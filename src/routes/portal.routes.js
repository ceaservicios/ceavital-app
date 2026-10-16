import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  cancelarPedidoPortalController,
  catalogoPortalController,
  crearPedidoPortalController,
  cuentaPortalController,
  listarPedidosPortalController,
  loginPortalController,
  logoutPortalController,
  obtenerPedidoPortalController,
  resumenPortalController,
} from '../controllers/portal.controller.js';
import { ingresoLimiter } from '../middleware/ingreso-limiter.middleware.js';
import { requirePortalAuth } from '../middleware/portal-auth.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import { obtenerDatosNegocio } from '../services/negocio.service.js';

const router = Router();

// El login del portal: además del bloqueo por cliente que ya aplica el servicio (10 intentos,
// 15 min), el tope de intentos FALLIDOS por IP compartido con el login del negocio
// (ingreso-limiter.middleware.js: 20 en 15 min, los correctos no cuentan).

// Tope por IP para armar pedidos: cada pedido pendiente reserva stock real.
const pedidosLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos en poco tiempo, esperá unos minutos.' },
});

router.post('/login', ingresoLimiter, asyncHandler(loginPortalController));
router.post('/logout', requirePortalAuth, logoutPortalController);
router.get('/cuenta', requirePortalAuth, cuentaPortalController);
// Nombre y contacto del negocio para el pie del portal (Configuración > Datos del negocio).
router.get('/negocio', requirePortalAuth, async (req, res) => res.json(await obtenerDatosNegocio()));
router.get('/resumen', requirePortalAuth, resumenPortalController);
router.get('/catalogo', requirePortalAuth, catalogoPortalController);
router.get('/pedidos', requirePortalAuth, listarPedidosPortalController);
router.post('/pedidos', requirePortalAuth, pedidosLimiter, crearPedidoPortalController);
router.get('/pedidos/:id', requirePortalAuth, obtenerPedidoPortalController);
router.post('/pedidos/:id/cancelar', requirePortalAuth, pedidosLimiter, cancelarPedidoPortalController);

export default router;
