import db from '../db/connection.js';
import { esDiaValido, hoyNegocio, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
import { ApiError } from '../utils/api-error.js';
import { factorMedida } from './presentacion.js';
import { listarProductosDeProveedor } from './stock.service.js';

// Tope de longitud de los textos libres (nombre, teléfono, email, condición de pago).
const MAX_TEXTO = 200;
// Tope de un monto en pesos, el mismo de precios y gastos (Number.isInteger(1e21) es true).
const MAX_MONTO = 1_000_000_000;
const MAX_LINEAS = 200;
const MAX_CANTIDAD = 10_000_000;

const COMPROBANTES = { remito: 'Remito', factura: 'Factura' };
// Una deuda cargada a mano puede no tener comprobante (2026-10-29).
const COMPROBANTES_DEUDA = { ...COMPROBANTES, sin: 'Sin comprobante' };
const MAX_TOTAL = 1_000_000_000_000;
const MEDIOS_PAGO = ['efectivo', 'mercado_pago', 'cheque'];

function validarString(valor, campo, { requerido = true, maxLength = MAX_TEXTO } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ApiError(400, `${campo} es requerido`);
    return null;
  }
  if (typeof valor !== 'string') throw new ApiError(400, `${campo} tiene que ser texto`);
  const limpio = valor.trim();
  if (limpio.length > maxLength) throw new ApiError(400, `${campo} no puede superar ${maxLength} caracteres`);
  return limpio;
}

function validarEntero(valor, campo, { minimo = null, maximo = null } = {}) {
  // Solo número: Number(true) vale 1 y Number('') vale 0, y se aceptaban.
  if (typeof valor !== 'number' || !Number.isInteger(valor)) throw new ApiError(400, `${campo} tiene que ser un número entero`);
  if (minimo !== null && valor < minimo) throw new ApiError(400, `${campo} no puede ser menor a ${minimo}`);
  if (maximo !== null && valor > maximo) throw new ApiError(400, `${campo} no puede superar ${maximo.toLocaleString('es-AR')}`);
  return valor;
}

function validarFecha(valor, campo) {
  if (!esDiaValido(valor)) throw new ApiError(400, `${campo} no es una fecha válida (AAAA-MM-DD)`);
  return valor;
}

// Fecha para pagar una boleta (opción A del usuario, 2026-10-29): la que trae la factura o el
// remito. Sin ella vence el mismo día de la boleta. Nunca antes de esa fecha.
function validarVence(valor, fecha) {
  if (valor === undefined || valor === null || valor === '') return fecha;
  const vence = validarFecha(valor, 'El vencimiento');
  if (vence < fecha) throw new ApiError(400, 'El vencimiento no puede ser anterior a la fecha de la boleta.');
  return vence;
}

function textoComprobante(c) {
  if (c.comprobante_tipo === 'sin') return 'Sin comprobante';
  const tipo = COMPROBANTES[c.comprobante_tipo];
  return c.comprobante_numero ? `${tipo} ${c.comprobante_numero}` : `${tipo} sin número`;
}

async function obtenerProveedorActivo(id) {
  const proveedor = await db.prepare('SELECT * FROM proveedores WHERE id = ? AND eliminado_en IS NULL').get(id);
  if (!proveedor) throw new ApiError(404, 'Proveedor no encontrado');
  return proveedor;
}

// Lo que se le debe a cada proveedor, su última compra y lo comprado en el mes (lista de
// Proveedores, 2026-10-28). Los pagos son siempre de compras activas (una compra con pagos no se
// anula), así que saldo = compras activas − pagos activos.
const SELECT_PROVEEDORES = `
  SELECT pr.*,
    COALESCE((SELECT SUM(c.total) FROM compras_proveedor c WHERE c.proveedor_id = pr.id AND c.anulada_en IS NULL), 0)
      - COALESCE((SELECT SUM(pg.monto) FROM pagos_proveedor pg WHERE pg.proveedor_id = pr.id AND pg.anulado_en IS NULL), 0) AS saldo,
    (SELECT MAX(c.fecha) FROM compras_proveedor c WHERE c.proveedor_id = pr.id AND c.anulada_en IS NULL) AS ultima_compra,
    COALESCE((
      SELECT SUM(c.total) FROM compras_proveedor c
      WHERE c.proveedor_id = pr.id AND c.anulada_en IS NULL
        AND date_trunc('month', c.fecha) = date_trunc('month', ${SQL_HOY_NEGOCIO})
    ), 0) AS comprado_mes
  FROM proveedores pr
`;

