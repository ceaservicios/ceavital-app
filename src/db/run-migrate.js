import db from './connection.js';
import { runMigrations } from './migrate.js';

try {
  await runMigrations();
  console.log('[migrate] listo');
} finally {
  await db.cerrar();
}
