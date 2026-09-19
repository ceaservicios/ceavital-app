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

const router = Router();

router.get('/health', (req, res) => res.json({ ok: true }));
router.use('/auth', authRoutes);
router.use('/productos', productosRoutes);
router.use('/vencimientos', vencimientosRoutes);
router.use('/ventas', ventasRoutes);
router.use('/caja', cajaRoutes);
router.use('/proveedores', proveedoresRoutes);
router.use('/usuarios', usuariosRoutes);
router.use('/configuracion', configuracionRoutes);
router.use('/clientes-empresa', clientesEmpresaRoutes);
router.use('/pedidos-cliente', pedidosClienteRoutes);
router.use('/portal', portalRoutes);
router.use('/', catalogosRoutes);

export default router;
