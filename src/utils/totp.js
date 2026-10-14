import crypto from 'node:crypto';

// Códigos de las apps autenticadoras (Google Authenticator, Microsoft Authenticator…): TOTP de
// la RFC 6238 con los valores que esas apps usan por defecto (HMAC-SHA1, 6 números, 30 s). Hecho
// con node:crypto, sin dependencias.

const PASO_SEGUNDOS = 30;
const DIGITOS = 6;
const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buffer) {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of buffer) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  return salida;
}

export function desdeBase32(texto) {
  const limpio = texto.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let valor = 0;
  const bytes = [];
  for (const caracter of limpio) {
    const indice = ALFABETO_BASE32.indexOf(caracter);
    if (indice === -1) throw new Error('Secreto TOTP con caracteres inválidos');
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// Secreto nuevo de 160 bits (el largo que recomienda la RFC 4226), en base32.
export function nuevoSecretoTotp() {
  return base32(crypto.randomBytes(20));
}

// Enlace que se muestra como código QR para cargar la cuenta en la app.
export function uriOtpauth(secreto, cuenta, emisor) {
  // encodeURIComponent y no URLSearchParams: este último pasa los espacios a "+" y algunas apps
  // muestran el "+" tal cual en el nombre.
  const etiqueta = encodeURIComponent(`${emisor}:${cuenta}`);
  return `otpauth://totp/${etiqueta}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=${DIGITOS}&period=${PASO_SEGUNDOS}`;
}

export function codigoTotp(clave, paso) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const hmac = crypto.createHmac('sha1', clave).update(contador).digest();
  const desplazamiento = hmac[hmac.length - 1] & 0x0f;
  const numero = hmac.readUInt32BE(desplazamiento) & 0x7fffffff;
  return String(numero % 10 ** DIGITOS).padStart(DIGITOS, '0');
}

export const pasoActual = (ahoraMs = Date.now()) => Math.floor(ahoraMs / 1000 / PASO_SEGUNDOS);

// Verifica un código con un paso de tolerancia hacia cada lado (±30 s, por la hora del celular) y
// rechaza un paso igual o anterior al último aceptado (el mismo código no se usa dos veces).
// Devuelve el paso aceptado, para guardarlo, o null si el código no sirve.
export function verificarTotp(secreto, codigo, ultimoPasoUsado = null, ahoraMs = Date.now()) {
  const limpio = String(codigo ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpio)) return null;
  const clave = desdeBase32(secreto);
  const actual = pasoActual(ahoraMs);
  for (const paso of [actual - 1, actual, actual + 1]) {
    const esperado = codigoTotp(clave, paso);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(limpio))) {
      if (ultimoPasoUsado !== null && ultimoPasoUsado !== undefined && paso <= Number(ultimoPasoUsado)) return null;
      return paso;
    }
  }
  return null;
}
