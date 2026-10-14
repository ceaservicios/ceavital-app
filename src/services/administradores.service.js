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

// Nunca password_hash ni secretos del 2FA.
const COLUMNAS = `
  id, nombre, email, usuario, eliminado_en, bloqueado_hasta, debe_cambiar_password, ultimo_acceso, creado_en,
  dosfa_metodo
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
// cola). Un Admin viejo sin email (creado con seed-admin) no recibe nada: la contraseña solo se ve
// en el panel. Un fallo del correo no deshace el alta.
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
  const admin = await obtenerAdministrador(id);
  await restablecerDosfa('usuario', id);
  await cerrarSesionDelUsuario(id);
  return { email: admin.email };
}

export async function darDeBajaAdministrador(id) {
  const admin = await obtenerAdministrador(id);
  await db.prepare('UPDATE usuarios SET eliminado_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  await cerrarSesionDelUsuario(id);
  return { email: admin.email };
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
