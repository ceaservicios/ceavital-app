import { Router } from 'express';
import authRoutes from './auth.routes.js';
import productosRoutes from './productos.routes.js';
import vencimientosRoutes from './vencimientos.routes.js';
import ventasRoutes from './ventas.routes.js';
import cajaRoutes from './caja.routes.js';
import proveedoresRoutes from './proveedores.routes.js';
import usuariosRoutes from './usuarios.routes.js';
import configuracionRoutes from './configuracion.routes.js';
import catalogosRoutes from './catalogos.routes.js';
import clientesEmpresaRoutes from './clientes-empresa.routes.js';
import pedidosClienteRoutes from './pedidos-cliente.routes.js';
import portalRoutes from './portal.routes.js';
import { requireModulo } from '../middleware/modulo.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import { modulosActivos } from '../services/modulos.service.js';

const router = Router();

router.get('/health', (req, res) => res.json({ ok: true }));

// Módulos activos de esta instalación. Público a propósito: lo necesita también
// la pantalla de ingreso del portal y solo dice qué hay activo, sin datos.
router.get(
  '/modulos',
  asyncHandler(async (req, res) => {
    res.json({ modulos: await modulosActivos() });
  })
);

router.use('/auth', authRoutes);
router.use('/productos', productosRoutes);
router.use('/vencimientos', vencimientosRoutes);
router.use('/ventas', ventasRoutes);
router.use('/caja', cajaRoutes);
router.use('/proveedores', proveedoresRoutes);
router.use('/usuarios', usuariosRoutes);
router.use('/configuracion', configuracionRoutes);
// Módulos apagados por el plan de la instalación: 404 antes de autenticar.
router.use('/clientes-empresa', requireModulo('clientes_empresa'), clientesEmpresaRoutes);
router.use('/pedidos-cliente', requireModulo('pedidos'), pedidosClienteRoutes);
router.use('/portal', requireModulo('portal'), portalRoutes);
router.use('/', catalogosRoutes);

export default router;
