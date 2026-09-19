import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

// Todo texto libre tiene tope de longitud: sin él, un texto de 100.000
// caracteres en un movimiento colgaba el servidor al armar el PDF de resumen
// (síncrono), y los datos de ficha podían crecer sin límite.
const MAX_TEXTO = 200;
const MAX_TEXTO_LARGO = 500;
// Tope de un monto en pesos: Number.isInteger(1e21) es true, así que sin tope un
// pago o ajuste absurdo dejaba el saldo del cliente en un número inservible.
const MAX_MONTO = 1_000_000_000;

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

function validarEmailOpcional(valor) {
  const email = validarString(valor, 'email', { requerido: false });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'email no tiene un formato válido');
  return email;
}

function validarMontoPositivo(valor, campo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${campo} tiene que ser un número entero mayor a 0`);
  if (n > MAX_MONTO) throw new ApiError(400, `${campo} no puede superar ${MAX_MONTO.toLocaleString('es-AR')}`);
  return n;
}

function validarMontoConSigno(valor, campo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n === 0) throw new ApiError(400, `${campo} tiene que ser un número entero distinto de 0`);
  if (Math.abs(n) > MAX_MONTO) throw new ApiError(400, `${campo} no puede superar ${MAX_MONTO.toLocaleString('es-AR')} (en valor absoluto)`);
  return n;
}

// Mismo criterio que catalogos.service.js (categorias/unidades_medida): la
// unicidad real se valida acá, el índice único parcial del esquema es solo
// backstop. cuit es opcional -- solo se chequea si se manda uno.
function verificarCuitLibre(cuit, excluirId = null) {
  if (!cuit) return;
  // Se compara sin guiones ni espacios: "30-11111111-1" y "30111111111" son el mismo CUIT.
  const soloDigitos = cuit.replace(/[-\s]/g, '');
  const existente = db
    .prepare(
      `SELECT id FROM clientes_empresa
       WHERE REPLACE(REPLACE(cuit, '-', ''), ' ', '') = ? AND eliminado_en IS NULL AND id != ?`
    )
    .get(soloDigitos, excluirId ?? -1);
  if (existente) throw new ApiError(409, 'Ya existe un cliente-empresa activo con ese CUIT');
}

// Columnas explícitas (no c.*): la columna de texto vieja
// clientes_empresa.condicion_pago quedó en el esquema sin uso (migración 023,
// nunca se borra nada) y chocaría con el nombre resuelto por JOIN contra el
// catálogo, que es el que la API expone como `condicion_pago` (string, igual
// que `categoria`/`unidad_medida` en stock.service.js). El JOIN no filtra por
// cp.eliminado_en a propósito: un cliente cuya condición se dio de baja
// después sigue mostrando su nombre real.
const SELECT_CLIENTE = `
  SELECT
    c.id, c.razon_social, c.cuit, c.contacto_nombre, c.telefono, c.email, c.direccion,
    c.condicion_pago_id, cp.nombre AS condicion_pago,
    c.eliminado_en, c.creado_en, c.actualizado_en
  FROM clientes_empresa c
  LEFT JOIN condiciones_pago cp ON cp.id = c.condicion_pago_id
`;

function obtenerClienteActivo(id) {
  const cliente = db.prepare(`${SELECT_CLIENTE} WHERE c.id = ? AND c.eliminado_en IS NULL`).get(id);
  if (!cliente) throw new ApiError(404, 'Cliente-empresa no encontrado');
  return cliente;
}

// undefined/null/'' = sin condición de pago (es opcional). Si viene un valor,
// tiene que ser una fila ACTIVA del catálogo -- no se puede asignar una ya
// dada de baja (mismo criterio que obtenerCategoriaActiva en stock.service.js).
function validarCondicionPagoId(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'condicion_pago_id inválido');
  const fila = db.prepare('SELECT id FROM condiciones_pago WHERE id = ? AND eliminado_en IS NULL').get(id);
  if (!fila) throw new ApiError(400, 'La condición de pago indicada no existe o está eliminada');
  return id;
}

function saldoDe(clienteEmpresaId) {
  const fila = db
    .prepare('SELECT COALESCE(SUM(monto), 0) AS saldo FROM cuenta_corriente_movimientos WHERE cliente_empresa_id = ?')
    .get(clienteEmpresaId);
  return fila.saldo;
}

function movimientosDe(clienteEmpresaId) {
  return db
    .prepare(
      `SELECT ccm.*, u.nombre AS usuario_nombre
       FROM cuenta_corriente_movimientos ccm
       JOIN usuarios u ON u.id = ccm.usuario_id
       WHERE ccm.cliente_empresa_id = ?
       ORDER BY ccm.creado_en DESC, ccm.id DESC`
    )
    .all(clienteEmpresaId);
}

// incluirSaldo: solo Admin+Encargado (mismo criterio que ocultarCosto en
// stock.service.js -- el Cajero solo necesita id + razón social para elegir a
// quién vende en Caja, nunca cuánto debe cada cliente). El saldo se calcula en
// la misma consulta (una subquery por cliente), no una request por cliente.
export function listarClientesEmpresa({ buscar, incluirSaldo = false } = {}) {
  const base = incluirSaldo
    ? SELECT_CLIENTE.replace(
        'c.eliminado_en, c.creado_en, c.actualizado_en',
        `c.eliminado_en, c.creado_en, c.actualizado_en,
    COALESCE((SELECT SUM(monto) FROM cuenta_corriente_movimientos WHERE cliente_empresa_id = c.id), 0) AS saldo`
      )
    : SELECT_CLIENTE;

  if (buscar) {
    return db
      .prepare(`${base} WHERE c.eliminado_en IS NULL AND c.razon_social LIKE ? ORDER BY c.razon_social`)
      .all(`%${buscar}%`);
  }
  return db.prepare(`${base} WHERE c.eliminado_en IS NULL ORDER BY c.razon_social`).all();
}

export function obtenerClienteEmpresa(id) {
  const cliente = obtenerClienteActivo(id);
  return { ...cliente, saldo: saldoDe(id), movimientos: movimientosDe(id) };
}

export function crearClienteEmpresa(datos) {
  const razonSocial = validarString(datos.razon_social, 'razon_social');
  const cuit = validarString(datos.cuit, 'cuit', { requerido: false });
  const contactoNombre = validarString(datos.contacto_nombre, 'contacto_nombre', { requerido: false });
  const telefono = validarString(datos.telefono, 'telefono', { requerido: false });
  const email = validarEmailOpcional(datos.email);
  const direccion = validarString(datos.direccion, 'direccion', { requerido: false, maxLength: MAX_TEXTO_LARGO });
  const condicionPagoId = validarCondicionPagoId(datos.condicion_pago_id);

  verificarCuitLibre(cuit);

  const resultado = db
    .prepare(
      `INSERT INTO clientes_empresa (razon_social, cuit, contacto_nombre, telefono, email, direccion, condicion_pago_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(razonSocial, cuit, contactoNombre, telefono, email, direccion, condicionPagoId);

  return obtenerClienteEmpresa(resultado.lastInsertRowid);
}

export function editarClienteEmpresa(id, datos) {
  const actual = obtenerClienteActivo(id);

  const actualizaciones = {};
  if (datos.razon_social !== undefined) actualizaciones.razon_social = validarString(datos.razon_social, 'razon_social');
  if (datos.cuit !== undefined) {
    const cuit = validarString(datos.cuit, 'cuit', { requerido: false });
    verificarCuitLibre(cuit, id);
    actualizaciones.cuit = cuit;
  }
  if (datos.contacto_nombre !== undefined) {
    actualizaciones.contacto_nombre = validarString(datos.contacto_nombre, 'contacto_nombre', { requerido: false });
  }
  if (datos.telefono !== undefined) {
    actualizaciones.telefono = validarString(datos.telefono, 'telefono', { requerido: false });
  }
  if (datos.email !== undefined) actualizaciones.email = validarEmailOpcional(datos.email);
  if (datos.direccion !== undefined) {
    actualizaciones.direccion = validarString(datos.direccion, 'direccion', { requerido: false, maxLength: MAX_TEXTO_LARGO });
  }
  if (datos.condicion_pago_id !== undefined) {
    // Reenviar la MISMA condición que ya tiene el cliente siempre se acepta,
    // aunque esa condición se haya dado de baja en el catálogo: la pantalla
    // manda el formulario completo al guardar, y si no, un cambio de teléfono
    // quedaría bloqueado por una condición que el usuario ni tocó. Elegir OTRA
    // sí exige que esté activa.
    const pedido =
      datos.condicion_pago_id === null || datos.condicion_pago_id === '' ? null : Number(datos.condicion_pago_id);
    actualizaciones.condicion_pago_id =
      pedido !== null && pedido === actual.condicion_pago_id ? pedido : validarCondicionPagoId(datos.condicion_pago_id);
  }

  const claves = Object.keys(actualizaciones);
  if (claves.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');

  const set = claves.map((c) => `${c} = ?`).join(', ');
  const valores = claves.map((c) => actualizaciones[c]);

  db.prepare(`UPDATE clientes_empresa SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(...valores, id);

  return obtenerClienteEmpresa(id);
}

// Al dar de baja un cliente, sus pedidos pendientes se rechazan solos: si no,
// seguían apartando stock (reserva) hasta que alguien los rechazara a mano y
// nadie podía aprobarlos igual (el cliente ya no existe). El stock reservado
// vuelve a estar disponible en el acto. Todo en una transacción.
export function eliminarClienteEmpresa(id, { usuarioId } = {}) {
  obtenerClienteActivo(id);
  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE pedidos_cliente
       SET estado = 'rechazado', motivo_rechazo = 'El cliente fue dado de baja', resuelto_por = ?,
           resuelto_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP
       WHERE cliente_empresa_id = ? AND estado = 'pendiente'`
    ).run(usuarioId ?? null, id);
    db.prepare('UPDATE clientes_empresa SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listarMovimientos(clienteEmpresaId) {
  obtenerClienteActivo(clienteEmpresaId);
  return { saldo: saldoDe(clienteEmpresaId), movimientos: movimientosDe(clienteEmpresaId) };
}

// Zona horaria de negocio para armar el resumen: SQLite guarda CURRENT_TIMESTAMP
// en UTC, y un rango "del 1 al 30" tiene que respetar el día calendario del
// cliente (un cargo de las 22:00 no es del día siguiente). Argentina no tiene
// horario de verano, así que la zona es fija.
const ZONA_NEGOCIO = 'America/Argentina/Buenos_Aires';
const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_NEGOCIO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function utcADate(datetimeUtc) {
  return new Date(`${datetimeUtc.replace(' ', 'T')}Z`);
}

function diaLocal(datetimeUtc) {
  return FORMATO_DIA.format(utcADate(datetimeUtc)); // 'YYYY-MM-DD'
}

function validarFechaOpcional(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new ApiError(400, `${campo} tiene que tener el formato AAAA-MM-DD`);
  }
  const fecha = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
    throw new ApiError(400, `${campo} no es una fecha válida`);
  }
  return valor;
}

// Datos del resumen de cuenta (PDF). Sin desde/hasta = toda la historia. Con
// rango: el saldo anterior es todo lo acumulado ANTES de `desde`, y los
// movimientos son solo los del período, cada uno con su saldo corrido.
export function armarResumenCuenta(clienteEmpresaId, { desde, hasta } = {}) {
  const cliente = obtenerClienteActivo(clienteEmpresaId);
  const desdeOk = validarFechaOpcional(desde, 'desde');
  const hastaOk = validarFechaOpcional(hasta, 'hasta');
  if (desdeOk && hastaOk && desdeOk > hastaOk) {
    throw new ApiError(400, 'La fecha "desde" no puede ser posterior a "hasta"');
  }

  const todos = movimientosDe(clienteEmpresaId).reverse(); // cronológico: más viejo primero
  let saldoAnterior = 0;
  const delPeriodo = [];
  for (const m of todos) {
    const dia = diaLocal(m.creado_en);
    if (desdeOk && dia < desdeOk) {
      saldoAnterior += m.monto;
    } else if (!hastaOk || dia <= hastaOk) {
      delPeriodo.push(m);
    }
  }

  let saldo = saldoAnterior;
  let cargos = 0;
  let pagos = 0;
  let ajustes = 0;
  const movimientos = delPeriodo.map((m) => {
    saldo += m.monto;
    if (m.tipo === 'CARGO') cargos += m.monto;
    else if (m.tipo === 'PAGO') pagos += -m.monto;
    else ajustes += m.monto;
    return { ...m, saldo };
  });

  return {
    cliente,
    desde: desdeOk,
    hasta: hastaOk,
    saldo_anterior: saldoAnterior,
    total_cargos: cargos,
    total_pagos: pagos,
    total_ajustes: ajustes,
    saldo_final: saldo,
    movimientos,
  };
}

export { diaLocal, ZONA_NEGOCIO };

// Pago manual (abono del cliente) -- se guarda negativo porque monto ya trae
// el efecto real sobre el saldo (Docs/Modelo-de-Datos.md): un pago siempre
// reduce lo que el cliente debe.
export function registrarPago(clienteEmpresaId, { monto, descripcion }, { usuarioId }) {
  obtenerClienteActivo(clienteEmpresaId);
  const montoValido = validarMontoPositivo(monto, 'monto');
  const desc = validarString(descripcion, 'descripcion', { requerido: false, maxLength: MAX_TEXTO_LARGO });

  db.prepare(
    `INSERT INTO cuenta_corriente_movimientos (cliente_empresa_id, tipo, monto, descripcion, usuario_id)
     VALUES (?, 'PAGO', ?, ?, ?)`
  ).run(clienteEmpresaId, -montoValido, desc, usuarioId);

  return listarMovimientos(clienteEmpresaId);
}

// Ajuste manual (corrección) -- signo libre, a diferencia del pago. Para
// arreglar un error de carga sin editar ni borrar ningún movimiento anterior
// (ledger insert-only).
export function registrarAjuste(clienteEmpresaId, { monto, descripcion }, { usuarioId }) {
  obtenerClienteActivo(clienteEmpresaId);
  const montoValido = validarMontoConSigno(monto, 'monto');
  const desc = validarString(descripcion, 'descripcion', { maxLength: MAX_TEXTO_LARGO });

  db.prepare(
    `INSERT INTO cuenta_corriente_movimientos (cliente_empresa_id, tipo, monto, descripcion, usuario_id)
     VALUES (?, 'AJUSTE', ?, ?, ?)`
  ).run(clienteEmpresaId, montoValido, desc, usuarioId);

  return listarMovimientos(clienteEmpresaId);
}

// -- Usadas por ventas.service.js, no exponen ruta propia --

export function existeClienteActivo(id) {
  const fila = db.prepare('SELECT id FROM clientes_empresa WHERE id = ? AND eliminado_en IS NULL').get(id);
  return Boolean(fila);
}

export function registrarCargoPorVenta(clienteEmpresaId, { monto, ventaId, usuarioId }) {
  db.prepare(
    `INSERT INTO cuenta_corriente_movimientos (cliente_empresa_id, tipo, monto, descripcion, venta_id, usuario_id)
     VALUES (?, 'CARGO', ?, ?, ?, ?)`
  ).run(clienteEmpresaId, monto, `Venta #${ventaId}`, ventaId, usuarioId);
}

export function registrarAjustePorAnulacion(clienteEmpresaId, { monto, ventaId, usuarioId }) {
  db.prepare(
    `INSERT INTO cuenta_corriente_movimientos (cliente_empresa_id, tipo, monto, descripcion, venta_id, usuario_id)
     VALUES (?, 'AJUSTE', ?, ?, ?, ?)`
  ).run(clienteEmpresaId, monto, `Reversión por anulación de venta #${ventaId}`, ventaId, usuarioId);
}
