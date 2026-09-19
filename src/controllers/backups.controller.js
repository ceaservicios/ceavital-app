import { ApiError } from '../utils/api-error.js';
import * as backupsService from '../services/backups.service.js';

// Los backups (ejecutar, listar archivos, restaurar) pasan a gestionarse desde el
// panel de administración de CEA con pg_dump por empresa; hasta entonces el
// servicio responde 503 (ver backups.service.js). Solo el historial se consulta.

export async function listarHistorialController(req, res) {
  res.json({ historial: await backupsService.listarHistorial() });
}

export async function listarArchivosController(req, res) {
  const destino = req.query.destino;
  if (!destino) throw new ApiError(400, 'destino es requerido');
  res.json({ archivos: await backupsService.listarArchivosDestino(destino) });
}

export async function ejecutarBackupController(req, res) {
  const resultados = await backupsService.ejecutarBackup();
  res.status(201).json({ resultados });
}

export async function restaurarController(req, res) {
  await backupsService.restaurarBackup(req.body || {});
  res.json({ ok: true });
}
