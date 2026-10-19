import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { generarPasswordProvisoria, hashPassword } from '../utils/password.js';
import { armarCorreoCuentaAdmin, correoDisponible } from './mail.service.js';
import { encolarCorreo } from './cola-correo.service.js';
import { cerrarSesionDelUsuario } from './session.service.js';
import { restablecerDosfa } from './dosfa.service.js';
import { verificarEmailLibre, verificarLoginLibre, verificarLugarLibre } from './usuarios.service.js';

// Administradores del negocio, gestionados solo por el superadmin (EST-01 §5): alta con contraseña
// provisoria (se ve una sola vez y, si el correo de la empresa está configurado, también sale por
// mail), restablecer contraseña o verificación en dos pasos, baja y reactivación. Baja lógica,
// nunca se borra. El Admin del negocio no puede tocar a ningún Administrador (usuarios.service).

const MAX_NOMBRE = 200;
const MAX_EMAIL = 100;
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MENSAJE_UNICO_ADMIN =
  'Es el único Administrador activo: el negocio se quedaría sin Administrador. Creá otro antes de darlo de baja (o cambiale el email).';

// Nunca password_hash ni secretos del 2FA.
const COLUMNAS = `
  id, nombre, email, usuario, eliminado_en, bloqueado_hasta, debe_cambiar_password, ultimo_acceso, creado_en,
  dosfa_metodo, dosfa_desactivada
`;

function validarTexto(valor, campo, maximo) {
  if (typeof valor !== 'string' || !valor.trim()) throw new ApiError(400, `${campo} es requerido`);
  const limpio = valor.trim();
  if (limpio.length > maximo) throw new ApiError(400, `${campo} no puede superar ${maximo} caracteres`);
  return limpio;
}

export function listarAdministradores() {
  return db
    .prepare(`SELECT ${COLUMNAS} FROM usuarios WHERE rol = 'admin' ORDER BY (eliminado_en IS NOT NULL), nombre`)
    .all();
}

async function obtenerAdministrador(id, { activo = true } = {}) {
  const fila = await db
    .prepare(
      `SELECT ${COLUMNAS} FROM usuarios WHERE id = ? AND rol = 'admin' AND eliminado_en IS ${activo ? 'NULL' : 'NOT NULL'}`
    )
    .get(id);
  if (!fila) throw new ApiError(404, activo ? 'El Administrador no existe o está dado de baja' : 'El Administrador no está dado de baja');
  return fila;
}

// Si el correo de la empresa está configurado y la cuenta tiene email, le manda sus datos (por la
// cola). Un Admin viejo sin email (de cuando existía el script seed-admin) no recibe nada: la
// contraseña solo se ve en el panel. Un fallo del correo no deshace el alta.
async function mandarDatos(admin, password, enlace, restablecida) {
  if (!admin.email || !correoDisponible()) return false;
  try {
    await encolarCorreo(
      { para: admin.email, ...armarCorreoCuentaAdmin({ nombre: admin.nombre, email: admin.email, password, enlace, restablecida }) },
      { tipo: 'cuenta-admin' }
    );
    return true;
  } catch (err) {
    console.error('[administradores] no se pudo encolar el mail con los datos:', err.message);
    return false;
  }
}

export async function crearAdministrador(datos, { enlace }) {
  const nombre = validarTexto(datos.nombre, 'El nombre', MAX_NOMBRE);
  const email = validarTexto(datos.email, 'El email', MAX_EMAIL);
  if (!EMAIL_VALIDO.test(email)) throw new ApiError(400, 'El email no tiene un formato válido');

  const password = generarPasswordProvisoria();
  const passwordHash = await hashPassword(password);
  const id = await db.transaction(async () => {
    await verificarLugarLibre('admin');
    await verificarLoginLibre(email);
    await verificarEmailLibre(email);
    const r = await db
      .prepare(
        `INSERT INTO usuarios (nombre, usuario, email, password_hash, rol, debe_cambiar_password)
         VALUES (?, ?, ?, ?, 'admin', TRUE) RETURNING id`
      )
      .run(nombre, email, email, passwordHash);
    return r.lastInsertRowid;
  });

  const admin = await obtenerAdministrador(id);
  return {
    administrador: admin,
    usuario: admin.email ?? admin.usuario, // con qué entra
    password_provisoria: password,
    por_mail: await mandarDatos(admin, password, enlace, false),
  };
}

// Contraseña provisoria nueva: la anterior deja de servir, se le cierra la sesión y la tiene que
// cambiar al entrar. También le saca un bloqueo por intentos fallidos.
export async function restablecerPasswordAdministrador(id, { enlace }) {
  const admin = await obtenerAdministrador(id);
  const password = generarPasswordProvisoria();
  await db
    .prepare(
      `UPDATE usuarios SET password_hash = ?, debe_cambiar_password = TRUE, intentos_fallidos = 0, bloqueado_hasta = NULL,
              actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`
    )
    .run(await hashPassword(password), id);
  await cerrarSesionDelUsuario(id);
  return {
    email: admin.email,
    usuario: admin.email ?? admin.usuario, // con qué entra (un Admin viejo puede no tener email)
    password_provisoria: password,
    por_mail: await mandarDatos(admin, password, enlace, true),
  };
}

