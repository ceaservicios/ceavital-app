import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { hashPassword } from '../utils/password.js';
import { cerrarSesion } from './session.service.js';

const ROLES = ['admin', 'encargado', 'cajero'];

// Nunca se selecciona password_hash -- ni siquiera para Admin. Explícito acá
// (no "SELECT *") para que un campo nuevo agregado a la tabla en el futuro no
// se filtre por accidente a una respuesta HTTP.
const COLUMNAS_SEGURAS = `
  id, nombre, usuario, rol, intentos_fallidos, bloqueado_hasta, eliminado_en, creado_en, actualizado_en
`;

function validarString(valor, campo, { requerido = true } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ApiError(400, `${campo} es requerido`);
    return null;
  }
  if (typeof valor !== 'string') throw new ApiError(400, `${campo} tiene que ser texto`);
  return valor.trim();
}

function validarRol(valor) {
  if (!ROLES.includes(valor)) throw new ApiError(400, `rol tiene que ser uno de: ${ROLES.join(', ')}`);
  return valor;
}

// Mismo mínimo que seed-admin.js (src/db/seed-admin.js) -- una sola regla de
// complejidad de contraseña en todo el proyecto, no duplicar el número.
function validarPassword(valor) {
  if (typeof valor !== 'string' || valor.length < 8) {
    throw new ApiError(400, 'password tiene que tener al menos 8 caracteres');
  }
  return valor;
}

async function obtenerUsuarioActivo(id) {
  const usuario = await db
    .prepare(`SELECT ${COLUMNAS_SEGURAS} FROM usuarios WHERE id = ? AND eliminado_en IS NULL`)
    .get(id);
  if (!usuario) throw new ApiError(404, 'Usuario no encontrado');
  return usuario;
}

async function verificarLoginLibre(login, excluirId = null) {
  const existente = await db
    .prepare(`SELECT id FROM usuarios WHERE usuario = ? AND eliminado_en IS NULL AND id != ?`)
    .get(login, excluirId ?? -1);
  if (existente) throw new ApiError(409, 'Ya existe un usuario activo con ese login');
}

// Cuántos Admin activos quedan sin contar `excluirId` -- usado para bloquear
// la operación que dejaría al sistema sin nadie que pueda gestionar usuarios/
// configuración (Docs/Instructivo-Funcional.md: esas dos áreas son Admin-only,
// y la recuperación de contraseña del Admin exige acceso físico a la PC
// servidor -- si además no queda ninguna fila con rol admin, no hay forma de
// recuperar el acceso administrativo sin tocar la base a mano).
async function contarAdminsActivos(excluirId = null) {
  const fila = await db
    .prepare(`SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'admin' AND eliminado_en IS NULL AND id != ?`)
    .get(excluirId ?? -1);
  return fila.c;
}

// Cambiar el rol o la contraseña de un usuario es seguridad-sensible: si tiene
// una sesión activa, cerrarla para que el cambio rija de inmediato (si no,
// podría seguir operando con el rol/contraseña viejos hasta 30 min de timeout).
async function cerrarSesionActivaDelUsuario(usuarioId) {
  const sesion = await db
    .prepare(`SELECT id FROM sesiones_activas WHERE usuario_id = ? AND estado = 'activa'`)
    .get(usuarioId);
  if (sesion) await cerrarSesion(sesion.id, 'expulsada');
}

export function listarUsuarios() {
  return db.prepare(`SELECT ${COLUMNAS_SEGURAS} FROM usuarios WHERE eliminado_en IS NULL ORDER BY nombre`).all();
}

export function obtenerUsuario(id) {
  return obtenerUsuarioActivo(id);
}

export async function crearUsuario(datos) {
  const nombre = validarString(datos.nombre, 'nombre');
  const login = validarString(datos.usuario, 'usuario');
  const rol = validarRol(datos.rol);
  validarPassword(datos.password);

  const passwordHash = await hashPassword(datos.password);

  const id = await db.transaction(async () => {
    await verificarLoginLibre(login);
    const resultado = await db
      .prepare('INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?) RETURNING id')
      .run(nombre, login, passwordHash, rol);
    return resultado.lastInsertRowid;
  });

  return obtenerUsuario(id);
}

export async function editarUsuario(id, datos) {
  await db.transaction(async () => {
    const actual = await obtenerUsuarioActivo(id);

    const actualizaciones = {};

    if (datos.nombre !== undefined) actualizaciones.nombre = validarString(datos.nombre, 'nombre');

    if (datos.usuario !== undefined) {
      actualizaciones.usuario = validarString(datos.usuario, 'usuario');
      await verificarLoginLibre(actualizaciones.usuario, id);
    }

    if (datos.rol !== undefined) {
      actualizaciones.rol = validarRol(datos.rol);
      if (actual.rol === 'admin' && actualizaciones.rol !== 'admin' && (await contarAdminsActivos(id)) === 0) {
        throw new ApiError(409, 'No se le puede quitar el rol Admin al único usuario Admin activo');
      }
    }

    if (datos.password !== undefined) {
      validarPassword(datos.password);
      actualizaciones.password_hash = await hashPassword(datos.password);
    }

    const claves = Object.keys(actualizaciones);
    if (claves.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');

    const set = claves.map((c) => `${c} = ?`).join(', ');
    const valores = claves.map((c) => actualizaciones[c]);

    await db
      .prepare(`UPDATE usuarios SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...valores, id);

    if (datos.rol !== undefined || datos.password !== undefined) {
      await cerrarSesionActivaDelUsuario(id);
    }
  });

  return obtenerUsuario(id);
}

export async function eliminarUsuario(id) {
  await db.transaction(async () => {
    const usuario = await obtenerUsuarioActivo(id);

    if (usuario.rol === 'admin' && (await contarAdminsActivos(id)) === 0) {
      throw new ApiError(409, 'No se puede eliminar el único usuario Admin activo');
    }

    await db.prepare('UPDATE usuarios SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    await cerrarSesionActivaDelUsuario(id);
  });
}
