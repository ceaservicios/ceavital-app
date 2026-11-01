import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  agregarProductoController,
  cambiarPrecioCantidadController,
  crearGrupoController,
  eliminarGrupoController,
  listarGruposController,
  renombrarGrupoController,
  sacarProductoController,
} from '../controllers/grupos-promocion.controller.js';

const router = Router();

// Grupos de promoción (2026-11-01): los arma, cambia y borra solo el Administrador (decisión del
// usuario), en Configuración → Promociones. Caja y el portal reciben el grupo de cada producto con
// la lista de productos; no necesitan esto.
router.get('/', requireAuth(['admin']), listarGruposController);
router.post('/', requireAuth(['admin']), crearGrupoController);
router.patch('/:id', requireAuth(['admin']), renombrarGrupoController);
router.delete('/:id', requireAuth(['admin']), eliminarGrupoController);
router.put('/:id/productos/:productoId', requireAuth(['admin']), agregarProductoController);
// El precio por cantidad de un producto del grupo, cambiado desde el grupo (el mismo dato de su ficha).
router.put('/:id/productos/:productoId/precio-cantidad', requireAuth(['admin']), cambiarPrecioCantidadController);
router.delete('/:id/productos/:productoId', requireAuth(['admin']), sacarProductoController);

export default router;
