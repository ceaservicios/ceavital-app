import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

// "Mi cuenta" de un usuario del negocio: cambiar su contraseña. Con la contraseña provisoria (la
// que le dio CEA, EST-01 §5) es obligatorio cambiarla antes de usar el sistema, y no se le pide la
// actual: acaba de usarla para entrar.

const PASSWORD_MIN = 8; // mismo mínimo que usuarios.service
const PASSWORD_MAX = 72; // límite real de bcrypt: más allá se ignora en silencio

function leerCuenta(usuarioId) {
  return db
    .prepare('SELECT password_hash, debe_cambiar_password FROM usuarios WHERE id = ? AND eliminado_en IS NULL')
    .get(usuarioId);
}

export async function cambiarPassword(usuarioId, { actual, nueva } = {}) {
  const cuenta = await leerCuenta(usuarioId);
  if (!cuenta) throw new ApiError(404, 'Usuario no encontrado');

  if (!cuenta.debe_cambiar_password) {
    if (typeof actual !== 'string' || !actual) throw new ApiError(400, 'Escribí tu contraseña actual');
    // 403 y no 401: un 401 se toma como "se venció la sesión" y saca al usuario de la pantalla.
    if (!(await verifyPassword(actual, cuenta.password_hash))) throw new ApiError(403, 'La contraseña actual no es correcta');
  }
  if (typeof nueva !== 'string' || nueva.length < PASSWORD_MIN) {
    throw new ApiError(400, `La contraseña nueva tiene que tener al menos ${PASSWORD_MIN} caracteres`);
  }
  if (nueva.length > PASSWORD_MAX) throw new ApiError(400, `La contraseña nueva no puede superar los ${PASSWORD_MAX} caracteres`);
  if (await verifyPassword(nueva, cuenta.password_hash)) throw new ApiError(400, 'Elegí una contraseña distinta de la actual');
  const nuevoHash = await hashPassword(nueva);

  // Leer-decidir-escribir en una transacción. bcrypt queda afuera (es lento y la transacción se
  // puede reintentar), así que adentro se confirma que la cuenta sigue activa y con la misma
  // contraseña con la que se decidió: si cambió en el medio (otro pedido, o el Admin desde
  // Usuarios), no se pisa.
  await db.transaction(async () => {
    const vigente = await leerCuenta(usuarioId);
    if (!vigente) throw new ApiError(404, 'Usuario no encontrado');
    if (vigente.password_hash !== cuenta.password_hash || vigente.debe_cambiar_password !== cuenta.debe_cambiar_password) {
      throw new ApiError(409, 'Tu contraseña se acaba de cambiar desde otro lado: volvé a intentar');
    }
    await db
      .prepare(
        `UPDATE usuarios SET password_hash = ?, debe_cambiar_password = FALSE, intentos_fallidos = 0, bloqueado_hasta = NULL,
                actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(nuevoHash, usuarioId);
  });
}

export function datosDeCuenta(usuarioId) {
  return db.prepare('SELECT id, nombre, usuario, email, rol FROM usuarios WHERE id = ? AND eliminado_en IS NULL').get(usuarioId);
}
