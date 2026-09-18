import bcrypt from 'bcryptjs';

// bcryptjs (pure JS, sin binding nativo) en vez de bcrypt: simplifica el
// empaquetado futuro a .exe (ver CLAUDE.md > Empaquetado) al no depender de
// compilacion nativa para esta libreria puntual.
const SALT_ROUNDS = 12;

export async function hashPassword(passwordPlano) {
  return bcrypt.hash(passwordPlano, SALT_ROUNDS);
}

export async function verifyPassword(passwordPlano, hash) {
  return bcrypt.compare(passwordPlano, hash);
}
