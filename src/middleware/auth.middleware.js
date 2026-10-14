import config from '../config/env.js';
import { obtenerSesionActivaValida, marcarActividad, pendienteDeCuenta } from '../services/session.service.js';

// Cookie de la sesión del negocio: la fija el ingreso (auth.controller) y la renueva cada uso
// (requireAuth), para que el navegador no la borre a las 8 h del ingreso si se sigue usando.
const OPCIONES_COOKIE_SESION = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: config.session.timeoutMinutes * 60 * 1000,
};

export function fijarCookieSesion(res, token) {
  res.cookie('sesion_token', token, OPCIONES_COOKIE_SESION);
}

const MENSAJE_PENDIENTE = {
  password: 'Antes de seguir tenés que elegir una contraseña nueva (la que tenés es provisoria).',
  dosfa: 'Antes de seguir tenés que activar la verificación en dos pasos.',
};

/**
 * Exige sesion valida (cookie httpOnly). Si se pasan rolesPermitidos, ademas
 * exige que el rol de la sesion este en esa lista (control de acceso por rol).
 * Una cuenta con algo pendiente (contraseña provisoria, Admin sin 2FA) solo pasa por las
 * rutas marcadas con permitirPendiente (ingreso, "Mi cuenta"): el resto responde 403.
 */
export function requireAuth(rolesPermitidos = null, { permitirPendiente = false } = {}) {
  return async (req, res, next) => {
    const token = req.cookies?.sesion_token;

    if (!token) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const sesion = await obtenerSesionActivaValida(token);

    if (!sesion) {
      res.clearCookie('sesion_token');
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    if (rolesPermitidos && !rolesPermitidos.includes(sesion.rol)) {
      return res.status(403).json({ error: 'No autorizado para este rol' });
    }

    const pendiente = pendienteDeCuenta(sesion);
    if (pendiente && !permitirPendiente) {
      return res.status(403).json({ error: MENSAJE_PENDIENTE[pendiente], codigo: 'CUENTA_PENDIENTE', pendiente });
    }

    await marcarActividad(sesion.id);
    // EST-01 §3: Encargado y Cajero, 8 h sin uso (la cookie acompaña a la sesión); la del Admin
    // vence a las 8 h del ingreso aunque se use, así que su cookie no se renueva.
    if (sesion.rol !== 'admin') fijarCookieSesion(res, token);
    req.sesion = { ...sesion, pendiente };
    next();
  };
}
