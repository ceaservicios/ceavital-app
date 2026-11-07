import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { esDiaValido, sqlDiaNegocio } from '../utils/fecha-negocio.js';
import { frenarSiNoAlcanza, validarOrigen } from './caja-general.service.js';
import { crearFijoDeGasto } from './fijos.service.js';

const MAX_CONCEPTO = 200;
// Tope de un monto en pesos (Number.isInteger(1e21) es true): sin él un gasto
// absurdo corrompía el efectivo esperado del día.
const MAX_MONTO = 1_000_000_000;
// Medio de pago del gasto (migración 039, 2026-11-03). Solo 'efectivo' sale de la caja.
const MEDIOS_PAGO = ['efectivo', 'mercado_pago', 'transferencia', 'tarjeta', 'cheque'];

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

// Sin medio: efectivo, como antes de la 039.
function validarMedioPago(valor) {
  if (valor === undefined || valor === null || valor === '') return 'efectivo';
  if (!MEDIOS_PAGO.includes(valor)) throw new ApiError(400, 'Medio de pago inválido');
  return valor;
}

// Sin proveedor: null.
function validarProveedorId(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (typeof valor === 'boolean' || !Number.isInteger(n) || n <= 0) throw new ApiError(400, 'proveedor_id inválido');
  return n;
}

async function verificarProveedorActivo(proveedorId) {
  if (proveedorId === null) return;
  const proveedor = await db.prepare('SELECT id FROM proveedores WHERE id = ? AND eliminado_en IS NULL').get(proveedorId);
  if (!proveedor) throw new ApiError(400, 'El proveedor indicado no existe o está eliminado');
}

// Un pago a un proveedor o de una cuenta de Saldos pendientes que salió de la caja se anula desde
// donde se registró: si se tocara acá, el pago seguiría descontando lo que se debe con el monto viejo.
async function verificarQueNoEsUnPago(id) {
  const pago = await db
    .prepare(
      `SELECT pr.nombre FROM pagos_proveedor pp JOIN proveedores pr ON pr.id = pp.proveedor_id
       WHERE pp.gasto_caja_id = ? AND pp.anulado_en IS NULL`
    )
    .get(id);
  if (pago) throw new ApiError(409, `Es un pago a ${pago.nombre}: se anula desde Proveedores, en su perfil (pestaña Pagos).`);
  const pagoCuenta = await db
    .prepare(
      `SELECT cp.concepto FROM pagos_cuenta pc JOIN cuentas_pagar cp ON cp.id = pc.cuenta_id
       WHERE pc.gasto_caja_id = ? AND pc.anulado_en IS NULL`
    )
    .get(id);
  if (pagoCuenta) throw new ApiError(409, `Es el pago de «${pagoCuenta.concepto}»: se anula desde Saldos pendientes, en su ficha.`);
}

const SQL_GASTO_CON_PROVEEDOR = `SELECT g.id, g.concepto, g.monto, g.medio_pago, g.origen, g.proveedor_id, p.nombre AS proveedor_nombre
  FROM gastos_caja g LEFT JOIN proveedores p ON p.id = g.proveedor_id
  WHERE g.id = ? AND g.eliminado_en IS NULL`;

// Gastos y pagos a proveedores en Caja (corrección pedida 2026-09-15). Desde el 2026-11-03 cada
// gasto lleva su medio de pago (migración 039) y, en efectivo, de dónde sale (migración 040): de la
// caja del turno cuenta en el arqueo (caja.service.calcularResumenDelTurno), de Caja general baja su
// saldo y de otro lado queda anotado sin tocar ninguna de las dos.
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
  // pago_proveedor_id: el gasto es un pago a un proveedor que salió de la caja (2026-10-28); ese
  // se anula desde el perfil del proveedor, no se elimina acá. pago_cuenta_id: lo mismo con el
  // pago de una cuenta de Saldos pendientes (2026-10-29), que se anula desde su ficha.
  return db
    .prepare(
      `SELECT g.*, u.nombre AS usuario_nombre, p.nombre AS proveedor_nombre, pp.id AS pago_proveedor_id,
         pc.id AS pago_cuenta_id
       FROM gastos_caja g
       JOIN usuarios u ON u.id = g.usuario_id
       LEFT JOIN proveedores p ON p.id = g.proveedor_id
       LEFT JOIN pagos_proveedor pp ON pp.gasto_caja_id = g.id AND pp.anulado_en IS NULL
       LEFT JOIN pagos_cuenta pc ON pc.gasto_caja_id = g.id AND pc.anulado_en IS NULL
       WHERE ${condiciones.join(' AND ')}
       ORDER BY g.creado_en DESC, g.id DESC`
    )
    .all(...params);
}

