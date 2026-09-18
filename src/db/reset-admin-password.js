import crypto from 'node:crypto';
import db from './connection.js';
import { runMigrations } from './migrate.js';
import { hashPassword } from '../utils/password.js';

// Docs/Instructivo-Funcional.md > Configuración y Seguridad: "Si el Admin
// olvida su propia contraseña: no hay reset remoto por red -- se recupera con
// una herramienta local que solo puede ejecutarse con acceso físico a la PC
// servidor (genera una contraseña temporal)". Esta herramienta es justamente
// eso: un script de línea de comandos, nunca un endpoint HTTP -- "acceso
// físico" queda garantizado por construcción (solo se puede correr con
// terminal abierta en la máquina servidor), igual que seed-admin.js.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // sin 0/O/1/l/I ambiguos

function generarPasswordTemporal(longitud = 12) {
  return Array.from(crypto.randomFillSync(new Uint8Array(longitud)))
    .map((b) => ALFABETO[b % ALFABETO.length])
    .join('');
}

async function main() {
  const [, , usuarioLogin] = process.argv;

  if (!usuarioLogin) {
    console.error('Uso: npm run reset-admin-password -- <usuario>');
    process.exit(1);
  }

  runMigrations();

  const usuario = db
    .prepare('SELECT id, rol FROM usuarios WHERE usuario = ? AND eliminado_en IS NULL')
    .get(usuarioLogin);

  if (!usuario) {
    console.error(`No existe un usuario activo con login "${usuarioLogin}".`);
    process.exit(1);
  }

  if (usuario.rol !== 'admin') {
    console.error(
      `"${usuarioLogin}" no es un usuario Admin -- esta herramienta es exclusiva para recuperar el acceso ` +
        'de Admin. Para resetear la contraseña de un Encargado o Cajero, usar la pantalla de Usuarios logueado como Admin.'
    );
    process.exit(1);
  }

  const passwordTemporal = generarPasswordTemporal();
  const passwordHash = await hashPassword(passwordTemporal);

  db.prepare(
    `UPDATE usuarios
     SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(passwordHash, usuario.id);

  console.log(`Contraseña temporal para "${usuarioLogin}": ${passwordTemporal}`);
  console.log('Recomendado: iniciar sesión con esta contraseña y cambiarla cuanto antes desde Usuarios.');
}

main();