// Para cuando perdió el acceso a su segundo paso: al entrar lo vuelve a configurar.
export async function restablecerDosfaAdministrador(id) {
  const admin = await db.transaction(async () => {
    const fila = await obtenerAdministrador(id);
    if (fila.dosfa_desactivada) {
      throw new ApiError(409, 'Tiene la verificación en dos pasos desactivada: no hay nada que restablecer');
    }
    await restablecerDosfa('usuario', id); // se une a esta transacción
    await cerrarSesionDelUsuario(id);
    return fila;
  });
  return { email: admin.email };
}

// Verificación en dos pasos apagada para este Admin (decisión del usuario, 2026-10-19, apartándose
// de EST-01 §4): entra solo con la contraseña y no la puede activar desde "Mi cuenta". Se borra lo
// que tenía configurado, como al restablecerla. No se le cierra la sesión: puede seguir trabajando
// (y si estaba frenado en "activá la verificación", se destraba).
export async function desactivarDosfaAdministrador(id) {
  const admin = await db.transaction(async () => {
    const fila = await obtenerAdministrador(id);
    if (fila.dosfa_desactivada) throw new ApiError(409, 'La verificación en dos pasos ya está desactivada');
    await db.prepare('UPDATE usuarios SET dosfa_desactivada = TRUE, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    await restablecerDosfa('usuario', id); // en la misma transacción: no queda marcada a medias
    return fila;
  });
  return { email: admin.email };
}

// Vuelve a ser obligatoria: se le cierra la sesión y la configura de cero al entrar.
export async function activarDosfaAdministrador(id) {
  const admin = await db.transaction(async () => {
    const fila = await obtenerAdministrador(id);
    if (!fila.dosfa_desactivada) throw new ApiError(409, 'La verificación en dos pasos ya está activa');
    await db.prepare('UPDATE usuarios SET dosfa_desactivada = FALSE, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    await cerrarSesionDelUsuario(id);
    return fila;
  });
  return { email: admin.email };
}

// Nunca deja al negocio sin Administrador (decisión del usuario, 2026-10-14): para reemplazar al
// único, se crea el nuevo antes (subiendo el tope si hace falta) o se le cambia el email.
export async function darDeBajaAdministrador(id) {
  const admin = await db.transaction(async () => {
    const fila = await obtenerAdministrador(id);
    const { activos } = await db
      .prepare(`SELECT COUNT(*)::int AS activos FROM usuarios WHERE rol = 'admin' AND eliminado_en IS NULL`)
      .get();
    if (activos <= 1) throw new ApiError(409, MENSAJE_UNICO_ADMIN);
    await db.prepare('UPDATE usuarios SET eliminado_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return fila;
  });
  await cerrarSesionDelUsuario(id);
  return { email: admin.email };
}

// El email de un Admin es también su usuario de ingreso: cambia los dos, queda sin verificar (como
// al editar un Encargado o Cajero) y se le cierra la sesión. Si la cuenta pasa a otra persona, CEA
// le genera además una contraseña nueva y le restablece la verificación en dos pasos.
export async function cambiarEmailAdministrador(id, datos) {
  const email = validarTexto(datos?.email, 'El email', MAX_EMAIL);
  if (!EMAIL_VALIDO.test(email)) throw new ApiError(400, 'El email no tiene un formato válido');

  const anterior = await db.transaction(async () => {
    const admin = await obtenerAdministrador(id);
    const previo = admin.email ?? admin.usuario;
    if (admin.email && admin.email.toLowerCase() === email.toLowerCase()) throw new ApiError(400, 'Es el mismo email que ya tiene');
    await verificarEmailLibre(email, id);
    await verificarLoginLibre(email, id);
    await db
      .prepare(
        `UPDATE usuarios SET usuario = ?, email = ?, email_verificado_en = NULL, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(email, email, id);
    return previo;
  });
  await cerrarSesionDelUsuario(id);
  return { anterior, administrador: await obtenerAdministrador(id) };
}

// Vuelve a estar activo si hay lugar en el tope y nadie tomó su mail mientras estuvo de baja.
export async function reactivarAdministrador(id) {
  await db.transaction(async () => {
    const admin = await obtenerAdministrador(id, { activo: false });
    await verificarLugarLibre('admin');
    await verificarLoginLibre(admin.usuario, id);
    if (admin.email) await verificarEmailLibre(admin.email, id);
    await db.prepare('UPDATE usuarios SET eliminado_en = NULL, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  });
  return obtenerAdministrador(id);
}
