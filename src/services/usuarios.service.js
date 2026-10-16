import { esUsuarioSuperadmin } from './superadmin.service.js';
import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { hashPassword } from '../utils/password.js';
import { cerrarSesionDelUsuario } from './session.service.js';
import { correoDisponible } from './mail.service.js';
import { cuposPorRol } from './instancia.service.js';

const ROLES = ['admin', 'encargado', 'cajero'];
// EST-01 §5: a los Administradores los da de alta, restablece y da de baja solo el superadmin
// (administradores.service); el Admin del negocio gestiona Encargados y Cajeros.
const ROLES_DEL_ADMIN = ['encargado', 'cajero'];
const MENSAJE_ADMIN_DE_CEA =
  'A los Administradores los gestiona CEA Servicios (alta, contraseña, verificación en dos pasos y baja).';
const ETIQUETA_ROL = { admin: 'Administrador', encargado: 'Encargado', cajero: 'Cajero' };

// Topes de longitud de nombre y usuario (sin tope, un nombre de 90.000 caracteres se guardaba).
const MAX_NOMBRE = 200;
const MAX_USUARIO = 100;
const MAX_EMAIL = 100; // el email de los usuarios nuevos es también su usuario (mismo tope)
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Los códigos de ingreso (verificar el email, 2FA) salen por el correo de la empresa. Sin él la app
// funciona igual (EST-01 §10.2): los usuarios se crean y la verificación del email queda en pausa
// hasta que se configure (codigo-ingreso.service > segundoPasoDeEmpleado). Lo único que no se puede
// es activar el 2FA por mail, porque no habría cómo mandar el código.
const MENSAJE_SIN_CORREO =
  'Falta configurar el correo de la empresa (lo hace CEA Servicios): sin él no se puede activar el 2FA, que manda el código por mail.';

// Nunca se selecciona password_hash -- ni siquiera para Admin. Explícito acá
// (no "SELECT *") para que un campo nuevo agregado a la tabla en el futuro no
// se filtre por accidente a una respuesta HTTP.
const COLUMNAS_SEGURAS = `
  id, nombre, usuario, email, email_verificado_en, dos_fa, rol, intentos_fallidos, bloqueado_hasta,
  debe_cambiar_password, (dosfa_metodo IS NOT NULL) AS dosfa_configurado, ultimo_acceso,
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
  if (!ROLES_DEL_ADMIN.includes(valor)) throw new ApiError(403, MENSAJE_ADMIN_DE_CEA);
  return valor;
}

// Mismo mínimo y máximo que cuenta.service ("Mi cuenta") -- una sola regla de complejidad de
// contraseña en todo el proyecto. El máximo es el límite real de bcrypt: más allá se ignora en silencio.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

function validarPassword(valor) {
  if (typeof valor !== 'string' || valor.length < PASSWORD_MIN) {
    throw new ApiError(400, `password tiene que tener al menos ${PASSWORD_MIN} caracteres`);
  }
  if (valor.length > PASSWORD_MAX) throw new ApiError(400, `password no puede superar ${PASSWORD_MAX} caracteres`);
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

export async function verificarEmailLibre(email, excluirId = null) {
  const existente = await db
    .prepare(`SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?) AND eliminado_en IS NULL AND id != ?`)
    .get(email, excluirId ?? -1);
  if (existente) throw new ApiError(409, 'Ya hay otro usuario activo con ese email');
  if (await esUsuarioSuperadmin(email)) throw new ApiError(409, 'Ese email está reservado');
}

// Topes por rol que carga el superadmin (instancia.service > cuposPorRol).
export async function verificarLugarLibre(rol) {
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

export async function verificarLoginLibre(login, excluirId = null) {
  const existente = await db
    .prepare(`SELECT id FROM usuarios WHERE LOWER(usuario) = LOWER(?) AND eliminado_en IS NULL AND id != ?`)
    .get(login, excluirId ?? -1);
  if (existente) throw new ApiError(409, 'Ya existe un usuario activo con ese login');
  if (await esUsuarioSuperadmin(login)) throw new ApiError(409, 'Ese nombre de usuario está reservado');
}

export function listarUsuarios() {
  return db.prepare(`SELECT ${COLUMNAS_SEGURAS} FROM usuarios WHERE eliminado_en IS NULL ORDER BY nombre`).all();
}

export function obtenerUsuario(id) {
  return obtenerUsuarioActivo(id);
}

// Usuario nuevo (Encargado o Cajero): entra con su email (usuario = email), que se verifica con
// un código la primera vez que ingresa (en pausa mientras no haya correo de la empresa). Solo si
// queda lugar libre en su rol (tope del superadmin).
export async function crearUsuario(datos) {
  const nombre = validarString(datos.nombre, 'nombre', { maxLength: MAX_NOMBRE });
  const email = validarEmail(datos.email);
  const rol = validarRol(datos.rol);
  validarPassword(datos.password);
  const dosFa = datos.dos_fa === undefined ? false : validarBooleano(datos.dos_fa, 'dos_fa');
  if (dosFa && !correoDisponible()) throw new ApiError(503, MENSAJE_SIN_CORREO);

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
    if (actual.rol === 'admin') throw new ApiError(403, MENSAJE_ADMIN_DE_CEA);

    const actualizaciones = {};

    if (datos.nombre !== undefined) actualizaciones.nombre = validarString(datos.nombre, 'nombre', { maxLength: MAX_NOMBRE });

    if (datos.usuario !== undefined) {
      actualizaciones.usuario = validarString(datos.usuario, 'usuario', { maxLength: MAX_USUARIO });
      await verificarLoginLibre(actualizaciones.usuario, id);
    }

    // Email nuevo: queda sin verificar (se verifica con el código en su próximo ingreso, o cuando
    // se configure el correo de la empresa). Si el usuario entraba con su email, pasa a entrar con el nuevo.
    if (datos.email !== undefined) {
      const email = validarEmail(datos.email);
      if (email.toLowerCase() !== (actual.email ?? '').toLowerCase()) {
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
      if (actualizaciones.rol !== actual.rol) await verificarLugarLibre(actualizaciones.rol);
    }

    // 2FA: el código de cada ingreso (una vez por semana en cada navegador) llega a su email.
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
      await cerrarSesionDelUsuario(id);
    }
  });

  return obtenerUsuario(id);
}

export async function eliminarUsuario(id) {
  await db.transaction(async () => {
    const usuario = await obtenerUsuarioActivo(id);
    if (usuario.rol === 'admin') throw new ApiError(403, MENSAJE_ADMIN_DE_CEA);

    await db.prepare('UPDATE usuarios SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    await cerrarSesionDelUsuario(id);
  });
}
