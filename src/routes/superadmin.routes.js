import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  accionesSuperadminController,
  cambiarPlanSuperadminController,
  correoPruebaSuperadminController,
  empresaEmailSuperadminController,
  fijarCuotaSuperadminController,
  loginSuperadminController,
  logoutSuperadminController,
  meSuperadminController,
  panelSuperadminController,
  reactivarSuperadminController,
  suspenderSuperadminController,
} from '../controllers/superadmin.controller.js';
import { origenPermitido, requireSuperadmin } from '../middleware/superadmin-auth.middleware.js';

const router = Router();

// Nada de lo que sale de /sa se guarda en cachés compartidas ni del navegador.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Alcanzable desde internet: tope por IP además del bloqueo por cuenta del servicio.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de ingreso, esperá unos minutos.' },
});

router.post(
  '/login',
  loginLimiter,
  (req, res, next) => (origenPermitido(req) ? next() : res.status(403).json({ error: 'Pedido no autorizado' })),
  loginSuperadminController
);

router.use(requireSuperadmin);
router.post('/logout', logoutSuperadminController);
router.get('/me', meSuperadminController);
router.get('/panel', panelSuperadminController);
router.get('/acciones', accionesSuperadminController);
router.put('/plan', cambiarPlanSuperadminController);
router.put('/cuota', fijarCuotaSuperadminController);
router.put('/empresa-email', empresaEmailSuperadminController);
router.post('/correo-prueba', correoPruebaSuperadminController);
router.post('/suspender', suspenderSuperadminController);
router.post('/reactivar', reactivarSuperadminController);

export default router;
