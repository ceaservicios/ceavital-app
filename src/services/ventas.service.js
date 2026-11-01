import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { existeClienteActivo, registrarAjustePorAnulacion, registrarCargoPorVenta } from './clientes-empresa.service.js';
import { stockDisponible } from './reservas.service.js';
import { esDiaValido, sqlDiaNegocio, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
import { mediosPagoPermitidos } from './modulos.service.js';
import {
  aplicarCombos,
  armarLineas,
  COLUMNAS_PRESENTACION,
  describirCantidad,
  juntarLineas,
  lineasDeCombo,
  validarPresentacion,
} from './presentacion.js';
import { combosVigentes } from './combos.service.js';

// 'cta_cte' (B2B Fase 1) es distinto de 'fiado' -- 'fiado' sigue siendo la
// venta fiada informal, sin cliente ni ledger (decisión confirmada con el
// usuario). 'cta_cte' SIEMPRE requiere un cliente_empresa_id real, ver
// validarClienteEmpresa más abajo.
// 'cta_cte' solo se acepta si el plan incluye el módulo de clientes-empresa
// (ver modulos.service.mediosPagoPermitidos).
async function validarMedioPago(valor) {
  const permitidos = await mediosPagoPermitidos();
  if (!permitidos.includes(valor)) {
    throw new ApiError(400, `medio_pago tiene que ser uno de: ${permitidos.join(', ')}`);
  }
  return valor;
}

// Varios medios en una venta (pedido del usuario, 2026-11-01): la venta guarda 'mixto' y cada parte
// va en venta_pagos (migración 034). Se reparte entre los medios que se cobran en el momento y Pago
// pendiente (decisión del usuario); Cuenta corriente no, porque carga el total a la deuda del cliente.
const MEDIOS_REPARTIBLES = ['efectivo', 'tarjeta', 'transferencia_qr', 'mercado_pago', 'fiado'];
const MAX_MONTO = 1_000_000_000;

const pesos = (n) => `$${n.toLocaleString('es-AR')}`;

// Las partes llegan como [{ medio_pago, monto }]: dos o más medios distintos, cada uno con pesos
// enteros. Que sumen el total se controla al registrar, cuando ya se sabe el total.
function validarPagos(pagos) {
  if (!Array.isArray(pagos) || pagos.length < 2) {
    throw new ApiError(400, 'Para cobrar con varios medios cargá el monto de al menos dos.');
  }
  const vistos = new Set();
  return pagos.map((pago, i) => {
    const medio = pago?.medio_pago;
    if (!MEDIOS_REPARTIBLES.includes(medio)) {
      throw new ApiError(400, `pagos[${i}].medio_pago tiene que ser uno de: ${MEDIOS_REPARTIBLES.join(', ')}`);
    }
    if (vistos.has(medio)) throw new ApiError(400, 'Cada medio de pago va una sola vez.');
    vistos.add(medio);
    // Solo número o texto numérico: Number(true) vale 1 (ver caja.service.js).
    if (typeof pago.monto !== 'number' && typeof pago.monto !== 'string') {
      throw new ApiError(400, `pagos[${i}].monto tiene que ser un número entero`);
    }
    const monto = validarEntero(pago.monto, `pagos[${i}].monto`, { minimo: 1 });
    if (monto > MAX_MONTO) throw new ApiError(400, `pagos[${i}].monto no puede superar ${pesos(MAX_MONTO)}`);
    return { medio_pago: medio, monto };
  });
}

// Las partes de cada venta, para sumar por medio (Cierre de caja y Ventas): la de un solo medio es
// una parte por el total; la de varios, sus filas de venta_pagos. Va después de "FROM ventas v" y da
// pago.medio y pago.monto.
export const SQL_PARTES_DE_LA_VENTA = `JOIN LATERAL (
    SELECT v.medio_pago AS medio, v.total AS monto WHERE v.medio_pago <> 'mixto'
    UNION ALL
    SELECT vp.medio_pago, vp.monto FROM venta_pagos vp WHERE vp.venta_id = v.id
  ) pago ON TRUE`;

function validarEntero(valor, campo, { minimo = null } = {}) {
  const n = Number(valor);
  if (!Number.isInteger(n)) throw new ApiError(400, `${campo} tiene que ser un número entero`);
  if (minimo !== null && n < minimo) throw new ApiError(400, `${campo} no puede ser menor a ${minimo}`);
  return n;
}

function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'items es requerido y tiene que tener al menos un producto');
  }
  // presentacion: 'unidad' (por defecto) o 'pack' (venta por pack, 2026-10-11). Las líneas
  // repetidas del mismo producto y presentación se juntan (el precio por cantidad mira el total).
  return juntarLineas(
    items.map((item, i) => ({
      producto_id: validarEntero(item?.producto_id, `items[${i}].producto_id`, { minimo: 1 }),
      cantidad: validarEntero(item?.cantidad, `items[${i}].cantidad`, { minimo: 1 }),
      presentacion: validarPresentacion(item?.presentacion, `items[${i}].presentacion`),
    }))
  );
}

