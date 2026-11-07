import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { esDiaValido, hoyNegocio, sqlDiaNegocio } from '../utils/fecha-negocio.js';

// Caja general (pedido del usuario, 2026-11-06, migración 040): el efectivo que ya no está en la caja
// del turno. Entra solo con el retiro de cada cierre y sale con los gastos y pagos que se hacen con esa
// plata. El saldo se calcula siempre, no se guarda: corregir un cierre o anular un pago se refleja solo.
// Solo cuentan los cierres desde la migración 040: lo de antes se carga a mano como saldo inicial.

const MAX_MONTO = 1_000_000_000;
const MAX_DETALLE = 200;

// De dónde sale el efectivo de un gasto o de un pago. 'otro' no descuenta de ninguna de las dos.
const ORIGENES = ['caja', 'general', 'otro'];

const TIPOS_MANUALES = {
  inicial: { concepto: 'Saldo inicial', entra: true },
  ingreso: { concepto: 'Entró plata', entra: true },
  banco: { concepto: 'Depósito en el banco', entra: false },
  dueno: { concepto: 'Retiro del dueño', entra: false },
};

const SQL_RETIRO = 'c.total_efectivo_contado - c.fondo_dejado';

const pesos = (n) => `$ ${Number(n).toLocaleString('es-AR')}`;

export function validarOrigen(valor, medio) {
  if (medio !== 'efectivo') return 'otro';
  if (!ORIGENES.includes(valor)) throw new ApiError(400, 'Elegí de dónde sale el efectivo. Si no ves esa opción, actualizá la página.');
  return valor;
}

export async function saldoCajaGeneral() {
  const { saldo } = await db
    .prepare(
      `SELECT
         COALESCE((SELECT SUM(${SQL_RETIRO}) FROM cierres_caja c WHERE c.eliminado_en IS NULL AND c.a_caja_general), 0)
         + COALESCE((SELECT SUM(CASE WHEN m.tipo IN ('inicial', 'ingreso') THEN m.monto ELSE -m.monto END)
                     FROM caja_general_movimientos m WHERE m.anulado_en IS NULL), 0)
         - COALESCE((SELECT SUM(g.monto) FROM gastos_caja g WHERE g.eliminado_en IS NULL AND g.origen = 'general'), 0) AS saldo`
    )
    .get();
  return saldo;
}

// Caja general nunca queda en negativo (decisión del usuario, 2026-11-06: si no alcanza, se frena).
// Va al final de la transacción de todo lo que baja el saldo, después de escribir: el error deshace
// lo escrito, y la transacción SERIALIZABLE evita que dos pagos a la vez usen la misma plata.
export async function frenarSiNoAlcanza() {
  const saldo = await saldoCajaGeneral();
  if (saldo < 0) {
    throw new ApiError(409, `Caja general no alcanza: faltan ${pesos(-saldo)}. Si en realidad hay más plata, anotala primero en Caja general.`);
  }
}

function validarRango(desde, hasta) {
  if (!esDiaValido(desde) || !esDiaValido(hasta)) throw new ApiError(400, 'desde y hasta tienen que ser fechas válidas (AAAA-MM-DD)');
  if (desde > hasta) throw new ApiError(400, 'La fecha "desde" no puede ser posterior a "hasta"');
}

