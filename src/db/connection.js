import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

// Capa de acceso a PostgreSQL. Mantiene la forma que tenia con SQLite
// (db.prepare(sql).get/all/run, db.exec) para no reescribir cada consulta, pero
// todo es asincrono: hay que usar await.
//
// Diferencias que importan:
//  * Placeholders: se sigue escribiendo "?", aca se convierten a $1, $2...
//  * Los timestamps y fechas vuelven como TEXTO ("YYYY-MM-DD HH:MM:SS" /
//    "YYYY-MM-DD"), igual que con SQLite, en vez de objetos Date.
//  * COUNT/SUM (bigint) y NUMERIC vuelven como Number, no como string.
//  * Antes cada funcion era atomica por ser sincrona (un solo hilo, una sola
//    conexion). Ahora hay varias conexiones y awaits entre consultas: toda
//    secuencia "leer, decidir, escribir" tiene que ir dentro de db.transaction().

const { Pool, types } = pg;
types.setTypeParser(20, (v) => Number(v)); // int8 (COUNT, SUM, BIGINT)
types.setTypeParser(1700, (v) => Number(v)); // numeric
types.setTypeParser(1082, (v) => v); // date -> "YYYY-MM-DD"
types.setTypeParser(1114, (v) => v); // timestamp -> "YYYY-MM-DD HH:MM:SS"

if (!config.databaseUrl) {
  throw new Error('Falta DATABASE_URL (cadena de conexion a PostgreSQL). Ver .env.example.');
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.db.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Todo el sistema guarda fechas en UTC (ver fecha-negocio.js para la hora argentina):
  // fija la zona de la sesion para que CURRENT_TIMESTAMP/NOW() no dependan de la del servidor.
  options: '-c TimeZone=UTC',
});

// Un error en una conexion ociosa del pool (ej. reinicio de Postgres) no debe
// tumbar el proceso: el pool la descarta y abre otra.
pool.on('error', (err) => {
  console.error('[db] error en conexion ociosa del pool:', err.message);
});

// Dentro de db.transaction() todas las consultas usan la misma conexion, sin
// tener que pasarla como parametro por cada funcion.
const contexto = new AsyncLocalStorage();

const cacheConversion = new Map();

// "?" -> "$n", ignorando los que estan dentro de un literal entre comillas simples.
function convertirPlaceholders(sql) {
  const cacheado = cacheConversion.get(sql);
  if (cacheado) return cacheado;

  let salida = '';
  let n = 0;
  let enTexto = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      if (enTexto && sql[i + 1] === "'") {
        salida += "''";
        i++;
        continue;
      }
      enTexto = !enTexto;
    }
    salida += c === '?' && !enTexto ? `$${++n}` : c;
  }
  cacheConversion.set(sql, salida);
  return salida;
}

function ejecutor() {
  return contexto.getStore()?.client ?? pool;
}

function consulta(sql, params) {
  return ejecutor().query(convertirPlaceholders(sql), params);
}

/** Misma forma que db.prepare() de SQLite, pero get/all/run devuelven promesas. */
function prepare(sql) {
  return {
    get: async (...params) => (await consulta(sql, params)).rows[0],
    all: async (...params) => (await consulta(sql, params)).rows,
    run: async (...params) => {
      const r = await consulta(sql, params);
      // lastInsertRowid solo existe si el INSERT termina en RETURNING id.
      return { changes: r.rowCount, lastInsertRowid: r.rows?.[0]?.id };
    },
  };
}

/** Ejecuta una o varias sentencias sin parametros (migraciones, scripts). */
async function exec(sql) {
  await ejecutor().query(sql);
}

const CODIGOS_REINTENTABLES = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected
const MAX_INTENTOS = 6;

/**
 * Corre fn dentro de una transaccion SERIALIZABLE (equivale al comportamiento
 * de SQLite: como si las transacciones corrieran de a una). Si Postgres aborta
 * por un conflicto de concurrencia, se reintenta sola, por eso fn no puede
 * tener efectos fuera de la base (mails, archivos). Si ya hay una transaccion
 * en curso, se une a ella.
 */
async function transaction(fn) {
  if (contexto.getStore()?.client) return fn();

  for (let intento = 1; ; intento++) {
    const client = await pool.connect();
    let conexionRota = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const resultado = await contexto.run({ client }, fn);
      await client.query('COMMIT');
      return resultado;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        conexionRota = true; // si el ROLLBACK falla, la conexion se descarta
      }
      if (CODIGOS_REINTENTABLES.has(err.code)) {
        if (intento < MAX_INTENTOS) {
          // Espera aleatoria (jitter) que crece con cada intento: si todas las transacciones
          // en conflicto esperaran lo mismo, volverian a chocar juntas una y otra vez.
          await new Promise((r) => setTimeout(r, 10 * intento + Math.random() * 40 * 2 ** intento));
          continue;
        }
        // Contencion esperada, no un error del sistema: muchas transacciones simultaneas sobre
        // las mismas filas (ej. 10+ ventas del mismo producto al mismo tiempo) agotan los
        // reintentos aunque haya stock de sobra. No hubo ningun cambio (se hizo ROLLBACK), asi
        // que se responde un 409 reintentable en vez de un 500 "Error interno".
        throw new ApiError(409, 'El sistema está ocupado, volvé a intentar');
      }
      throw err;
    } finally {
      client.release(conexionRota ? true : undefined);
    }
  }
}

/** Cierra el pool (scripts de una sola corrida, para que el proceso termine). */
async function cerrar() {
  await pool.end();
}

const db = { prepare, exec, transaction, cerrar, pool };

export default db;