export function listarProveedores({ buscar } = {}) {
  if (buscar) {
    return db
      .prepare(`${SELECT_PROVEEDORES} WHERE pr.eliminado_en IS NULL AND pr.nombre ILIKE ? ORDER BY LOWER(pr.nombre)`)
      .all(`%${buscar}%`);
  }
  return db.prepare(`${SELECT_PROVEEDORES} WHERE pr.eliminado_en IS NULL ORDER BY LOWER(pr.nombre)`).all();
}

// Perfil del proveedor: sus datos, lo que trajo (cada compra con sus líneas y lo pagado), los
// pagos, sus productos y los pedidos de antes (ya no se cargan, quedan como historial).
export async function obtenerProveedor(id, { rol } = {}) {
  const proveedor = await db.prepare(`${SELECT_PROVEEDORES} WHERE pr.id = ? AND pr.eliminado_en IS NULL`).get(id);
  if (!proveedor) throw new ApiError(404, 'Proveedor no encontrado');

  const compras = await db
    .prepare(
      `SELECT c.id, c.fecha, c.vence, c.comprobante_tipo, c.comprobante_numero, c.total, c.creado_en, c.anulada_en,
         c.cargada_a_mano, c.nota, u.nombre AS usuario_nombre, ua.nombre AS anulada_por_nombre,
         COALESCE((SELECT SUM(pg.monto) FROM pagos_proveedor pg WHERE pg.compra_id = c.id AND pg.anulado_en IS NULL), 0) AS pagado
       FROM compras_proveedor c
       JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN usuarios ua ON ua.id = c.anulada_por
       WHERE c.proveedor_id = ?
       ORDER BY c.fecha DESC, c.id DESC`
    )
    .all(id);
  const items = await db
    .prepare(
      `SELECT ci.id, ci.compra_id, ci.producto_id, p.nombre AS producto_nombre, p.medida, ci.cantidad, ci.pack_nombre,
         ci.pack_unidades, ci.cantidad_presentacion, ci.costo_unitario, ci.subtotal, ci.fecha_vencimiento
       FROM compra_items ci
       JOIN compras_proveedor c ON c.id = ci.compra_id
       JOIN productos p ON p.id = ci.producto_id
       WHERE c.proveedor_id = ?
       ORDER BY ci.id`
    )
    .all(id);
  const pagos = await db
    .prepare(
      `SELECT pg.id, pg.compra_id, pg.fecha, pg.monto, pg.medio, pg.sale_de_caja, pg.cheque_numero, pg.cheque_banco,
         pg.cheque_fecha_cobro, pg.detalle, pg.creado_en, pg.anulado_en,
         u.nombre AS usuario_nombre, ua.nombre AS anulado_por_nombre,
         c.comprobante_tipo AS compra_comprobante_tipo, c.comprobante_numero AS compra_comprobante_numero
       FROM pagos_proveedor pg
       JOIN usuarios u ON u.id = pg.usuario_id
       LEFT JOIN usuarios ua ON ua.id = pg.anulado_por
       JOIN compras_proveedor c ON c.id = pg.compra_id
       WHERE pg.proveedor_id = ?
       ORDER BY pg.fecha DESC, pg.id DESC`
    )
    .all(id);
  const correcciones = await db
    .prepare(
      `SELECT cc.id, cc.compra_id, cc.motivo, cc.antes_tipo, cc.antes_numero, cc.antes_fecha, cc.antes_total,
         cc.despues_tipo, cc.despues_numero, cc.despues_fecha, cc.despues_total, cc.antes_vence, cc.despues_vence,
         cc.creado_en, u.nombre AS usuario_nombre
       FROM correcciones_compra cc
       JOIN compras_proveedor c ON c.id = cc.compra_id
       JOIN usuarios u ON u.id = cc.usuario_id
       WHERE c.proveedor_id = ?
       ORDER BY cc.id DESC`
    )
    .all(id);
  const pedidos = await db
    .prepare(
      `SELECT id, fecha, estado FROM pedidos_proveedor
       WHERE proveedor_id = ? AND eliminado_en IS NULL ORDER BY fecha DESC, id DESC`
    )
    .all(id);
  const itemsPedidos = await db
    .prepare(
      `SELECT pi.pedido_id, p.nombre AS producto_nombre, pi.cantidad
       FROM pedido_items pi JOIN pedidos_proveedor pp ON pp.id = pi.pedido_id JOIN productos p ON p.id = pi.producto_id
       WHERE pp.proveedor_id = ? ORDER BY pi.id`
    )
    .all(id);

  const activas = compras.filter((c) => !c.anulada_en);
  return {
    ...proveedor,
    total_comprado: activas.reduce((a, c) => a + c.total, 0),
    total_pagado: pagos.filter((p) => !p.anulado_en).reduce((a, p) => a + p.monto, 0),
    productos: await listarProductosDeProveedor(id, { rol }),
    compras: compras.map((c) => ({
      ...c,
      anulada: Boolean(c.anulada_en),
      items: items.filter((i) => i.compra_id === c.id),
      correcciones: correcciones.filter((x) => x.compra_id === c.id),
    })),
    pagos: pagos.map((p) => ({ ...p, anulado: Boolean(p.anulado_en) })),
    pedidos_anteriores: pedidos.map((p) => ({ ...p, items: itemsPedidos.filter((i) => i.pedido_id === p.id) })),
  };
}

