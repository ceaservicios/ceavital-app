import { Router } from 'express';
import {
  anularPagoSuperadminController,
  bloquearSuperadminController,
  cambiarPlanSuperadminController,
  correoPruebaSuperadminController,
  defensaSuperadminController,
  desbloquearSuperadminController,
  desbloquearTodasSuperadminController,
  empresaEmailSuperadminController,
  fijarCuposSuperadminController,
  fijarCuotaSuperadminController,
  logoutSuperadminController,
  meSuperadminController,
  panelSuperadminController,
  reactivarSuperadminController,
  registrarPagoSuperadminController,
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
router.put('/plan', cambiarPlanSuperadminController);
router.put('/cuota', fijarCuotaSuperadminController);
router.put('/empresa-email', empresaEmailSuperadminController);
router.put('/cupos', fijarCuposSuperadminController);
router.post('/correo-prueba', correoPruebaSuperadminController);
router.post('/pagos', registrarPagoSuperadminController);
router.post('/pagos/:id/anular', anularPagoSuperadminController);
router.post('/suspender', suspenderSuperadminController);
router.post('/reactivar', reactivarSuperadminController);
router.get('/defensa', defensaSuperadminController);
router.post('/defensa/desbloquear', desbloquearSuperadminController);
router.post('/defensa/desbloquear-todas', desbloquearTodasSuperadminController);
router.post('/defensa/bloquear', bloquearSuperadminController);

export default router;
