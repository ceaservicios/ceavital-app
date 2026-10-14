import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  cambiarPasswordController,
  confirmarAppController,
  confirmarMailController,
  iniciarAppController,
  iniciarMailController,
  regenerarCodigosController,
  verCuentaController,
} from '../controllers/cuenta.controller.js';

const router = Router();

// "Mi cuenta": la usa también quien tiene algo pendiente (contraseña provisoria, Admin sin 2FA),
// que no puede entrar a ninguna otra pantalla hasta resolverlo (auth.middleware).
const conPendiente = { permitirPendiente: true };

// Las acciones que comprueban la contraseña o mandan mails: tope por IP, además de los propios.
const cuentaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos, esperá unos minutos.' },
});

router.get('/', requireAuth(null, conPendiente), verCuentaController);
router.post('/password', cuentaLimiter, requireAuth(null, conPendiente), cambiarPasswordController);

// Verificación en dos pasos propia: solo el Admin (obligatoria para él, EST-01 §4).
router.post('/2fa/app/iniciar', cuentaLimiter, requireAuth(['admin'], conPendiente), iniciarAppController);
router.post('/2fa/app/confirmar', cuentaLimiter, requireAuth(['admin'], conPendiente), confirmarAppController);
router.post('/2fa/mail/iniciar', cuentaLimiter, requireAuth(['admin'], conPendiente), iniciarMailController);
router.post('/2fa/mail/confirmar', cuentaLimiter, requireAuth(['admin'], conPendiente), confirmarMailController);
router.post('/2fa/codigos', cuentaLimiter, requireAuth(['admin'], conPendiente), regenerarCodigosController);

export default router;
