import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  listarCierresController,
  obtenerCierreController,
  obtenerResumenController,
  registrarCierreController,
} from '../controllers/caja.controller.js';

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

export default router;
