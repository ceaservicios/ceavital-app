import crypto from 'node:crypto';
import { marcarActividadSuperadmin, obtenerSesionSuperadminValida } from '../services/superadmin.service.js';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Un pedido que modifica algo tiene que venir del propio sitio: si trae Origin, su host
// tiene que ser el mismo al que se le pidió (detrás del proxy de Easypanel `trust proxy`
// hace que req.get('host') sea el dominio real). Defensa en profundidad además del
// token CSRF y de la cookie SameSite=Strict.
export function origenPermitido(req) {
  const origen = req.get('origin');
  if (!origen) return true;
  try {
    return new URL(origen).host === req.get('host');
  } catch {
    return false;
  }
}

function tokensIguales(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Exige sesión de SUPERADMIN válida (cookie propia `sa_token`, tabla propia) y, en todo
// pedido que modifica algo, el token CSRF de esa sesión en el encabezado X-CSRF-Token.
// Ninguna otra sesión (negocio, cliente) pasa por acá.
export async function requireSuperadmin(req, res, next) {
  const token = req.cookies?.sa_token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  const sesion = await obtenerSesionSuperadminValida(token);
  if (!sesion) {
    res.clearCookie('sa_token', { path: '/api/sa' });
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }

  if (!METODOS_SEGUROS.has(req.method)) {
    if (!origenPermitido(req) || !tokensIguales(req.get('x-csrf-token'), sesion.csrf_token)) {
      return res.status(403).json({ error: 'Pedido no autorizado (falta el token de seguridad). Recargá la página.' });
    }
  }

  await marcarActividadSuperadmin(sesion.sesion_id);
  req.superadmin = { id: sesion.superadmin_id, usuario: sesion.usuario, sesionId: sesion.sesion_id, csrfToken: sesion.csrf_token };
  next();
}
