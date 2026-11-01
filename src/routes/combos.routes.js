import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  agregarMarcaController,
  agregarRenglonController,
  crearComboController,
  editarComboController,
  editarRenglonController,
  eliminarComboController,
  listarCombosController,
  sacarMarcaController,
  sacarRenglonController,
} from '../controllers/combos.controller.js';

const router = Router();

// Combos (2026-11-01): los ven los tres roles (Caja los necesita para mostrar el total antes de
// cobrar); los arma, cambia y borra solo el Administrador, en Configuración → Promociones. Cada combo
// lleva renglones, y cada renglón las marcas que valen.
router.get('/', requireAuth(), listarCombosController);
router.post('/', requireAuth(['admin']), crearComboController);
router.patch('/:id', requireAuth(['admin']), editarComboController);
router.delete('/:id', requireAuth(['admin']), eliminarComboController);
router.post('/:id/renglones', requireAuth(['admin']), agregarRenglonController);
router.patch('/:id/renglones/:renglonId', requireAuth(['admin']), editarRenglonController);
router.delete('/:id/renglones/:renglonId', requireAuth(['admin']), sacarRenglonController);
router.put('/:id/renglones/:renglonId/productos/:productoId', requireAuth(['admin']), agregarMarcaController);
router.delete('/:id/renglones/:renglonId/productos/:productoId', requireAuth(['admin']), sacarMarcaController);

export default router;
