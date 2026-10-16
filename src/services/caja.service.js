import db from '../db/connection.js';
import { hoyNegocio, sqlDiaNegocio, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
import { ApiError } from '../utils/api-error.js';

// Se suman todos los medios que existan en los datos, aunque el plan actual no
// ofrezca 'cta_cte': una venta ya registrada nunca se descarta del total.
const MEDIOS_PAGO = ['efectivo', 'tarjeta', 'transferencia_qr', 'mercado_pago', 'fiado', 'cta_cte'];

// Tope de un monto en pesos, el mismo de los gastos (gastos.service.js): Number.isInteger(9e15)
// es true y sin tope un cierre absurdo quedaba guardado y se heredaba como fondo al turno siguiente.
const MAX_MONTO = 1_000_000_000;

function validarEnteroNoNegativo(valor, campo) {
  // Solo número o texto numérico: Number(true) vale 1 y Number([5]) vale 5, y se aceptaban como monto.
  if (typeof valor !== 'number' && typeof valor !== 'string') {
    throw new ApiError(400, `${campo} tiene que ser un número entero mayor o igual a 0`);
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) {
    throw new ApiError(400, `${campo} tiene que ser un número entero mayor o igual a 0`);
  }
  if (n > MAX_MONTO) throw new ApiError(400, `${campo} no puede superar ${MAX_MONTO.toLocaleString('es-AR')}`);
  return n;
}

// El cierre de caja es POR TURNO (decisión del usuario, 2026-10-16): cada cierre cuenta lo que
// pasó desde el cierre anterior, aunque sea del mismo día, y arranca con el fondo que dejó ese
// cierre. Antes era por día: un segundo cierre del mismo día volvía a contar todo el día.
//
// Dónde arranca el turno:
// - Desde el último cierre (de cualquier día). Cada cierre guarda hasta qué venta y qué gasto
//   contó (hasta_venta_id / hasta_gasto_id, migración 024): el turno siguiente arranca exacto,
//   sin depender de la hora (dos movimientos del mismo segundo no se pierden ni se cuentan dos veces).
// - Un cierre anterior a la 024 no tiene esos datos: se usa su hora.
// - Si nunca hubo un cierre, desde el inicio del día (hora argentina).
async function ultimoCierre() {
  return db
    .prepare('SELECT id, fecha, creado_en, fondo_dejado, hasta_venta_id, hasta_gasto_id FROM cierres_caja ORDER BY id DESC LIMIT 1')
    .get();
}

function condicionDelTurno(anterior, columnaHasta) {
  if (anterior && anterior[columnaHasta] != null) return { sql: 'id > ?', params: [anterior[columnaHasta]] };
  if (anterior) return { sql: 'creado_en > ?::timestamp', params: [anterior.creado_en] };
  return { sql: `${sqlDiaNegocio('creado_en')} = ${SQL_HOY_NEGOCIO}`, params: [] };
}

// Totales del turno abierto, agrupados por medio de pago, en base a las ventas REGISTRADAS (no
// anuladas) -- cálculo en vivo; cierres_caja guarda la FOTO de cada cierre ya hecho. Es lo que
// ven los 3 roles en Cierre de Caja antes de que Admin/Encargado confirmen el cierre.
//
// Efectivo que tiene que haber en la caja = fondo que dejó el cierre anterior + ventas en
// efectivo del turno − gastos y pagos a proveedores del turno (se asumen en efectivo: salen del
// cajón, ver gastos.service.js).
export async function calcularResumenDelTurno() {
  const anterior = await ultimoCierre();
  const ventasTurno = condicionDelTurno(anterior, 'hasta_venta_id');
  const gastosTurno = condicionDelTurno(anterior, 'hasta_gasto_id');

  const filas = await db
    .prepare(
      `SELECT medio_pago, COALESCE(SUM(total), 0) AS total
       FROM ventas
       WHERE estado = 'registrada' AND ${ventasTurno.sql}
       GROUP BY medio_pago`
    )
    .all(...ventasTurno.params);
  const totales = Object.fromEntries(MEDIOS_PAGO.map((m) => [m, 0]));
  for (const fila of filas) totales[fila.medio_pago] = Number(fila.total);

  const gastos = await db
    .prepare(`SELECT COALESCE(SUM(monto), 0) AS total FROM gastos_caja WHERE eliminado_en IS NULL AND ${gastosTurno.sql}`)
    .get(...gastosTurno.params);

  const total_general = MEDIOS_PAGO.reduce((acc, m) => acc + totales[m], 0);
  const fondo_heredado = Number(anterior?.fondo_dejado ?? 0);
  const total_gastos = Number(gastos.total);

  return {
    fecha: hoyNegocio(),
    // Inicio del turno: el cierre anterior (UTC, como lo guarda la base) o null si no hubo ninguno.
    desde: anterior?.creado_en ?? null,
    cierre_anterior_id: anterior?.id ?? null,
    fondo_heredado,
    total_gastos,
    total_efectivo: totales.efectivo,
    total_efectivo_esperado: totales.efectivo + fondo_heredado - total_gastos,
    total_tarjeta: totales.tarjeta,
    total_transferencia_qr: totales.transferencia_qr,
    total_mercado_pago: totales.mercado_pago,
    total_fiado: totales.fiado,
    total_cta_cte: totales.cta_cte,
    total_general,
  };
}

export function listarCierres() {
  return db
    .prepare(
      `SELECT c.*, u.nombre AS usuario_nombre
       FROM cierres_caja c JOIN usuarios u ON u.id = c.usuario_id
       ORDER BY c.id DESC`
    )
    .all();
}

export async function obtenerCierre(id) {
  const cierre = await db.prepare('SELECT * FROM cierres_caja WHERE id = ?').get(id);
  if (!cierre) throw new ApiError(404, 'Cierre de caja no encontrado');
  return cierre;
}

// "Cierre de caja -- Editar" (Admin+Encargado, no Cajero -- confirmado en
// Docs/Resumen-Ejecutivo.md: "Cajero... ve el cierre de caja, sin editar").
// Guarda una FOTO de los totales del turno al momento del cierre (no se recalculan
// después). Solo efectivo tiene "esperado vs. contado": es el único medio que
// se cuenta físicamente y puede tener diferencia; los demás son registros
// digitales exactos que ya coinciden con lo esperado.
export async function registrarCierre({ total_efectivo_contado, fondo_dejado }, { usuarioId }) {
  const contado = validarEnteroNoNegativo(total_efectivo_contado, 'total_efectivo_contado');
  // Fondo que este cierre deja en el cajón para el turno siguiente (opcional, 0 si no se carga).
  const fondoDejado = fondo_dejado != null ? validarEnteroNoNegativo(fondo_dejado, 'fondo_dejado') : 0;
  if (fondoDejado > contado) throw new ApiError(400, 'El fondo a dejar no puede ser mayor que lo que contaste.');

  return db.transaction(async () => {
    // Los cierres van de a uno, y mientras se arma uno nadie registra ni anula ventas ni anota
    // gastos (esperan un instante): así lo que cuenta este cierre y lo que arranca el turno
    // siguiente se parten exacto. Los LOCK van antes de cualquier consulta, para que la
    // transacción vea todo lo confirmado hasta ese momento.
    await db.exec('LOCK TABLE cierres_caja IN SHARE ROW EXCLUSIVE MODE');
    await db.exec('LOCK TABLE ventas, gastos_caja IN SHARE MODE');

    // Doble envío (hallazgo Media, verificador-funcional 2026-09-10): un doble click en
    // "Confirmar" mandaba 2 POST seguidos. Con el cierre por turno el segundo ya no repetiría los
    // mismos totales (contaría un turno vacío), así que se rechaza cualquier cierre que llegue
    // menos de 5 segundos después de otro.
    const reciente = await db
      .prepare(`SELECT id FROM cierres_caja WHERE creado_en >= (NOW() AT TIME ZONE 'UTC') - INTERVAL '5 seconds' LIMIT 1`)
      .get();
    if (reciente) {
      throw new ApiError(409, 'Se acaba de registrar un cierre. Si querías cerrar otro turno, esperá unos segundos y volvé a intentar.');
    }

    const resumen = await calcularResumenDelTurno();
    const diferencia = contado - resumen.total_efectivo_esperado;
    const hasta = await db
      .prepare(
        `SELECT (SELECT COALESCE(MAX(id), 0) FROM ventas) AS venta,
                (SELECT COALESCE(MAX(id), 0) FROM gastos_caja) AS gasto`
      )
      .get();

    // total_general usa el total real de ventas (no el contado): es un total de auditoría de lo
    // que se vendió, separado del desvío de caja física que queda en diferencia_efectivo.
    // fondo_heredado/total_gastos se guardan tal cual estaban en el momento del cierre (misma
    // lógica de "foto" que el resto de la tabla -- nunca se recalculan después).
    return db
      .prepare(
        `INSERT INTO cierres_caja
           (usuario_id, fecha, total_efectivo_esperado, total_efectivo_contado, diferencia_efectivo,
            total_tarjeta, total_transferencia_qr, total_mercado_pago, total_fiado, total_cta_cte, total_general,
            fondo_dejado, fondo_heredado, total_gastos, hasta_venta_id, hasta_gasto_id)
         VALUES (?, ?::date, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`
      )
      .get(
        usuarioId,
        resumen.fecha,
        resumen.total_efectivo_esperado,
        contado,
        diferencia,
        resumen.total_tarjeta,
        resumen.total_transferencia_qr,
        resumen.total_mercado_pago,
        resumen.total_fiado,
        resumen.total_cta_cte,
        resumen.total_general,
        fondoDejado,
        resumen.fondo_heredado,
        resumen.total_gastos,
        Number(hasta.venta),
        Number(hasta.gasto)
      );
  });
}
