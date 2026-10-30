import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  anularPagoCuentaController,
  avisoSaldosController,
  crearCuentaController,
  editarCuentaController,
  eliminarCuentaController,
  obtenerCuentaController,
  obtenerSaldosController,
  registrarPagoCuentaController,
} from '../controllers/saldos.controller.js';

const router = Router();

// Saldos pendientes (2026-10-29): Admin + Encargado, igual que los pagos a proveedores (decisión
// del usuario). El Cajero no lo ve.
const ROLES = ['admin', 'encargado'];

router.get('/', requireAuth(ROLES), obtenerSaldosController);
router.get('/aviso', requireAuth(ROLES), avisoSaldosController);
router.post('/cuentas', requireAuth(ROLES), crearCuentaController);
router.get('/cuentas/:id', requireAuth(ROLES), obtenerCuentaController);
router.patch('/cuentas/:id', requireAuth(ROLES), editarCuentaController);
router.delete('/cuentas/:id', requireAuth(ROLES), eliminarCuentaController);
router.post('/cuentas/:id/pagos', requireAuth(ROLES), registrarPagoCuentaController);
router.post('/cuentas/:id/pagos/:pagoId/anular', requireAuth(ROLES), anularPagoCuentaController);

export default router;
