import crypto from 'node:crypto';
import db from '../db/connection.js';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { AuthError } from './auth.service.js';
import { armarCorreoAcceso, correoDisponible, enviarCorreo } from './mail.service.js';
import { moduloActivo } from './modulos.service.js';

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

async function verificarUsuarioLibre(usuario, excluirId) {
  const existente = await db
    .prepare(
      `SELECT id FROM clientes_empresa
       WHERE LOWER(portal_usuario) = LOWER(?) AND eliminado_en IS NULL AND id != ?`
    )
    .get(usuario, excluirId);
  if (existente) throw new ApiError(409, 'Ese usuario de acceso ya lo usa otro cliente');
}

async function obtenerClienteActivoParaAcceso(id) {
  // Columnas explícitas: nunca se lee portal_password_hash fuera del login.
  const fila = await db
    .prepare(
      `SELECT id, razon_social, email, portal_usuario, portal_habilitado, portal_ultimo_acceso,
              (portal_bloqueado_hasta IS NOT NULL AND portal_bloqueado_hasta > LOCALTIMESTAMP) AS bloqueado,
              (portal_password_hash IS NOT NULL) AS tiene_password
       FROM clientes_empresa WHERE id = ? AND eliminado_en IS NULL`
    )
    .get(id);
  if (!fila) throw new ApiError(404, 'Cliente-empresa no encontrado');
  return fila;
}

