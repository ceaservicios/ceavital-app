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

    // PRAGMA foreign_keys es no-op dentro de una transaccion activa -- por
    // eso se togglea ACA AFUERA, antes del BEGIN. Necesario para migraciones
    // que reconstruyen una tabla que es padre de una FK con filas reales
    // (SQLite hace un DELETE implicito al DROP TABLE con foreign_keys=ON, que
    // viola la FK de la tabla hija) -- sin esto, ese tipo de migracion no se
    // puede aplicar. Transparente para el resto: no cambia nada si la
    // migracion no reconstruye ninguna tabla.
    db.exec('PRAGMA foreign_keys = OFF');

    // node:sqlite no tiene un helper .transaction() como better-sqlite3 -- se
    // envuelve a mano con BEGIN/COMMIT/ROLLBACK.
    db.exec('BEGIN');
    try {
      db.exec(sql);
      registrarAplicada.run(archivo);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      db.exec('PRAGMA foreign_keys = ON');
      throw err;
    }

    db.exec('PRAGMA foreign_keys = ON');

    // Red de seguridad: si la migracion dejo alguna referencia rota (ej. un
    // error de copia de datos en una reconstruccion de tabla), abortar acá
    // mismo en vez de seguir con una base inconsistente sin darse cuenta.
    const violaciones = db.prepare('PRAGMA foreign_key_check').all();
    if (violaciones.length > 0) {
      throw new Error(
        `[migrate] ${archivo} aplicada pero dejó inconsistencias de foreign key: ${JSON.stringify(violaciones)}`
      );
    }

    console.log(`[migrate] aplicada: ${archivo}`);
  }
}
