import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  crearComboController,
  editarComboController,
  eliminarComboController,
  guardarProductoController,
  listarCombosController,
  sacarProductoController,
} from '../controllers/combos.controller.js';

const router = Router();

// Combos (2026-11-01): los ven los tres roles (Caja los necesita para mostrar el total antes de
// cobrar); los arma, cambia y borra solo el Administrador, en Configuración → Promociones.
router.get('/', requireAuth(), listarCombosController);
router.post('/', requireAuth(['admin']), crearComboController);
router.patch('/:id', requireAuth(['admin']), editarComboController);
router.delete('/:id', requireAuth(['admin']), eliminarComboController);
router.put('/:id/productos', requireAuth(['admin']), guardarProductoController);
router.delete('/:id/productos/:itemId', requireAuth(['admin']), sacarProductoController);

export default router;
