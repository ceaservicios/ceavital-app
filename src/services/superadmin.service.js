import crypto from 'node:crypto';
import db from '../db/connection.js';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { iniciarDesafio, segundoPasoObligatorio } from './codigo-ingreso.service.js';

// Superadmin de la instalación: la cuenta de CEA, separada del Admin del negocio.
// Tabla propia (`superadmin`), sesiones propias (`sesiones_superadmin`) y cookie
// propia (`sa_token`): una sesión de usuario del negocio o de cliente jamás pasa por
// acá, ni al revés. Entra con su mail (EST-01 §1), que se guarda en la columna `usuario`,
// y con verificación en dos pasos obligatoria (EST-01 §4). Ver Docs/Planes-y-Superadmin.md §4.

export const PASSWORD_MIN_SUPERADMIN = 12;
const PASSWORD_MAX = 72; // límite real de bcrypt: más allá se ignora en silencio
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const generarToken = () => crypto.randomBytes(32).toString('hex');

// El login es UNO solo (el de la app): si el usuario es el del superadmin entra al panel,
// si no, al sistema del negocio. Para que nunca haya ambigüedad, el nombre del superadmin
// está reservado (no se puede crear un usuario del negocio con ese nombre, ver
// usuarios.service) y el superadmin no puede tomar el nombre de un usuario del negocio.
export async function esUsuarioSuperadmin(usuario) {
  return Boolean(await db.prepare('SELECT 1 AS ok FROM superadmin WHERE LOWER(usuario) = LOWER(?)').get(usuario));
}

async function usuarioDelNegocioExiste(usuario) {
  return Boolean(
    await db.prepare('SELECT 1 AS ok FROM usuarios WHERE LOWER(usuario) = LOWER(?) AND eliminado_en IS NULL').get(usuario)
  );
}

// Crea la cuenta la primera vez, con SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD del
// entorno. Si ya existe alguna, no hace nada (no pisa una contraseña ya cambiada). Si
// no hay cuenta ni variable, la instalación queda sin superadmin: la ruta /sa no deja
// entrar a nadie (mejor eso que una clave por defecto).
export async function asegurarSuperadmin() {
  const fijado = config.superadmin.email;
  if (fijado && !EMAIL_VALIDO.test(fijado)) {
    console.error(`[superadmin] SUPERADMIN_EMAIL "${fijado}" no es un mail válido: no se usó`);
    return;
  }
  const existente = await db.prepare('SELECT id, usuario FROM superadmin ORDER BY id LIMIT 1').get();
  if (existente) {
    // SUPERADMIN_EMAIL manda sobre el mail de ingreso en cada arranque (la contraseña
    // no: esa es la guardada). Cambiarlo corta las sesiones abiertas.
    if (fijado && fijado !== existente.usuario) {
      if (await usuarioDelNegocioExiste(fijado)) {
        console.error(`[superadmin] SUPERADMIN_EMAIL "${fijado}" ya lo usa un usuario del negocio: no se cambió (cambiale el mail a ese usuario primero)`);
        return;
      }
      await db.transaction(async () => {
        await db.prepare('UPDATE superadmin SET usuario = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?').run(fijado, existente.id);
        await db
          .prepare(
            `UPDATE sesiones_superadmin SET estado = 'cerrada', motivo_cierre = 'usuario_cambiado', cerrada_en = CURRENT_TIMESTAMP
             WHERE estado = 'activa'`
          )
          .run();
      });
      console.log(`[superadmin] usuario cambiado a "${fijado}"`);
    }
    return;
  }

  const { password } = config.superadmin;
  const usuario = fijado;
  if (!password || !usuario) {
    console.warn('[superadmin] no hay cuenta ni SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD: el panel /sa no admite ingresos');
    return;
  }
  if (password.length < PASSWORD_MIN_SUPERADMIN || password.length > PASSWORD_MAX) {
    console.error(`[superadmin] SUPERADMIN_PASSWORD tiene que tener entre ${PASSWORD_MIN_SUPERADMIN} y ${PASSWORD_MAX} caracteres: no se creó la cuenta`);
    return;
  }

  if (await usuarioDelNegocioExiste(usuario)) {
    console.error(`[superadmin] el usuario "${usuario}" ya lo usa un usuario del negocio: no se creó la cuenta de superadmin`);
    return;
  }

  try {
    await db
      .prepare('INSERT INTO superadmin (usuario, password_hash) VALUES (?, ?)')
      .run(usuario, await hashPassword(password));
    console.log(`[superadmin] cuenta "${usuario}" creada`);
  } catch (err) {
    if (err.code !== '23505') throw err; // otra instancia arrancando al mismo tiempo la creó primero
  }
}

