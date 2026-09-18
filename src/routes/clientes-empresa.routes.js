import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  crearClienteEmpresaController,
  editarClienteEmpresaController,
  eliminarClienteEmpresaController,
  listarClientesEmpresaController,
  listarMovimientosController,
  obtenerClienteEmpresaController,
  registrarAjusteController,
  registrarPagoController,
} from '../controllers/clientes-empresa.controller.js';

const router = Router();

// Clientes-Empresa -- Ver / Crear / Editar / cuenta corriente: Admin +
// Encargado. Mismo criterio que Proveedores -- el Cajero no tiene ningún
// acceso a este módulo, ni siquiera "Ver" (decisión confirmada con el
// usuario, B2B Fase 1). Elegir el cliente al vender en Caja no pasa por acá
// -- ver GET /clientes-empresa más abajo, sin restricción de rol, porque los
// 3 roles necesitan la lista para el checkout de "Cuenta Corriente".
router.get('/', requireAuth(), listarClientesEmpresaController);
router.get('/:id', requireAuth(['admin', 'encargado']), obtenerClienteEmpresaController);
router.post('/', requireAuth(['admin', 'encargado']), crearClienteEmpresaController);
router.patch('/:id', requireAuth(['admin', 'encargado']), editarClienteEmpresaController);

// Clientes-Empresa -- Eliminar: exclusivo Admin.
router.delete('/:id', requireAuth(['admin']), eliminarClienteEmpresaController);

router.get('/:id/movimientos', requireAuth(['admin', 'encargado']), listarMovimientosController);
router.post('/:id/pagos', requireAuth(['admin', 'encargado']), registrarPagoController);
router.post('/:id/ajustes', requireAuth(['admin', 'encargado']), registrarAjusteController);

export default router;
