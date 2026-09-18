import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

/**
 * Aplica las migraciones .sql pendientes, en orden por nombre de archivo.
 * Idempotente: una migracion ya aplicada nunca se vuelve a correr.
 */
export function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      archivo TEXT NOT NULL UNIQUE,
      aplicada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const yaAplicadas = new Set(
    db.prepare('SELECT archivo FROM _migrations').all().map((fila) => fila.archivo)
  );

  const archivos = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const registrarAplicada = db.prepare('INSERT INTO _migrations (archivo) VALUES (?)');

  for (const archivo of archivos) {
    if (yaAplicadas.has(archivo)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, archivo), 'utf8');

    // node:sqlite no tiene un helper .transaction() como better-sqlite3 -- se
    // envuelve a mano con BEGIN/COMMIT/ROLLBACK.
    db.exec('BEGIN');
    try {
      db.exec(sql);
      registrarAplicada.run(archivo);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    console.log(`[migrate] aplicada: ${archivo}`);
  }
}