async function obtenerProductoActivo(productoId) {
  const producto = await db
    .prepare(`SELECT id, nombre, precio_venta, ${COLUMNAS_PRESENTACION} FROM productos WHERE id = ? AND eliminado_en IS NULL`)
    .get(productoId);
  if (!producto) throw new ApiError(404, `Producto ${productoId} no encontrado`);
  return producto;
}

// Mismo criterio FEFO que Stock (stock.service.js): el lote que vence antes
// primero, los sin vencimiento al final ordenados por fecha_ingreso (FIFO).
// Excluye lotes vencidos -- un lote vencido no es "stock_vendible", no se
// puede descontar de ahí en una venta nueva.
function lotesVendiblesFefo(productoId) {
  return db
    .prepare(
      `SELECT id, cantidad FROM lotes
       WHERE producto_id = ? AND eliminado_en IS NULL AND cantidad > 0
         AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= ${SQL_HOY_NEGOCIO})
       ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC, fecha_ingreso ASC`
    )
    .all(productoId);
}

// `pagos`: las partes de una venta con varios medios ([{ medio_pago, monto }]); null en las de uno.
async function obtenerVentaConItems(ventaId) {
  const venta = await db
    .prepare(
      `SELECT v.*,
              (SELECT json_agg(json_build_object('medio_pago', vp.medio_pago, 'monto', vp.monto) ORDER BY vp.id)
                 FROM venta_pagos vp WHERE vp.venta_id = v.id) AS pagos
       FROM ventas v WHERE v.id = ?`
    )
    .get(ventaId);
  if (!venta) throw new ApiError(404, 'Venta no encontrada');

  const items = await db
    .prepare(
      `SELECT vi.*, p.nombre AS producto_nombre, p.medida
       FROM venta_items vi
       JOIN productos p ON p.id = vi.producto_id
       WHERE vi.venta_id = ?
       ORDER BY vi.id`
    )
    .all(ventaId);

  return { ...venta, items };
}

// creado_en guarda segundos: dos ventas del mismo segundo se desempatan por id,
// así la primera es siempre la última registrada ("Anular último ticket" en Caja).
export function listarVentas({ fecha } = {}) {
  if (fecha) {
    return db
      .prepare(`SELECT * FROM ventas WHERE ${sqlDiaNegocio('creado_en')} = ?::date ORDER BY creado_en DESC, id DESC`)
      .all(fecha);
  }
  return db.prepare('SELECT * FROM ventas ORDER BY creado_en DESC, id DESC').all();
}

// Ventas diarias (2026-10-16): el listado con filtros de la pantalla "Ventas diarias". Los
// totales son siempre de las ventas registradas (las anuladas no suman, como en Caja y en el
// cierre), aunque la lista muestre las anuladas. El cliente es el de Cuenta Corriente: las
// demás ventas no guardan cliente (decisión del usuario).
// Una venta con varios medios (2026-11-01) suma cada parte en su medio, y aparece al filtrar por
// cualquiera de ellos o por 'mixto'.
const MEDIOS_FILTRO = ['efectivo', 'tarjeta', 'transferencia_qr', 'mercado_pago', 'fiado', 'cta_cte', 'mixto'];
const ESTADOS_FILTRO = ['registrada', 'anulada', 'todas'];
const TOPE_LISTADO = 1000;

function diaFiltro(valor, campo) {
  if (!esDiaValido(valor)) throw new ApiError(400, `${campo} tiene que ser una fecha válida (AAAA-MM-DD)`);
  return valor;
}

