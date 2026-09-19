import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  editarConfiguracionController,
  obtenerConfiguracionController,
} from '../controllers/configuracion.controller.js';
import {
  ejecutarBackupController,
  listarArchivosController,
  listarHistorialController,
  restaurarController,
} from '../controllers/backups.controller.js';

const router = Router();

// Configuración y Backups -- Ver / Editar / Restaurar: exclusivo Admin
// (Docs/Instructivo-Funcional.md > Roles y permisos). Ningún otro rol tiene
// acceso a este módulo.
router.get('/', requireAuth(['admin']), obtenerConfiguracionController);
router.patch('/', requireAuth(['admin']), editarConfiguracionController);

router.get('/backups', requireAuth(['admin']), listarHistorialController);
router.get('/backups/archivos', requireAuth(['admin']), listarArchivosController);

// Ejecutar y restaurar backups: responden 503 hasta que existan en el panel de
// administración de CEA (pg_dump por empresa) -- ver services/backups.service.js.
router.post('/backups', requireAuth(['admin']), ejecutarBackupController);
router.post('/restaurar', requireAuth(['admin']), restaurarController);

export default router;
