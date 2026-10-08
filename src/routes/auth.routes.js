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
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();

// El login es alcanzable desde cualquier lugar de internet (el sistema es online) --
// rate limit por IP ademas del bloqueo por usuario que ya aplica auth.service
// (defensa en dos capas contra fuerza bruta).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login, esperá unos minutos.' },
});

// Todos los controladores de auth son async: en Express 4 un reject sin capturar no
// llega solo a errorHandler. Los de login y código van con asyncHandler
// (src/utils/async-handler.js); logoutController y meController no lo necesitan
// porque express-async-errors (importado al inicio de server.js) ya pasa sus rejects
// a errorHandler.

// Código de ingreso por mail (verificar el email la primera vez, o 2FA): además de los 5
// intentos por código que controla el servicio, un tope por IP.
const codigoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos, esperá unos minutos.' },
});

router.post('/login', loginLimiter, asyncHandler(loginController));
router.post('/codigo', codigoLimiter, asyncHandler(codigoController));
router.post('/codigo/reenviar', codigoLimiter, asyncHandler(reenviarCodigoController));
router.post('/logout', requireAuth(), logoutController);
router.get('/me', requireAuth(), meController);

export default router;
