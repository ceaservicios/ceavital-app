import crypto from 'node:crypto';
import db from '../db/connection.js';
import config from '../config/env.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { crearSesion, cerrarSesion, pendienteDeCuenta } from './session.service.js';
import { asegurarInstanciaActiva } from './instancia.service.js';
import {
  confirmarCodigo,
  iniciarDesafio,
  recordarDispositivo,
  segundoPasoDeEmpleado,
  segundoPasoObligatorio,
} from './codigo-ingreso.service.js';
import { abrirSesionSuperadmin } from './superadmin.service.js';

export class AuthError extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.codigo = codigo;
  }
}

const datosPublicos = (usuario) => ({
  id: usuario.id,
  nombre: usuario.nombre,
  usuario: usuario.usuario,
  rol: usuario.rol,
  pendiente: pendienteDeCuenta(usuario),
});

async function abrirSesion(usuario) {
  const { token, expulsada } = await crearSesion(usuario);
  await db.prepare('UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id = ?').run(usuario.id);
  return { token, expulsada, usuario: datosPublicos(usuario) };
}

let hashDeRelleno = null; // ver login: usuario inexistente

// Paso 1 del ingreso: usuario y contraseña. Si hace falta un segundo paso no se abre la sesión:
// devuelve { requiereCodigo, desafio, metodo, email } y la sesión se abre en confirmarIngreso.
//  - Admin: verificación en dos pasos obligatoria (EST-01 §4) con el método que eligió (app o
//    mail), una vez por semana en cada navegador. Si todavía no la configuró, entra y la sesión
//    queda pendiente hasta configurarla (ver auth.middleware). Si el superadmin se la desactivó
//    (dosfa_desactivada), entra solo con la contraseña.
//  - Encargado y Cajero: código por mail para verificar el email la primera vez y, si el Admin
//    les activó el 2FA, una vez por semana en cada navegador.
// `dispositivo`: identificador del navegador (cookie).
export async function login(usuarioLogin, passwordPlano, { dispositivo } = {}) {
  await asegurarInstanciaActiva();

  // El flag "bloqueado" se calcula en SQL para evitar parseo de fechas en JS -- mismo criterio
  // que session.service.
  const usuario = await db
    .prepare(
      `SELECT *, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > LOCALTIMESTAMP) AS bloqueado
       FROM usuarios WHERE LOWER(usuario) = LOWER(?) AND eliminado_en IS NULL
       ORDER BY (usuario = ?) DESC LIMIT 1`
    )
    .get(usuarioLogin, usuarioLogin);

  if (!usuario) {
    // Se compara igual contra un hash de relleno: si no, "usuario que no existe" responde más rápido
    // que "contraseña incorrecta" y se podría averiguar qué usuarios existen midiendo el tiempo
    // (mismo criterio que loginSuperadmin y loginCliente).
    hashDeRelleno ??= await hashPassword(crypto.randomBytes(32).toString('hex'));
    await verifyPassword(passwordPlano, hashDeRelleno);
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
    // se activaba). Mismo criterio que loginCliente. Si ya pasó un bloqueo anterior, la cuenta
    // arranca de cero (decisión D2 del usuario, 2026-10-16): antes, al vencer los 15 min, un solo
    // error más la volvía a bloquear.
    const { intentos_fallidos: intentos } = await db
      .prepare(
        `UPDATE usuarios
         SET intentos_fallidos = CASE WHEN bloqueado_hasta <= LOCALTIMESTAMP THEN 1 ELSE intentos_fallidos + 1 END,
             bloqueado_hasta = CASE WHEN bloqueado_hasta <= LOCALTIMESTAMP THEN NULL ELSE bloqueado_hasta END,
             actualizado_en = CURRENT_TIMESTAMP
         WHERE id = ? RETURNING intentos_fallidos`
      )
      .get(usuario.id);

    if (intentos >= config.login.maxIntentos) {
      // Bloqueo condicionado: en una ráfaga simultánea lo activa un solo pedido (los demás ya la
      // encuentran bloqueada) y si un ingreso correcto reinició el contador mientras tanto, no se
      // bloquea. Solo el pedido que la bloquea lo anota en el registro de acciones.
      const bloqueo = await db
        .prepare(
          `UPDATE usuarios SET bloqueado_hasta = LOCALTIMESTAMP + (?::int * INTERVAL '1 minute')
           WHERE id = ? AND intentos_fallidos >= ? AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= LOCALTIMESTAMP)
           RETURNING id`
        )
        .get(config.login.bloqueoMinutos, usuario.id, config.login.maxIntentos);

      const error = new AuthError(
        `Usuario bloqueado por ${config.login.maxIntentos} intentos fallidos. Reintentar en ${config.login.bloqueoMinutos} minutos.`,
        'USUARIO_BLOQUEADO'
      );
      // recienBloqueado + cuenta: el controlador lo anota en el registro de acciones.
      if (bloqueo) {
        Object.assign(error, { recienBloqueado: true, cuenta: { tipo: 'usuario', id: usuario.id, nombre: usuario.usuario, rol: usuario.rol } });
      }
      throw error;
    }

    throw new AuthError('Usuario o contraseña incorrectos', 'CREDENCIALES_INVALIDAS');
  }

  // Contraseña correcta: reinicia el contador solo si la cuenta no quedó bloqueada mientras se
  // comparaba la contraseña (intentos fallidos simultáneos). Si quedó bloqueada, no entra.
  const reiniciado = await db
    .prepare(
      `UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, actualizado_en = CURRENT_TIMESTAMP
       WHERE id = ? AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= LOCALTIMESTAMP) RETURNING id`
    )
    .get(usuario.id);
  if (!reiniciado) {
    throw new AuthError(
      `Usuario bloqueado temporalmente por intentos fallidos. Reintentar en ${config.login.bloqueoMinutos} minutos.`,
      'USUARIO_BLOQUEADO'
    );
  }

  let metodo;
  if (usuario.rol !== 'admin') metodo = await segundoPasoDeEmpleado(usuario, dispositivo);
  else metodo = usuario.dosfa_desactivada ? null : await segundoPasoObligatorio('usuario', usuario, dispositivo);
  if (metodo) {
    return { requiereCodigo: true, ...(await iniciarDesafio('usuario', usuario, metodo)) };
  }

  return abrirSesion(usuario);
}

