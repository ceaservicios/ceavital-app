import { obtenerSesionActivaValida, marcarActividad } from '../services/session.service.js';

/**
 * Exige sesion valida (cookie httpOnly). Si se pasan rolesPermitidos, ademas
 * exige que el rol de la sesion este en esa lista (control de acceso por rol).
 */
export function requireAuth(rolesPermitidos = null) {
  return (req, res, next) => {
    const token = req.cookies?.sesion_token;

    if (!token) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const sesion = obtenerSesionActivaValida(token);

    if (!sesion) {
      res.clearCookie('sesion_token');
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    if (rolesPermitidos && !rolesPermitidos.includes(sesion.rol)) {
      return res.status(403).json({ error: 'No autorizado para este rol' });
    }

    marcarActividad(sesion.id);
    req.sesion = sesion;
    next();
  };
}
