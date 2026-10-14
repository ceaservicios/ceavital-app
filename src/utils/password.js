import crypto from 'node:crypto';
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

// Sin caracteres que se confunden al leer o dictar (0/O, 1/l/I).
const ALFABETO_PROVISORIA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

// Contraseña provisoria (EST-01 §5): 12 caracteres con azar criptográfico; se cambia al primer ingreso.
export function generarPasswordProvisoria(largo = 12) {
  let resultado = '';
  for (let i = 0; i < largo; i++) resultado += ALFABETO_PROVISORIA[crypto.randomInt(ALFABETO_PROVISORIA.length)];
  return resultado;
}
