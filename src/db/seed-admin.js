import db from './connection.js';
import { runMigrations } from './migrate.js';
import { hashPassword } from '../utils/password.js';

async function main() {
  const [, , nombre, usuario, password] = process.argv;

  if (!nombre || !usuario || !password) {
    console.error('Uso: npm run seed:admin -- "<nombre completo>" <usuario> <password>');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('La contrasena tiene que tener al menos 8 caracteres.');
    process.exit(1);
  }

  runMigrations();

  const existente = db
    .prepare(`SELECT id FROM usuarios WHERE usuario = ? AND eliminado_en IS NULL`)
    .get(usuario);

  if (existente) {
    console.error(`Ya existe un usuario activo con login "${usuario}".`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  db.prepare(
    `INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, 'admin')`
  ).run(nombre, usuario, passwordHash);

  console.log(`Usuario admin "${usuario}" creado correctamente.`);
}

main();