// Paso 2: el código (de la app o del mail). Sirve para los usuarios del negocio y para el
// superadmin (el desafío dice de quién es). Abre la sesión y, si la cuenta tiene verificación en
// dos pasos, deja este navegador como de confianza por una semana (devuelve su identificador
// para la cookie).
// segundoPaso ('app' | 'mail' | 'recuperacion') va al registro de acciones.
export async function confirmarIngreso(desafio, codigo, { dispositivo } = {}) {
  const { tipo, cuenta, metodo, recuperacion } = await confirmarCodigo(desafio, codigo);
  const segundoPaso = recuperacion ? 'recuperacion' : metodo;

  if (tipo === 'superadmin') {
    const sesion = await abrirSesionSuperadmin(cuenta);
    return { tipo, segundoPaso, ...sesion, dispositivo: await recordarDispositivo('superadmin', cuenta.id, dispositivo) };
  }

  await asegurarInstanciaActiva();
  const sesion = await abrirSesion(cuenta);
  // Un Admin al que le desactivaron la verificación no deja navegadores de confianza.
  const conDosfa = cuenta.rol === 'admin' ? Boolean(cuenta.dosfa_metodo) && !cuenta.dosfa_desactivada : cuenta.dos_fa;
  const dispositivoConfiable = conDosfa ? await recordarDispositivo('usuario', cuenta.id, dispositivo) : null;
  return { tipo, segundoPaso, ...sesion, dispositivo: dispositivoConfiable };
}

export async function logout(sesionId) {
  await cerrarSesion(sesionId, 'logout');
}
