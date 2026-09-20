import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { sqlDiaNegocio, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';

// Historial de backups automáticos (tabla backup_corridas). La usan las dos puntas: la app de
// backups guarda ahí sus propias corridas (origen 'local') y producción guarda lo que aquella
// le informa (origen 'informada'), para mostrar el estado del último backup en el panel.

const DETALLE_MAX = 1000;
const DRIVE_VALIDO = new Set(['subido', 'no_configurado', 'error']);

function fechaISO(valor, nombre) {
  const d = new Date(valor);
  if (typeof valor !== 'string' || Number.isNaN(d.getTime())) throw new ApiError(400, `${nombre} no es una fecha válida`);
  return d.toISOString().slice(0, 19); // UTC, sin zona: la columna es TIMESTAMP en UTC
}

const entero = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : null);

// Valida lo que llega por la API (la app de backups es de confianza, pero un error de formato
// no tiene que llegar a la base).
export function normalizarCorrida(c, origen) {
  if (!c || typeof c !== 'object') throw new ApiError(400, 'Falta el estado del backup');
  if (c.resultado !== 'ok' && c.resultado !== 'error') throw new ApiError(400, 'resultado tiene que ser "ok" o "error"');
  const drive = c.drive ?? 'no_configurado';
  if (!DRIVE_VALIDO.has(drive)) throw new ApiError(400, 'drive no es válido');
  return {
    iniciada_en: fechaISO(c.iniciada_en, 'iniciada_en'),
    terminada_en: c.terminada_en ? fechaISO(c.terminada_en, 'terminada_en') : null,
    resultado: c.resultado,
    archivo: c.archivo ? String(c.archivo).slice(0, 200) : null,
    bytes: entero(c.bytes),
    filas: entero(c.filas),
    verificado: c.verificado === true,
    drive,
    detalle: c.detalle ? String(c.detalle).slice(0, DETALLE_MAX) : null,
    origen,
  };
}

export async function registrarCorrida(c, origen = 'local') {
  const f = normalizarCorrida(c, origen);
  const { id } = await db
    .prepare(
      `INSERT INTO backup_corridas (iniciada_en, terminada_en, resultado, archivo, bytes, filas, verificado, drive, detalle, origen)
       VALUES (?::timestamp, ?::timestamp, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(f.iniciada_en, f.terminada_en, f.resultado, f.archivo, f.bytes, f.filas, f.verificado, f.drive, f.detalle, f.origen);
  // Solo se conservan las últimas 200 corridas (una por día, más los reintentos).
  await db.prepare('DELETE FROM backup_corridas WHERE id NOT IN (SELECT id FROM backup_corridas ORDER BY id DESC LIMIT 200)').run();
  return id;
}

export function ultimasCorridas(limite = 10) {
  return db
    .prepare(
      `SELECT id, iniciada_en, terminada_en, resultado, archivo, bytes, filas, verificado, drive, detalle
       FROM backup_corridas ORDER BY id DESC LIMIT ?`
    )
    .all(limite);
}

// Cuántas corridas hubo hoy (día argentino) y cuánto pasó desde la última: lo usa la app de
// backups para decidir si le toca correr o si tiene que reintentar.
export async function corridasDeHoy() {
  const dia = sqlDiaNegocio('iniciada_en');
  const fila = await db
    .prepare(
      `SELECT COUNT(*) AS cantidad,
              (ARRAY_AGG(resultado ORDER BY id DESC))[1] AS ultimo_resultado,
              EXTRACT(EPOCH FROM (LOCALTIMESTAMP - MAX(iniciada_en))) AS segundos_desde_la_ultima
       FROM backup_corridas WHERE ${dia} = ${SQL_HOY_NEGOCIO}`
    )
    .get();
  return {
    cantidad: fila.cantidad,
    ultimoResultado: fila.ultimo_resultado ?? null,
    segundosDesdeLaUltima: fila.segundos_desde_la_ultima === null ? null : Number(fila.segundos_desde_la_ultima),
  };
}

// Estado que ve el superadmin. "atrasado" = hay backups configurados pero el último bueno tiene
// más de 36 horas (un día de margen sobre el horario diario).
export async function estadoBackupsAutomaticos(configurado) {
  const corridas = await ultimasCorridas(10);
  const ultimoOk = corridas.find((c) => c.resultado === 'ok') ?? null;
  let atrasado = false;
  if (configurado) {
    const fila = await db
      .prepare(`SELECT COALESCE(MAX(iniciada_en) > LOCALTIMESTAMP - INTERVAL '36 hours', FALSE) AS reciente FROM backup_corridas WHERE resultado = 'ok'`)
      .get();
    atrasado = !fila.reciente;
  }
  return { configurado, atrasado, ultimo_ok: ultimoOk, corridas };
}
