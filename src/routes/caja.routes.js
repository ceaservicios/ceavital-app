import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  listarCierresController,
  obtenerCierreController,
  obtenerResumenController,
  registrarCierreController,
} from '../controllers/caja.controller.js';
import {
  eliminarGastoController,
  listarGastosController,
  registrarGastoController,
} from '../controllers/gastos.controller.js';

const router = Router();

// Cierre de caja -- Ver: todos los roles, incluido el Cajero (ve los totales
// en vivo y el historial, pero no puede ejecutar el cierre).
router.get('/resumen', requireAuth(), obtenerResumenController);
router.get('/cierres', requireAuth(), listarCierresController);
router.get('/cierres/:id', requireAuth(), obtenerCierreController);

// Cierre de caja -- Editar (ejecutar el cierre): Admin + Encargado, no
// Cajero (Docs/Resumen-Ejecutivo.md: "Cajero... ve el cierre de caja, sin
// editar ni eliminar nada").
router.post('/cierres', requireAuth(['admin', 'encargado']), registrarCierreController);

// Gastos y pagos a proveedores (corrección pedida 2026-09-15, decisiones
// confirmadas 2026-09-18). Crear/Ver: los 3 roles (cualquiera en caja puede
// registrar un gasto en el momento en que ocurre). Eliminar (corregir un
// gasto mal cargado): Admin+Encargado, mismo criterio que anular una venta.
router.get('/gastos', requireAuth(), listarGastosController);
router.post('/gastos', requireAuth(), registrarGastoController);
router.delete('/gastos/:id', requireAuth(['admin', 'encargado']), eliminarGastoController);

export default router;
