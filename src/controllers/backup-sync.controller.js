import crypto from 'node:crypto';
import fs from 'node:fs';
import config from '../config/env.js';
import { generarBackup } from '../services/backup-completo.service.js';
import { registrarCorrida } from '../services/backup-corridas.service.js';
import { ApiError } from '../utils/api-error.js';

// Ruta que usa SOLO la app de backups (ceavital-app-bkps) para traer el backup cifrado y para
// informar cómo le fue. Se autentica con un token largo compartido (BACKUP_SYNC_TOKEN), no con
// una sesión. Sin token configurado la ruta no existe (404). Los fallos de token cuentan para
// la defensa por IP (fuerza bruta).

const hash = (valor) => crypto.createHash('sha256').update(String(valor)).digest();
export const TOKEN_MIN = 32;

export function requireBackupSync(req, res, next) {
  const esperado = config.backupSync.token;
  if (esperado.length < TOKEN_MIN) return res.status(404).json({ error: 'No encontrado' });
  const recibido = /^Bearer (.+)$/.exec(req.get('authorization') || '')?.[1] ?? '';
  // Se comparan los hashes (largo fijo): la comparación no depende de cuánto acierta el token.
  if (!crypto.timingSafeEqual(hash(recibido), hash(esperado))) return res.status(401).json({ error: 'No autorizado' });
  next();
}

export async function exportarBackupSyncController(req, res) {
  const { ruta, nombre } = await generarBackup(req.body?.password);
  console.log('[backup] la app de backups descargó un backup completo');
  res.set('Cache-Control', 'no-store');
  res.download(ruta, nombre, () => {
    fs.promises.rm(ruta, { force: true }).catch(() => {});
  });
}

export async function estadoBackupSyncController(req, res) {
  if (!req.body || typeof req.body !== 'object') throw new ApiError(400, 'Falta el estado del backup');
  const id = await registrarCorrida(req.body, 'informada');
  res.json({ id });
}
