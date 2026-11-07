import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  activarFijoController,
  crearFijoController,
  editarFijoController,
  eliminarFijoController,
  listarFijosController,
  obtenerFijoController,
  pausarFijoController,
} from '../controllers/fijos.controller.js';

const router = Router();

// Fijos (2026-11-06): Administrador y Encargado, igual que Saldos pendientes. El Cajero no lo ve.
const ROLES = ['admin', 'encargado'];

router.get('/', requireAuth(ROLES), listarFijosController);
router.post('/', requireAuth(ROLES), crearFijoController);
router.get('/:id', requireAuth(ROLES), obtenerFijoController);
router.patch('/:id', requireAuth(ROLES), editarFijoController);
router.post('/:id/pausar', requireAuth(ROLES), pausarFijoController);
router.post('/:id/activar', requireAuth(ROLES), activarFijoController);
router.delete('/:id', requireAuth(ROLES), eliminarFijoController);

export default router;
