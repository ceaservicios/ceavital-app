import config from '../config/env.js';
import { login as loginService, logout as logoutService } from '../services/auth.service.js';

export async function loginController(req, res) {
  const { usuario, password } = req.body || {};

  if (!usuario || typeof usuario !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  try {
    const resultado = await loginService(usuario, password);

    res.cookie('sesion_token', resultado.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: config.session.timeoutMinutes * 60 * 1000,
    });

    res.json({ usuario: resultado.usuario, expulsoSesionAnterior: resultado.expulsada });
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

export function logoutController(req, res) {
  logoutService(req.sesion.id);
  res.clearCookie('sesion_token');
  res.json({ ok: true });
}

export function meController(req, res) {
  res.json({
    usuarioId: req.sesion.usuario_id,
    usuario: req.sesion.usuario,
    nombre: req.sesion.nombre,
    rol: req.sesion.rol,
  });
}
