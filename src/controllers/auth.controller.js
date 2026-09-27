import config from '../config/env.js';
import { confirmarIngreso, login as loginService, logout as logoutService } from '../services/auth.service.js';
import { reenviarCodigo } from '../services/codigo-ingreso.service.js';
import { esUsuarioSuperadmin } from '../services/superadmin.service.js';
import { loginSuperadminController } from './superadmin.controller.js';

const OPCIONES_SESION = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: config.session.timeoutMinutes * 60 * 1000,
};

// Identificador del navegador para el 2FA de una vez por día. Solo viaja a /api/auth (donde
// se ingresa); la confianza real (24 h por usuario) vive en la base, no en la cookie.
const OPCIONES_DISPOSITIVO = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: 365 * 24 * 60 * 60 * 1000,
};

function responderSesion(res, resultado) {
  res.cookie('sesion_token', resultado.token, OPCIONES_SESION);
  res.json({ usuario: resultado.usuario, expulsoSesionAnterior: resultado.expulsada });
}

export async function loginController(req, res) {
  const { usuario, password } = req.body || {};

  if (!usuario || typeof usuario !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  // Un solo ingreso para todos: el usuario del superadmin entra al panel de CEA (cookie y
  // sesión propias); cualquier otro entra al sistema del negocio.
  if (await esUsuarioSuperadmin(usuario.trim())) return loginSuperadminController(req, res);

  try {
    const resultado = await loginService(usuario, password, { dispositivo: req.cookies?.dispositivo });
    if (resultado.requiereCodigo) {
      // Contraseña correcta, pero falta el código que se le acaba de mandar por mail.
      res.set('Cache-Control', 'no-store');
      return res.json({ requiere_codigo: true, desafio: resultado.desafio, email: resultado.email });
    }
    responderSesion(res, resultado);
  } catch (err) {
    if (err.codigo === 'USUARIO_BLOQUEADO') {
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
  if (!/^\d{6}$/.test(codigo)) return res.status(400).json({ error: 'Ingresá el código de 6 números que te llegó por mail' });

  const resultado = await confirmarIngreso(desafio, codigo, { dispositivo: req.cookies?.dispositivo });
  if (resultado.dispositivo) res.cookie('dispositivo', resultado.dispositivo, OPCIONES_DISPOSITIVO);
  responderSesion(res, resultado);
}

export async function reenviarCodigoController(req, res) {
  const desafio = leerDesafio(req, res);
  if (!desafio) return;
  res.json(await reenviarCodigo(desafio));
}

export async function logoutController(req, res) {
  await logoutService(req.sesion.id);
  res.clearCookie('sesion_token');
  res.json({ ok: true });
}

export async function meController(req, res) {
  res.json({
    usuarioId: req.sesion.usuario_id,
    usuario: req.sesion.usuario,
    nombre: req.sesion.nombre,
    rol: req.sesion.rol,
  });
}
