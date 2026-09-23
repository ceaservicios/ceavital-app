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

  await runMigrations();

  const existente = await db
    .prepare(`SELECT id FROM usuarios WHERE LOWER(usuario) = LOWER(?) AND eliminado_en IS NULL`)
    .get(usuario);

  if (existente) {
    console.error(`Ya existe un usuario activo con login "${usuario}".`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  await db
    .prepare(`INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, 'admin')`)
    .run(nombre, usuario, passwordHash);

  console.log(`Usuario admin "${usuario}" creado correctamente.`);
}

try {
  await main();
} finally {
  await db.cerrar();
}
