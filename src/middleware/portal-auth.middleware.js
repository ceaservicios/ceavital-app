import config from '../config/env.js';
import { cerradaPorOtroEquipo, marcarActividadCliente, obtenerSesionClienteValida } from '../services/clientes-portal.service.js';

// Cookie de la sesión del portal: la fija el ingreso (portal.controller) y la renueva cada uso
// (requirePortalAuth). La sesión vence a las 8 h sin uso; sin renovar, el navegador borraba la
// cookie a las 8 h del ingreso aunque el cliente la estuviera usando.
const OPCIONES_COOKIE_PORTAL = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: config.session.timeoutMinutes * 60 * 1000,
};

export function fijarCookiePortal(res, token) {
  res.cookie('portal_token', token, OPCIONES_COOKIE_PORTAL);
}

// Exige sesión de CLIENTE válida (cookie propia, distinta de la de los
// usuarios internos). Solo deja el id del cliente autenticado en req.cliente:
// todas las consultas del portal se hacen contra ese id, nunca contra uno que
// venga en la URL, así un cliente no puede pedir la cuenta de otro.
export async function requirePortalAuth(req, res, next) {
  const token = req.cookies?.portal_token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  const sesion = await obtenerSesionClienteValida(token);
  if (!sesion) {
    res.clearCookie('portal_token');
    // Cerrada porque entró un tercer equipo con el mismo usuario: el portal muestra el cartel.
    if (await cerradaPorOtroEquipo(token)) {
      return res.status(401).json({ error: 'Se cerró tu sesión porque se ingresó desde otro equipo.', codigo: 'SESION_OTRO_EQUIPO' });
    }
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }

  await marcarActividadCliente(sesion.sesion_id);
  fijarCookiePortal(res, token);
  req.cliente = { id: sesion.cliente_id, razon_social: sesion.razon_social, sesionId: sesion.sesion_id };
  next();
}
