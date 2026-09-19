import config from '../config/env.js';
import { login as loginService, logout as logoutService } from '../services/auth.service.js';
import { esUsuarioSuperadmin } from '../services/superadmin.service.js';
import { loginSuperadminController } from './superadmin.controller.js';

export async function loginController(req, res) {
  const { usuario, password } = req.body || {};

  if (!usuario || typeof usuario !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  // Un solo ingreso para todos: el usuario del superadmin entra al panel de CEA (cookie y
  // sesión propias); cualquier otro entra al sistema del negocio.
  if (await esUsuarioSuperadmin(usuario.trim())) return loginSuperadminController(req, res);

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