function idFiltro(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' && typeof valor !== 'number') throw new ApiError(400, `${campo} inválido`);
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export async function buscarVentas({ desde, hasta, medio_pago, cliente_empresa_id, usuario_id, estado } = {}) {
  const dia1 = diaFiltro(desde, 'desde');
  const dia2 = diaFiltro(hasta ?? desde, 'hasta');
  if (dia1 > dia2) throw new ApiError(400, 'La fecha "desde" no puede ser posterior a "hasta"');
  const estadoLista = estado || 'registrada';
  if (!ESTADOS_FILTRO.includes(estadoLista)) throw new ApiError(400, `estado tiene que ser uno de: ${ESTADOS_FILTRO.join(', ')}`);

  const enRango = `${sqlDiaNegocio('v.creado_en')} BETWEEN ?::date AND ?::date`;
  const condiciones = [enRango];
  const params = [dia1, dia2];
  if (medio_pago) {
    if (!MEDIOS_FILTRO.includes(medio_pago)) throw new ApiError(400, `medio_pago tiene que ser uno de: ${MEDIOS_FILTRO.join(', ')}`);
    condiciones.push('(v.medio_pago = ? OR EXISTS (SELECT 1 FROM venta_pagos vp WHERE vp.venta_id = v.id AND vp.medio_pago = ?))');
    params.push(medio_pago, medio_pago);
  }
  // Filtrando por un medio, los totales son solo lo cobrado por ese medio (de una venta con varios,
  // su parte); con 'mixto', todas las partes de esas ventas.
  const medioDeLaParte = medio_pago && medio_pago !== 'mixto' ? medio_pago : null;
  const clienteId = idFiltro(cliente_empresa_id, 'cliente_empresa_id');
  if (clienteId) {
    condiciones.push('v.cliente_empresa_id = ?');
    params.push(clienteId);
  }
  const usuarioId = idFiltro(usuario_id, 'usuario_id');
  if (usuarioId) {
    condiciones.push('v.usuario_id = ?');
    params.push(usuarioId);
  }
  const filtros = condiciones.join(' AND ');

  const filas = await db
    .prepare(
      `SELECT v.id, v.creado_en, v.medio_pago, v.total, v.estado, v.anulada_en, v.usuario_id, v.cliente_empresa_id,
              u.nombre AS usuario_nombre, ua.nombre AS anulada_por_nombre, ce.razon_social AS cliente_razon_social,
              (SELECT COUNT(DISTINCT vi.producto_id::text || '|' || COALESCE(vi.pack_nombre, ''))
                 FROM venta_items vi WHERE vi.venta_id = v.id) AS cantidad_productos
       FROM ventas v
       JOIN usuarios u ON u.id = v.usuario_id
       LEFT JOIN usuarios ua ON ua.id = v.anulada_por
       LEFT JOIN clientes_empresa ce ON ce.id = v.cliente_empresa_id
       WHERE ${filtros}${estadoLista === 'todas' ? '' : ' AND v.estado = ?'}
       ORDER BY v.creado_en DESC, v.id DESC
       LIMIT ${TOPE_LISTADO + 1}`
    )
    .all(...params, ...(estadoLista === 'todas' ? [] : [estadoLista]));

  const porMedio = await db
    .prepare(
      `SELECT pago.medio, COUNT(*) AS cantidad, COALESCE(SUM(pago.monto), 0) AS total
       FROM ventas v ${SQL_PARTES_DE_LA_VENTA}
       WHERE ${filtros} AND v.estado = 'registrada'${medioDeLaParte ? ' AND pago.medio = ?' : ''}
       GROUP BY pago.medio`
    )
    .all(...params, ...(medioDeLaParte ? [medioDeLaParte] : []));
  // Los tickets se cuentan por venta: una con varios medios cuenta en cada uno, pero es un ticket.
  const cuenta = await db
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE v.estado = 'registrada') AS tickets,
              COUNT(*) FILTER (WHERE v.estado = 'anulada') AS anuladas
       FROM ventas v WHERE ${filtros}`
    )
    .get(...params);
  // Para el filtro "Cobró": quienes vendieron en esas fechas (sin mirar los otros filtros).
  const vendedores = await db
    .prepare(
      `SELECT DISTINCT u.id, u.nombre FROM ventas v JOIN usuarios u ON u.id = v.usuario_id
       WHERE ${enRango} ORDER BY u.nombre`
    )
    .all(dia1, dia2);

  const totales = { total: 0, tickets: Number(cuenta.tickets), anuladas: Number(cuenta.anuladas), por_medio: {} };
  for (const fila of porMedio) {
    const cantidad = Number(fila.cantidad);
    const total = Number(fila.total);
    totales.por_medio[fila.medio] = { cantidad, total };
    totales.total += total;
  }
  return {
    ventas: filas.slice(0, TOPE_LISTADO),
    hay_mas: filas.length > TOPE_LISTADO,
    totales,
    vendedores,
  };
}

export function obtenerVenta(id) {
  return obtenerVentaConItems(id);
}

// 'cta_cte' SIEMPRE necesita un cliente-empresa real y activo -- a diferencia
// de 'fiado', que nunca lo pidió (decisión confirmada con el usuario, B2B
// Fase 1: son 2 conceptos separados, no el mismo campo formalizado).
async function validarClienteEmpresa(medioPago, clienteEmpresaId) {
  if (medioPago !== 'cta_cte') return null;
  const id = Number(clienteEmpresaId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, 'cliente_empresa_id es requerido cuando medio_pago es "cta_cte"');
  }
  if (!(await existeClienteActivo(id))) throw new ApiError(404, `Cliente-empresa ${id} no encontrado`);
  return id;
}

// Carrito multi-producto: se registra una sola venta con todos los items al
// cierre (Docs/Instructivo-Funcional.md > Caja > "Armado de venta"). Un mismo
// producto puede necesitar tomarse de mas de un lote (venta_items.lote_id es
// por-lote, no por-producto) -- se reparte en orden FEFO hasta cubrir la
// cantidad pedida.
//
// Solo se puede vender el stock DISPONIBLE: lo vendible menos lo reservado por
// pedidos de clientes-empresa pendientes (B2B Fase 2). Al aprobar un pedido se
// llama a registrarVentaEnTransaccion con su pedidoId (su propia reserva no
// cuenta contra sí misma) y los precios que quedaron congelados al pedir.
//
// registrarVentaEnTransaccion tiene que correr DENTRO de un db.transaction()
// de quien la llama (registrarVenta, o la aprobación de un pedido, que además
// de la venta tiene que actualizar el pedido en la misma transacción).
//
// Venta por pack (2026-10-11): las líneas se arman con armarLineas (presentacion.js): las
// unidades de stock que mueve cada una, el precio de esa presentación (unidad, pack o precio por
// cantidad, que mira el total de su grupo de promoción) y la copia del pack. `lineasCongeladas`:
// al aprobar un pedido, las líneas tal como quedaron al pedir (presentación, precio y unidades),
// en vez de armarlas de nuevo.
//
// Varios medios (2026-11-01): con `pagos` en vez de `medio_pago`, la venta queda 'mixto' y cada parte
// en venta_pagos. Las partes tienen que sumar el total que calcula el servidor.
//
// Combos (2026-11-01, solo Caja): antes de ponerle precio a las líneas se saca lo que entra en los
// combos vigentes (aplicarCombos); eso va en líneas propias, cada una a su precio en la promo, y el
// resto se cobra como siempre. Al aprobar un pedido (lineasCongeladas) no se aplican.
export async function registrarVentaEnTransaccion(
  { medio_pago, pagos, items, cliente_empresa_id },
  { usuarioId, pedidoId = null, lineasCongeladas = null }
) {
  const partes = pagos != null ? validarPagos(pagos) : null;
  const medioPago = partes ? 'mixto' : await validarMedioPago(medio_pago);
  const clienteEmpresaId = await validarClienteEmpresa(medioPago, cliente_empresa_id);

  const lineas = [];
  if (lineasCongeladas) {
    for (const linea of lineasCongeladas) {
      lineas.push({ ...linea, producto: await obtenerProductoActivo(linea.producto_id) });
    }
  } else {
    const validados = validarItems(items);
    const productos = new Map();
    for (const item of validados) {
      if (!productos.has(item.producto_id)) productos.set(item.producto_id, await obtenerProductoActivo(item.producto_id));
    }
    const { aplicados, resto } = aplicarCombos(validados, await combosVigentes());
    for (const linea of armarLineas(resto, productos)) {
      lineas.push({ ...linea, producto: productos.get(linea.producto_id) });
    }
    for (const { combo, veces, partes } of aplicados) {
      for (const linea of lineasDeCombo(combo, veces, partes, productos)) {
        lineas.push({ ...linea, producto: productos.get(linea.producto_id) });
      }
    }
  }

  const ventaResult = await db
    .prepare('INSERT INTO ventas (usuario_id, medio_pago, cliente_empresa_id, total) VALUES (?, ?, ?, 0) RETURNING id')
    .run(usuarioId, medioPago, clienteEmpresaId);
  const ventaId = ventaResult.lastInsertRowid;

  let total = 0;

  // Las líneas se descuentan de a una: la segunda línea del mismo producto (unidad y pack)
  // ya ve el stock que se llevó la primera, porque los lotes se actualizan en esta transacción.
  for (const linea of lineas) {
    const { producto, producto_id, unidades } = linea;

    const disponible = await stockDisponible(producto_id, { excluirPedidoId: pedidoId });
    if (unidades > disponible) {
      throw new ApiError(409, `Stock insuficiente para "${producto.nombre}" (faltan ${describirCantidad(unidades - disponible, producto.medida)})`);
    }

    let restante = unidades;
    let tomadas = 0;
    let cobrado = 0;

    for (const lote of await lotesVendiblesFefo(producto_id)) {
      if (restante <= 0) break;
      const tomar = Math.min(lote.cantidad, restante);

      await db
        .prepare('UPDATE lotes SET cantidad = cantidad - ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
        .run(tomar, lote.id);

      // El subtotal de la línea se reparte entre los lotes en proporción a las unidades,
      // redondeando sobre lo acumulado: la suma de las filas da siempre el subtotal exacto
      // (un pack de $1.000 partido 1 + 2 unidades da $333 + $667). Por unidad da tomar × precio.
      tomadas += tomar;
      const subtotal = Math.round((linea.subtotal * tomadas) / unidades) - cobrado;
      cobrado += subtotal;

      await db
        .prepare(
          `INSERT INTO venta_items
             (venta_id, producto_id, lote_id, cantidad, precio_unitario, subtotal, pack_nombre, pack_unidades,
              precio_cantidad_desde, precio_cantidad_grupo, combo_id, combo_nombre)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          ventaId, producto_id, lote.id, tomar, linea.precio_unitario, subtotal,
          linea.pack_nombre, linea.pack_unidades, linea.precio_cantidad_desde, linea.precio_cantidad_grupo ?? null,
          linea.combo_id ?? null, linea.combo_nombre ?? null
        );

      total += subtotal;
      restante -= tomar;
    }

    if (restante > 0) {
      throw new ApiError(409, `Stock insuficiente para "${producto.nombre}" (faltan ${describirCantidad(restante, producto.medida)})`);
    }
  }

  await db.prepare('UPDATE ventas SET total = ? WHERE id = ?').run(total, ventaId);

  if (partes) {
    const cargado = partes.reduce((acc, parte) => acc + parte.monto, 0);
    if (cargado !== total) {
      throw new ApiError(409, `Los montos suman ${pesos(cargado)} y la venta es de ${pesos(total)}. Revisá los montos y volvé a cobrar.`);
    }
    for (const parte of partes) {
      await db
        .prepare('INSERT INTO venta_pagos (venta_id, medio_pago, monto) VALUES (?, ?, ?)')
        .run(ventaId, parte.medio_pago, parte.monto);
    }
  }

  // CARGO automático en la cuenta corriente del cliente (B2B Fase 1,
  // decisión confirmada con el usuario) -- misma transacción que el resto
  // de la venta: si algo de arriba falla (stock insuficiente), el ROLLBACK
  // se lleva también este insert, nunca queda un cargo sin venta real.
  if (clienteEmpresaId) {
    await registrarCargoPorVenta(clienteEmpresaId, { monto: total, ventaId, usuarioId });
  }

  return ventaId;
}

