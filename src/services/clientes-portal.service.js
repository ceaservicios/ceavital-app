import crypto from 'node:crypto';
import db from '../db/connection.js';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { AuthError } from './auth.service.js';

// Portal del cliente-empresa: credenciales que carga el Admin/Encargado desde
// la ficha del cliente, y login propio del cliente para ver su cuenta. Vive
// aparte del login interno (auth.service / session.service): otra tabla de
// sesiones, otra cookie y otras rutas, para que una sesión de cliente jamás
// pueda pasar por una sesión interna.

const USUARIO_VALIDO = /^[A-Za-z0-9._@+-]{3,60}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // límite real de bcrypt: más allá se ignora en silencio

function validarUsuario(valor) {
  if (typeof valor !== 'string' || !valor.trim()) throw new ApiError(400, 'El usuario de acceso es requerido');
  const usuario = valor.trim();
  if (!USUARIO_VALIDO.test(usuario)) {
    throw new ApiError(400, 'El usuario tiene que tener entre 3 y 60 caracteres: letras, números y . _ @ + -');
  }
  return usuario;
}

function validarPassword(valor) {
  if (typeof valor !== 'string' || valor.length < PASSWORD_MIN) {
    throw new ApiError(400, `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres`);
  }
  if (valor.length > PASSWORD_MAX) {
    throw new ApiError(400, `La contraseña no puede superar los ${PASSWORD_MAX} caracteres`);
  }
  return valor;
}

function verificarUsuarioLibre(usuario, excluirId) {
  const existente = db
    .prepare(
      `SELECT id FROM clientes_empresa
       WHERE portal_usuario = ? COLLATE NOCASE AND eliminado_en IS NULL AND id != ?`
    )
    .get(usuario, excluirId);
  if (existente) throw new ApiError(409, 'Ese usuario de acceso ya lo usa otro cliente');
}

function obtenerClienteActivoParaAcceso(id) {
  // Columnas explícitas: nunca se lee portal_password_hash fuera del login.
  const fila = db
    .prepare(
      `SELECT id, portal_usuario, portal_habilitado, portal_ultimo_acceso,
              (portal_bloqueado_hasta IS NOT NULL AND portal_bloqueado_hasta > datetime('now')) AS bloqueado,
              (portal_password_hash IS NOT NULL) AS tiene_password
       FROM clientes_empresa WHERE id = ? AND eliminado_en IS NULL`
    )
    .get(id);
  if (!fila) throw new ApiError(404, 'Cliente-empresa no encontrado');
  return fila;
}

function aAcceso(fila) {
  return {
    portal_disponible: config.portalClientes,
    configurado: Boolean(fila.portal_usuario && fila.tiene_password),
    usuario: fila.portal_usuario ?? null,
    habilitado: Boolean(fila.portal_habilitado),
    bloqueado: Boolean(fila.bloqueado),
    ultimo_acceso: fila.portal_ultimo_acceso ?? null,
  };
}

export function obtenerAcceso(clienteEmpresaId) {
  return aAcceso(obtenerClienteActivoParaAcceso(clienteEmpresaId));
}

