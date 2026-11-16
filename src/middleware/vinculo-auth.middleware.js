import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import config from '../config/env.js';
import { ipDe, rutaApiInexistente } from '../services/defensa-ip.service.js';

// Consulta de CEA Servicios - Gestión (GET /api/vinculo/estado): sin sesión ni cookie, solo el token
// de VINCULO_GESTION_TOKEN en `Authorization: Bearer <token>`. Sin token configurado la ruta no existe
// (404, y cuenta como ruta inexistente para la defensa por IP).

export const TOKEN_MINIMO = 32;
export const vinculoDisponible = () => config.vinculo.token.length >= TOKEN_MINIMO;

const huella = (texto) => crypto.createHash('sha256').update(texto).digest();

// Se comparan los hashes en tiempo constante: no se filtra ni el largo ni dónde difiere.
export function tokenValido(cabecera) {
  const m = /^Bearer ([\x21-\x7e]{1,200})$/.exec(cabecera ?? '');
  return Boolean(m) && crypto.timingSafeEqual(huella(m[1]), huella(config.vinculo.token));
}

export function soloConVinculo(req, res, next) {
  if (!vinculoDisponible()) return rutaApiInexistente(req, res);
  next();
}

// Gestión consulta una vez por día y cuando se abre su pantalla de sistemas: 30 cada 15 min sobran.
export const vinculoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas desde esta conexión. Esperá unos minutos.' },
});

export function exigirTokenVinculo(req, res, next) {
  if (tokenValido(req.get('authorization'))) return next();
  console.warn(`[vinculo] consulta con un token inválido desde ${ipDe(req)}`);
  res.status(401).json({ error: 'No autorizado' });
}
