import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  cuentaPortalController,
  loginPortalController,
  logoutPortalController,
  resumenPortalController,
} from '../controllers/portal.controller.js';
import { portalDisponible, requirePortalAuth } from '../middleware/portal-auth.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();

// Este login sí es alcanzable desde internet (modalidad online): tope por IP
// además del bloqueo por cliente que ya aplica el servicio.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de ingreso, esperá unos minutos.' },
});

router.use(portalDisponible);

router.post('/login', loginLimiter, asyncHandler(loginPortalController));
router.post('/logout', requirePortalAuth, logoutPortalController);
router.get('/cuenta', requirePortalAuth, cuentaPortalController);
router.get('/resumen', requirePortalAuth, resumenPortalController);

export default router;
