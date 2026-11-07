import db from '../db/connection.js';
import { esDiaValido, hoyNegocio, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
import { ApiError } from '../utils/api-error.js';
import { frenarSiNoAlcanza, validarOrigen } from './caja-general.service.js';

// Saldos pendientes (pedido del usuario, 2026-10-29): en una sola lista, lo que falta pagar. Las
// boletas de proveedores impagas o pagadas en parte (salen de compras_proveedor, con su fecha para
// pagar) y las cuentas de impuestos y servicios: las que se cargan acá, de una sola vez, y los
// vencimientos de lo que se paga siempre, que entran solos desde Fijos (fijos.service.js, migración 041).

const MAX_TEXTO = 200;
// Tope de un monto en pesos, el mismo de precios, gastos y pagos a proveedores.
const MAX_MONTO = 1_000_000_000;

export const TIPOS_CUENTA = ['impuestos', 'alquiler', 'luz', 'agua', 'gas', 'internet', 'honorarios', 'otro'];
const MEDIOS_PAGO = ['efectivo', 'transferencia', 'mercado_pago', 'debito', 'tarjeta'];

export function validarTexto(valor, campo, { requerido = true } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ApiError(400, `${campo} es requerido`);
    return null;
  }
  if (typeof valor !== 'string') throw new ApiError(400, `${campo} tiene que ser texto`);
  const limpio = valor.trim();
  if (requerido && limpio === '') throw new ApiError(400, `${campo} es requerido`);
  if (limpio.length > MAX_TEXTO) throw new ApiError(400, `${campo} no puede superar ${MAX_TEXTO} caracteres`);
  return limpio || null;
}

export function validarMonto(valor, campo) {
  // Solo número: Number(true) vale 1 y Number('') vale 0, y se aceptaban.
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1) throw new ApiError(400, `${campo} tiene que ser un número entero mayor a 0`);
  if (valor > MAX_MONTO) throw new ApiError(400, `${campo} no puede superar ${MAX_MONTO.toLocaleString('es-AR')}`);
  return valor;
}

function validarFecha(valor, campo) {
  if (!esDiaValido(valor)) throw new ApiError(400, `${campo} no es una fecha válida (AAAA-MM-DD)`);
  return valor;
}

function validarCuenta(datos, { parcial = false } = {}) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new ApiError(400, 'Faltan los datos de la cuenta');
  const cuenta = {};
  const pide = (campo) => !parcial || datos[campo] !== undefined;
  if (pide('tipo')) {
    if (!TIPOS_CUENTA.includes(datos.tipo)) throw new ApiError(400, `tipo tiene que ser uno de: ${TIPOS_CUENTA.join(', ')}`);
    cuenta.tipo = datos.tipo;
  }
  if (pide('concepto')) cuenta.concepto = validarTexto(datos.concepto, 'El concepto');
  if (pide('monto')) cuenta.monto = validarMonto(datos.monto, 'El monto');
  if (pide('vence')) cuenta.vence = validarFecha(datos.vence, 'El vencimiento');
  if (datos.nota !== undefined) cuenta.nota = validarTexto(datos.nota, 'La nota', { requerido: false });
  return cuenta;
}

// Lo pagado de cada cuenta y de cada boleta (pagos no anulados).
export const SQL_PAGADO = 'COALESCE((SELECT SUM(p.monto) FROM pagos_cuenta p WHERE p.cuenta_id = cp.id AND p.anulado_en IS NULL), 0)';
const SQL_PAGADO_COMPRA = 'COALESCE((SELECT SUM(pg.monto) FROM pagos_proveedor pg WHERE pg.compra_id = c.id AND pg.anulado_en IS NULL), 0)';

async function obtenerCuentaActiva(id) {
  const cuenta = await db
    .prepare(`SELECT cp.*, ${SQL_PAGADO} AS pagado FROM cuentas_pagar cp WHERE cp.id = ? AND cp.eliminado_en IS NULL`)
    .get(id);
  if (!cuenta) throw new ApiError(404, 'Cuenta no encontrada');
  return cuenta;
}

