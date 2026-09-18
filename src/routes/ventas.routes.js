import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  anularVentaController,
  editarMedioPagoController,
  listarVentasController,
  obtenerVentaController,
  registrarVentaController,
} from '../controllers/ventas.controller.js';

const router = Router();

// Ventas -- Ver: todos los roles.
router.get('/', requireAuth(), listarVentasController);
router.get('/:id', requireAuth(), obtenerVentaController);

// Ventas -- Crear (registrar): todos los roles, incluido el Cajero.
router.post('/', requireAuth(), registrarVentaController);

// Ventas -- Editar: Admin + Encargado. Alcance acotado a corregir el medio de
// pago de una venta ya registrada (confirmado con el usuario) -- nunca
// productos/cantidades/stock, eso es exclusivo de anular.
router.patch('/:id', requireAuth(['admin', 'encargado']), editarMedioPagoController);

// Ventas -- Eliminar (anular, reingresa stock): Admin + Encargado. A
// diferencia de Stock, la venta no desaparece (se anula, el registro queda) --
// por eso devuelve la venta actualizada en vez de 204.
router.delete('/:id', requireAuth(['admin', 'encargado']), anularVentaController);

export default router;