// Crear: los 3 roles (decisión 2026-09-18 -- cualquiera en caja puede
// registrar un gasto en el momento en que ocurre, ej. un cajero que paga un
// flete en efectivo a media tarde). El Cajero no maneja Caja general: su gasto en efectivo sale siempre
// de la caja del turno. "Repetir todos los meses" (2026-11-06) crea un fijo mensual con este gasto, solo
// para Administrador y Encargado, que son los que ven Fijos.
export async function registrarGasto({ concepto, monto, proveedor_id, medio_pago, origen, repetir }, { usuarioId, rol }) {
  const conceptoValido = validarConcepto(concepto);
  const montoValido = validarMonto(monto);
  const medioValido = validarMedioPago(medio_pago);
  const origenValido = validarOrigen(rol === 'cajero' ? 'caja' : origen ?? 'caja', medioValido);
  const proveedorId = validarProveedorId(proveedor_id);
  if (repetir !== undefined && typeof repetir !== 'boolean') throw new ApiError(400, 'repetir tiene que ser true o false');

  // Leer-decidir-escribir en una transacción: el proveedor no puede darse de baja entre el chequeo y el alta.
  return db.transaction(async () => {
    await verificarProveedorActivo(proveedorId);
    const gasto = await db
      .prepare(`INSERT INTO gastos_caja (usuario_id, concepto, monto, proveedor_id, medio_pago, origen) VALUES (?, ?, ?, ?, ?, ?) RETURNING *`)
      .get(usuarioId, conceptoValido, montoValido, proveedorId, medioValido, origenValido);
    if (origenValido === 'general') await frenarSiNoAlcanza();
    if (repetir && rol !== 'cajero') await crearFijoDeGasto({ concepto: conceptoValido, monto: montoValido }, { usuarioId });
    return gasto;
  });
}

// Corregir un gasto ya anotado (pedido del usuario, 2026-11-03: "en gastos podamos editar los
// métodos de pago y todo eso. Todo el gasto hecho"): concepto, monto, medio de pago, de dónde salió
// el efectivo y proveedor.
// Admin+Encargado, como eliminarlo. La fecha y quién lo anotó no cambian. Un cierre ya hecho no
// cambia (es una foto); el turno abierto sí. Devuelve el gasto como quedó y como estaba (para el registro).
export async function editarGasto(id, { concepto, monto, proveedor_id, medio_pago, origen }) {
  const conceptoValido = validarConcepto(concepto);
  const montoValido = validarMonto(monto);
  const medioValido = validarMedioPago(medio_pago);
  const origenValido = validarOrigen(origen ?? 'caja', medioValido);
  const proveedorId = validarProveedorId(proveedor_id);

  return db.transaction(async () => {
    const antes = await db.prepare(SQL_GASTO_CON_PROVEEDOR).get(id);
    if (!antes) throw new ApiError(404, 'Gasto no encontrado');
    await verificarQueNoEsUnPago(id);
    // Si el proveedor no cambia, se deja aunque se haya dado de baja después.
    if (proveedorId !== antes.proveedor_id) await verificarProveedorActivo(proveedorId);
    await db
      .prepare('UPDATE gastos_caja SET concepto = ?, monto = ?, medio_pago = ?, origen = ?, proveedor_id = ? WHERE id = ?')
      .run(conceptoValido, montoValido, medioValido, origenValido, proveedorId, id);
    if (origenValido === 'general') await frenarSiNoAlcanza();
    const gasto = await db.prepare(SQL_GASTO_CON_PROVEEDOR).get(id);
    return { gasto, antes };
  });
}

// Eliminar (corregir un gasto mal cargado): Admin+Encargado, no Cajero --
// mismo criterio que anular una venta: una acción correctiva queda más
// restringida que la de crear.
export async function eliminarGasto(id) {
  await db.transaction(async () => {
    const gasto = await db.prepare('SELECT id FROM gastos_caja WHERE id = ? AND eliminado_en IS NULL').get(id);
    if (!gasto) throw new ApiError(404, 'Gasto no encontrado');
    await verificarQueNoEsUnPago(id);
    await db.prepare('UPDATE gastos_caja SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  });
}
