import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  aprobarPedidoController,
  listarPedidosController,
  obtenerPedidoController,
  rechazarPedidoController,
} from '../controllers/pedidos-cliente.controller.js';

const router = Router();

// Pedidos de clientes-empresa (B2B Fase 2): ver, aprobar y rechazar = Admin +
// Encargado. El Cajero no tiene acceso (mismo criterio que Clientes-Empresa).
// Los pedidos los crea y cancela el cliente desde el portal (/api/portal).
router.get('/', requireAuth(['admin', 'encargado']), listarPedidosController);
router.get('/:id', requireAuth(['admin', 'encargado']), obtenerPedidoController);
router.post('/:id/aprobar', requireAuth(['admin', 'encargado']), aprobarPedidoController);
router.post('/:id/rechazar', requireAuth(['admin', 'encargado']), rechazarPedidoController);

export default router;
