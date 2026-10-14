// Modo mantenimiento: mientras se restaura una copia, nadie del negocio ni del portal usa el sistema
// (responde 503) y las tareas periódicas no escriben. Solo el panel /sa sigue andando, para seguir el
// avance. Vive en memoria a propósito: si el servidor se reinicia, nunca queda trabado en
// mantenimiento (y la restauración cortada se deshace sola, ver restauracion.service.js).

const MENSAJE = 'El sistema está en mantenimiento por unos minutos. Probá de nuevo en un rato.';

let desde = null;

export const enMantenimiento = () => desde !== null;

export function entrarEnMantenimiento() {
  desde = new Date();
  console.warn('[mantenimiento] el sistema entra en mantenimiento');
}

export function salirDeMantenimiento() {
  if (!desde) return;
  desde = null;
  console.warn('[mantenimiento] el sistema vuelve a estar disponible');
}

// Va después de la defensa por IP: todo /api salvo el panel del superadmin y el estado del servidor.
export function mantenimientoMiddleware(req, res, next) {
  if (!desde || !req.path.startsWith('/api/') || req.path.startsWith('/api/sa/') || req.path === '/api/health') return next();
  res.set('Retry-After', '120').status(503).json({ error: MENSAJE, codigo: 'MANTENIMIENTO' });
}
