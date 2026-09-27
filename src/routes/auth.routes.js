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

// El login es alcanzable desde toda la red local, no solo desde dispositivos
// "de confianza" -- rate limit por IP ademas del bloqueo por usuario que ya
// aplica auth.service (defensa en dos capas contra fuerza bruta).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login, esperá unos minutos.' },
});

// loginController es async: en Express 4 un reject sin capturar tumba el
// proceso (unhandled promise rejection) en vez de terminar en errorHandler
// -- ver src/utils/async-handler.js. logoutController y meController son
// sync (no `async function`), asi que un throw ahi ya lo captura Express 4
// en su try/catch interno de handlers sincronos; no necesitan el wrapper.
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
