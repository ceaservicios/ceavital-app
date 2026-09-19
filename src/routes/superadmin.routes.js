import { Router } from 'express';
import {
  accionesSuperadminController,
  cambiarPlanSuperadminController,
  correoPruebaSuperadminController,
  empresaEmailSuperadminController,
  fijarCuotaSuperadminController,
  logoutSuperadminController,
  meSuperadminController,
  panelSuperadminController,
  reactivarSuperadminController,
  suspenderSuperadminController,
} from '../controllers/superadmin.controller.js';
import { requireSuperadmin } from '../middleware/superadmin-auth.middleware.js';

const router = Router();

// Nada de lo que sale de /sa se guarda en cachés compartidas ni del navegador.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// El ingreso del superadmin es el mismo de la app (POST /api/auth/login, ver auth.controller).
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
