export function errorHandler(err, req, res, next) {
  console.error(err);

  // Respetar el status que ya trae el error (ej. body-parser de Express
  // devuelve err.status = 400 ante JSON malformado) en vez de aplanar todo
  // a 500. Para errores 4xx el mensaje del propio err es seguro de exponer
  // (son errores de input del cliente); para 5xx nunca se expone err.message
  // para no filtrar detalles internos.
  const status = err.status || err.statusCode || 500;
  const mensaje = status >= 400 && status < 500 ? err.message : 'Error interno del servidor';

  res.status(status).json({ error: mensaje || 'Error interno del servidor' });
}
