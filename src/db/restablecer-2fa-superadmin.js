import db from './connection.js';
import { runMigrations } from './migrate.js';
import { restablecerDosfa } from '../services/dosfa.service.js';
import { cerrarSesionesSuperadmin } from '../services/superadmin.service.js';
import { registrarAccion } from '../services/registro.service.js';

// Restablece la verificación en dos pasos del superadmin desde la terminal del servidor, para
// cuando perdió el celular de la app o el correo de CEA dejó de andar. Al entrar con su
// contraseña la vuelve a configurar. Cierra las sesiones abiertas. Solo por terminal, nunca por HTTP.
//   npm run restablecer-2fa-superadmin

try {
  await runMigrations();
  const cuenta = await db.prepare('SELECT id FROM superadmin ORDER BY id LIMIT 1').get();
  if (!cuenta) throw new Error('Todavía no existe la cuenta de superadmin');
  await restablecerDosfa('superadmin', cuenta.id);
  await cerrarSesionesSuperadmin('dosfa_restablecido');
  await registrarAccion('dosfa-restablecido-terminal');
  console.log('[superadmin] verificación en dos pasos restablecida: al entrar se configura de nuevo');
} catch (err) {
  console.error(`[superadmin] ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.cerrar();
}