// La pantalla: cuentas sin pagar del todo (una sin monto todavía no se pagó) y boletas de proveedores con saldo (en cada una, la que
// vence antes, primero), lo pagado en el mes y la fecha de hoy del negocio, para que la pantalla arme
// "Vencidas", "Esta semana" y "Más adelante" con el mismo día que el servidor.
export async function obtenerSaldos() {
  const cuentas = await db
    .prepare(
      `SELECT * FROM (
         SELECT cp.id, cp.tipo, cp.concepto, cp.monto, cp.vence, cp.repeticion, cp.nota, ${SQL_PAGADO} AS pagado
         FROM cuentas_pagar cp WHERE cp.eliminado_en IS NULL
       ) x WHERE monto IS NULL OR pagado < monto ORDER BY vence, id`
    )
    .all();
  const compras = await db
    .prepare(
      `SELECT * FROM (
         SELECT c.id, c.proveedor_id, pr.nombre AS proveedor_nombre, c.fecha, c.vence, c.comprobante_tipo, c.comprobante_numero,
           c.total, c.cargada_a_mano, c.nota, EXISTS (SELECT 1 FROM correcciones_compra cc WHERE cc.compra_id = c.id) AS corregida,
           ${SQL_PAGADO_COMPRA} AS pagado
         FROM compras_proveedor c JOIN proveedores pr ON pr.id = c.proveedor_id
         WHERE c.anulada_en IS NULL AND pr.eliminado_en IS NULL
       ) x WHERE pagado < total ORDER BY vence, fecha, id`
    )
    .all();
  const pagadoMes = await db
    .prepare(
      `SELECT COALESCE(SUM(monto), 0) AS monto, COUNT(*) AS cantidad FROM (
         SELECT monto, fecha FROM pagos_proveedor WHERE anulado_en IS NULL
         UNION ALL
         SELECT monto, fecha FROM pagos_cuenta WHERE anulado_en IS NULL
       ) p WHERE date_trunc('month', fecha) = date_trunc('month', ${SQL_HOY_NEGOCIO})`
    )
    .get();
  return { hoy: hoyNegocio(), cuentas, compras, pagado_mes: pagadoMes };
}

// Para el contador del menú: cuentas y boletas de proveedores vencidas sin pagar del todo.
export async function contarVencidas() {
  const fila = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM cuentas_pagar cp
          WHERE cp.eliminado_en IS NULL AND cp.vence < ${SQL_HOY_NEGOCIO} AND (cp.monto IS NULL OR ${SQL_PAGADO} < cp.monto))
         + (SELECT COUNT(*) FROM compras_proveedor c JOIN proveedores pr ON pr.id = c.proveedor_id
            WHERE c.anulada_en IS NULL AND pr.eliminado_en IS NULL AND c.vence < ${SQL_HOY_NEGOCIO} AND ${SQL_PAGADO_COMPRA} < c.total)
         AS cantidad`
    )
    .get();
  return fila.cantidad;
}

// Ficha de una cuenta: sus datos, lo pagado, los pagos (con los anulados) y si su fijo sigue vigente.
export async function obtenerCuenta(id) {
  const cuenta = await obtenerCuentaActiva(id);
  const pagos = await db
    .prepare(
      `SELECT p.id, p.fecha, p.monto, p.medio, COALESCE(g.origen, 'otro') AS origen, p.detalle, p.creado_en, p.anulado_en,
         u.nombre AS usuario_nombre, ua.nombre AS anulado_por_nombre
       FROM pagos_cuenta p
       JOIN usuarios u ON u.id = p.usuario_id
       LEFT JOIN usuarios ua ON ua.id = p.anulado_por
       LEFT JOIN gastos_caja g ON g.id = p.gasto_caja_id
       WHERE p.cuenta_id = ?
       ORDER BY p.fecha DESC, p.id DESC`
    )
    .all(id);
  const fijo = cuenta.fijo_id ? await db.prepare('SELECT id FROM fijos WHERE id = ? AND eliminado_en IS NULL').get(cuenta.fijo_id) : null;
  return { ...cuenta, pagos: pagos.map((p) => ({ ...p, anulado: Boolean(p.anulado_en) })), fijo_vigente: Boolean(fijo) };
}

export async function crearCuenta(datos, { usuarioId }) {
  const c = validarCuenta(datos);
  const creada = await db
    .prepare(
      `INSERT INTO cuentas_pagar (tipo, concepto, monto, vence, nota, serie_base, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(c.tipo, c.concepto, c.monto, c.vence, c.nota ?? null, c.vence, usuarioId);
  return obtenerCuenta(creada.id);
}

