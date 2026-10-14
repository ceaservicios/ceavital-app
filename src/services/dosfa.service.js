import QRCode from 'qrcode';
import db from '../db/connection.js';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import { verifyPassword } from '../utils/password.js';
import { nuevoSecretoTotp, uriOtpauth, verificarTotp } from '../utils/totp.js';
import {
  cifrarSecreto,
  claveDosfaDisponible,
  descifrarSecreto,
  generarCodigosRecuperacion,
  hashearCodigosRecuperacion,
} from '../utils/dosfa.js';
import { correoDelCanalDisponible } from './mail.service.js';
import {
  CUENTAS,
  codigosDeConfiguracionRecientes,
  confirmarCodigo,
  emailDeCuenta,
  enmascararEmail,
  iniciarDesafio,
  obtenerCuenta,
  olvidarDispositivos,
} from './codigo-ingreso.service.js';

// Configurar la verificación en dos pasos desde "Mi cuenta" (Admin del negocio) o desde el panel
// del superadmin (EST-01 §4): cada uno elige app autenticadora o código por mail. La primera vez
// alcanza con la sesión recién abierta; cambiar de método o generar códigos de recuperación nuevos
// pide la contraseña (con la sesión abierta sola no alcanza).

const MAX_CODIGOS_CONFIGURAR = 5; // códigos por mail pedidos desde "Mi cuenta" en media hora

async function cuenta(tipo, id) {
  const c = await obtenerCuenta(tipo, id);
  if (!c) throw new ApiError(404, 'La cuenta no existe');
  return c;
}

export async function comprobarPassword(tipo, id, password) {
  if (typeof password !== 'string' || !password) throw new ApiError(400, 'Escribí tu contraseña para confirmar');
  const { tabla } = CUENTAS[tipo];
  const fila = await db.prepare(`SELECT password_hash FROM ${tabla} WHERE id = ?`).get(id);
  // 403 y no 401: un 401 se toma como "se venció la sesión" y saca al usuario de la pantalla.
  if (!fila || !(await verifyPassword(password, fila.password_hash))) throw new ApiError(403, 'La contraseña no es correcta');
}

// mail_falta dice por qué no se ofrece el código por mail, para que la pantalla lo explique:
// 'email' (la cuenta no tiene un mail) o 'correo' (falta configurar el correo en el servidor).
export async function estadoDosfa(tipo, id) {
  const c = await cuenta(tipo, id);
  const email = emailDeCuenta(tipo, c);
  const mailFalta = !email ? 'email' : correoDelCanalDisponible(CUENTAS[tipo].canal) ? null : 'correo';
  return {
    metodo: c.dosfa_metodo ?? null,
    codigos_restantes: c.dosfa_metodo === 'app' ? c.dosfa_codigos.length : null,
    app_disponible: claveDosfaDisponible(),
    mail_disponible: mailFalta === null,
    mail_falta: mailFalta,
    email: email ? enmascararEmail(email) : null,
  };
}

// App, paso 1: secreto nuevo (pendiente hasta confirmarlo) y su código QR.
export async function iniciarApp(tipo, id) {
  const c = await cuenta(tipo, id);
  if (!claveDosfaDisponible()) throw new ApiError(503, 'Falta configurar DOSFA_CLAVE en el servidor: por ahora usá el código por mail.');
  const secreto = nuevoSecretoTotp();
  await db.prepare(`UPDATE ${CUENTAS[tipo].tabla} SET dosfa_secreto_nuevo = ? WHERE id = ?`).run(cifrarSecreto(secreto), id);
  const etiqueta = emailDeCuenta(tipo, c) || c.usuario;
  const qr = await QRCode.toDataURL(uriOtpauth(secreto, etiqueta, config.dosfa.emisor), { margin: 1, width: 220 });
  return { qr, clave: secreto.replace(/(.{4})/g, '$1 ').trim(), emisor: config.dosfa.emisor };
}

