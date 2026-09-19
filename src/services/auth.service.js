import db from '../db/connection.js';
import config from '../config/env.js';
import { verifyPassword } from '../utils/password.js';
import { crearSesion, cerrarSesion } from './session.service.js';
import { asegurarInstanciaActiva } from './instancia.service.js';

export class AuthError extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.codigo = codigo;
  }
}

export async function login(usuarioLogin, passwordPlano) {
  await asegurarInstanciaActiva();

  // El flag "bloqueado" se calcula en SQL (datetime('now')) para evitar
  // parseo de fechas en JS -- mismo criterio que session.service.
  const usuario = await db
    .prepare(
      `SELECT *, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > LOCALTIMESTAMP) AS bloqueado
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
    // Incremento atómico en la propia sentencia (nunca "leer, esperar el hash,
    // escribir +1": con logins simultáneos se perdían intentos y el bloqueo no
    // se activaba). Mismo criterio que loginCliente.
    const { intentos_fallidos: intentos } = await db
      .prepare(
        `UPDATE usuarios SET intentos_fallidos = intentos_fallidos + 1, actualizado_en = CURRENT_TIMESTAMP
         WHERE id = ? RETURNING intentos_fallidos`
      )
      .get(usuario.id);

    if (intentos >= config.login.maxIntentos) {
      await db
        .prepare(`UPDATE usuarios SET bloqueado_hasta = LOCALTIMESTAMP + (?::int * INTERVAL '1 minute') WHERE id = ?`)
        .run(config.login.bloqueoMinutos, usuario.id);

      throw new AuthError(
        `Usuario bloqueado por ${config.login.maxIntentos} intentos fallidos. Reintentar en ${config.login.bloqueoMinutos} minutos.`,
        'USUARIO_BLOQUEADO'
      );
    }

    throw new AuthError('Usuario o contraseña incorrectos', 'CREDENCIALES_INVALIDAS');
  }

  await db
    .prepare(
    `UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(usuario.id);

  const { token, expulsada } = await crearSesion(usuario);

  return {
    token,
    expulsada,
    usuario: { id: usuario.id, nombre: usuario.nombre, usuario: usuario.usuario, rol: usuario.rol },
  };
}

export async function logout(sesionId) {
  await cerrarSesion(sesionId, 'logout');
}
