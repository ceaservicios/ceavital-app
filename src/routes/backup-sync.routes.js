import { Router } from 'express';
import { estadoBackupSyncController, exportarBackupSyncController, requireBackupSync } from '../controllers/backup-sync.controller.js';

const router = Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(requireBackupSync);
router.post('/export', exportarBackupSyncController);
router.post('/estado', estadoBackupSyncController);

export default router;
