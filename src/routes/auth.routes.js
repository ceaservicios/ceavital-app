import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  codigoController,
  loginController,
  logoutController,
  meController,
  reenviarCodigoController,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { ingresoLimiter } from '../middleware/ingreso-limiter.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();

// El login y el código por mail son alcanzables desde cualquier lugar de internet (el
// sistema es online): además del bloqueo por cuenta (5 intentos, 15 min) que aplican
// auth.service y codigo-ingreso.service, el tope de intentos FALLIDOS por IP compartido
// con el portal (ingreso-limiter.middleware.js: 20 en 15 min).

// Todos los controladores de auth son async: en Express 4 un reject sin capturar no
// llega solo a errorHandler. Los de login y código van con asyncHandler
// (src/utils/async-handler.js); logoutController y meController no lo necesitan
// porque express-async-errors (importado al inicio de server.js) ya pasa sus rejects
// a errorHandler.

// Reenviar el código no es un intento de ingreso (cada desafío ya tiene sus topes: 5 envíos,
// uno por minuto): solo un tope por IP para que no se use para mandar mails sin fin.
const reenvioLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos de código, esperá unos minutos.' },
});

router.post('/login', ingresoLimiter, asyncHandler(loginController));
router.post('/codigo', ingresoLimiter, asyncHandler(codigoController));
router.post('/codigo/reenviar', reenvioLimiter, asyncHandler(reenviarCodigoController));
router.post('/logout', requireAuth(), logoutController);
router.get('/me', requireAuth(), meController);

export default router;