// Alta o cambio del acceso del cliente. Alta: usuario y contraseña son
// obligatorios y el acceso queda habilitado. Cambio: todo es opcional; cambiar
// la contraseña también levanta un bloqueo por intentos fallidos. Cambiar el
// usuario o la contraseña, o deshabilitar, cierra las sesiones abiertas del
// cliente (si no, seguiría entrando con las credenciales viejas hasta 30 min).
export async function configurarAcceso(clienteEmpresaId, { usuario, password, habilitado } = {}) {
  const actual = obtenerClienteActivoParaAcceso(clienteEmpresaId);
  const yaConfigurado = Boolean(actual.portal_usuario && actual.tiene_password);

  const cambios = {};
  let cerrarSesiones = false;

  if (usuario !== undefined && usuario !== null && usuario !== '') {
    const nuevo = validarUsuario(usuario);
    verificarUsuarioLibre(nuevo, clienteEmpresaId);
    if (nuevo.toLowerCase() !== (actual.portal_usuario ?? '').toLowerCase()) cerrarSesiones = true;
    cambios.portal_usuario = nuevo;
  } else if (!yaConfigurado) {
    throw new ApiError(400, 'El usuario de acceso es requerido');
  }

  if (password !== undefined && password !== null && password !== '') {
    cambios.portal_password_hash = await hashPassword(validarPassword(password));
    cambios.portal_intentos_fallidos = 0;
    cambios.portal_bloqueado_hasta = null;
    cerrarSesiones = true;
  } else if (!yaConfigurado) {
    throw new ApiError(400, 'La contraseña es requerida');
  }

  if (habilitado !== undefined && habilitado !== null) {
    if (typeof habilitado !== 'boolean') throw new ApiError(400, 'habilitado tiene que ser verdadero o falso');
    cambios.portal_habilitado = habilitado ? 1 : 0;
    if (!habilitado) cerrarSesiones = true;
  } else if (!yaConfigurado) {
    cambios.portal_habilitado = 1;
  }

  const claves = Object.keys(cambios);
  if (claves.length === 0) throw new ApiError(400, 'No se envió ningún cambio');

  const set = claves.map((c) => `${c} = ?`).join(', ');
  db.prepare(`UPDATE clientes_empresa SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(
    ...claves.map((c) => cambios[c]),
    clienteEmpresaId
  );

  if (cerrarSesiones) cerrarSesionesDeCliente(clienteEmpresaId, 'credenciales_cambiadas');

  return obtenerAcceso(clienteEmpresaId);
}

// --- Login y sesiones del cliente -------------------------------------------

let hashDeRelleno = null;

export async function loginCliente(usuarioLogin, passwordPlano) {
  const cliente = db
    .prepare(
      `SELECT id, razon_social, portal_password_hash, portal_intentos_fallidos,
              (portal_bloqueado_hasta IS NOT NULL AND portal_bloqueado_hasta > datetime('now')) AS bloqueado
       FROM clientes_empresa
       WHERE portal_usuario = ? COLLATE NOCASE AND eliminado_en IS NULL AND portal_habilitado = 1
         AND portal_password_hash IS NOT NULL`
    )
    .get(usuarioLogin);

  if (!cliente) {
    // Se compara igual contra un hash de relleno: si no, "usuario que no
    // existe" responde mucho más rápido que "contraseña incorrecta" y eso
    // permite averiguar qué usuarios existen midiendo el tiempo.
    hashDeRelleno ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
    await verifyPassword(passwordPlano, hashDeRelleno);
    throw new AuthError('Usuario o contraseña incorrectos', 'CREDENCIALES_INVALIDAS');
  }

  if (cliente.bloqueado) {
    throw new AuthError(
      `Acceso bloqueado temporalmente por intentos fallidos. Reintentá en ${config.login.bloqueoMinutos} minutos.`,
      'USUARIO_BLOQUEADO'
    );
  }

  const passwordOk = await verifyPassword(passwordPlano, cliente.portal_password_hash);

  if (!passwordOk) {
    const intentos = cliente.portal_intentos_fallidos + 1;
    if (intentos >= config.login.maxIntentos) {
      db.prepare(
        `UPDATE clientes_empresa
         SET portal_intentos_fallidos = ?, portal_bloqueado_hasta = datetime('now', '+' || ? || ' minutes')
         WHERE id = ?`
      ).run(intentos, config.login.bloqueoMinutos, cliente.id);
      throw new AuthError(
        `Acceso bloqueado por ${config.login.maxIntentos} intentos fallidos. Reintentá en ${config.login.bloqueoMinutos} minutos.`,
        'USUARIO_BLOQUEADO'
      );
    }
    db.prepare('UPDATE clientes_empresa SET portal_intentos_fallidos = ? WHERE id = ?').run(intentos, cliente.id);
    throw new AuthError('Usuario o contraseña incorrectos', 'CREDENCIALES_INVALIDAS');
  }

  db.prepare(
    `UPDATE clientes_empresa
     SET portal_intentos_fallidos = 0, portal_bloqueado_hasta = NULL, portal_ultimo_acceso = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(cliente.id);

  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones_cliente (cliente_empresa_id, token) VALUES (?, ?)').run(cliente.id, token);

  return { token, cliente: { id: cliente.id, razon_social: cliente.razon_social } };
}

// Sesión válida = activa, sin vencer por inactividad, y el cliente sigue
// existiendo y habilitado (dar de baja o deshabilitar corta el acceso en el
// acto, sin esperar a que venza la sesión). Fechas comparadas en SQL, igual
// que session.service.
export function obtenerSesionClienteValida(token) {
  return db
    .prepare(
      `SELECT sc.id AS sesion_id, c.id AS cliente_id, c.razon_social
       FROM sesiones_cliente sc
       JOIN clientes_empresa c ON c.id = sc.cliente_empresa_id
       WHERE sc.token = ? AND sc.estado = 'activa'
         AND sc.ultima_actividad >= datetime('now', '-' || ? || ' minutes')
         AND c.eliminado_en IS NULL AND c.portal_habilitado = 1`
    )
    .get(token, config.session.timeoutMinutes);
}

export function marcarActividadCliente(sesionId) {
  db.prepare('UPDATE sesiones_cliente SET ultima_actividad = CURRENT_TIMESTAMP WHERE id = ?').run(sesionId);
}

export function cerrarSesionCliente(sesionId, motivo = 'logout') {
  db.prepare(
    `UPDATE sesiones_cliente SET estado = 'cerrada', motivo_cierre = ?, cerrada_en = CURRENT_TIMESTAMP
     WHERE id = ? AND estado = 'activa'`
  ).run(motivo, sesionId);
}

export function cerrarSesionesDeCliente(clienteEmpresaId, motivo) {
  db.prepare(
    `UPDATE sesiones_cliente SET estado = 'cerrada', motivo_cierre = ?, cerrada_en = CURRENT_TIMESTAMP
     WHERE cliente_empresa_id = ? AND estado = 'activa'`
  ).run(motivo, clienteEmpresaId);
}

// Housekeeping: deja prolijo el historial (motivo 'timeout'); no es lo que
// bloquea el acceso, eso ya lo hace obtenerSesionClienteValida en cada request.
export function cerrarSesionesClienteInactivas() {
  return db
    .prepare(
      `UPDATE sesiones_cliente SET estado = 'cerrada', motivo_cierre = 'timeout', cerrada_en = CURRENT_TIMESTAMP
       WHERE estado = 'activa' AND ultima_actividad < datetime('now', '-' || ? || ' minutes')`
    )
    .run(config.session.timeoutMinutes).changes;
}
