// Exige que la request venga del mismo equipo que corre el servidor
// (loopback) -- usado por Restaurar backup, la única acción de Configuración
// y Seguridad que el instructivo restringe a "logueado directamente desde la
// PC servidor" (mismo criterio que la recuperación de contraseña de Admin).
// No hay proxy/reverse-proxy delante de este Express (HTTPS directo), así que
// req.ip refleja la IP real de origen sin necesitar "trust proxy".
const IPS_LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function requireLocalhost(req, res, next) {
  if (!IPS_LOOPBACK.has(req.ip)) {
    return res.status(403).json({ error: 'Esta acción solo puede ejecutarse desde la PC servidor' });
  }
  next();
}
