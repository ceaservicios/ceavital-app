import { confirmarIngreso, login as loginService, logout as logoutService } from '../services/auth.service.js';
import { reenviarCodigo } from '../services/codigo-ingreso.service.js';
import { esUsuarioSuperadmin } from '../services/superadmin.service.js';
import { loginSuperadminController, responderSesionSuperadmin } from './superadmin.controller.js';
import { pareceCodigoRecuperacion } from '../utils/dosfa.js';
import { responderSegundoPaso } from './segundo-paso.js';
import { actorDeSesion, actorDeSuperadmin, registrarAccion } from '../services/registro.service.js';
import { fijarCookieSesion } from '../middleware/auth.middleware.js';

// Ingreso al registro de acciones (EST-01 §6). segundoPaso: 'app' | 'mail' | 'recuperacion' | null.
function registrarIngreso(req, actor, resultado, segundoPaso) {
  return registrarAccion('ingreso', {
    actor,
    ip: req.ip,
    detalle: { segundo_paso: segundoPaso, sesion_anterior_cerrada: Boolean(resultado.expulsada) },
  });
}

const actorDeUsuario = (u) => ({ tipo: 'usuario', id: u.id, nombre: u.usuario, rol: u.rol });

// Identificador del navegador para la verificación en dos pasos (una vez por semana). Solo viaja
// a /api/auth (donde se ingresa); la confianza real (por cuenta) vive en la base, no en la cookie.
const OPCIONES_DISPOSITIVO = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: 365 * 24 * 60 * 60 * 1000,
};

function responderSesion(res, resultado) {
  fijarCookieSesion(res, resultado.token);
  res.json({ usuario: resultado.usuario, expulsoSesionAnterior: resultado.expulsada });
}

export async function loginController(req, res) {
  const { usuario, password } = req.body || {};

  if (!usuario || typeof usuario !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  // Un solo ingreso para todos: el mail del superadmin entra al panel de CEA (cookie y sesión
  // propias); cualquier otro entra al sistema del negocio.
  if (await esUsuarioSuperadmin(usuario.trim())) return loginSuperadminController(req, res);

  try {
    const resultado = await loginService(usuario, password, { dispositivo: req.cookies?.dispositivo });
    if (resultado.requiereCodigo) return responderSegundoPaso(res, resultado);
    await registrarIngreso(req, actorDeUsuario(resultado.usuario), resultado, null);
    responderSesion(res, resultado);
  } catch (err) {
    if (err.codigo === 'USUARIO_BLOQUEADO') {
      if (err.recienBloqueado) {
        await registrarAccion('cuenta-bloqueada', { actor: err.cuenta, ip: req.ip, detalle: { cuenta: err.cuenta.nombre } });
      }
      return res.status(423).json({ error: err.message });
    }
    if (err.codigo === 'CREDENCIALES_INVALIDAS') {
      return res.status(401).json({ error: err.message });
    }
    throw err;
  }
}

function leerDesafio(req, res) {
  const { desafio } = req.body || {};
  if (typeof desafio !== 'string' || !/^[0-9a-f]{64}$/.test(desafio)) {
    res.status(400).json({ error: 'El ingreso no es válido. Volvé a ingresar con tu contraseña.' });
    return null;
  }
  return desafio;
}

export async function codigoController(req, res) {
  const desafio = leerDesafio(req, res);
  if (!desafio) return;
  const codigo = typeof req.body.codigo === 'string' ? req.body.codigo.trim() : '';
  // 6 números (mail o app) o un código de recuperación (XXXXX-XXXXX, solo con la app).
  if (!/^\d{6}$/.test(codigo) && !pareceCodigoRecuperacion(codigo)) {
    return res.status(400).json({ error: 'Ingresá el código de 6 números' });
  }

  const resultado = await confirmarIngreso(desafio, codigo, { dispositivo: req.cookies?.dispositivo });
  if (resultado.dispositivo) res.cookie('dispositivo', resultado.dispositivo, OPCIONES_DISPOSITIVO);
  if (resultado.tipo === 'superadmin') {
    await registrarIngreso(req, actorDeSuperadmin(resultado.superadmin), resultado, resultado.segundoPaso);
    return responderSesionSuperadmin(res, resultado);
  }
  await registrarIngreso(req, actorDeUsuario(resultado.usuario), resultado, resultado.segundoPaso);
  responderSesion(res, resultado);
}

export async function reenviarCodigoController(req, res) {
  const desafio = leerDesafio(req, res);
  if (!desafio) return;
  res.json(await reenviarCodigo(desafio));
}

export async function logoutController(req, res) {
  await logoutService(req.sesion.id);
  await registrarAccion('salida', { actor: actorDeSesion(req.sesion), ip: req.ip });
  res.clearCookie('sesion_token');
  res.json({ ok: true });
}

export async function meController(req, res) {
  res.json({
    usuarioId: req.sesion.usuario_id,
    usuario: req.sesion.usuario,
    nombre: req.sesion.nombre,
    rol: req.sesion.rol,
    pendiente: req.sesion.pendiente,
  });
}
