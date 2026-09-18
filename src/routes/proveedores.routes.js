import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  crearPedidoController,
  crearProveedorController,
  editarPedidoController,
  editarProveedorController,
  eliminarPedidoController,
  eliminarProveedorController,
  listarPedidosController,
  listarProveedoresController,
  obtenerPedidoController,
  obtenerProveedorController,
} from '../controllers/proveedores.controller.js';

const router = Router();

// Proveedores -- Ver / Editar (+ pedidos): Admin + Encargado. A diferencia de
// Stock/Ventas/Vencimientos, el Cajero no tiene ningún check en este módulo
// (Docs/Instructivo-Funcional.md > Roles y permisos) -- ni siquiera "Ver".
router.get('/', requireAuth(['admin', 'encargado']), listarProveedoresController);
router.get('/:id', requireAuth(['admin', 'encargado']), obtenerProveedorController);
router.post('/', requireAuth(['admin', 'encargado']), crearProveedorController);
router.patch('/:id', requireAuth(['admin', 'encargado']), editarProveedorController);

// Proveedores -- Eliminar: exclusivo Admin.
router.delete('/:id', requireAuth(['admin']), eliminarProveedorController);

router.get('/:id/pedidos', requireAuth(['admin', 'encargado']), listarPedidosController);
router.get('/:id/pedidos/:pedidoId', requireAuth(['admin', 'encargado']), obtenerPedidoController);
router.post('/:id/pedidos', requireAuth(['admin', 'encargado']), crearPedidoController);
router.patch('/:id/pedidos/:pedidoId', requireAuth(['admin', 'encargado']), editarPedidoController);
router.delete('/:id/pedidos/:pedidoId', requireAuth(['admin', 'encargado']), eliminarPedidoController);

export default router;
