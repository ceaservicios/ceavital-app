import db from '../db/connection.js';
import config from '../config/env.js';
import { verifyPassword } from '../utils/password.js';
import { crearSesion, cerrarSesion } from './session.service.js';
import { asegurarInstanciaActiva } from './instancia.service.js';
import { confirmarCodigo, iniciarDesafio, necesitaCodigo, recordarDispositivo } from './codigo-ingreso.service.js';

export class AuthError extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.codigo = codigo;
  }
}

const datosPublicos = (usuario) => ({ id: usuario.id, nombre: usuario.nombre, usuario: usuario.usuario, rol: usuario.rol });

// Paso 1 del ingreso: usuario y contraseña. Si el usuario tiene que confirmar un código por
// mail (email sin verificar, o 2FA en un dispositivo no confiable) no se abre la sesión:
// devuelve { requiereCodigo, desafio, email } y la sesión se abre en confirmarIngreso.
// `dispositivo`: identificador del navegador (cookie), para el 2FA de una vez por día.
export async function login(usuarioLogin, passwordPlano, { dispositivo } = {}) {
  await asegurarInstanciaActiva();

  // El flag "bloqueado" se calcula en SQL (datetime('now')) para evitar
  // parseo de fechas en JS -- mismo criterio que session.service.
  const usuario = await db
    .prepare(
      `SELECT *, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > LOCALTIMESTAMP) AS bloqueado
       FROM usuarios WHERE LOWER(usuario) = LOWER(?) AND eliminado_en IS NULL
       ORDER BY (usuario = ?) DESC LIMIT 1`
    )
    .get(usuarioLogin, usuarioLogin);

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

  if (await necesitaCodigo(usuario, dispositivo)) {
    return { requiereCodigo: true, ...(await iniciarDesafio(usuario)) };
  }

  const { token, expulsada } = await crearSesion(usuario);
  return { token, expulsada, usuario: datosPublicos(usuario) };
}

// Paso 2: el código que llegó por mail. Abre la sesión y, si el usuario tiene 2FA, deja
// este navegador como confiable por 24 h (devuelve su identificador para la cookie).
export async function confirmarIngreso(desafio, codigo, { dispositivo } = {}) {
  await asegurarInstanciaActiva();
  const usuario = await confirmarCodigo(desafio, codigo);
  const { token, expulsada } = await crearSesion(usuario);
  const dispositivoConfiable = usuario.dos_fa ? await recordarDispositivo(usuario.id, dispositivo) : null;
  return { token, expulsada, usuario: datosPublicos(usuario), dispositivo: dispositivoConfiable };
}

export async function logout(sesionId) {
  await cerrarSesion(sesionId, 'logout');
}