// Cambia la contraseña de la cuenta existente y corta sus sesiones (lo usa el script
// reset-superadmin-password.js; la contraseña llega por variable de entorno).
export async function cambiarPasswordSuperadmin(nueva) {
  if (typeof nueva !== 'string' || nueva.length < PASSWORD_MIN_SUPERADMIN || nueva.length > PASSWORD_MAX) {
    throw new ApiError(400, `La contraseña tiene que tener entre ${PASSWORD_MIN_SUPERADMIN} y ${PASSWORD_MAX} caracteres`);
  }
  const cuenta = await db.prepare('SELECT id FROM superadmin ORDER BY id LIMIT 1').get();
  if (!cuenta) throw new ApiError(404, 'Todavía no existe la cuenta de superadmin');

  await db.transaction(async () => {
    await db
      .prepare(
        `UPDATE superadmin SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL,
                actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(await hashPassword(nueva), cuenta.id);
    await db
      .prepare(
        `UPDATE sesiones_superadmin SET estado = 'cerrada', motivo_cierre = 'password_cambiada', cerrada_en = CURRENT_TIMESTAMP
         WHERE estado = 'activa'`
      )
      .run();
  });
}

let hashDeRelleno = null;

// Suma un intento fallido y, al llegar al tope, bloquea la cuenta (lo lanza como 423).
// Incremento atómico en la propia sentencia (con intentos simultáneos, "leer y escribir +1"
// pierde cuentas y el bloqueo no se activa). Si ya pasó un bloqueo anterior, arranca de cero
// (decisión D2 del usuario, 2026-10-16).
async function registrarIntentoFallido(cuenta) {
  const { intentos_fallidos: intentos } = await db
    .prepare(
      `UPDATE superadmin
       SET intentos_fallidos = CASE WHEN bloqueado_hasta <= LOCALTIMESTAMP THEN 1 ELSE intentos_fallidos + 1 END,
           bloqueado_hasta = CASE WHEN bloqueado_hasta <= LOCALTIMESTAMP THEN NULL ELSE bloqueado_hasta END
       WHERE id = ? RETURNING intentos_fallidos`
    )
    .get(cuenta.id);
  if (intentos >= config.login.maxIntentos) {
    // Bloqueo condicionado (mismo criterio que auth.service): en una ráfaga lo activa y lo anota
    // un solo pedido; si un ingreso correcto reinició el contador mientras tanto, no se bloquea.
    const bloqueo = await db
      .prepare(
        `UPDATE superadmin SET bloqueado_hasta = LOCALTIMESTAMP + (?::int * INTERVAL '1 minute')
         WHERE id = ? AND intentos_fallidos >= ? AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= LOCALTIMESTAMP)
         RETURNING id`
      )
      .get(config.login.bloqueoMinutos, cuenta.id, config.login.maxIntentos);
    const error = new ApiError(423, `Acceso bloqueado por ${config.login.maxIntentos} intentos fallidos. Reintentá en ${config.login.bloqueoMinutos} minutos.`);
    // recienBloqueado + cuenta: el controlador lo anota en el registro de acciones.
    if (bloqueo) {
      Object.assign(error, { recienBloqueado: true, cuenta: { tipo: 'superadmin', id: cuenta.id, nombre: cuenta.usuario, rol: 'superadmin' } });
    }
    throw error;
  }
}

const MENSAJE_BLOQUEADO = `Acceso bloqueado temporalmente por intentos fallidos. Reintentá en ${config.login.bloqueoMinutos} minutos.`;

// Paso 1 del ingreso del superadmin. Con la verificación en dos pasos configurada y un navegador
// que no es de confianza, devuelve { requiereCodigo, desafio, metodo, email } y la sesión se abre
// al confirmar el código (auth.service > confirmarIngreso). Sin configurarla, entra y el panel le
// pide activarla antes de usarlo (superadmin-auth.middleware > exigirSuperadminListo).
export async function loginSuperadmin(usuarioLogin, passwordPlano, { dispositivo } = {}) {
  const cuenta = await db
    .prepare(
      `SELECT id, usuario, password_hash, dosfa_metodo,
              (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > LOCALTIMESTAMP) AS bloqueado
       FROM superadmin WHERE LOWER(usuario) = LOWER(?)`
    )
    .get(usuarioLogin);

  if (!cuenta) {
    // Se compara igual contra un hash de relleno: si no, "usuario que no existe"
    // responde más rápido que "contraseña incorrecta" y se podría averiguar cuál es.
    hashDeRelleno ??= await hashPassword(generarToken());
    await verifyPassword(passwordPlano, hashDeRelleno);
    throw new ApiError(401, 'Usuario o contraseña incorrectos');
  }

  if (cuenta.bloqueado) throw new ApiError(423, MENSAJE_BLOQUEADO);

  if (!(await verifyPassword(passwordPlano, cuenta.password_hash))) {
    await registrarIntentoFallido(cuenta);
    throw new ApiError(401, 'Usuario o contraseña incorrectos');
  }

  // Contraseña correcta: reinicia el contador solo si la cuenta no quedó bloqueada mientras se
  // comparaba la contraseña (intentos fallidos simultáneos). Si quedó bloqueada, no entra.
  const reiniciado = await db
    .prepare(
      `UPDATE superadmin SET intentos_fallidos = 0, bloqueado_hasta = NULL
       WHERE id = ? AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= LOCALTIMESTAMP) RETURNING id`
    )
    .get(cuenta.id);
  if (!reiniciado) throw new ApiError(423, MENSAJE_BLOQUEADO);

  const metodo = await segundoPasoObligatorio('superadmin', cuenta, dispositivo);
  if (metodo) return { requiereCodigo: true, ...(await iniciarDesafio('superadmin', cuenta, metodo)) };

  return abrirSesionSuperadmin(cuenta);
}

// Abre la sesión del superadmin (contraseña y, si corresponde, segundo paso ya validados).
export async function abrirSesionSuperadmin(cuenta) {
  const token = generarToken();
  const csrfToken = generarToken();
  const expulsada = await db.transaction(async () => {
    await db
      .prepare(`UPDATE superadmin SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(cuenta.id);
    // Una sola sesión a la vez: un ingreso nuevo cierra el anterior (y se le avisa en este).
    const cerradas = await db
      .prepare(
        `UPDATE sesiones_superadmin SET estado = 'cerrada', motivo_cierre = 'reemplazada', cerrada_en = CURRENT_TIMESTAMP
         WHERE estado = 'activa' AND iniciada_en >= LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')`
      )
      .run(config.session.timeoutMinutes);
    await db
      .prepare('INSERT INTO sesiones_superadmin (superadmin_id, token, csrf_token) VALUES (?, ?, ?)')
      .run(cuenta.id, token, csrfToken);
    return cerradas.changes > 0;
  });

  return {
    token,
    csrfToken,
    expulsada,
    superadmin: { id: cuenta.id, usuario: cuenta.usuario, pendiente_dosfa: !cuenta.dosfa_metodo },
  };
}

