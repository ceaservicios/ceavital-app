import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.middleware.js';
import { MENSAJE_DOSFA_DESACTIVADA } from '../services/dosfa.service.js';
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

// Si el superadmin le desactivó la verificación en dos pasos (decisión del usuario, 2026-10-19), no
// la puede configurar. dosfa.service lo vuelve a mirar antes de escribir.
function exigirDosfaHabilitada(req, res, next) {
  if (req.sesion.dosfa_desactivada) return res.status(409).json({ error: MENSAJE_DOSFA_DESACTIVADA });
  next();
}

// Verificación en dos pasos propia: solo el Admin (obligatoria para él, EST-01 §4).
const adminConDosfa = [requireAuth(['admin'], conPendiente), exigirDosfaHabilitada];
router.post('/2fa/app/iniciar', cuentaLimiter, ...adminConDosfa, iniciarAppController);
router.post('/2fa/app/confirmar', cuentaLimiter, ...adminConDosfa, confirmarAppController);
router.post('/2fa/mail/iniciar', cuentaLimiter, ...adminConDosfa, iniciarMailController);
router.post('/2fa/mail/confirmar', cuentaLimiter, ...adminConDosfa, confirmarMailController);
router.post('/2fa/codigos', cuentaLimiter, ...adminConDosfa, regenerarCodigosController);

export default router;
