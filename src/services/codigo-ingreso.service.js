import crypto from 'node:crypto';
import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { armarCorreoCodigo, correoDisponible, enviarCorreo } from './mail.service.js';

// Código de ingreso por mail para los usuarios del negocio: la primera vez que entra un
// usuario con email (así se comprueba que el email es suyo) y, si el Admin le activó el
// 2FA, una vez por día en cada dispositivo. Sale por el correo de la empresa (SMTP_*, lo
// configura CEA). En la base solo se guardan hashes: el "desafío" identifica el ingreso en
// curso (la contraseña ya se validó) y el código es lo que llegó por mail.

const MINUTOS_VIGENCIA = 10;
const MAX_INTENTOS = 5;
const MAX_ENVIOS = 5;
const SEGUNDOS_ENTRE_ENVIOS = 60;
const HORAS_DISPOSITIVO = 24;
const DISPOSITIVO_VALIDO = /^[0-9a-f]{64}$/;

export const MENSAJE_SIN_CORREO =
  'No se puede mandar el código de ingreso: falta configurar el correo de la empresa. Avisale a CEA Servicios.';
const MENSAJE_VENCIDO = 'El código venció o ya no sirve. Volvé a ingresar con tu contraseña.';

const hash = (valor) => crypto.createHash('sha256').update(valor).digest('hex');
// El código va atado a su desafío: el mismo código de 6 números en otro ingreso no sirve.
const hashCodigo = (desafio, codigo) => hash(`${desafio}:${codigo}`);
const nuevoCodigo = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

