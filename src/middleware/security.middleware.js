import helmet from 'helmet';
import cors from 'cors';
import config from '../config/env.js';

export const helmetMiddleware = helmet();

/**
 * En produccion el mismo Express sirve el frontend (mismo origen) y no hace
 * falta CORS. En desarrollo, si ALLOWED_ORIGINS esta configurado en .env, se
 * habilita CORS solo para esos origenes (con credenciales, por la cookie de
 * sesion). Sin configurar, no se agrega CORS -- nunca "*" con credentials,
 * eso anularia la proteccion de same-origin.
 */
export function buildCorsMiddleware() {
  if (config.allowedOrigins.length === 0) {
    return (req, res, next) => next();
  }

  return cors({
    origin: config.allowedOrigins,
    credentials: true,
  });
}
