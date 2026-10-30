import db from '../db/connection.js';
import { esDiaValido, hoyNegocio, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
import { ApiError } from '../utils/api-error.js';

// Saldos pendientes (pedido del usuario, 2026-10-29): en una sola lista, lo que falta pagar. Las
// boletas de proveedores impagas o pagadas en parte (salen de compras_proveedor, con su fecha para
// pagar) y las cuentas de impuestos, servicios y gastos fijos, que se cargan acá con vencimiento y
// repetición.

const MAX_TEXTO = 200;
// Tope de un monto en pesos, el mismo de precios, gastos y pagos a proveedores.
const MAX_MONTO = 1_000_000_000;

export const TIPOS_CUENTA = ['impuestos', 'alquiler', 'luz', 'agua', 'gas', 'internet', 'honorarios', 'otro'];
// Cada cuánto se repite: el intervalo de Postgres que separa un vencimiento del siguiente.
const REPETICIONES = { no: null, semanal: '7 days', quincenal: '15 days', mensual: '1 month', bimestral: '2 months', anual: '1 year' };
const MEDIOS_PAGO = ['efectivo', 'transferencia', 'mercado_pago', 'debito', 'tarjeta'];

function validarTexto(valor, campo, { requerido = true } = {}) {
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

function validarMonto(valor, campo) {
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
  if (pide('repeticion')) {
    const repeticion = datos.repeticion ?? 'no';
    if (!(repeticion in REPETICIONES)) throw new ApiError(400, `repeticion tiene que ser una de: ${Object.keys(REPETICIONES).join(', ')}`);
    cuenta.repeticion = repeticion;
  }
  if (datos.nota !== undefined) cuenta.nota = validarTexto(datos.nota, 'La nota', { requerido: false });
  return cuenta;
}

// Lo pagado de cada cuenta y de cada boleta (pagos no anulados).
const SQL_PAGADO = 'COALESCE((SELECT SUM(p.monto) FROM pagos_cuenta p WHERE p.cuenta_id = cp.id AND p.anulado_en IS NULL), 0)';
const SQL_PAGADO_COMPRA = 'COALESCE((SELECT SUM(pg.monto) FROM pagos_proveedor pg WHERE pg.compra_id = c.id AND pg.anulado_en IS NULL), 0)';

async function obtenerCuentaActiva(id) {
  const cuenta = await db
    .prepare(`SELECT cp.*, ${SQL_PAGADO} AS pagado FROM cuentas_pagar cp WHERE cp.id = ? AND cp.eliminado_en IS NULL`)
    .get(id);
  if (!cuenta) throw new ApiError(404, 'Cuenta no encontrada');
  return cuenta;
}

// La pantalla: cuentas sin pagar del todo y boletas de proveedores con saldo (en cada una, la que
// vence antes, primero), lo pagado en el mes y la fecha de hoy del negocio, para que la pantalla arme
// "Vencidas", "Esta semana" y "Más adelante" con el mismo día que el servidor.
export async function obtenerSaldos() {
  const cuentas = await db
    .prepare(
      `SELECT * FROM (
         SELECT cp.id, cp.tipo, cp.concepto, cp.monto, cp.vence, cp.repeticion, cp.nota, ${SQL_PAGADO} AS pagado
         FROM cuentas_pagar cp WHERE cp.eliminado_en IS NULL
       ) x WHERE pagado < monto ORDER BY vence, id`
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
          WHERE cp.eliminado_en IS NULL AND cp.vence < ${SQL_HOY_NEGOCIO} AND ${SQL_PAGADO} < cp.monto)
         + (SELECT COUNT(*) FROM compras_proveedor c JOIN proveedores pr ON pr.id = c.proveedor_id
            WHERE c.anulada_en IS NULL AND pr.eliminado_en IS NULL AND c.vence < ${SQL_HOY_NEGOCIO} AND ${SQL_PAGADO_COMPRA} < c.total)
         AS cantidad`
    )
    .get();
  return fila.cantidad;
}

// Ficha de una cuenta: sus datos, lo pagado, los pagos (con los anulados) y, si ya se creó, la
// siguiente de la serie.
export async function obtenerCuenta(id) {
  const cuenta = await obtenerCuentaActiva(id);
  const pagos = await db
    .prepare(
      `SELECT p.id, p.fecha, p.monto, p.medio, p.sale_de_caja, p.detalle, p.creado_en, p.anulado_en,
         u.nombre AS usuario_nombre, ua.nombre AS anulado_por_nombre
       FROM pagos_cuenta p
       JOIN usuarios u ON u.id = p.usuario_id
       LEFT JOIN usuarios ua ON ua.id = p.anulado_por
       WHERE p.cuenta_id = ?
       ORDER BY p.fecha DESC, p.id DESC`
    )
    .all(id);
  const siguiente = await db
    .prepare('SELECT id, vence FROM cuentas_pagar WHERE origen_id = ? AND eliminado_en IS NULL')
    .get(id);
  return { ...cuenta, pagos: pagos.map((p) => ({ ...p, anulado: Boolean(p.anulado_en) })), siguiente: siguiente ?? null };
}

export async function crearCuenta(datos, { usuarioId }) {
  const c = validarCuenta(datos);
  const creada = await db
    .prepare(
      `INSERT INTO cuentas_pagar (tipo, concepto, monto, vence, repeticion, nota, serie_base, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(c.tipo, c.concepto, c.monto, c.vence, c.repeticion, c.nota ?? null, c.vence, usuarioId);
  return obtenerCuenta(creada.id);
}

// Corregir una cuenta (ej. la luz de este mes vino más cara). El monto no puede quedar por debajo
// de lo ya pagado. Si cambia el vencimiento, la serie sigue contando desde la fecha nueva.
export async function editarCuenta(id, datos) {
  const c = validarCuenta(datos, { parcial: true });
  if (Object.keys(c).length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');
  await db.transaction(async () => {
    const actual = await obtenerCuentaActiva(id);
    if (c.monto !== undefined && c.monto < actual.pagado) {
      throw new ApiError(400, `El monto no puede ser menor a lo ya pagado (${actual.pagado.toLocaleString('es-AR')}).`);
    }
    if (c.vence !== undefined && c.vence !== actual.vence) {
      c.serie_base = c.vence;
      c.serie_numero = 0;
    }
    const claves = Object.keys(c);
    await db
      .prepare(`UPDATE cuentas_pagar SET ${claves.map((k) => `${k} = ?`).join(', ')}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...claves.map((k) => c[k]), id);
  });
  return obtenerCuenta(id);
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
  if (datos.sale_de_caja !== undefined && typeof datos.sale_de_caja !== 'boolean') {
    throw new ApiError(400, 'sale_de_caja tiene que ser true o false');
  }
  return {
    monto: validarMonto(datos.monto, 'El monto del pago'),
    fecha: validarFecha(datos.fecha ?? hoyNegocio(), 'La fecha del pago'),
    medio: datos.medio,
    sale_de_caja: datos.medio === 'efectivo' && datos.sale_de_caja === true,
    detalle: validarTexto(datos.detalle, 'El detalle', { requerido: false }),
  };
}

// Pagar (todo o una parte). Leer lo pagado, decidir y escribir en una transacción: dos pagos a la
// vez no pueden pasarse del monto. Si con este pago queda saldada y se repite, se crea la
// siguiente con el mismo monto (una sola vez por cuenta: origen_id es único).
export async function registrarPagoCuenta(id, datos, { usuarioId }) {
  const pago = validarPago(datos);
  await db.transaction(async () => {
    const cuenta = await obtenerCuentaActiva(id);
    const pendiente = cuenta.monto - cuenta.pagado;
    if (pago.monto > pendiente) throw new ApiError(400, `El pago supera lo que falta pagar (${pendiente.toLocaleString('es-AR')}).`);
    let gastoId = null;
    if (pago.sale_de_caja) {
      const gasto = await db
        .prepare('INSERT INTO gastos_caja (usuario_id, concepto, monto, proveedor_id) VALUES (?, ?, ?, NULL) RETURNING id')
        .get(usuarioId, `Pago de ${cuenta.concepto}`.slice(0, MAX_TEXTO), pago.monto);
      gastoId = gasto.id;
    }
    await db
      .prepare(
        `INSERT INTO pagos_cuenta (cuenta_id, usuario_id, fecha, monto, medio, sale_de_caja, gasto_caja_id, detalle)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, usuarioId, pago.fecha, pago.monto, pago.medio, pago.sale_de_caja, gastoId, pago.detalle);

    const intervalo = REPETICIONES[cuenta.repeticion];
    if (intervalo && pago.monto === pendiente) {
      const numero = cuenta.serie_numero + 1;
      const { vence } = await db.prepare('SELECT (?::date + (?::int * ?::interval))::date AS vence').get(cuenta.serie_base, numero, intervalo);
      await db
        .prepare(
          `INSERT INTO cuentas_pagar (tipo, concepto, monto, vence, repeticion, nota, serie_base, serie_numero, origen_id, usuario_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (origen_id) DO NOTHING`
        )
        .run(cuenta.tipo, cuenta.concepto, cuenta.monto, vence, cuenta.repeticion, cuenta.nota, cuenta.serie_base, numero, id, usuarioId);
    }
  });
  return obtenerCuenta(id);
}

// Anular un pago cargado mal: queda en el historial y, si salió de la caja, se da de baja su gasto.
// La siguiente de la serie, si ya se creó, queda (se elimina a mano si no corresponde).
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