export async function crearProveedor(datos, { rol } = {}) {
  const nombre = validarString(datos.nombre, 'nombre');
  const telefono = validarString(datos.telefono, 'telefono', { requerido: false });
  const email = validarString(datos.email, 'email', { requerido: false });
  const condicionPago = validarString(datos.condicion_pago, 'condicion_pago', { requerido: false });

  const resultado = await db
    .prepare('INSERT INTO proveedores (nombre, telefono, email, condicion_pago) VALUES (?, ?, ?, ?) RETURNING id')
    .run(nombre, telefono, email, condicionPago);

  return obtenerProveedor(resultado.lastInsertRowid, { rol });
}

// Leer-decidir-escribir en una transacción: si otro da de baja al proveedor en el medio, no se
// edita uno ya eliminado.
export async function editarProveedor(id, datos, { rol } = {}) {
  await db.transaction(async () => {
    await obtenerProveedorActivo(id);

    const actualizaciones = {};
    if (datos.nombre !== undefined) actualizaciones.nombre = validarString(datos.nombre, 'nombre');
    if (datos.telefono !== undefined) {
      actualizaciones.telefono = validarString(datos.telefono, 'telefono', { requerido: false });
    }
    if (datos.email !== undefined) {
      actualizaciones.email = validarString(datos.email, 'email', { requerido: false });
    }
    if (datos.condicion_pago !== undefined) {
      actualizaciones.condicion_pago = validarString(datos.condicion_pago, 'condicion_pago', { requerido: false });
    }

    const claves = Object.keys(actualizaciones);
    if (claves.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');

    const set = claves.map((c) => `${c} = ?`).join(', ');
    const valores = claves.map((c) => actualizaciones[c]);

    await db
      .prepare(`UPDATE proveedores SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...valores, id);
  });

  return obtenerProveedor(id, { rol });
}

export async function eliminarProveedor(id) {
  await db.transaction(async () => {
    await obtenerProveedorActivo(id);
    await db.prepare('UPDATE proveedores SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  });
}

// -- Pagos a proveedores --

// Un pago: monto, fecha, medio y, si es cheque, sus datos. En efectivo se elige si sale de la
// caja (decisión del usuario, 2026-10-28).
function validarPago(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new ApiError(400, 'Faltan los datos del pago');
  const medio = datos.medio;
  if (!MEDIOS_PAGO.includes(medio)) throw new ApiError(400, 'medio tiene que ser efectivo, mercado_pago o cheque');
  if (datos.sale_de_caja !== undefined && typeof datos.sale_de_caja !== 'boolean') {
    throw new ApiError(400, 'sale_de_caja tiene que ser true o false');
  }
  const esCheque = medio === 'cheque';
  return {
    monto: validarEntero(datos.monto, 'El monto del pago', { minimo: 1, maximo: MAX_MONTO }),
    fecha: validarFecha(datos.fecha ?? hoyNegocio(), 'La fecha del pago'),
    medio,
    sale_de_caja: medio === 'efectivo' && datos.sale_de_caja === true,
    cheque_numero: esCheque ? validarString(datos.cheque_numero, 'El número de cheque', { requerido: false, maxLength: 50 }) : null,
    cheque_banco: esCheque ? validarString(datos.cheque_banco, 'El banco', { requerido: false, maxLength: 100 }) : null,
    cheque_fecha_cobro: esCheque && datos.cheque_fecha_cobro != null ? validarFecha(datos.cheque_fecha_cobro, 'La fecha de cobro') : null,
    detalle: validarString(datos.detalle, 'El detalle', { requerido: false }),
  };
}

// Dentro de la transacción de quien llama. Si sale de la caja, se anota también como gasto de
// caja (cuenta en el arqueo del turno y aparece en Ventas diarias).
async function insertarPago(proveedor, compra, pago, usuarioId) {
  const pendiente = compra.total - compra.pagado;
  if (pago.monto > pendiente) {
    throw new ApiError(400, `El pago supera lo que falta pagar de ${textoComprobante(compra)} (${pendiente.toLocaleString('es-AR')}).`);
  }
  let gastoId = null;
  if (pago.sale_de_caja) {
    const gasto = await db
      .prepare('INSERT INTO gastos_caja (usuario_id, concepto, monto, proveedor_id) VALUES (?, ?, ?, ?) RETURNING id')
      .get(usuarioId, `Pago a ${proveedor.nombre} · ${textoComprobante(compra)}`.slice(0, MAX_TEXTO), pago.monto, proveedor.id);
    gastoId = gasto.id;
  }
  await db
    .prepare(
      `INSERT INTO pagos_proveedor (proveedor_id, compra_id, usuario_id, fecha, monto, medio, sale_de_caja, gasto_caja_id,
         cheque_numero, cheque_banco, cheque_fecha_cobro, detalle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      proveedor.id, compra.id, usuarioId, pago.fecha, pago.monto, pago.medio, pago.sale_de_caja, gastoId,
      pago.cheque_numero, pago.cheque_banco, pago.cheque_fecha_cobro, pago.detalle
    );
}

async function obtenerCompraActiva(proveedorId, compraId) {
  const compra = await db
    .prepare(
      `SELECT c.*, COALESCE((SELECT SUM(pg.monto) FROM pagos_proveedor pg WHERE pg.compra_id = c.id AND pg.anulado_en IS NULL), 0) AS pagado
       FROM compras_proveedor c WHERE c.id = ? AND c.proveedor_id = ? AND c.anulada_en IS NULL`
    )
    .get(compraId, proveedorId);
  if (!compra) throw new ApiError(404, 'Compra no encontrada');
  return compra;
}

// Admin + Encargado (decisión del usuario, 2026-10-28). Leer lo pagado, decidir y escribir en una
// transacción: dos pagos a la vez no pueden pasarse del total.
export async function registrarPago(proveedorId, datos, { usuarioId, rol }) {
  const compraId = validarEntero(datos?.compra_id, 'compra_id', { minimo: 1 });
  const pago = validarPago(datos);
  await db.transaction(async () => {
    const proveedor = await obtenerProveedorActivo(proveedorId);
    const compra = await obtenerCompraActiva(proveedorId, compraId);
    await insertarPago(proveedor, compra, pago, usuarioId);
  });
  return obtenerProveedor(proveedorId, { rol });
}

// Anular un pago (cargado mal): queda en el historial y, si salió de la caja, se da de baja su
// gasto, así el efectivo del turno vuelve a lo que era.
export async function anularPago(proveedorId, pagoId, { usuarioId, rol }) {
  await db.transaction(async () => {
    await obtenerProveedorActivo(proveedorId);
    const pago = await db
      .prepare('SELECT id, gasto_caja_id FROM pagos_proveedor WHERE id = ? AND proveedor_id = ? AND anulado_en IS NULL')
      .get(pagoId, proveedorId);
    if (!pago) throw new ApiError(404, 'Pago no encontrado');
    await db.prepare('UPDATE pagos_proveedor SET anulado_en = CURRENT_TIMESTAMP, anulado_por = ? WHERE id = ?').run(usuarioId, pagoId);
    if (pago.gasto_caja_id) {
      await db.prepare('UPDATE gastos_caja SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ? AND eliminado_en IS NULL').run(pago.gasto_caja_id);
    }
  });
  return obtenerProveedor(proveedorId, { rol });
}

// -- Mercadería que trae un proveedor (compras) --

// Una línea: el producto, cuánto (en packs con `en_packs`, si no en la medida chica: unidades,
// gramos o ml), el costo de esa presentación (por pack, por unidad o por kg/litro) y el
// vencimiento. Devuelve lo que se guarda.
async function validarLinea(item, i) {
  if (!item || typeof item !== 'object') throw new ApiError(400, `La línea ${i + 1} no es válida`);
  const productoId = validarEntero(item.producto_id, `items[${i}].producto_id`, { minimo: 1 });
  const producto = await db
    .prepare('SELECT id, nombre, medida, pack_nombre, pack_unidades FROM productos WHERE id = ? AND eliminado_en IS NULL')
    .get(productoId);
  if (!producto) throw new ApiError(400, `El producto ${productoId} no existe o está eliminado`);
  if (item.en_packs !== undefined && typeof item.en_packs !== 'boolean') throw new ApiError(400, 'en_packs tiene que ser true o false');
  const enPacks = item.en_packs === true;
  if (enPacks && !producto.pack_unidades) throw new ApiError(400, `«${producto.nombre}» no tiene pack: cargalo en su medida`);
  const cargada = validarEntero(item.cantidad, `La cantidad de «${producto.nombre}»`, { minimo: 1, maximo: MAX_CANTIDAD });
  const costo = validarEntero(item.costo, `El costo de «${producto.nombre}»`, { minimo: 0, maximo: MAX_MONTO });
  const cantidad = enPacks ? cargada * producto.pack_unidades : cargada;
  if (cantidad > MAX_CANTIDAD) throw new ApiError(400, `La cantidad de «${producto.nombre}» es demasiado grande`);
  return {
    producto,
    cantidad,
    pack_nombre: enPacks ? producto.pack_nombre : null,
    pack_unidades: enPacks ? producto.pack_unidades : null,
    cantidad_presentacion: enPacks ? cargada : null,
    costo_unitario: costo,
    subtotal: enPacks ? cargada * costo : Math.round((cantidad * costo) / factorMedida(producto.medida)),
    fecha_vencimiento: item.fecha_vencimiento != null ? validarFecha(item.fecha_vencimiento, `El vencimiento de «${producto.nombre}»`) : null,
  };
}

// Cargar lo que trajo un proveedor (pedido del usuario, 2026-10-28): en una sola transacción, la
// compra, un lote por línea (así entra al stock) y, si se le pagó algo en el momento, el pago.
export async function crearCompra(proveedorId, datos, { usuarioId, rol }) {
  const fecha = validarFecha(datos.fecha ?? hoyNegocio(), 'La fecha');
  const vence = validarVence(datos.vence, fecha);
  if (!COMPROBANTES[datos.comprobante_tipo]) throw new ApiError(400, 'comprobante_tipo tiene que ser remito o factura');
  const numero = validarString(datos.comprobante_numero, 'El número de comprobante', { requerido: false, maxLength: 50 });
  if (!Array.isArray(datos.items) || datos.items.length === 0) throw new ApiError(400, 'Agregá al menos un producto');
  if (datos.items.length > MAX_LINEAS) throw new ApiError(400, `Una compra no puede tener más de ${MAX_LINEAS} líneas`);
  const pago = datos.pago != null ? validarPago(datos.pago) : null;

  await db.transaction(async () => {
    const proveedor = await obtenerProveedorActivo(proveedorId);
    const lineas = [];
    for (const [i, item] of datos.items.entries()) lineas.push(await validarLinea(item, i));
    const total = lineas.reduce((a, l) => a + l.subtotal, 0);
    if (total > 1_000_000_000_000) throw new ApiError(400, 'El total de la compra es demasiado grande');

    const compra = await db
      .prepare(
        `INSERT INTO compras_proveedor (proveedor_id, usuario_id, fecha, vence, comprobante_tipo, comprobante_numero, total)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
      )
      .get(proveedorId, usuarioId, fecha, vence, datos.comprobante_tipo, numero, total);
    for (const l of lineas) {
      const lote = await db
        .prepare('INSERT INTO lotes (producto_id, cantidad, fecha_ingreso, fecha_vencimiento) VALUES (?, ?, ?, ?) RETURNING id')
        .get(l.producto.id, l.cantidad, fecha, l.fecha_vencimiento);
      await db
        .prepare(
          `INSERT INTO compra_items (compra_id, producto_id, lote_id, cantidad, pack_nombre, pack_unidades, cantidad_presentacion,
             costo_unitario, subtotal, fecha_vencimiento)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          compra.id, l.producto.id, lote.id, l.cantidad, l.pack_nombre, l.pack_unidades, l.cantidad_presentacion,
          l.costo_unitario, l.subtotal, l.fecha_vencimiento
        );
    }
    if (pago) await insertarPago(proveedor, { ...compra, pagado: 0 }, pago, usuarioId);
  });
  return obtenerProveedor(proveedorId, { rol });
}

// Anular una compra cargada mal: retira del stock sus lotes y la deja en el historial. Solo si no
// tiene pagos (se anulan primero) y si de ningún lote se vendió ni retiró nada: si no, el stock
// quedaría mal; eso se corrige desde Stock.
export async function anularCompra(proveedorId, compraId, { usuarioId, rol }) {
  await db.transaction(async () => {
    await obtenerProveedorActivo(proveedorId);
    const compra = await obtenerCompraActiva(proveedorId, compraId);
    if (compra.pagado > 0) throw new ApiError(409, 'Esta compra tiene pagos: anulalos primero, en la pestaña Pagos.');
    const lineas = await db
      .prepare(
        `SELECT ci.cantidad, ci.lote_id, p.nombre, l.cantidad AS en_lote, l.eliminado_en
         FROM compra_items ci JOIN lotes l ON l.id = ci.lote_id JOIN productos p ON p.id = ci.producto_id
         WHERE ci.compra_id = ?`
      )
      .all(compraId);
    const tocada = lineas.find((l) => l.eliminado_en || l.en_lote !== l.cantidad);
    if (tocada) {
      throw new ApiError(409, `Ya se vendió o se retiró parte de «${tocada.nombre}» de esta compra: no se puede anular. Corregilo desde Stock.`);
    }
    for (const l of lineas) {
      await db.prepare('UPDATE lotes SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(l.lote_id);
    }
    await db.prepare('UPDATE compras_proveedor SET anulada_en = CURRENT_TIMESTAMP, anulada_por = ? WHERE id = ?').run(usuarioId, compraId);
  });
  return obtenerProveedor(proveedorId, { rol });
}

// -- A mano, desde Saldos pendientes (pedido del usuario, 2026-10-29) --

// Comprobante, número y fecha de una boleta. Sin comprobante no lleva número.
function validarComprobante(datos, tipos) {
  if (!tipos[datos.comprobante_tipo]) throw new ApiError(400, `comprobante_tipo tiene que ser ${Object.keys(tipos).join(', ')}`);
  return {
    comprobante_tipo: datos.comprobante_tipo,
    comprobante_numero:
      datos.comprobante_tipo === 'sin'
        ? null
        : validarString(datos.comprobante_numero, 'El número de comprobante', { requerido: false, maxLength: 50 }),
    fecha: validarFecha(datos.fecha, 'La fecha'),
  };
}

// Deuda con un proveedor sin cargar mercadería (un saldo de antes, una boleta que no se carga
// producto por producto): una compra sin líneas, que no toca el stock. Se paga y se anula como
// cualquier compra.
export async function crearDeudaManual(proveedorId, datos, { usuarioId, rol }) {
  const comprobante = validarComprobante(datos, COMPROBANTES_DEUDA);
  const vence = validarVence(datos.vence, comprobante.fecha);
  const monto = validarEntero(datos.monto, 'El monto', { minimo: 1, maximo: MAX_TOTAL });
  const nota = validarString(datos.nota, 'La nota', { requerido: false });
  await db.transaction(async () => {
    await obtenerProveedorActivo(proveedorId);
    await db
      .prepare(
        `INSERT INTO compras_proveedor (proveedor_id, usuario_id, fecha, vence, comprobante_tipo, comprobante_numero, total, cargada_a_mano, nota)
         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?)`
      )
      .run(proveedorId, usuarioId, comprobante.fecha, vence, comprobante.comprobante_tipo, comprobante.comprobante_numero, monto, nota);
  });
  return obtenerProveedor(proveedorId, { rol });
}

// Corregir una boleta como dice la factura o el remito: comprobante, número, fecha, vencimiento y
// total. La compra queda con lo corregido (el saldo y los pagos usan el total real) y lo de antes se
// guarda en correcciones_compra con el motivo. El stock y los costos no cambian. El total no puede
// quedar por debajo de lo ya pagado.
export async function corregirCompra(proveedorId, compraId, datos, { usuarioId, rol }) {
  const motivo = validarString(datos.motivo, 'El motivo');
  const total = validarEntero(datos.total, 'El total', { minimo: 0, maximo: MAX_TOTAL });
  await db.transaction(async () => {
    await obtenerProveedorActivo(proveedorId);
    const compra = await obtenerCompraActiva(proveedorId, compraId);
    const comprobante = validarComprobante(datos, compra.cargada_a_mano ? COMPROBANTES_DEUDA : COMPROBANTES);
    // Sin vencimiento en el pedido queda el que tenía, o la fecha nueva si la boleta pasó a ser posterior.
    const vence =
      datos.vence === undefined
        ? (compra.vence < comprobante.fecha ? comprobante.fecha : compra.vence)
        : validarVence(datos.vence, comprobante.fecha);
    if (total < compra.pagado) {
      throw new ApiError(409, `El total no puede quedar por debajo de lo ya pagado (${compra.pagado.toLocaleString('es-AR')}).`);
    }
    const igual =
      comprobante.comprobante_tipo === compra.comprobante_tipo &&
      comprobante.comprobante_numero === compra.comprobante_numero &&
      comprobante.fecha === compra.fecha &&
      vence === compra.vence &&
      total === compra.total;
    if (igual) throw new ApiError(400, 'No cambiaste nada de la boleta.');
    await db
      .prepare(
        `INSERT INTO correcciones_compra (compra_id, usuario_id, motivo, antes_tipo, antes_numero, antes_fecha, antes_total,
           despues_tipo, despues_numero, despues_fecha, despues_total, antes_vence, despues_vence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        compraId, usuarioId, motivo, compra.comprobante_tipo, compra.comprobante_numero, compra.fecha, compra.total,
        comprobante.comprobante_tipo, comprobante.comprobante_numero, comprobante.fecha, total, compra.vence, vence
      );
    await db
      .prepare('UPDATE compras_proveedor SET comprobante_tipo = ?, comprobante_numero = ?, fecha = ?, vence = ?, total = ? WHERE id = ?')
      .run(comprobante.comprobante_tipo, comprobante.comprobante_numero, comprobante.fecha, vence, total, compraId);
  });
  return obtenerProveedor(proveedorId, { rol });
}
