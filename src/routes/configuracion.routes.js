import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireLocalhost } from '../middleware/local-only.middleware.js';
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

// "Hacer backup ahora": disponible siempre, desde cualquier dispositivo de la
// red como Admin -- el instructivo solo restringe a la PC servidor la
// Restauración, no el backup manual.
router.post('/backups', requireAuth(['admin']), ejecutarBackupController);

// Restaurar: exclusivo Admin Y solo desde la PC servidor (mismo criterio que
// la recuperación de contraseña de Admin) -- Docs/Instructivo-Funcional.md >
// Restauración de un backup.
router.post('/restaurar', requireAuth(['admin']), requireLocalhost, restaurarController);

export default router;