async function aAcceso(fila) {
  return {
    portal_disponible: await moduloActivo('portal'),
    configurado: Boolean(fila.portal_usuario && fila.tiene_password),
    usuario: fila.portal_usuario ?? null,
    habilitado: Boolean(fila.portal_habilitado),
    bloqueado: Boolean(fila.bloqueado),
    ultimo_acceso: fila.portal_ultimo_acceso ?? null,
    // Para el botón "Enviar por mail" de la ficha: si el servidor puede mandar
    // mails y a qué dirección (el email que ya tiene cargado el cliente).
    correo_disponible: correoDisponible(),
    email_cliente: fila.email || null,
  };
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Manda por mail los datos de acceso al email que el cliente ya tiene cargado
// en su ficha (nunca a una dirección que llegue en el pedido). La contraseña en
// texto plano solo la conoce quien acaba de definirla: se recibe para armar el
// mail, se comprueba que sea la vigente (así no se manda una que ya cambió) y
// no se guarda en ningún lado.
export async function enviarAccesoPorCorreo(clienteEmpresaId, { password, enlace }) {
  const cliente = await obtenerClienteActivoParaAcceso(clienteEmpresaId);
  if (!cliente.portal_usuario || !cliente.tiene_password) {
    throw new ApiError(409, 'Este cliente todavía no tiene acceso configurado');
  }
  if (!cliente.portal_habilitado) throw new ApiError(409, 'El acceso está deshabilitado: habilitalo antes de enviarlo');
  if (!cliente.email || !EMAIL_VALIDO.test(cliente.email)) {
    throw new ApiError(400, 'El cliente no tiene un email válido cargado. Cargalo en la pestaña Datos.');
  }
  if (typeof password !== 'string' || !password) throw new ApiError(400, 'La contraseña es requerida');
  if (typeof enlace !== 'string' || !/^https?:\/\//.test(enlace)) throw new ApiError(400, 'El enlace del portal no es válido');

  const { password_hash: hash } = await db
    .prepare('SELECT portal_password_hash AS password_hash FROM clientes_empresa WHERE id = ?')
    .get(clienteEmpresaId);
  if (!(await verifyPassword(password, hash))) {
    throw new ApiError(409, 'Esa contraseña ya no es la vigente. Definí una nueva y volvé a enviarla.');
  }

  const { asunto, texto, html } = armarCorreoAcceso({
    razonSocial: cliente.razon_social,
    enlace,
    usuario: cliente.portal_usuario,
    password,
  });
  await enviarCorreo({ para: cliente.email, asunto, texto, html });
  return { enviado_a: cliente.email };
}

export async function obtenerAcceso(clienteEmpresaId) {
  return await aAcceso(await obtenerClienteActivoParaAcceso(clienteEmpresaId));
}

// Alta o cambio del acceso del cliente. Alta: usuario y contraseña son
// obligatorios y el acceso queda habilitado. Cambio: todo es opcional; cambiar
// la contraseña también levanta un bloqueo por intentos fallidos. Cambiar el
// usuario o la contraseña, o deshabilitar, cierra las sesiones abiertas del
// cliente (si no, seguiría entrando con las credenciales viejas hasta 30 min).
export async function configurarAcceso(clienteEmpresaId, { usuario, password, habilitado } = {}) {
  await db.transaction(async () => {
    const actual = await obtenerClienteActivoParaAcceso(clienteEmpresaId);
    const yaConfigurado = Boolean(actual.portal_usuario && actual.tiene_password);

    const cambios = {};
    let cerrarSesiones = false;

    if (usuario !== undefined && usuario !== null && usuario !== '') {
      const nuevo = validarUsuario(usuario);
      await verificarUsuarioLibre(nuevo, clienteEmpresaId);
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
    await db
      .prepare(`UPDATE clientes_empresa SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...claves.map((c) => cambios[c]), clienteEmpresaId);

    if (cerrarSesiones) await cerrarSesionesDeCliente(clienteEmpresaId, 'credenciales_cambiadas');
  });

  return obtenerAcceso(clienteEmpresaId);
}

// --- Login y sesiones del cliente -------------------------------------------

let hashDeRelleno = null;

export async function loginCliente(usuarioLogin, passwordPlano) {
  const cliente = await db
    .prepare(
      `SELECT id, razon_social, portal_password_hash, portal_intentos_fallidos,
              (portal_bloqueado_hasta IS NOT NULL AND portal_bloqueado_hasta > LOCALTIMESTAMP) AS bloqueado
       FROM clientes_empresa
       WHERE LOWER(portal_usuario) = LOWER(?) AND eliminado_en IS NULL AND portal_habilitado = 1
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
    // Incremento atómico en la propia sentencia (nunca "leer, esperar el hash,
    // escribir +1": con logins simultáneos se perdían intentos y el bloqueo no
    // se activaba). Y el bloqueo se decide con el valor ya incrementado.
    const { portal_intentos_fallidos: intentos } = await db
      .prepare(
        `UPDATE clientes_empresa SET portal_intentos_fallidos = portal_intentos_fallidos + 1
         WHERE id = ? RETURNING portal_intentos_fallidos`
      )
      .get(cliente.id);
    if (intentos >= config.login.maxIntentos) {
      await db
        .prepare(
          `UPDATE clientes_empresa SET portal_bloqueado_hasta = LOCALTIMESTAMP + (?::int * INTERVAL '1 minute') WHERE id = ?`
        )
        .run(config.login.bloqueoMinutos, cliente.id);
      throw new AuthError(
        `Acceso bloqueado por ${config.login.maxIntentos} intentos fallidos. Reintentá en ${config.login.bloqueoMinutos} minutos.`,
        'USUARIO_BLOQUEADO'
      );
    }
    throw new AuthError('Usuario o contraseña incorrectos', 'CREDENCIALES_INVALIDAS');
  }

  await db
    .prepare(
      `UPDATE clientes_empresa
       SET portal_intentos_fallidos = 0, portal_bloqueado_hasta = NULL, portal_ultimo_acceso = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(cliente.id);

  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sesiones_cliente (cliente_empresa_id, token) VALUES (?, ?)').run(cliente.id, token);

  return { token, cliente: { id: cliente.id, razon_social: cliente.razon_social } };
}

// Sesión válida = activa, sin vencer por inactividad, y el cliente sigue
// existiendo y habilitado (dar de baja o deshabilitar corta el acceso en el
// acto, sin esperar a que venza la sesión). Fechas comparadas en la base, igual
// que session.service.
export function obtenerSesionClienteValida(token) {
  return db
    .prepare(
      `SELECT sc.id AS sesion_id, c.id AS cliente_id, c.razon_social
       FROM sesiones_cliente sc
       JOIN clientes_empresa c ON c.id = sc.cliente_empresa_id
       WHERE sc.token = ? AND sc.estado = 'activa'
         AND sc.ultima_actividad >= LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')
         AND c.eliminado_en IS NULL AND c.portal_habilitado = 1`
    )
    .get(token, config.session.timeoutMinutes);
}

export async function marcarActividadCliente(sesionId) {
  await db.prepare('UPDATE sesiones_cliente SET ultima_actividad = CURRENT_TIMESTAMP WHERE id = ?').run(sesionId);
}

export async function cerrarSesionCliente(sesionId, motivo = 'logout') {
  await db
    .prepare(
      `UPDATE sesiones_cliente SET estado = 'cerrada', motivo_cierre = ?, cerrada_en = CURRENT_TIMESTAMP
       WHERE id = ? AND estado = 'activa'`
    )
    .run(motivo, sesionId);
}

export async function cerrarSesionesDeCliente(clienteEmpresaId, motivo) {
  await db
    .prepare(
      `UPDATE sesiones_cliente SET estado = 'cerrada', motivo_cierre = ?, cerrada_en = CURRENT_TIMESTAMP
       WHERE cliente_empresa_id = ? AND estado = 'activa'`
    )
    .run(motivo, clienteEmpresaId);
}

// Housekeeping: deja prolijo el historial (motivo 'timeout'); no es lo que
// bloquea el acceso, eso ya lo hace obtenerSesionClienteValida en cada request.
export async function cerrarSesionesClienteInactivas() {
  const resultado = await db
    .prepare(
      `UPDATE sesiones_cliente SET estado = 'cerrada', motivo_cierre = 'timeout', cerrada_en = CURRENT_TIMESTAMP
       WHERE estado = 'activa' AND ultima_actividad < LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')`
    )
    .run(config.session.timeoutMinutes);
  return resultado.changes;
}
