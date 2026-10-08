import rateLimit from 'express-rate-limit';

// Intentos fallidos de ingreso por IP (regla del usuario, 2026-10-08): 20 fallidos en 15 min
// desde la misma IP y esa IP tiene que esperar (hasta 15 min) para volver a intentar. Siempre
// igual, sin escalar. Un solo contador para todos los ingresos: negocio y superadmin
// (/auth/login), código por mail (/auth/codigo) y portal del cliente (/portal/login).
//
// Pensado para no dejar afuera nunca a una empresa cliente (muchas no tienen IP fija y varios
// empleados, o un proveedor de internet con CGNAT, comparten la misma IP pública):
//  * los ingresos correctos no cuentan: una oficina con muchos empleados no llega al tope;
//  * los errores del servidor (5xx, ej. falta el correo) tampoco: no son culpa del que entra;
//  * solo frena el ingreso: quien ya tiene sesión sigue trabajando.
// Aparte, cada cuenta se bloquea sola a los 5 intentos fallidos (15 min).
export const MAX_INGRESOS_FALLIDOS = 20;
export const MINUTOS_ESPERA_INGRESO = 15;

export const ingresoLimiter = rateLimit({
  windowMs: MINUTOS_ESPERA_INGRESO * 60 * 1000,
  max: MAX_INGRESOS_FALLIDOS,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode < 400 || res.statusCode >= 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: `Demasiados intentos fallidos desde esta conexión. Esperá unos minutos (hasta ${MINUTOS_ESPERA_INGRESO}) y volvé a intentar.`,
  },
});
