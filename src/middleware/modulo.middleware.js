import { moduloActivo } from '../services/modulos.service.js';

// Módulo apagado por el plan de la instalación: la ruta directamente no existe
// (404, no 403 "prohibido"). Va antes de la autenticación a propósito: un módulo
// apagado no debe ni revelar que existe.
export function requireModulo(modulo) {
  return async function (req, res, next) {
    if (!(await moduloActivo(modulo))) return res.status(404).json({ error: 'No encontrado' });
    next();
  };
}
