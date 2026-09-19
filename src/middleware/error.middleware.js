import { ApiError } from '../utils/api-error.js';

export function errorHandler(err, req, res, next) {
  console.error(err);

  // Respetar el status que ya trae el error (ej. body-parser de Express
  // devuelve err.status = 400 ante JSON malformado) en vez de aplanar todo
  // a 500. Para errores 4xx el mensaje del propio err es seguro de exponer
  // (son errores de input del cliente); para 5xx nunca se expone err.message
  // para no filtrar detalles internos.
  const status = err.status || err.statusCode || 500;
  // ApiError = error que el propio código lanzó a propósito con un mensaje pensado
  // para el usuario (ej. 503 "el envío de mails no está configurado"); esos se
  // exponen aunque sean 5xx. Cualquier otro 5xx (una excepción inesperada) nunca.
  const mensaje = (status >= 400 && status < 500) || err instanceof ApiError ? err.message : 'Error interno del servidor';

  res.status(status).json({ error: mensaje || 'Error interno del servidor' });
}
