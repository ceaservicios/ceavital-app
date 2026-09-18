import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  crearUsuarioController,
  editarUsuarioController,
  eliminarUsuarioController,
  listarUsuariosController,
  obtenerUsuarioController,
} from '../controllers/usuarios.controller.js';

const router = Router();

// Usuarios del sistema -- Ver / Editar / Eliminar: exclusivo Admin
// (Docs/Instructivo-Funcional.md > Roles y permisos). Ningún otro rol tiene
// ningún acceso a este módulo, ni lectura.
router.get('/', requireAuth(['admin']), listarUsuariosController);
router.get('/:id', requireAuth(['admin']), obtenerUsuarioController);

// crear/editar son async (hashean password con bcryptjs) -- necesitan
// asyncHandler en Express 4 (ver src/utils/async-handler.js y CLAUDE.md >
// Convenciones). eliminar es síncrono, no lo necesita.
router.post('/', requireAuth(['admin']), asyncHandler(crearUsuarioController));
router.patch('/:id', requireAuth(['admin']), asyncHandler(editarUsuarioController));
router.delete('/:id', requireAuth(['admin']), eliminarUsuarioController);

export default router;
