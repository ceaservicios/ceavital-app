import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { correoDelCanalDisponible, datosDelCanal, mandarPorSmtp } from './mail.service.js';
import { enMantenimiento } from './mantenimiento.service.js';

// Cola de mails (EST-01 §10.3; tabla `correos`, migración 015). Quien manda un mail lo encola y
// sigue: el pedido del usuario no espera al SMTP y un envío que falla se reintenta solo (1, 5, 30,
// 120 y 360 minutos después; si sigue fallando, queda "fallido"). Al terminar se vacían el asunto y
// el contenido, que pueden llevar una contraseña o un código; la fila queda como historial y nunca
// se borra. Se procesa apenas se confirma lo encolado y, además, cada 30 segundos (lo que quedó de
// antes de un reinicio, los reintentos). Modelo: la cola de DaleFit.

const REINTENTOS_MINUTOS = [1, 5, 30, 120, 360];
const LOTE = 20;
const RESERVA_MINUTOS = 5; // si el proceso se corta a mitad de un envío, ese mail se retoma después
const SEGUNDOS_ENTRE_PASADAS = 30;
const MAX_PARA = 254;
const MAX_ERROR = 300;
const CANALES = ['cea', 'empresa'];

let ocupada = false;
let otraVuelta = false;
let temporizador = null;

// Encola un mail. tipo: qué mail es (se ve en el panel). venceEnMinutos: si no salió en ese tiempo
// ya no sirve y se descarta (un código de ingreso). Dentro de una transacción, se guarda con ella.
export async function encolarCorreo({ para, asunto, texto, html }, { canal = 'empresa', tipo, venceEnMinutos = null } = {}) {
  if (!correoDelCanalDisponible(canal)) throw new ApiError(503, 'El envío de mails no está configurado en este servidor');
  await db
    .prepare(
      `INSERT INTO correos (canal, tipo, para, asunto, texto, html, vence_en)
       VALUES (?, ?, ?, ?, ?, ?, LOCALTIMESTAMP + (?::int * INTERVAL '1 minute'))`
    )
    .run(canal, tipo, String(para).slice(0, MAX_PARA), asunto, texto, html ?? null, venceEnMinutos);
  db.despuesDeConfirmar(() => setImmediate(procesarCola));
}

// Cierra el mail: deja el estado final y vacía lo que podía ser sensible.
function terminar(id, estado, intentos, error = null) {
  return db
    .prepare(
      `UPDATE correos SET estado = ?, intentos = ?, ultimo_error = ?, asunto = NULL, texto = NULL, html = NULL,
              terminado_en = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(estado, intentos, error, id);
}

async function procesarUno(c) {
  if (c.vencido) return terminar(c.id, 'descartado', c.intentos, 'Venció antes de poder mandarse');
  if (!correoDelCanalDisponible(c.canal)) return terminar(c.id, 'descartado', c.intentos, 'Su correo dejó de estar configurado');

  const intentos = c.intentos + 1;
  try {
    await mandarPorSmtp(c.canal, { para: c.para, asunto: c.asunto, texto: c.texto, html: c.html ?? undefined });
  } catch (err) {
    const error = String(err?.message ?? err).slice(0, MAX_ERROR);
    console.warn(`[correo] no salió el mail #${c.id} (${c.tipo}), intento ${intentos}: ${error}`);
    if (intentos > REINTENTOS_MINUTOS.length) return terminar(c.id, 'fallido', intentos, error);
    await db
      .prepare(`UPDATE correos SET intentos = ?, ultimo_error = ?, proximo_intento = LOCALTIMESTAMP + (?::int * INTERVAL '1 minute') WHERE id = ?`)
      .run(intentos, error, REINTENTOS_MINUTOS[intentos - 1], c.id);
    return;
  }
  await terminar(c.id, 'enviado', intentos);
}

// Manda lo que toca. Una pasada a la vez: si se pide otra mientras corre, se encadena al terminar.
// Cada lote se reserva en un solo UPDATE (SKIP LOCKED), así ningún mail sale dos veces.
export async function procesarCola() {
  // Mientras se restaura una copia no sale nada: lo pendiente sale en la próxima pasada.
  if (enMantenimiento()) return;
  if (ocupada) {
    otraVuelta = true;
    return;
  }
  ocupada = true;
  try {
    do {
      otraVuelta = false;
      const lote = await db
        .prepare(
          `UPDATE correos SET proximo_intento = LOCALTIMESTAMP + (?::int * INTERVAL '1 minute')
           WHERE id IN (SELECT id FROM correos WHERE estado = 'pendiente' AND proximo_intento <= LOCALTIMESTAMP
                        ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED)
           RETURNING id, canal, tipo, para, asunto, texto, html, intentos,
                     (vence_en IS NOT NULL AND vence_en <= LOCALTIMESTAMP) AS vencido`
        )
        .all(RESERVA_MINUTOS, LOTE);
      lote.sort((a, b) => a.id - b.id);
      for (const c of lote) {
        try {
          await procesarUno(c);
        } catch (err) {
          console.error(`[correo] no se pudo procesar el mail #${c.id}:`, err.message);
        }
      }
      if (lote.length === LOTE) otraVuelta = true;
    } while (otraVuelta);
  } catch (err) {
    console.error('[correo] no se pudo procesar la cola:', err.message);
  } finally {
    ocupada = false;
  }
}

export function iniciarColaCorreo() {
  if (temporizador) return;
  procesarCola();
  temporizador = setInterval(procesarCola, SEGUNDOS_ENTRE_PASADAS * 1000);
  temporizador.unref();
}

// Pestaña Correo del panel: cómo está cada correo y los últimos mails (sin su contenido).
export async function estadoCorreos() {
  const [resumen, correos] = await Promise.all([
    db
      .prepare(
        `SELECT canal,
                COUNT(*) FILTER (WHERE estado = 'pendiente') AS pendientes,
                COUNT(*) FILTER (WHERE estado = 'fallido' AND creado_en > LOCALTIMESTAMP - INTERVAL '30 days') AS fallidos_30d,
                MAX(terminado_en) FILTER (WHERE estado = 'enviado') AS ultimo_enviado
         FROM correos GROUP BY canal`
      )
      .all(),
    db
      .prepare(
        `SELECT id, canal, tipo, para, estado, intentos, ultimo_error, creado_en, terminado_en
         FROM correos ORDER BY id DESC LIMIT 20`
      )
      .all(),
  ]);
  const canales = CANALES.map((id) => {
    const r = resumen.find((f) => f.canal === id);
    return { id, ...datosDelCanal(id), pendientes: r?.pendientes ?? 0, fallidos_30d: r?.fallidos_30d ?? 0, ultimo_enviado: r?.ultimo_enviado ?? null };
  });
  return { canales, correos };
}
