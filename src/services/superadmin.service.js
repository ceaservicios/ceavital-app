import crypto from 'node:crypto';
import db from '../db/connection.js';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

// Superadmin de la instalación: la cuenta de CEA, separada del Admin del negocio.
// Tabla propia (`superadmin`), sesiones propias (`sesiones_superadmin`) y cookie
// propia (`sa_token`): una sesión de usuario del negocio o de cliente jamás pasa por
// acá, ni al revés. Ver Docs/Planes-y-Superadmin.md §4.

export const PASSWORD_MIN_SUPERADMIN = 12;
const PASSWORD_MAX = 72; // límite real de bcrypt: más allá se ignora en silencio

const generarToken = () => crypto.randomBytes(32).toString('hex');

// Crea la cuenta la primera vez, con SUPERADMIN_USUARIO / SUPERADMIN_PASSWORD del
// entorno. Si ya existe alguna, no hace nada (no pisa una contraseña ya cambiada). Si
// no hay cuenta ni variable, la instalación queda sin superadmin: la ruta /sa no deja
// entrar a nadie (mejor eso que una clave por defecto).
export async function asegurarSuperadmin() {
  const existente = await db.prepare('SELECT id FROM superadmin LIMIT 1').get();
  if (existente) return;

  const { usuario, password } = config.superadmin;
  if (!password) {
    console.warn('[superadmin] no hay cuenta ni SUPERADMIN_PASSWORD: el panel /sa no admite ingresos');
    return;
  }
  if (password.length < PASSWORD_MIN_SUPERADMIN || password.length > PASSWORD_MAX) {
    console.error(`[superadmin] SUPERADMIN_PASSWORD tiene que tener entre ${PASSWORD_MIN_SUPERADMIN} y ${PASSWORD_MAX} caracteres: no se creó la cuenta`);
    return;
  }
  if (!usuario) {
    console.error('[superadmin] SUPERADMIN_USUARIO está vacío: no se creó la cuenta');
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
    await registrarAccion(cuenta.id, 'password_cambiada', 'Desde la terminal del servidor', null);
  });
}

let hashDeRelleno = null;

export async function loginSuperadmin(usuarioLogin, passwordPlano, ip) {
  const cuenta = await db
    .prepare(
      `SELECT id, usuario, password_hash,
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

  if (cuenta.bloqueado) {
    throw new ApiError(423, `Acceso bloqueado temporalmente por intentos fallidos. Reintentá en ${config.login.bloqueoMinutos} minutos.`);
  }

  if (!(await verifyPassword(passwordPlano, cuenta.password_hash))) {
    // Incremento atómico en la propia sentencia (con intentos simultáneos, "leer y
    // escribir +1" pierde cuentas y el bloqueo no se activa).
    const { intentos_fallidos: intentos } = await db
      .prepare(
        `UPDATE superadmin SET intentos_fallidos = intentos_fallidos + 1 WHERE id = ? RETURNING intentos_fallidos`
      )
      .get(cuenta.id);
    if (intentos >= config.login.maxIntentos) {
      await db
        .prepare(`UPDATE superadmin SET bloqueado_hasta = LOCALTIMESTAMP + (?::int * INTERVAL '1 minute') WHERE id = ?`)
        .run(config.login.bloqueoMinutos, cuenta.id);
      await registrarAccion(cuenta.id, 'bloqueo_por_intentos', `${intentos} intentos fallidos`, ip);
      throw new ApiError(423, `Acceso bloqueado por ${config.login.maxIntentos} intentos fallidos. Reintentá en ${config.login.bloqueoMinutos} minutos.`);
    }
    throw new ApiError(401, 'Usuario o contraseña incorrectos');
  }

  const token = generarToken();
  const csrfToken = generarToken();
  await db.transaction(async () => {
    await db
      .prepare(
        `UPDATE superadmin SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(cuenta.id);
    // Una sola sesión a la vez: un ingreso nuevo cierra el anterior.
    await db
      .prepare(
        `UPDATE sesiones_superadmin SET estado = 'cerrada', motivo_cierre = 'reemplazada', cerrada_en = CURRENT_TIMESTAMP
         WHERE estado = 'activa'`
      )
      .run();
    await db
      .prepare('INSERT INTO sesiones_superadmin (superadmin_id, token, csrf_token) VALUES (?, ?, ?)')
      .run(cuenta.id, token, csrfToken);
    await registrarAccion(cuenta.id, 'login', null, ip);
  });

  return { token, csrfToken, superadmin: { id: cuenta.id, usuario: cuenta.usuario } };
}

// Sesión válida = activa y sin vencer por inactividad. Fechas comparadas en la base.
export function obtenerSesionSuperadminValida(token) {
  return db
    .prepare(
      `SELECT s.id AS sesion_id, s.csrf_token, a.id AS superadmin_id, a.usuario
       FROM sesiones_superadmin s
       JOIN superadmin a ON a.id = s.superadmin_id
       WHERE s.token = ? AND s.estado = 'activa'
         AND s.ultima_actividad >= LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')`
    )
    .get(token, config.session.timeoutMinutes);
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
       WHERE estado = 'activa' AND ultima_actividad < LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')`
    )
    .run(config.session.timeoutMinutes);
  return r.changes;
}

// Registro de acciones de CEA sobre la instancia (solo se agrega). Dentro de una
// transacción abierta se une a ella, así una acción y su registro quedan o no juntos.
export async function registrarAccion(superadminId, accion, detalle, ip) {
  await db
    .prepare('INSERT INTO superadmin_acciones (superadmin_id, accion, detalle, ip) VALUES (?, ?, ?, ?)')
    .run(superadminId ?? null, accion, detalle ?? null, ip ?? null);
}

export function listarAcciones(limite = 50) {
  const tope = Math.min(Math.max(Number.parseInt(limite, 10) || 50, 1), 200);
  return db
    .prepare(
      `SELECT a.id, a.accion, a.detalle, a.ip, a.creado_en, s.usuario
       FROM superadmin_acciones a LEFT JOIN superadmin s ON s.id = a.superadmin_id
       ORDER BY a.id DESC LIMIT ?`
    )
    .all(tope);
}