// Sesión válida = activa y con menos de 8 h desde el ingreso: la del superadmin no se extiende
// sola con el uso (EST-01 §3). Fechas comparadas en la base.
export function obtenerSesionSuperadminValida(token) {
  return db
    .prepare(
      `SELECT s.id AS sesion_id, s.csrf_token, a.id AS superadmin_id, a.usuario, a.dosfa_metodo
       FROM sesiones_superadmin s
       JOIN superadmin a ON a.id = s.superadmin_id
       WHERE s.token = ? AND s.estado = 'activa'
         AND s.iniciada_en >= LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')`
    )
    .get(token, config.session.timeoutMinutes);
}

// Cierra las sesiones abiertas del superadmin (al restablecer su 2FA desde la terminal).
export async function cerrarSesionesSuperadmin(motivo) {
  await db
    .prepare(
      `UPDATE sesiones_superadmin SET estado = 'cerrada', motivo_cierre = ?, cerrada_en = CURRENT_TIMESTAMP
       WHERE estado = 'activa'`
    )
    .run(motivo);
}

export async function marcarActividadSuperadmin(sesionId) {
  await db.prepare('UPDATE sesiones_superadmin SET ultima_actividad = CURRENT_TIMESTAMP WHERE id = ?').run(sesionId);
}

export async function cerrarSesionSuperadmin(sesionId, motivo = 'logout') {
  await db
    .prepare(
      `UPDATE sesiones_superadmin SET estado = 'cerrada', motivo_cierre = ?, cerrada_en = CURRENT_TIMESTAMP
       WHERE id = ? AND estado = 'activa'`
    )
    .run(motivo, sesionId);
}

export async function cerrarSesionesSuperadminInactivas() {
  const r = await db
    .prepare(
      `UPDATE sesiones_superadmin SET estado = 'cerrada', motivo_cierre = 'timeout', cerrada_en = CURRENT_TIMESTAMP
       WHERE estado = 'activa' AND iniciada_en < LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')`
    )
    .run(config.session.timeoutMinutes);
  return r.changes;
}
