import crypto from 'node:crypto';
import db from '../db/connection.js';
import config from '../config/env.js';

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Crea una sesion activa para el usuario, expulsando automaticamente
 * cualquier sesion activa previa del mismo rol (regla de concurrencia:
 * nunca dos sesiones activas del mismo rol a la vez).
 */
export async function crearSesion(usuario) {
  const token = generarToken();

  return db.transaction(async () => {
    const activaPrevia = await db
      .prepare(`SELECT id FROM sesiones_activas WHERE rol = ? AND estado = 'activa'`)
      .get(usuario.rol);

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

/**
 * Devuelve la sesion solo si esta activa Y no vencio por inactividad (30 min).
 * La comparacion de fechas se hace en la base (LOCALTIMESTAMP, en UTC) para no
 * depender de parseo de fechas en JS, que es una fuente tipica de bugs de huso horario.
 */
export function obtenerSesionActivaValida(token) {
  // JOIN a usuarios solo para nombre/usuario -- lo necesita el frontend para
  // mostrar el nombre real en el Sidebar sin depender de lo que devolvio el
  // login (que no sobrevive a un refresh de pagina).
  return db
    .prepare(
      `SELECT sa.*, u.nombre, u.usuario
       FROM sesiones_activas sa
       JOIN usuarios u ON u.id = sa.usuario_id
       WHERE sa.token = ? AND sa.estado = 'activa'
         AND sa.ultima_actividad >= LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')`
    )
    .get(token, config.session.timeoutMinutes);
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
 * cerrada_en) las sesiones que siguen marcadas 'activa' pero superaron los
 * 30 min de inactividad. No es lo que bloquea el acceso (eso ya lo hace
 * obtenerSesionActivaValida en cada request) -- es para que el historial de
 * sesiones quede prolijo y auditable.
 */
export async function cerrarSesionesInactivas() {
  const resultado = await db
    .prepare(
      `UPDATE sesiones_activas
       SET estado = 'cerrada', motivo_cierre = 'timeout', cerrada_en = CURRENT_TIMESTAMP
       WHERE estado = 'activa'
         AND ultima_actividad < LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')`
    )
    .run(config.session.timeoutMinutes);

  return resultado.changes;
}
