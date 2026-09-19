import db from './connection.js';
import { runMigrations } from './migrate.js';
import { desbloquearTodas } from '../services/defensa-ip.service.js';

// Libera todas las IPs bloqueadas por la defensa activa, desde la terminal del servidor.
// Es la salida de emergencia si el propio superadmin quedó bloqueado y no puede entrar al panel
// (lo normal es desbloquear desde el panel, sección Seguridad).
//   npm run desbloquear-ip
// Si el servidor ya estaba corriendo, toma el cambio en menos de un minuto (recarga la lista).

try {
  await runMigrations();
  const { liberadas } = await desbloquearTodas();
  console.log(`[defensa] ${liberadas} IP(s) liberada(s). El servidor en marcha lo toma en menos de 1 minuto.`);
} catch (err) {
  console.error(`[defensa] ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.cerrar();
}
