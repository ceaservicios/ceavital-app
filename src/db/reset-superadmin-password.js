import db from './connection.js';
import { runMigrations } from './migrate.js';
import { cambiarPasswordSuperadmin } from '../services/superadmin.service.js';

// Cambia la contraseña del superadmin desde la terminal del servidor. La contraseña nueva
// va en la variable de entorno SUPERADMIN_PASSWORD_NUEVA (nunca como argumento: quedaría
// en el historial del shell y en la lista de procesos).
//   SUPERADMIN_PASSWORD_NUEVA=... npm run reset-superadmin-password

try {
  await runMigrations();
  await cambiarPasswordSuperadmin(process.env.SUPERADMIN_PASSWORD_NUEVA);
  console.log('[superadmin] contraseña cambiada; las sesiones abiertas se cerraron');
} catch (err) {
  console.error(`[superadmin] ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.cerrar();
}
