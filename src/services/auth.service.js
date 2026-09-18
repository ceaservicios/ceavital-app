import db from '../db/connection.js';
import config from '../config/env.js';
import { verifyPassword } from '../utils/password.js';
import { crearSesion, cerrarSesion } from './session.service.js';

export class AuthError extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.codigo = codigo;
  }
}

export async function login(usuarioLogin, passwordPlano) {
  // El flag "bloqueado" se calcula en SQL (datetime('now')) para evitar
  // parseo de fechas en JS -- mismo criterio que session.service.
  const usuario = db
    .prepare(
      `SELECT *, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > datetime('now')) AS bloqueado
       FROM usuarios WHERE usuario = ? AND eliminado_en IS NULL`
    )
    .get(usuarioLogin);

  if (!usuario) {
    throw new AuthError('Usuario o contraseña incorrectos', 'CREDENCIALES_INVALIDAS');
  }

  if (usuario.bloqueado) {
    throw new AuthError(
      `Usuario bloqueado temporalmente por intentos fallidos. Reintentar en ${config.login.bloqueoMinutos} minutos.`,
      'USUARIO_BLOQUEADO'
    );
  }

  const passwordOk = await verifyPassword(passwordPlano, usuario.password_hash);

  if (!passwordOk) {
    const intentos = usuario.intentos_fallidos + 1;

    if (intentos >= config.login.maxIntentos) {
      db.prepare(
        `UPDATE usuarios
         SET intentos_fallidos = ?, bloqueado_hasta = datetime('now', '+' || ? || ' minutes'), actualizado_en = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(intentos, config.login.bloqueoMinutos, usuario.id);

      throw new AuthError(
        `Usuario bloqueado por ${config.login.maxIntentos} intentos fallidos. Reintentar en ${config.login.bloqueoMinutos} minutos.`,
        'USUARIO_BLOQUEADO'
      );
    }

    db.prepare(
      `UPDATE usuarios SET intentos_fallidos = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(intentos, usuario.id);

    throw new AuthError('Usuario o contraseña incorrectos', 'CREDENCIALES_INVALIDAS');
  }

  db.prepare(
    `UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(usuario.id);

  const { token, expulsada } = crearSesion(usuario);

  return {
    token,
    expulsada,
    usuario: { id: usuario.id, nombre: usuario.nombre, usuario: usuario.usuario, rol: usuario.rol },
  };
}

export function logout(sesionId) {
  cerrarSesion(sesionId, 'logout');
}
