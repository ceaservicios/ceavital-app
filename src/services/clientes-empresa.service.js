import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

function validarString(valor, campo, { requerido = true } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ApiError(400, `${campo} es requerido`);
    return null;
  }
  if (typeof valor !== 'string') throw new ApiError(400, `${campo} tiene que ser texto`);
  return valor.trim();
}

function validarMontoPositivo(valor, campo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${campo} tiene que ser un número entero mayor a 0`);
  return n;
}

function validarMontoConSigno(valor, campo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n === 0) throw new ApiError(400, `${campo} tiene que ser un número entero distinto de 0`);
  return n;
}

// Mismo criterio que catalogos.service.js (categorias/unidades_medida): la
// unicidad real se valida acá, el índice único parcial del esquema es solo
// backstop. cuit es opcional -- solo se chequea si se manda uno.
function verificarCuitLibre(cuit, excluirId = null) {
  if (!cuit) return;
  const existente = db
    .prepare('SELECT id FROM clientes_empresa WHERE cuit = ? AND eliminado_en IS NULL AND id != ?')
    .get(cuit, excluirId ?? -1);
  if (existente) throw new ApiError(409, 'Ya existe un cliente-empresa activo con ese CUIT');
}

function obtenerClienteActivo(id) {
  const cliente = db.prepare('SELECT * FROM clientes_empresa WHERE id = ? AND eliminado_en IS NULL').get(id);
  if (!cliente) throw new ApiError(404, 'Cliente-empresa no encontrado');
  return cliente;
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
  const columnas = incluirSaldo
    ? `c.*, COALESCE((SELECT SUM(monto) FROM cuenta_corriente_movimientos WHERE cliente_empresa_id = c.id), 0) AS saldo`
    : 'c.*';

  if (buscar) {
    return db
      .prepare(
        `SELECT ${columnas} FROM clientes_empresa c
         WHERE c.eliminado_en IS NULL AND c.razon_social LIKE ? ORDER BY c.razon_social`
      )
      .all(`%${buscar}%`);
  }
  return db
    .prepare(`SELECT ${columnas} FROM clientes_empresa c WHERE c.eliminado_en IS NULL ORDER BY c.razon_social`)
    .all();
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
  const email = validarString(datos.email, 'email', { requerido: false });
  const direccion = validarString(datos.direccion, 'direccion', { requerido: false });
  const condicionPago = validarString(datos.condicion_pago, 'condicion_pago', { requerido: false });

  verificarCuitLibre(cuit);

  const resultado = db
    .prepare(
      `INSERT INTO clientes_empresa (razon_social, cuit, contacto_nombre, telefono, email, direccion, condicion_pago)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(razonSocial, cuit, contactoNombre, telefono, email, direccion, condicionPago);

  return obtenerClienteEmpresa(resultado.lastInsertRowid);
}

export function editarClienteEmpresa(id, datos) {
  obtenerClienteActivo(id);

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
  if (datos.email !== undefined) actualizaciones.email = validarString(datos.email, 'email', { requerido: false });
  if (datos.direccion !== undefined) {
    actualizaciones.direccion = validarString(datos.direccion, 'direccion', { requerido: false });
  }
  if (datos.condicion_pago !== undefined) {
    actualizaciones.condicion_pago = validarString(datos.condicion_pago, 'condicion_pago', { requerido: false });
  }

  const claves = Object.keys(actualizaciones);
  if (claves.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');

  const set = claves.map((c) => `${c} = ?`).join(', ');
  const valores = claves.map((c) => actualizaciones[c]);

  db.prepare(`UPDATE clientes_empresa SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(...valores, id);

  return obtenerClienteEmpresa(id);
}

export function eliminarClienteEmpresa(id) {
  obtenerClienteActivo(id);
  db.prepare('UPDATE clientes_empresa SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

export function listarMovimientos(clienteEmpresaId) {
  obtenerClienteActivo(clienteEmpresaId);
  return { saldo: saldoDe(clienteEmpresaId), movimientos: movimientosDe(clienteEmpresaId) };
}

// Pago manual (abono del cliente) -- se guarda negativo porque monto ya trae
// el efecto real sobre el saldo (Docs/Modelo-de-Datos.md): un pago siempre
// reduce lo que el cliente debe.
export function registrarPago(clienteEmpresaId, { monto, descripcion }, { usuarioId }) {
  obtenerClienteActivo(clienteEmpresaId);
  const montoValido = validarMontoPositivo(monto, 'monto');
  const desc = validarString(descripcion, 'descripcion', { requerido: false });

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
  const desc = validarString(descripcion, 'descripcion');

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
