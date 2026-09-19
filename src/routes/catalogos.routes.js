import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireModulo } from '../middleware/modulo.middleware.js';
import {
  categoriasController,
  condicionesPagoController,
  unidadesMedidaController,
} from '../controllers/catalogos.controller.js';

const router = Router();

// Categorías y Unidad de medida -- catálogo nuevo (corrección pedida
// 2026-09-15). Ver: Admin + Encargado (necesitan el listado para el <select>
// del alta/edición de producto en Stock -- Cajero no edita productos, no
// necesita este endpoint). Crear/Editar/Eliminar el catálogo en sí: exclusivo
// Admin (decisión confirmada 2026-09-18), igual criterio que Usuarios y
// Configuración.
router.get('/categorias', requireAuth(['admin', 'encargado']), categoriasController.listar);
router.post('/categorias', requireAuth(['admin']), categoriasController.crear);
router.patch('/categorias/:id', requireAuth(['admin']), categoriasController.editar);
router.delete('/categorias/:id', requireAuth(['admin']), categoriasController.eliminar);

router.get('/unidades-medida', requireAuth(['admin', 'encargado']), unidadesMedidaController.listar);
router.post('/unidades-medida', requireAuth(['admin']), unidadesMedidaController.crear);
router.patch('/unidades-medida/:id', requireAuth(['admin']), unidadesMedidaController.editar);
router.delete('/unidades-medida/:id', requireAuth(['admin']), unidadesMedidaController.eliminar);

// Condiciones de pago (B2B, pedido del usuario 2026-09-18) -- mismo criterio:
// Ver = Admin + Encargado (necesitan el listado para el <select> de
// Clientes-Empresa), Crear/Editar/Eliminar = exclusivo Admin.
// Las condiciones de pago pertenecen al módulo de clientes-empresa.
router.use('/condiciones-pago', requireModulo('clientes_empresa'));
router.get('/condiciones-pago', requireAuth(['admin', 'encargado']), condicionesPagoController.listar);
router.post('/condiciones-pago', requireAuth(['admin']), condicionesPagoController.crear);
router.patch('/condiciones-pago/:id', requireAuth(['admin']), condicionesPagoController.editar);
router.delete('/condiciones-pago/:id', requireAuth(['admin']), condicionesPagoController.eliminar);

export default router;
