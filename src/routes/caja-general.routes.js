import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  anotarMovimientoController,
  anularMovimientoController,
  disponibleController,
  obtenerCajaGeneralController,
} from '../controllers/caja-general.controller.js';

const router = Router();

// Caja general (2026-11-06, decisión del usuario): Administrador y Encargado, el Cajero no. Anular un
// movimiento anotado a mano es solo del Administrador.
const ROLES = ['admin', 'encargado'];

router.get('/', requireAuth(ROLES), obtenerCajaGeneralController);
router.get('/disponible', requireAuth(ROLES), disponibleController);
router.post('/movimientos', requireAuth(ROLES), anotarMovimientoController);
router.post('/movimientos/:id/anular', requireAuth(['admin']), anularMovimientoController);

export default router;
