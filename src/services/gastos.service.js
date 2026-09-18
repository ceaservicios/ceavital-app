import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

function validarConcepto(valor) {
  if (typeof valor !== 'string' || valor.trim() === '') throw new ApiError(400, 'concepto es requerido');
  return valor.trim();
}

function validarMonto(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, 'monto tiene que ser un número entero mayor a 0');
  return n;
}

function verificarProveedorActivo(proveedorId) {
  if (proveedorId === null) return;
  const proveedor = db.prepare('SELECT id FROM proveedores WHERE id = ? AND eliminado_en IS NULL').get(proveedorId);
  if (!proveedor) throw new ApiError(400, 'El proveedor indicado no existe o está eliminado');
}

// Gastos y pagos a proveedores en Caja (corrección pedida 2026-09-15) -- se
// asumen SIEMPRE en efectivo (es lo que motiva registrarlos acá: afectan el
// arqueo físico del cajón, ver caja.service.calcularResumenDelDia). Si algún
// día hace falta un gasto no-efectivo, sumar un campo medio_pago recién ahí --
// no se anticipa acá sin un caso real.
export function listarGastos({ fecha } = {}) {
  const condiciones = ['eliminado_en IS NULL'];
  const params = [];
  if (fecha) {
    condiciones.push('date(creado_en) = ?');
    params.push(fecha);
  }
  return db.prepare(`SELECT * FROM gastos_caja WHERE ${condiciones.join(' AND ')} ORDER BY creado_en DESC`).all(...params);
}

// Crear: los 3 roles (decisión 2026-09-18 -- cualquiera en caja puede
// registrar un gasto en el momento en que ocurre, ej. un cajero que paga un
// flete en efectivo a media tarde).
export function registrarGasto({ concepto, monto, proveedor_id }, { usuarioId }) {
  const conceptoValido = validarConcepto(concepto);
  const montoValido = validarMonto(monto);
  const proveedorId = proveedor_id != null ? Number(proveedor_id) : null;
  verificarProveedorActivo(proveedorId);

  const resultado = db
    .prepare(`INSERT INTO gastos_caja (usuario_id, concepto, monto, proveedor_id) VALUES (?, ?, ?, ?)`)
    .run(usuarioId, conceptoValido, montoValido, proveedorId);

  return db.prepare('SELECT * FROM gastos_caja WHERE id = ?').get(resultado.lastInsertRowid);
}

// Eliminar (corregir un gasto mal cargado): Admin+Encargado, no Cajero --
// mismo criterio que anular una venta: una acción correctiva queda más
// restringida que la de crear.
export function eliminarGasto(id) {
  const gasto = db.prepare('SELECT id FROM gastos_caja WHERE id = ? AND eliminado_en IS NULL').get(id);
  if (!gasto) throw new ApiError(404, 'Gasto no encontrado');
  db.prepare('UPDATE gastos_caja SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

export function totalGastosDelDia(fecha) {
  const fila = db
    .prepare(`SELECT COALESCE(SUM(monto), 0) AS total FROM gastos_caja WHERE eliminado_en IS NULL AND date(creado_en) = ?`)
    .get(fecha);
  return fila.total;
}