// Caja muestra, al cobrar, cuánto stock queda de cada producto vendido (2026-10-11: "no hay
// relación entre cómo se carga, cómo cobra y el stock"): unidades vendidas y disponible después.
export async function registrarVenta(datos, { usuarioId }) {
  const ventaId = await db.transaction(() => registrarVentaEnTransaccion(datos, { usuarioId }));
  const venta = await obtenerVentaConItems(ventaId);
  const vendidas = new Map();
  for (const item of venta.items) vendidas.set(item.producto_id, (vendidas.get(item.producto_id) ?? 0) + item.cantidad);
  const stockDespues = [];
  for (const [productoId, unidades] of vendidas) {
    const producto = await db
      .prepare(
        `SELECT p.nombre, p.medida, p.vende_suelto, p.pack_nombre, p.pack_unidades
         FROM productos p WHERE p.id = ?`
      )
      .get(productoId);
    stockDespues.push({ producto_id: productoId, ...producto, unidades_vendidas: unidades, stock_disponible: await stockDisponible(productoId) });
  }
  return { ...venta, stock_despues: stockDespues };
}

export { obtenerVentaConItems };

// "Ventas -- Editar" (Admin+Encargado, matriz de permisos): alcance acotado a
// corregir el medio de pago de una venta ya registrada (confirmado con el
// usuario) -- nunca productos/cantidades/stock, eso es exclusivo de anular.
// No admite entrar ni salir de 'cta_cte' -- ese cambio movería el cargo real
// en la cuenta corriente de un cliente a otro (o lo crearía/borraría), y este
// endpoint nunca tocó nada del ledger. Para corregir un medio_pago='cta_cte'
// mal cargado, anular la venta (revierte el cargo con un AJUSTE) y volver a
// registrarla bien.
// Corrige solo el medio de pago (regla de septiembre; con botón en Caja desde 2026-10-16, decisión
// D3 del usuario). Devuelve la venta y el medio anterior (null si no cambió), para el registro.
export async function editarMedioPago(id, { medio_pago }) {
  const medioPago = await validarMedioPago(medio_pago);

  const anterior = await db.transaction(async () => {
    const venta = await db.prepare('SELECT id, estado, medio_pago FROM ventas WHERE id = ?').get(id);
    if (!venta) throw new ApiError(404, 'Venta no encontrada');
    if (venta.estado === 'anulada') throw new ApiError(409, 'No se puede editar una venta anulada');
    // Una venta con varios medios no se pasa a uno solo: se anula y se vuelve a cobrar (2026-11-01).
    if (venta.medio_pago === 'mixto') {
      throw new ApiError(409, 'Esta venta se cobró con varios medios: para corregirla, anulala y volvé a cobrarla');
    }
    if (venta.medio_pago === 'cta_cte' || medioPago === 'cta_cte') {
      throw new ApiError(409, 'No se puede cambiar el medio de pago a ni desde Cuenta Corriente: anulá la venta y volvé a cobrarla');
    }
    if (venta.medio_pago === medioPago) return null;

    await db.prepare('UPDATE ventas SET medio_pago = ? WHERE id = ?').run(medioPago, id);
    return venta.medio_pago;
  });

  return { venta: await obtenerVentaConItems(id), anterior };
}

