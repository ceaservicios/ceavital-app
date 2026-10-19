import crypto from 'node:crypto';
import db from '../db/connection.js';
import config from '../config/env.js';
import { asegurarInstanciaActiva } from './instancia.service.js';

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Crea una sesion activa para el usuario, expulsando automaticamente su
 * sesion activa previa si la tenia (regla de concurrencia desde 2026-09-26:
 * una sesion por USUARIO; antes era una por rol, de cuando el sistema iba a
 * ser local, y con varios cajeros el segundo expulsaba al primero).
 */
export async function crearSesion(usuario) {
  const token = generarToken();

  return db.transaction(async () => {
    // El login ya miró la instancia al empezar, pero entre eso (y la contraseña) y este INSERT
    // el superadmin pudo suspenderla: se vuelve a mirar en esta misma transacción. Si la
    // suspensión (instancia.service, aplicarSuspension) corre a la vez, las dos chocan
    // (SERIALIZABLE) y una se reintenta: o esta ve 'suspendida', o la suspensión cierra esta sesión.
    await asegurarInstanciaActiva();

    const activaPrevia = await db
      .prepare(`SELECT id FROM sesiones_activas WHERE usuario_id = ? AND estado = 'activa'`)
      .get(usuario.id);

    if (activaPrevia) {
      await db
        .prepare(
          `UPDATE sesiones_activas
           SET estado = 'cerrada', motivo_cierre = 'expulsada', cerrada_en = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(activaPrevia.id);
    }

    const resultado = await db
      .prepare(
        `INSERT INTO sesiones_activas (usuario_id, rol, token, estado, iniciada_en, ultima_actividad)
         VALUES (?, ?, ?, 'activa', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`
      )
      .run(usuario.id, usuario.rol, token);

    return { sesionId: resultado.lastInsertRowid, token, expulsada: Boolean(activaPrevia) };
  });
}

// EST-01 §3: la sesión vence a las 8 h sin uso; la del Admin, además, a las 8 h de haber ingresado
// aunque se use (no se extiende sola). Condición SQL compartida por la validación y la limpieza.
const SQL_SESION_VIGENTE = `sa.ultima_actividad >= LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')
  AND (sa.rol <> 'admin' OR sa.iniciada_en >= LOCALTIMESTAMP - (?::int * INTERVAL '1 minute'))`;

/**
 * Devuelve la sesion solo si esta activa Y no vencio (ver SQL_SESION_VIGENTE).
 * La comparacion de fechas se hace en la base (LOCALTIMESTAMP, en UTC) para no
 * depender de parseo de fechas en JS, que es una fuente tipica de bugs de huso horario.
 */
export function obtenerSesionActivaValida(token) {
  // JOIN a usuarios para nombre/usuario (el Sidebar muestra el nombre real aunque se recargue la
  // página) y para saber si la cuenta tiene algo pendiente (contraseña provisoria, 2FA sin configurar).
  return db
    .prepare(
      `SELECT sa.*, u.nombre, u.usuario, u.debe_cambiar_password, u.dosfa_metodo, u.dosfa_desactivada
       FROM sesiones_activas sa
       JOIN usuarios u ON u.id = sa.usuario_id
       WHERE sa.token = ? AND sa.estado = 'activa' AND ${SQL_SESION_VIGENTE}`
    )
    .get(token, config.session.timeoutMinutes, config.session.timeoutMinutes);
}

// Lo que la cuenta tiene que resolver antes de usar el sistema: 'password' (contraseña provisoria,
// EST-01 §5) o 'dosfa' (Admin sin verificación en dos pasos, EST-01 §4; no si el superadmin se la
// desactivó, decisión del usuario del 2026-10-19). null = nada.
export function pendienteDeCuenta({ rol, debe_cambiar_password: debeCambiar, dosfa_metodo: metodo, dosfa_desactivada: desactivada }) {
  if (debeCambiar) return 'password';
  if (rol === 'admin' && !metodo && !desactivada) return 'dosfa';
  return null;
}

export async function marcarActividad(sesionId) {
  await db
    .prepare(`UPDATE sesiones_activas SET ultima_actividad = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(sesionId);
}

export async function cerrarSesion(sesionId, motivo = 'logout') {
  await db
    .prepare(
      `UPDATE sesiones_activas
       SET estado = 'cerrada', motivo_cierre = ?, cerrada_en = CURRENT_TIMESTAMP
       WHERE id = ? AND estado = 'activa'`
    )
    .run(motivo, sesionId);
}

/**
 * Housekeeping: cierra formalmente (con motivo_cierre = 'timeout' y
 * cerrada_en) las sesiones que siguen marcadas 'activa' pero ya vencieron.
 * No es lo que bloquea el acceso (eso ya lo hace obtenerSesionActivaValida en
 * cada request) -- es para que el historial de sesiones quede prolijo y auditable.
 */
export async function cerrarSesionesInactivas() {
  const resultado = await db
    .prepare(
      `UPDATE sesiones_activas sa
       SET estado = 'cerrada', motivo_cierre = 'timeout', cerrada_en = CURRENT_TIMESTAMP
       WHERE sa.estado = 'activa' AND NOT (${SQL_SESION_VIGENTE})`
    )
    .run(config.session.timeoutMinutes, config.session.timeoutMinutes);

  return resultado.changes;
}

// Cierra la sesión activa de un usuario (hay una sola por usuario), por ejemplo cuando el
// superadmin le restablece la contraseña o el 2FA, o lo da de baja.
export async function cerrarSesionDelUsuario(usuarioId) {
  await db
    .prepare(
      `UPDATE sesiones_activas SET estado = 'cerrada', motivo_cierre = 'expulsada', cerrada_en = CURRENT_TIMESTAMP
       WHERE usuario_id = ? AND estado = 'activa'`
    )
    .run(usuarioId);
}
