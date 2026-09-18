import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { obtenerVencimientosController } from '../controllers/vencimientos.controller.js';

const router = Router();

// Mismo criterio que "Stock -- Ver": los 3 roles ven vencimientos (no hay fila
// propia en la matriz de permisos, se apoya en los lotes ya visibles de Stock).
router.get('/', requireAuth(), obtenerVencimientosController);

export default router;