export async function anularVenta(id, { usuarioId }) {
  await db.transaction(async () => {
    const venta = await db
      .prepare('SELECT id, estado, medio_pago, cliente_empresa_id, total FROM ventas WHERE id = ?')
      .get(id);
    if (!venta) throw new ApiError(404, 'Venta no encontrada');
    if (venta.estado === 'anulada') throw new ApiError(409, 'La venta ya está anulada');

    const items = await db.prepare('SELECT lote_id, cantidad FROM venta_items WHERE venta_id = ?').all(id);

    // Reingresa al lote original tal cual, aunque ese lote haya sido dado de
    // baja (soft delete) despues de la venta -- prioriza la trazabilidad real
    // ("de que lote salio") sobre que el stock vuelva a estar vendible
    // automaticamente. Si el lote esta eliminado, la reposicion vendible
    // queda a cargo de un ajuste manual del Admin en Stock.
    for (const item of items) {
      await db
        .prepare('UPDATE lotes SET cantidad = cantidad + ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
        .run(item.cantidad, item.lote_id);
    }

    await db
      .prepare(`UPDATE ventas SET estado = 'anulada', anulada_por = ?, anulada_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(usuarioId, id);

    // Reversión automática del cargo en la cuenta corriente (B2B Fase 1,
    // decisión confirmada con el usuario) -- un AJUSTE nuevo que compensa el
    // CARGO original, nunca se edita/borra el movimiento original (ledger
    // insert-only).
    if (venta.medio_pago === 'cta_cte' && venta.cliente_empresa_id) {
      await registrarAjustePorAnulacion(venta.cliente_empresa_id, {
        monto: -venta.total,
        ventaId: id,
        usuarioId,
      });
    }
  });

  return obtenerVentaConItems(id);
}