// App, paso 2: confirma con un código de la app y deja ese método, con 10 códigos de recuperación
// (se devuelven una sola vez).
export async function confirmarApp(tipo, id, { codigo, password } = {}) {
  const c = await cuenta(tipo, id);
  const { tabla } = CUENTAS[tipo];
  const pendiente = await db.prepare(`SELECT dosfa_secreto_nuevo FROM ${tabla} WHERE id = ?`).get(id);
  if (!pendiente?.dosfa_secreto_nuevo) throw new ApiError(409, 'Primero generá el código QR.');
  if (c.dosfa_metodo) await comprobarPassword(tipo, id, password);

  const paso = verificarTotp(descifrarSecreto(pendiente.dosfa_secreto_nuevo), codigo, null);
  if (paso === null) throw new ApiError(400, 'El código no es correcto. Revisá que la hora del celular esté bien y probá con el próximo.');

  const codigos = generarCodigosRecuperacion();
  const actualizado = await db
    .prepare(
      `UPDATE ${tabla} SET dosfa_metodo = 'app', dosfa_secreto = dosfa_secreto_nuevo, dosfa_secreto_nuevo = NULL,
              dosfa_ultimo_paso = ?, dosfa_codigos = ?
       WHERE id = ? AND dosfa_secreto_nuevo = ? RETURNING id`
    )
    .get(paso, await hashearCodigosRecuperacion(codigos), id, pendiente.dosfa_secreto_nuevo);
  // Otro pedido generó un QR nuevo mientras tanto: el que se escaneó ya no es el pendiente.
  if (!actualizado) throw new ApiError(409, 'El código QR cambió. Generalo de nuevo y escanealo otra vez.');
  await olvidarDispositivos(tipo, id);
  return { metodo: 'app', anterior: c.dosfa_metodo ?? null, codigos };
}

// Mail, paso 1: manda un código para comprobar que le llega.
export async function iniciarMail(tipo, id) {
  const c = await cuenta(tipo, id);
  if (!emailDeCuenta(tipo, c)) throw new ApiError(409, 'La cuenta no tiene un email cargado: usá la app autenticadora.');
  if (!correoDelCanalDisponible(CUENTAS[tipo].canal)) {
    throw new ApiError(503, 'El correo todavía no está configurado en el servidor. Por ahora usá la app autenticadora.');
  }
  if ((await codigosDeConfiguracionRecientes(tipo, id)) >= MAX_CODIGOS_CONFIGURAR) {
    throw new ApiError(429, 'Ya se mandaron varios códigos. Esperá unos minutos y probá de nuevo.');
  }
  const { desafio, email } = await iniciarDesafio(tipo, c, 'mail', 'configurar');
  return { desafio, email };
}

// Mail, paso 2: confirma el código y deja el mail como método.
export async function confirmarMail(tipo, id, { desafio, codigo, password } = {}) {
  if (typeof desafio !== 'string' || !/^[0-9a-f]{64}$/.test(desafio)) throw new ApiError(400, 'Pedí un código primero.');
  const c = await cuenta(tipo, id);
  if (c.dosfa_metodo) await comprobarPassword(tipo, id, password);
  const r = await confirmarCodigo(desafio, codigo, 'configurar');
  if (r.tipo !== tipo || r.cuenta.id !== id) throw new ApiError(400, 'El código no corresponde a tu cuenta. Pedí uno nuevo.');
  await db
    .prepare(
      `UPDATE ${CUENTAS[tipo].tabla} SET dosfa_metodo = 'mail', dosfa_secreto = NULL, dosfa_secreto_nuevo = NULL,
              dosfa_ultimo_paso = NULL, dosfa_codigos = '{}' WHERE id = ?`
    )
    .run(id);
  await olvidarDispositivos(tipo, id);
  return { metodo: 'mail', anterior: c.dosfa_metodo ?? null };
}

// Códigos de recuperación nuevos (los anteriores dejan de servir). Siempre pide la contraseña.
export async function regenerarCodigos(tipo, id, password) {
  const c = await cuenta(tipo, id);
  if (c.dosfa_metodo !== 'app') throw new ApiError(409, 'Los códigos de recuperación son para la verificación con app.');
  await comprobarPassword(tipo, id, password);
  const codigos = generarCodigosRecuperacion();
  await db.prepare(`UPDATE ${CUENTAS[tipo].tabla} SET dosfa_codigos = ? WHERE id = ?`).run(await hashearCodigosRecuperacion(codigos), id);
  return { codigos };
}

// Para quien perdió su segundo paso (lo hace el superadmin para un Admin, o la terminal para el
// superadmin): queda sin método y lo vuelve a configurar al entrar. Quien llama cierra sus sesiones.
export async function restablecerDosfa(tipo, id) {
  await db
    .prepare(
      `UPDATE ${CUENTAS[tipo].tabla} SET dosfa_metodo = NULL, dosfa_secreto = NULL, dosfa_secreto_nuevo = NULL,
              dosfa_ultimo_paso = NULL, dosfa_codigos = '{}' WHERE id = ?`
    )
    .run(id);
  await olvidarDispositivos(tipo, id);
}
