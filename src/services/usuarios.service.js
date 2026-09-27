import { esUsuarioSuperadmin } from './superadmin.service.js';
import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { hashPassword } from '../utils/password.js';
import { cerrarSesion } from './session.service.js';
import { correoDisponible } from './mail.service.js';
import { cuposPorRol } from './instancia.service.js';

const ROLES = ['admin', 'encargado', 'cajero'];
const ETIQUETA_ROL = { admin: 'Administrador', encargado: 'Encargado', cajero: 'Cajero' };

// Topes de longitud de nombre y usuario (sin tope, un nombre de 90.000 caracteres se guardaba).
const MAX_NOMBRE = 200;
const MAX_USUARIO = 100;
const MAX_EMAIL = 100; // el email de los usuarios nuevos es también su usuario (mismo tope)
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Los códigos de ingreso (verificar el email, 2FA) salen por el correo de la empresa: sin él
// un usuario con email no podría entrar, así que no se deja crearlo ni activarle el 2FA.
const MENSAJE_SIN_CORREO =
  'Falta configurar el correo de la empresa (lo hace CEA Servicios): sin él no se pueden crear usuarios, cambiar emails ni activar el 2FA.';

// Nunca se selecciona password_hash -- ni siquiera para Admin. Explícito acá
// (no "SELECT *") para que un campo nuevo agregado a la tabla en el futuro no
// se filtre por accidente a una respuesta HTTP.
const COLUMNAS_SEGURAS = `
  id, nombre, usuario, email, email_verificado_en, dos_fa, rol, intentos_fallidos, bloqueado_hasta,
  eliminado_en, creado_en, actualizado_en
`;

function validarString(valor, campo, { requerido = true, maxLength = MAX_NOMBRE } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ApiError(400, `${campo} es requerido`);
    return null;
  }
  if (typeof valor !== 'string') throw new ApiError(400, `${campo} tiene que ser texto`);
  const limpio = valor.trim();
  if (limpio.length > maxLength) throw new ApiError(400, `${campo} no puede superar ${maxLength} caracteres`);
  return limpio;
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

function validarEmail(valor) {
  const email = validarString(valor, 'email', { maxLength: MAX_EMAIL });
  if (!EMAIL_VALIDO.test(email)) throw new ApiError(400, 'El email no tiene un formato válido');
  return email;
}

function validarBooleano(valor, campo) {
  if (typeof valor !== 'boolean') throw new ApiError(400, `${campo} tiene que ser verdadero o falso`);
  return valor;
}

async function verificarEmailLibre(email, excluirId = null) {
  const existente = await db
    .prepare(`SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?) AND eliminado_en IS NULL AND id != ?`)
    .get(email, excluirId ?? -1);
  if (existente) throw new ApiError(409, 'Ya hay otro usuario activo con ese email');
}

// Topes por rol que carga el superadmin (instancia.service > cuposPorRol).
async function verificarLugarLibre(rol) {
  const cupo = (await cuposPorRol()).find((c) => c.rol === rol);
  if (cupo.tope === null) {
    throw new ApiError(409, `Todavía no hay lugares habilitados para ${ETIQUETA_ROL[rol]}. Pedíselos a CEA Servicios.`);
  }
  if (cupo.libres <= 0) {
    throw new ApiError(
      409,
      `No quedan lugares libres para ${ETIQUETA_ROL[rol]} (el tope es ${cupo.tope}). Para sumar más, pedíselo a CEA Servicios.`
    );
  }
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
    .prepare(`SELECT id FROM usuarios WHERE LOWER(usuario) = LOWER(?) AND eliminado_en IS NULL AND id != ?`)
    .get(login, excluirId ?? -1);
  if (existente) throw new ApiError(409, 'Ya existe un usuario activo con ese login');
  if (await esUsuarioSuperadmin(login)) throw new ApiError(409, 'Ese nombre de usuario está reservado');
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

// Usuario nuevo: entra con su email (usuario = email), que se verifica con un código la
// primera vez que ingresa. Solo si queda lugar libre en su rol (tope del superadmin).
export async function crearUsuario(datos) {
  const nombre = validarString(datos.nombre, 'nombre', { maxLength: MAX_NOMBRE });
  const email = validarEmail(datos.email);
  const rol = validarRol(datos.rol);
  validarPassword(datos.password);
  const dosFa = datos.dos_fa === undefined ? false : validarBooleano(datos.dos_fa, 'dos_fa');
  if (!correoDisponible()) throw new ApiError(503, MENSAJE_SIN_CORREO);

  const passwordHash = await hashPassword(datos.password);

  const id = await db.transaction(async () => {
    await verificarLugarLibre(rol);
    await verificarLoginLibre(email);
    await verificarEmailLibre(email);
    const resultado = await db
      .prepare('INSERT INTO usuarios (nombre, usuario, email, password_hash, rol, dos_fa) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
      .run(nombre, email, email, passwordHash, rol, dosFa);
    return resultado.lastInsertRowid;
  });

  return obtenerUsuario(id);
}

export async function editarUsuario(id, datos) {
  await db.transaction(async () => {
    const actual = await obtenerUsuarioActivo(id);

    const actualizaciones = {};

    if (datos.nombre !== undefined) actualizaciones.nombre = validarString(datos.nombre, 'nombre', { maxLength: MAX_NOMBRE });

    if (datos.usuario !== undefined) {
      actualizaciones.usuario = validarString(datos.usuario, 'usuario', { maxLength: MAX_USUARIO });
      await verificarLoginLibre(actualizaciones.usuario, id);
    }

    // Email nuevo: queda sin verificar (se verifica con el código en su próximo ingreso).
    // Si el usuario entraba con su email, pasa a entrar con el nuevo.
    if (datos.email !== undefined) {
      const email = validarEmail(datos.email);
      if (email.toLowerCase() !== (actual.email ?? '').toLowerCase()) {
        if (!correoDisponible()) throw new ApiError(503, MENSAJE_SIN_CORREO);
        await verificarEmailLibre(email, id);
        actualizaciones.email = email;
        actualizaciones.email_verificado_en = null;
        if (datos.usuario === undefined && actual.email && actual.usuario.toLowerCase() === actual.email.toLowerCase()) {
          await verificarLoginLibre(email, id);
          actualizaciones.usuario = email;
        }
      }
    }

    if (datos.rol !== undefined) {
      actualizaciones.rol = validarRol(datos.rol);
      if (actual.rol === 'admin' && actualizaciones.rol !== 'admin' && (await contarAdminsActivos(id)) === 0) {
        throw new ApiError(409, 'No se le puede quitar el rol Admin al único usuario Admin activo');
      }
      if (actualizaciones.rol !== actual.rol) await verificarLugarLibre(actualizaciones.rol);
    }

    // 2FA: el código de cada ingreso (una vez por día por dispositivo) llega a su email.
    if (datos.dos_fa !== undefined) {
      actualizaciones.dos_fa = validarBooleano(datos.dos_fa, 'dos_fa');
      if (actualizaciones.dos_fa && !actual.dos_fa) {
        if (!(actualizaciones.email ?? actual.email)) {
          throw new ApiError(409, 'Para activar el 2FA el usuario tiene que tener un email cargado');
        }
        if (!correoDisponible()) throw new ApiError(503, MENSAJE_SIN_CORREO);
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

    // Solo si el rol cambió de verdad (la pantalla manda el rol en cada guardado: antes,
    // cambiarle el nombre a alguien le cerraba la sesión).
    if ((actualizaciones.rol !== undefined && actualizaciones.rol !== actual.rol) || datos.password !== undefined) {
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
