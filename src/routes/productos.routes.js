import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  crearProductoController,
  editarProductoController,
  eliminarProductoController,
  listarProductosController,
  obtenerProductoController,
  pasarAPackController,
} from '../controllers/productos.controller.js';
import {
  crearLoteController,
  editarLoteController,
  eliminarLoteController,
} from '../controllers/lotes.controller.js';

const router = Router();

// Stock -- Ver (producto y precio de venta): todos los roles autenticados.
// El costo se oculta a nivel de servicio para no-admin, no a nivel de ruta.
router.get('/', requireAuth(), listarProductosController);
router.get('/:id', requireAuth(), obtenerProductoController);

// Stock -- Editar (alta, lotes, ajustes): Admin + Encargado.
router.post('/', requireAuth(['admin', 'encargado']), crearProductoController);
router.patch('/:id', requireAuth(['admin', 'encargado']), editarProductoController);

// Pasar un producto cargado con un envase como unidad ("Caja x 12") a unidad suelta + pack:
// convierte stock, precios y líneas viejas. Exclusivo Admin (son precios).
router.post('/:id/pasar-a-pack', requireAuth(['admin']), pasarAPackController);

// Stock -- Eliminar productos: exclusivo Admin.
router.delete('/:id', requireAuth(['admin']), eliminarProductoController);

router.post('/:id/lotes', requireAuth(['admin', 'encargado']), crearLoteController);
// Corregir un lote ya cargado: solo el Administrador (pedido del usuario, 2026-10-31).
router.patch('/:id/lotes/:loteId', requireAuth(['admin']), editarLoteController);
router.delete('/:id/lotes/:loteId', requireAuth(['admin', 'encargado']), eliminarLoteController);

export default router;