// Corregir una cuenta (ej. la luz de este mes vino más cara). El monto no puede quedar por debajo
// de lo ya pagado.
export async function editarCuenta(id, datos) {
  const c = validarCuenta(datos, { parcial: true });
  if (Object.keys(c).length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');
  await db.transaction(async () => {
    const actual = await obtenerCuentaActiva(id);
    if (c.monto !== undefined && c.monto < actual.pagado) {
      throw new ApiError(400, `El monto no puede ser menor a lo ya pagado (${actual.pagado.toLocaleString('es-AR')}).`);
    }
    const claves = Object.keys(c);
    await db
      .prepare(`UPDATE cuentas_pagar SET ${claves.map((k) => `${k} = ?`).join(', ')}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...claves.map((k) => c[k]), id);
  });
  return obtenerCuenta(id);
}

// "Saltear" un vencimiento de un fijo que este período no se paga: se da de baja y el próximo sigue
// igual. No vuelve, porque el fijo ya lo dejó atrás. Si tiene pagos, se anulan primero.
export async function saltearVencimiento(id) {
  await db.transaction(async () => {
    const cuenta = await obtenerCuentaActiva(id);
    if (!cuenta.fijo_id) throw new ApiError(409, 'Solo se puede saltear un vencimiento de un fijo.');
    if (cuenta.pagado > 0) throw new ApiError(409, 'Este vencimiento tiene pagos: anulalos primero.');
    await db.prepare('UPDATE cuentas_pagar SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  });
}

// Dar de baja una cuenta cargada por error. Si tiene pagos, se anulan primero.
export async function eliminarCuenta(id) {
  await db.transaction(async () => {
    const cuenta = await obtenerCuentaActiva(id);
    if (cuenta.pagado > 0) throw new ApiError(409, 'Esta cuenta tiene pagos: anulalos primero.');
    await db.prepare('UPDATE cuentas_pagar SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  });
}

function validarPago(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new ApiError(400, 'Faltan los datos del pago');
  if (!MEDIOS_PAGO.includes(datos.medio)) throw new ApiError(400, `medio tiene que ser uno de: ${MEDIOS_PAGO.join(', ')}`);
  return {
    monto: validarMonto(datos.monto, 'El monto del pago'),
    fecha: validarFecha(datos.fecha ?? hoyNegocio(), 'La fecha del pago'),
    medio: datos.medio,
    origen: validarOrigen(datos.origen, datos.medio),
    detalle: validarTexto(datos.detalle, 'El detalle', { requerido: false }),
  };
}

// Pagar (todo o una parte). Leer lo pagado, decidir y escribir en una transacción: dos pagos a la
// vez no pueden pasarse del monto. En un vencimiento sin monto ("según factura"), el que se escribe
// al pagar pasa a ser el de la cuenta.
export async function registrarPagoCuenta(id, datos, { usuarioId }) {
  const pago = validarPago(datos);
  await db.transaction(async () => {
    const cuenta = await obtenerCuentaActiva(id);
    if (cuenta.monto === null) {
      await db.prepare('UPDATE cuentas_pagar SET monto = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?').run(pago.monto, id);
    } else if (pago.monto > cuenta.monto - cuenta.pagado) {
      throw new ApiError(400, `El pago supera lo que falta pagar (${(cuenta.monto - cuenta.pagado).toLocaleString('es-AR')}).`);
    }
    const saleDeUnaCaja = pago.origen !== 'otro';
    let gastoId = null;
    if (saleDeUnaCaja) {
      const gasto = await db
        .prepare('INSERT INTO gastos_caja (usuario_id, concepto, monto, proveedor_id, origen) VALUES (?, ?, ?, NULL, ?) RETURNING id')
        .get(usuarioId, `Pago de ${cuenta.concepto}`.slice(0, MAX_TEXTO), pago.monto, pago.origen);
      gastoId = gasto.id;
      if (pago.origen === 'general') await frenarSiNoAlcanza();
    }
    await db
      .prepare(
        `INSERT INTO pagos_cuenta (cuenta_id, usuario_id, fecha, monto, medio, sale_de_caja, gasto_caja_id, detalle)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, usuarioId, pago.fecha, pago.monto, pago.medio, saleDeUnaCaja, gastoId, pago.detalle);
  });
  return obtenerCuenta(id);
}

// Anular un pago cargado mal: queda en el historial y, si salió de una caja, se da de baja su gasto.
export async function anularPagoCuenta(id, pagoId, { usuarioId }) {
  await db.transaction(async () => {
    await obtenerCuentaActiva(id);
    const pago = await db
      .prepare('SELECT id, gasto_caja_id FROM pagos_cuenta WHERE id = ? AND cuenta_id = ? AND anulado_en IS NULL')
      .get(pagoId, id);
    if (!pago) throw new ApiError(404, 'Pago no encontrado');
    await db.prepare('UPDATE pagos_cuenta SET anulado_en = CURRENT_TIMESTAMP, anulado_por = ? WHERE id = ?').run(usuarioId, pagoId);
    if (pago.gasto_caja_id) {
      await db.prepare('UPDATE gastos_caja SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ? AND eliminado_en IS NULL').run(pago.gasto_caja_id);
    }
  });
  return obtenerCuenta(id);
}