// Todo lo que entró y salió, del más viejo al más nuevo. Las tres fuentes quedan con la misma forma.
async function todosLosMovimientos() {
  const cierres = await db
    .prepare(
      `SELECT c.id, c.fecha, c.creado_en, ${SQL_RETIRO} AS monto
       FROM cierres_caja c
       WHERE c.eliminado_en IS NULL AND c.a_caja_general AND ${SQL_RETIRO} > 0`
    )
    .all();
  const manuales = await db
    .prepare(
      `SELECT m.id, m.tipo, m.fecha, m.creado_en, m.monto, m.detalle, u.nombre AS usuario_nombre
       FROM caja_general_movimientos m JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.anulado_en IS NULL`
    )
    .all();
  // La fecha de un pago es la que se cargó en el pago; la de un gasto, el día en que se anotó.
  const salidas = await db
    .prepare(
      `SELECT g.id, g.concepto, g.monto, g.creado_en, pp.id AS pago_proveedor_id, pc.id AS pago_cuenta_id,
         COALESCE(pp.fecha, pc.fecha, ${sqlDiaNegocio('g.creado_en')}) AS fecha
       FROM gastos_caja g
       LEFT JOIN pagos_proveedor pp ON pp.gasto_caja_id = g.id AND pp.anulado_en IS NULL
       LEFT JOIN pagos_cuenta pc ON pc.gasto_caja_id = g.id AND pc.anulado_en IS NULL
       WHERE g.eliminado_en IS NULL AND g.origen = 'general'`
    )
    .all();

  return [
    ...cierres.map((c) => ({
      clave: `cierre-${c.id}`,
      tipo: 'cierre',
      fecha: c.fecha,
      creado_en: c.creado_en,
      concepto: 'Retiro del cierre de caja',
      detalle: `Cierre #${c.id}`,
      entra: c.monto,
      sale: 0,
    })),
    ...manuales.map((m) => ({
      clave: `manual-${m.id}`,
      id: m.id,
      tipo: m.tipo,
      fecha: m.fecha,
      creado_en: m.creado_en,
      concepto: TIPOS_MANUALES[m.tipo].concepto,
      detalle: m.detalle,
      entra: TIPOS_MANUALES[m.tipo].entra ? m.monto : 0,
      sale: TIPOS_MANUALES[m.tipo].entra ? 0 : m.monto,
      manual: true,
      usuario_nombre: m.usuario_nombre,
    })),
    ...salidas.map((g) => ({
      clave: `gasto-${g.id}`,
      tipo: g.pago_proveedor_id ? 'pago' : g.pago_cuenta_id ? 'saldo' : 'gasto',
      fecha: g.fecha,
      creado_en: g.creado_en,
      concepto: g.concepto,
      detalle: g.pago_cuenta_id ? 'Saldos pendientes' : null,
      entra: 0,
      sale: g.monto,
    })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creado_en.localeCompare(b.creado_en));
}

// La pantalla: el saldo de hoy y los movimientos del período, el más nuevo primero, cada uno con lo
// que quedó después de él. primera: la fecha del movimiento más viejo, para el filtro "Todo".
export async function obtenerCajaGeneral({ desde, hasta }) {
  validarRango(desde, hasta);
  let saldo = 0;
  const movimientos = (await todosLosMovimientos()).map((m) => {
    saldo += m.entra - m.sale;
    return { ...m, saldo };
  });
  return {
    saldo,
    primera: movimientos[0]?.fecha ?? null,
    movimientos: movimientos.filter((m) => m.fecha >= desde && m.fecha <= hasta).reverse(),
  };
}

function validarMovimiento({ tipo, monto, fecha, detalle }) {
  if (typeof tipo !== 'string' || !Object.hasOwn(TIPOS_MANUALES, tipo)) throw new ApiError(400, 'Tipo de movimiento inválido');
  if (typeof monto !== 'number' || !Number.isInteger(monto) || monto < 1) throw new ApiError(400, 'El monto tiene que ser un número entero mayor a 0');
  if (monto > MAX_MONTO) throw new ApiError(400, `El monto no puede superar ${MAX_MONTO.toLocaleString('es-AR')}`);
  if (!esDiaValido(fecha)) throw new ApiError(400, 'La fecha no es válida (AAAA-MM-DD)');
  if (fecha > hoyNegocio()) throw new ApiError(400, 'La fecha no puede ser posterior a hoy.');
  if (detalle != null && typeof detalle !== 'string') throw new ApiError(400, 'El detalle tiene que ser texto');
  const limpio = detalle?.trim() || null;
  if (limpio && limpio.length > MAX_DETALLE) throw new ApiError(400, `El detalle no puede superar ${MAX_DETALLE} caracteres`);
  return { tipo, monto, fecha, detalle: limpio };
}

// Lo que no viene de un cierre ni de un pago. Devuelve el movimiento con su concepto, para el registro.
export async function anotarMovimiento(datos, { usuarioId }) {
  const m = validarMovimiento(datos || {});
  const { id } = await db.transaction(async () => {
    const creado = await db
      .prepare('INSERT INTO caja_general_movimientos (tipo, monto, fecha, detalle, usuario_id) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .get(m.tipo, m.monto, m.fecha, m.detalle, usuarioId);
    if (!TIPOS_MANUALES[m.tipo].entra) await frenarSiNoAlcanza();
    return creado;
  });
  return { id, ...m, concepto: TIPOS_MANUALES[m.tipo].concepto };
}

export async function anularMovimiento(id, { usuarioId }) {
  return db.transaction(async () => {
    const m = await db
      .prepare('SELECT id, tipo, monto, fecha, detalle FROM caja_general_movimientos WHERE id = ? AND anulado_en IS NULL')
      .get(id);
    if (!m) throw new ApiError(404, 'Movimiento no encontrado');
    await db
      .prepare(`UPDATE caja_general_movimientos SET anulado_en = (NOW() AT TIME ZONE 'UTC'), anulado_por = ? WHERE id = ?`)
      .run(usuarioId, id);
    if (TIPOS_MANUALES[m.tipo].entra) await frenarSiNoAlcanza();
    return { ...m, concepto: TIPOS_MANUALES[m.tipo].concepto };
  });
}
