import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

// Los backups del sistema en SQLite copiaban el archivo de la base a una
// carpeta local/USB/nube. Con PostgreSQL (una base por empresa, todo online)
// eso ya no aplica: los backups pasan a gestionarse desde el superadmin de CEA
// con pg_dump por empresa (ver Docs/Planes-y-Superadmin.md, seccion 3).
// Hasta que exista ese modulo, ejecutar y restaurar responden un aviso claro;
// el historial y la configuracion guardados siguen consultables.
const MENSAJE_PENDIENTE =
  'Los backups ahora los gestiona CEA desde el panel de administración (en construcción). ' +
  'Mientras tanto, la base de datos se respalda desde el servidor.';

export function ejecutarBackup() {
  throw new ApiError(503, MENSAJE_PENDIENTE);
}

export function listarArchivosDestino() {
  throw new ApiError(503, MENSAJE_PENDIENTE);
}

export function restaurarBackup() {
  throw new ApiError(503, MENSAJE_PENDIENTE);
}

export function listarHistorial() {
  return db.prepare('SELECT * FROM backups_historial ORDER BY creado_en DESC').all();
}