export function enmascararEmail(email) {
  const [local, dominio] = email.split('@');
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${dominio}`;
}

async function mandarCodigo({ nombre, email }, codigo) {
  await enviarCorreo({ para: email, ...armarCorreoCodigo({ nombre, codigo, minutos: MINUTOS_VIGENCIA }) });
}

// ¿Este ingreso necesita código? Sí si el email todavía no se verificó, o si tiene 2FA y
// este navegador no lo confirmó en las últimas 24 h. Un usuario sin email (los anteriores
// a esto) entra como siempre.
export async function necesitaCodigo(usuario, dispositivo) {
  if (!usuario.email) return false;
  if (!usuario.email_verificado_en) return true;
  if (!usuario.dos_fa) return false;
  if (!DISPOSITIVO_VALIDO.test(dispositivo ?? '')) return true;
  const confiable = await db
    .prepare(`SELECT 1 AS ok FROM dispositivos_2fa WHERE usuario_id = ? AND dispositivo_hash = ? AND expira_en > LOCALTIMESTAMP`)
    .get(usuario.id, hash(dispositivo));
  return !confiable;
}

export async function iniciarDesafio(usuario) {
  if (!correoDisponible()) throw new ApiError(503, MENSAJE_SIN_CORREO);
  const desafio = crypto.randomBytes(32).toString('hex');
  const codigo = nuevoCodigo();
  await db
    .prepare(
      `INSERT INTO codigos_ingreso (usuario_id, desafio_hash, codigo_hash, enviado_a, expira_en)
       VALUES (?, ?, ?, ?, LOCALTIMESTAMP + (?::int * INTERVAL '1 minute'))`
    )
    .run(usuario.id, hash(desafio), hashCodigo(desafio, codigo), usuario.email, MINUTOS_VIGENCIA);
  await mandarCodigo(usuario, codigo);
  return { desafio, email: enmascararEmail(usuario.email) };
}

// Valida el código y lo consume. Devuelve el usuario para abrirle la sesión. Cada intento
// (correcto o no) se anota ANTES de comparar, en un solo UPDATE atómico con el tope en el
// WHERE: así 30 pedidos simultáneos no pasan todos el "intentos < 5" (a los 5 incorrectos
// hay que volver a empezar desde la contraseña).
export async function confirmarCodigo(desafio, codigo) {
  const fila = await db
    .prepare(
      `UPDATE codigos_ingreso c SET intentos = c.intentos + 1
       FROM usuarios u
       WHERE u.id = c.usuario_id AND u.eliminado_en IS NULL
         AND c.desafio_hash = ? AND c.usado_en IS NULL AND c.expira_en > LOCALTIMESTAMP AND c.intentos < ?
       RETURNING c.id, c.codigo_hash, c.enviado_a, c.intentos,
                 u.id AS usuario_id, u.nombre, u.usuario, u.rol, u.email, u.dos_fa`
    )
    .get(hash(desafio), MAX_INTENTOS);
  if (!fila) throw new ApiError(401, MENSAJE_VENCIDO);

  const correcto = crypto.timingSafeEqual(Buffer.from(fila.codigo_hash, 'hex'), Buffer.from(hashCodigo(desafio, codigo), 'hex'));
  if (!correcto) {
    const { intentos } = fila;
    if (intentos >= MAX_INTENTOS) {
      throw new ApiError(401, 'Demasiados intentos con un código incorrecto. Volvé a ingresar con tu contraseña.');
    }
    const quedan = MAX_INTENTOS - intentos;
    throw new ApiError(401, `El código no es correcto. Te ${quedan === 1 ? 'queda 1 intento' : `quedan ${quedan} intentos`}.`);
  }

  // Consumo atómico: el mismo código mandado dos veces no abre dos sesiones.
  const usado = await db
    .prepare(
      `UPDATE codigos_ingreso SET usado_en = CURRENT_TIMESTAMP
       WHERE id = ? AND usado_en IS NULL AND expira_en > LOCALTIMESTAMP RETURNING id`
    )
    .get(fila.id);
  if (!usado) throw new ApiError(401, MENSAJE_VENCIDO);

  // El código llegó a ese email: queda verificado (si el Admin no lo cambió mientras tanto).
  if (fila.email && fila.email.toLowerCase() === fila.enviado_a.toLowerCase()) {
    await db
      .prepare('UPDATE usuarios SET email_verificado_en = COALESCE(email_verificado_en, CURRENT_TIMESTAMP) WHERE id = ?')
      .run(fila.usuario_id);
  }
  return { id: fila.usuario_id, nombre: fila.nombre, usuario: fila.usuario, rol: fila.rol, dos_fa: fila.dos_fa };
}

export async function reenviarCodigo(desafio) {
  if (!correoDisponible()) throw new ApiError(503, MENSAJE_SIN_CORREO);
  const codigo = nuevoCodigo();
  const destino = await db.transaction(async () => {
    const actual = await db
      .prepare(
        `SELECT c.id, c.envios, (c.ultimo_envio_en > LOCALTIMESTAMP - (?::int * INTERVAL '1 second')) AS muy_pronto,
                u.nombre, u.email
         FROM codigos_ingreso c JOIN usuarios u ON u.id = c.usuario_id
         WHERE c.desafio_hash = ? AND c.usado_en IS NULL AND c.creado_en > LOCALTIMESTAMP - INTERVAL '30 minutes'
           AND u.eliminado_en IS NULL`
      )
      .get(SEGUNDOS_ENTRE_ENVIOS, hash(desafio));
    if (!actual?.email) throw new ApiError(401, 'El ingreso venció. Volvé a ingresar con tu contraseña.');
    if (actual.envios >= MAX_ENVIOS) {
      throw new ApiError(429, 'Ya se mandaron varios códigos. Volvé a ingresar con tu contraseña.');
    }
    if (actual.muy_pronto) throw new ApiError(429, 'Esperá un minuto antes de pedir otro código.');
    await db
      .prepare(
        `UPDATE codigos_ingreso SET codigo_hash = ?, enviado_a = ?, intentos = 0, envios = envios + 1,
                ultimo_envio_en = CURRENT_TIMESTAMP, expira_en = LOCALTIMESTAMP + (?::int * INTERVAL '1 minute')
         WHERE id = ?`
      )
      .run(hashCodigo(desafio, codigo), actual.email, MINUTOS_VIGENCIA, actual.id);
    return actual;
  });
  await mandarCodigo(destino, codigo);
  return { email: enmascararEmail(destino.email) };
}

// 2FA: este navegador queda confiable para este usuario por 24 h. Devuelve el identificador
// del navegador (el que ya tenía en su cookie o uno nuevo) para guardarlo en la cookie.
export async function recordarDispositivo(usuarioId, dispositivoActual) {
  const dispositivo = DISPOSITIVO_VALIDO.test(dispositivoActual ?? '') ? dispositivoActual : crypto.randomBytes(32).toString('hex');
  await db
    .prepare(
      `INSERT INTO dispositivos_2fa (usuario_id, dispositivo_hash, expira_en)
       VALUES (?, ?, LOCALTIMESTAMP + (?::int * INTERVAL '1 hour'))
       ON CONFLICT (usuario_id, dispositivo_hash) DO UPDATE SET expira_en = EXCLUDED.expira_en`
    )
    .run(usuarioId, hash(dispositivo), HORAS_DISPOSITIVO);
  return dispositivo;
}
