import { marcarActividadCliente, obtenerSesionClienteValida } from '../services/clientes-portal.service.js';

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
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }

  await marcarActividadCliente(sesion.sesion_id);
  req.cliente = { id: sesion.cliente_id, razon_social: sesion.razon_social, sesionId: sesion.sesion_id };
  next();
}
