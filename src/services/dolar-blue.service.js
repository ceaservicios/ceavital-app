import db from '../db/connection.js';
import { diaNegocioDeUtc, esDiaValido, sqlDiaNegocio, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';

// Dólar blue venta del día (decisión del usuario, 2026-10-21; regla de precios de CEA: los precios van
// en dólares y el equivalente en pesos se calcula con el dólar blue venta del día). Sale en el aviso de
// pago por mail, en /sa > Cuota y pagos y como sugerencia al anotar un pago. Migración 027.
//
// De dónde: DolarApi y, si falla, Bluelytics (URLs fijas, solo GET, sin nada del usuario). Siempre la
// VENTA. Cada respuesta se valida entera; si algo no cierra, esa fuente falló.
// Caché: la última válida queda en `instancia`; si se consultó hace menos de 30 minutos se usa sin
// pedir de nuevo. Si fallan las dos, sirve la guardada solo si se consultó hoy (hora argentina); si
// no, no hay cotización y todo sigue solo en dólares. Después de que fallan las dos, no se vuelve a
// salir a buscarla por 5 minutos (que una fuente caída no demore cada carga del panel).
// Nunca tira error hacia afuera: una falla de la cotización jamás frena un aviso, el panel ni un pago.

export const VENTA_MIN_CENT = 100; // $ 1
export const VENTA_MAX_CENT = 100_000_000; // $ 1.000.000
const TIEMPO_MAXIMO_MS = 5_000;
const ESPERA_TRAS_FALLA_MS = 5 * 60_000;
const BYTES_MAX = 64 * 1024;
// Una cotización de hace más de una semana, o de más de una hora en el futuro, es un dato roto.
const ANTIGUEDAD_MAX_MS = 7 * 86_400_000;
const ADELANTO_MAX_MS = 60 * 60_000;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// leer: de la respuesta ya parseada, [venta, fecha de la cotización].
export const FUENTES = [
  { nombre: 'DolarApi', url: 'https://dolarapi.com/v1/dolares/blue', leer: (json) => [json.venta, json.fechaActualizacion] },
  { nombre: 'Bluelytics', url: 'https://api.bluelytics.com.ar/v2/latest', leer: (json) => [json.blue?.value_sell, json.last_update] },
];

const textoUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// ---- Reglas puras ----

// venta: un número (no un texto) finito, entre 1 y 1.000.000, con hasta dos decimales. fecha: ISO 8601
// con zona, un día que exista, de la última semana y no del futuro. Devuelve { venta_cent, fecha }
// (fecha en UTC, 'AAAA-MM-DD HH:MM:SS') o null si no valida.
export function validarCotizacion(venta, fecha, ahora = Date.now()) {
  if (typeof venta !== 'number' || !Number.isFinite(venta)) return null;
  const centavos = Math.round(venta * 100);
  if (Math.abs(venta * 100 - centavos) > 1e-6 || centavos < VENTA_MIN_CENT || centavos > VENTA_MAX_CENT) return null;
  if (typeof fecha !== 'string' || !FECHA_ISO.test(fecha) || !esDiaValido(fecha.slice(0, 10))) return null;
  const ms = Date.parse(fecha);
  if (!Number.isFinite(ms) || ms > ahora + ADELANTO_MAX_MS || ms < ahora - ANTIGUEDAD_MAX_MS) return null;
  return { venta_cent: centavos, fecha: textoUtc(ms) };
}

// El cuerpo de la respuesta de una fuente -> { venta_cent, fecha } o null (JSON roto, otra forma, etc.).
export function leerRespuesta(fuente, texto, ahora = Date.now()) {
  if (typeof texto !== 'string' || texto.length > BYTES_MAX) return null;
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const [venta, fecha] = fuente.leer(json);
  return validarCotizacion(venta, fecha, ahora);
}

// Equivalente en pesos enteros de un total en centavos de dólar, a una cotización en centavos de peso:
// redondeo de (total × venta) / 10.000 (USD 253,75 a $ 1.565 = $ 397.118,75 -> $ 397.119). Con BigInt,
// porque en los topes el producto pasa el entero exacto de un Number.
export function pesosDelTotal(totalCentUsd, ventaCent) {
  if (![totalCentUsd, ventaCent].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  return Number((BigInt(totalCentUsd) * BigInt(ventaCent) + 5_000n) / 10_000n);
}

// ---- Consulta ----

async function consultarFuente(fuente) {
  try {
    const res = await fetch(fuente.url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    if (Number(res.headers.get('content-length')) > BYTES_MAX) throw new Error('respuesta demasiado grande');
    const cotizacion = leerRespuesta(fuente, await res.text());
    if (!cotizacion) throw new Error('respuesta con un formato inesperado');
    return { ...cotizacion, fuente: fuente.nombre };
  } catch (err) {
    const motivo = err?.name === 'TimeoutError' ? `no respondió en ${TIEMPO_MAXIMO_MS / 1000} s` : String(err?.message ?? err).slice(0, 120);
    console.warn(`[dolar-blue] ${fuente.nombre} sin cotización: ${motivo}`);
    return null;
  }
}

const publica = ({ venta_cent: ventaCent, fecha, fuente }) => ({ venta_cent: ventaCent, fecha, dia: diaNegocioDeUtc(fecha), fuente });

async function leerGuardada() {
  const fila = await db
    .prepare(
      `SELECT blue_venta_cent, blue_fecha, blue_fuente,
              blue_consultado_en > LOCALTIMESTAMP - INTERVAL '30 minutes' AS fresca,
              ${sqlDiaNegocio('blue_consultado_en')} = ${SQL_HOY_NEGOCIO} AS de_hoy
       FROM instancia WHERE id = 1`
    )
    .get();
  if (!fila?.blue_venta_cent) return null;
  return {
    venta_cent: Number(fila.blue_venta_cent),
    fecha: fila.blue_fecha,
    fuente: fila.blue_fuente,
    fresca: Boolean(fila.fresca),
    de_hoy: Boolean(fila.de_hoy),
  };
}

// Si no se puede guardar, igual se usa la que se acaba de consultar.
async function guardar(cotizacion) {
  try {
    await db
      .prepare(
        `UPDATE instancia SET blue_venta_cent = ?, blue_fecha = ?, blue_fuente = ?, blue_consultado_en = CURRENT_TIMESTAMP
         WHERE id = 1`
      )
      .run(cotizacion.venta_cent, cotizacion.fecha, cotizacion.fuente);
  } catch (err) {
    console.warn(`[dolar-blue] no se pudo guardar la cotización: ${String(err?.message ?? err).slice(0, 120)}`);
  }
  return cotizacion;
}

let sinFuentesHasta = 0; // después de que fallan las dos, hasta cuándo no se vuelve a salir
let enCurso = null; // dos pedidos a la vez comparten la misma consulta

async function resolverCotizacion() {
  try {
    const guardada = await leerGuardada();
    if (guardada?.fresca) return publica(guardada);
    if (Date.now() >= sinFuentesHasta) {
      for (const fuente of FUENTES) {
        const nueva = await consultarFuente(fuente);
        if (nueva) {
          sinFuentesHasta = 0;
          return publica(await guardar(nueva));
        }
      }
      sinFuentesHasta = Date.now() + ESPERA_TRAS_FALLA_MS;
      console.warn(
        `[dolar-blue] fallaron las dos fuentes: ${guardada?.de_hoy ? 'se usa la cotización guardada de hoy' : 'sin cotización, todo sale solo en dólares'}`
      );
    }
    return guardada?.de_hoy ? publica(guardada) : null;
  } catch (err) {
    console.warn(`[dolar-blue] no se pudo obtener la cotización: ${String(err?.message ?? err).slice(0, 120)}`);
    return null;
  }
}

// La cotización a usar ahora: { venta_cent, fecha (UTC), dia ('AAAA-MM-DD' argentino), fuente } o null.
// Nunca rechaza.
export function obtenerCotizacion() {
  if (!enCurso) enCurso = resolverCotizacion().finally(() => (enCurso = null));
  return enCurso;
}

// Olvida la espera de 5 minutos tras una falla de las dos fuentes (la usan las pruebas).
export function olvidarFallaDeLasFuentes() {
  sinFuentesHasta = 0;
}
