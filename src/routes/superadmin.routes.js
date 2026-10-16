import { Router } from 'express';
import {
  anularPagoSuperadminController,
  bajaAdministradorController,
  bloquearSuperadminController,
  cambiarPlanSuperadminController,
  confirmarAppSuperadminController,
  confirmarMailSuperadminController,
  copiasDriveSuperadminController,
  copiasSuperadminController,
  correoCanalSuperadminController,
  correoPruebaSuperadminController,
  correoPruebaCanalSuperadminController,
  crearAdministradorController,
  defensaSuperadminController,
  desafioRestauracionSuperadminController,
  desbloquearSuperadminController,
  desbloquearTodasSuperadminController,
  dosfaAdministradorController,
  emailAdministradorController,
  empresaEmailSuperadminController,
  estadoDosfaSuperadminController,
  fijarCuposSuperadminController,
  fijarCuotaSuperadminController,
  iniciarAppSuperadminController,
  iniciarMailSuperadminController,
  logoutSuperadminController,
  meSuperadminController,
  panelSuperadminController,
  passwordAdministradorController,
  reactivarAdministradorController,
  reactivarSuperadminController,
  regenerarCodigosSuperadminController,
  registrarPagoSuperadminController,
  registroSuperadminController,
  respaldarSuperadminController,
  restauracionesSuperadminController,
  restaurarSuperadminController,
  suspenderSuperadminController,
} from '../controllers/superadmin.controller.js';
import { exigirSuperadminListo, requireSuperadmin } from '../middleware/superadmin-auth.middleware.js';

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

// Su verificación en dos pasos: lo único que puede usar mientras no la configuró (EST-01 §4).
router.get('/2fa', estadoDosfaSuperadminController);
router.post('/2fa/app/iniciar', iniciarAppSuperadminController);
router.post('/2fa/app/confirmar', confirmarAppSuperadminController);
router.post('/2fa/mail/iniciar', iniciarMailSuperadminController);
router.post('/2fa/mail/confirmar', confirmarMailSuperadminController);
router.post('/2fa/codigos', regenerarCodigosSuperadminController);

router.use(exigirSuperadminListo);
router.get('/panel', panelSuperadminController);
router.get('/registro', registroSuperadminController);
router.put('/plan', cambiarPlanSuperadminController);
router.put('/cuota', fijarCuotaSuperadminController);
router.put('/empresa-email', empresaEmailSuperadminController);
router.put('/cupos', fijarCuposSuperadminController);
router.post('/correo-prueba', correoPruebaSuperadminController);
router.get('/correo', correoCanalSuperadminController);
router.post('/correo/prueba', correoPruebaCanalSuperadminController);
router.get('/copias', copiasSuperadminController);
router.post('/copias', respaldarSuperadminController);
// Restaurar una copia del Drive sobre la base real: contraseña (desafío) y después código + dominio.
router.get('/copias/drive', copiasDriveSuperadminController);
router.get('/restauraciones', restauracionesSuperadminController);
router.post('/restauraciones/desafio', desafioRestauracionSuperadminController);
router.post('/restauraciones', restaurarSuperadminController);
router.post('/pagos', registrarPagoSuperadminController);
router.post('/pagos/:id/anular', anularPagoSuperadminController);
router.post('/suspender', suspenderSuperadminController);
router.post('/reactivar', reactivarSuperadminController);
router.get('/defensa', defensaSuperadminController);
router.post('/defensa/desbloquear', desbloquearSuperadminController);
router.post('/defensa/desbloquear-todas', desbloquearTodasSuperadminController);
router.post('/defensa/bloquear', bloquearSuperadminController);
// Administradores del negocio: los da de alta, restablece y da de baja solo el superadmin (EST-01 §5).
router.post('/administradores', crearAdministradorController);
router.post('/administradores/:id/password', passwordAdministradorController);
router.post('/administradores/:id/2fa', dosfaAdministradorController);
router.post('/administradores/:id/email', emailAdministradorController);
router.post('/administradores/:id/baja', bajaAdministradorController);
router.post('/administradores/:id/reactivar', reactivarAdministradorController);

export default router;
