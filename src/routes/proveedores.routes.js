import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  anularCompraController,
  anularPagoController,
  crearCompraController,
  crearProveedorController,
  editarProveedorController,
  eliminarProveedorController,
  listarProveedoresController,
  obtenerProveedorController,
  registrarPagoController,
} from '../controllers/proveedores.controller.js';

const router = Router();

// Proveedores -- Ver / Editar: Admin + Encargado. A diferencia de Stock/Ventas/Vencimientos, el
// Cajero no tiene ningún check en este módulo (Docs/Instructivo-Funcional.md > Roles y
// permisos) -- ni siquiera "Ver".
router.get('/', requireAuth(['admin', 'encargado']), listarProveedoresController);
router.get('/:id', requireAuth(['admin', 'encargado']), obtenerProveedorController);
router.post('/', requireAuth(['admin', 'encargado']), crearProveedorController);
router.patch('/:id', requireAuth(['admin', 'encargado']), editarProveedorController);

// Proveedores -- Eliminar: exclusivo Admin.
router.delete('/:id', requireAuth(['admin']), eliminarProveedorController);

// Mercadería que trajo y pagos (2026-10-28): Admin + Encargado, con importes (decisión del
// usuario). Los pedidos de antes ya no se cargan: se ven en el perfil como historial.
router.post('/:id/compras', requireAuth(['admin', 'encargado']), crearCompraController);
router.post('/:id/compras/:compraId/anular', requireAuth(['admin', 'encargado']), anularCompraController);
router.post('/:id/pagos', requireAuth(['admin', 'encargado']), registrarPagoController);
router.post('/:id/pagos/:pagoId/anular', requireAuth(['admin', 'encargado']), anularPagoController);

export default router;
