import crypto from 'node:crypto';
import { promisify } from 'node:util';
import config from '../config/env.js';
import { ApiError } from './api-error.js';

// Piezas de la verificación en dos pasos que no tocan la base: cifrado del secreto de la app
// autenticadora y códigos de recuperación (EST-01 §4.2 y §4.4).

const scrypt = promisify(crypto.scrypt);
const CLAVE_MINIMA = 32;

export const claveDosfaDisponible = () => config.dosfa.clave.length >= CLAVE_MINIMA;

function clave() {
  if (!claveDosfaDisponible()) {
    throw new ApiError(503, 'Falta configurar DOSFA_CLAVE en el servidor: por ahora solo se puede elegir el código por mail.');
  }
  return crypto.createHash('sha256').update(config.dosfa.clave).digest();
}

// AES-256-GCM: iv.etiqueta.datos, cada parte en base64url.
export function cifrarSecreto(secreto) {
  const iv = crypto.randomBytes(12);
  const cifrador = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const datos = Buffer.concat([cifrador.update(secreto, 'utf8'), cifrador.final()]);
  return [iv, cifrador.getAuthTag(), datos].map((b) => b.toString('base64url')).join('.');
}

export function descifrarSecreto(guardado) {
  const [iv, etiqueta, datos] = String(guardado).split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv?.length || !etiqueta?.length || !datos?.length) throw new Error('Secreto de verificación con formato inválido');
  const descifrador = crypto.createDecipheriv('aes-256-gcm', clave(), iv);
  descifrador.setAuthTag(etiqueta);
  return Buffer.concat([descifrador.update(datos), descifrador.final()]).toString('utf8');
}

// ---- Códigos de recuperación: 10, de un solo uso, legibles (XXXXX-XXXXX). Se muestran una sola
// vez; en la base va solo su hash (scrypt con sal propia, nativo de Node).

const normalizar = (codigo) => String(codigo ?? '').replace(/[\s-]/g, '').toUpperCase();
export const pareceCodigoRecuperacion = (codigo) => /^[0-9A-F]{10}$/.test(normalizar(codigo));

export function generarCodigosRecuperacion(cantidad = 10) {
  return Array.from({ length: cantidad }, () => {
    const crudo = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `${crudo.slice(0, 5)}-${crudo.slice(5)}`;
  });
}

async function hashear(normalizado, sal) {
  return (await scrypt(normalizado, sal, 32)).toString('base64url');
}

export function hashearCodigosRecuperacion(codigos) {
  return Promise.all(
    codigos.map(async (c) => {
      const sal = crypto.randomBytes(16).toString('base64url');
      return `${sal}.${await hashear(normalizar(c), sal)}`;
    })
  );
}

// Devuelve el hash guardado que coincide (para descartarlo) o null.
export async function buscarCodigoRecuperacion(codigo, hashes) {
  if (!pareceCodigoRecuperacion(codigo)) return null;
  const normalizado = normalizar(codigo);
  for (const guardado of hashes ?? []) {
    const [sal, valor] = String(guardado).split('.');
    if (!sal || !valor) continue;
    const calculado = Buffer.from(await hashear(normalizado, sal));
    const esperado = Buffer.from(valor);
    if (calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado)) return guardado;
  }
  return null;
}
