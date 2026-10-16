import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { esDiaValido, sqlDiaNegocio } from '../utils/fecha-negocio.js';

const MAX_CONCEPTO = 200;
// Tope de un monto en pesos (Number.isInteger(1e21) es true): sin él un gasto
// absurdo corrompía el efectivo esperado del día.
const MAX_MONTO = 1_000_000_000;

function validarConcepto(valor) {
  if (typeof valor !== 'string' || valor.trim() === '') throw new ApiError(400, 'concepto es requerido');
  const limpio = valor.trim();
  if (limpio.length > MAX_CONCEPTO) throw new ApiError(400, `concepto no puede superar ${MAX_CONCEPTO} caracteres`);
  return limpio;
}

function validarMonto(valor) {
  // Solo número o texto numérico: Number(true) vale 1 y Number([5]) vale 5, y se aceptaban como monto.
  if (typeof valor !== 'number' && typeof valor !== 'string') throw new ApiError(400, 'monto tiene que ser un número entero mayor a 0');
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, 'monto tiene que ser un número entero mayor a 0');
  if (n > MAX_MONTO) throw new ApiError(400, `monto no puede superar ${MAX_MONTO.toLocaleString('es-AR')}`);
  return n;
}

async function verificarProveedorActivo(proveedorId) {
  if (proveedorId === null) return;
  const proveedor = await db.prepare('SELECT id FROM proveedores WHERE id = ? AND eliminado_en IS NULL').get(proveedorId);
  if (!proveedor) throw new ApiError(400, 'El proveedor indicado no existe o está eliminado');
}

// Gastos y pagos a proveedores en Caja (corrección pedida 2026-09-15) -- se
// asumen SIEMPRE en efectivo (es lo que motiva registrarlos acá: afectan el
// arqueo físico del cajón, ver caja.service.calcularResumenDelTurno). Si algún
// día hace falta un gasto no-efectivo, sumar un campo medio_pago recién ahí --
// no se anticipa acá sin un caso real.
// Con desde/hasta: los gastos de un período (pantalla "Ventas diarias", 2026-10-16), con quién
// lo cargó y el proveedor.
export function listarGastos({ fecha, desde, hasta } = {}) {
  const condiciones = ['g.eliminado_en IS NULL'];
  const params = [];
  if (desde !== undefined || hasta !== undefined) {
    const dia1 = desde;
    const dia2 = hasta ?? desde;
    if (!esDiaValido(dia1) || !esDiaValido(dia2)) throw new ApiError(400, 'desde y hasta tienen que ser fechas válidas (AAAA-MM-DD)');
    if (dia1 > dia2) throw new ApiError(400, 'La fecha "desde" no puede ser posterior a "hasta"');
    condiciones.push(`${sqlDiaNegocio('g.creado_en')} BETWEEN ?::date AND ?::date`);
    params.push(dia1, dia2);
  } else if (fecha) {
    condiciones.push(`${sqlDiaNegocio('g.creado_en')} = ?`);
    params.push(fecha);
  }
  return db
    .prepare(
      `SELECT g.*, u.nombre AS usuario_nombre, p.nombre AS proveedor_nombre
       FROM gastos_caja g
       JOIN usuarios u ON u.id = g.usuario_id
       LEFT JOIN proveedores p ON p.id = g.proveedor_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY g.creado_en DESC, g.id DESC`
    )
    .all(...params);
}

// Crear: los 3 roles (decisión 2026-09-18 -- cualquiera en caja puede
// registrar un gasto en el momento en que ocurre, ej. un cajero que paga un
// flete en efectivo a media tarde).
export async function registrarGasto({ concepto, monto, proveedor_id }, { usuarioId }) {
  const conceptoValido = validarConcepto(concepto);
  const montoValido = validarMonto(monto);
  const proveedorId = proveedor_id != null ? Number(proveedor_id) : null;

  // Leer-decidir-escribir en una transacción: el proveedor no puede darse de baja entre el chequeo y el alta.
  return db.transaction(async () => {
    await verificarProveedorActivo(proveedorId);
    return db
      .prepare(`INSERT INTO gastos_caja (usuario_id, concepto, monto, proveedor_id) VALUES (?, ?, ?, ?) RETURNING *`)
      .get(usuarioId, conceptoValido, montoValido, proveedorId);
  });
}

// Eliminar (corregir un gasto mal cargado): Admin+Encargado, no Cajero --
// mismo criterio que anular una venta: una acción correctiva queda más
// restringida que la de crear.
export async function eliminarGasto(id) {
  await db.transaction(async () => {
    const gasto = await db.prepare('SELECT id FROM gastos_caja WHERE id = ? AND eliminado_en IS NULL').get(id);
    if (!gasto) throw new ApiError(404, 'Gasto no encontrado');
    await db.prepare('UPDATE gastos_caja SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  });
}
