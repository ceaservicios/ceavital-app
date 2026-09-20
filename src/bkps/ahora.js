import db from '../db/connection.js';
import config from '../config/env.js';
import { runMigrations } from '../db/migrate.js';
import { ejecutarBackupDiario } from './ejecutar.js';

// Corre UN backup ahora mismo, sin esperar la madrugada (para probar la configuración desde la
// terminal del servicio ceavital-app-bkps):  npm run bkps:ahora
// Usa la misma configuración que el servicio (BKPS_*, GDRIVE_*, DATABASE_URL de la base de verificación).

try {
  if (!config.bkps.instanciaUrl || !config.bkps.token || !config.bkps.password) {
    throw new Error('Faltan BKPS_INSTANCIA_URL, BKPS_TOKEN o BKPS_BACKUP_PASSWORD');
  }
  await runMigrations();
  const corrida = await ejecutarBackupDiario();
  process.exitCode = corrida.resultado === 'ok' ? 0 : 1;
} catch (err) {
  console.error(`[bkps] ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.cerrar();
}
