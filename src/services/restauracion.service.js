import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { restaurarBackup, tieneCabeceraDeBackup } from './backup-completo.service.js';
import { ApiError } from '../utils/api-error.js';

// Restaurar un backup completo (.ceavbak) desde el panel del superadmin, en DOS pasos para que
// las contraseñas viajen en un cuerpo JSON y no en un encabezado ni en la URL:
//  1. recibirArchivo(): el navegador sube el archivo tal cual (application/octet-stream) y queda
//     en una carpeta temporal, cifrado como vino (nunca hay datos en claro en disco).
//  2. restaurarDesdeArchivo(): con el id del paso 1 y la contraseña del backup, reemplaza los
//     datos del negocio (todo o nada, ver restaurarBackup).
// Solo hay UN archivo pendiente a la vez y se descarta solo a los 15 minutos.

const DIR = path.join(os.tmpdir(), 'ceavital-restauracion');
export const MAX_BYTES_RESTAURACION = 300 * 1024 * 1024;
const VIDA_MS = 15 * 60 * 1000;

let pendiente = null; // { id, ruta, bytes, timer }
let restaurando = false;

async function descartarPendiente() {
  if (!pendiente) return;
  const { ruta, timer } = pendiente;
  clearTimeout(timer);
  pendiente = null;
  await fs.promises.rm(ruta, { force: true }).catch(() => {});
}

export async function recibirArchivo(req) {
  if (restaurando) throw new ApiError(409, 'Hay una restauración en curso. Esperá a que termine.');
  const declarado = Number(req.get('content-length'));
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_RESTAURACION) {
    throw new ApiError(413, `El archivo es demasiado grande (máximo ${MAX_BYTES_RESTAURACION / 1024 / 1024} MB).`);
  }

  await descartarPendiente();
  await fs.promises.mkdir(DIR, { recursive: true, mode: 0o700 });
  const id = crypto.randomBytes(16).toString('hex');
  const ruta = path.join(DIR, `${id}.ceavbak.tmp`);

  let bytes = 0;
  const contar = new Transform({
    transform(trozo, _codificacion, listo) {
      bytes += trozo.length;
      if (bytes > MAX_BYTES_RESTAURACION) {
        return listo(new ApiError(413, `El archivo es demasiado grande (máximo ${MAX_BYTES_RESTAURACION / 1024 / 1024} MB).`));
      }
      listo(null, trozo);
    },
  });

  try {
    await pipeline(req, contar, fs.createWriteStream(ruta, { mode: 0o600 }));
    if (bytes === 0 || !(await tieneCabeceraDeBackup(ruta))) {
      throw new ApiError(400, 'El archivo no es un backup de CEAVital (tiene que ser un .ceavbak descargado del panel).');
    }
  } catch (err) {
    await fs.promises.rm(ruta, { force: true }).catch(() => {});
    throw err;
  }

  pendiente = { id, ruta, bytes, timer: setTimeout(() => descartarPendiente(), VIDA_MS) };
  pendiente.timer.unref();
  return { archivo_id: id, bytes };
}

export async function restaurarDesdeArchivo(archivoId, passwordBackup) {
  if (restaurando) throw new ApiError(409, 'Ya hay una restauración en curso.');
  if (typeof passwordBackup !== 'string' || passwordBackup.length === 0) {
    throw new ApiError(400, 'La contraseña del backup es requerida');
  }
  if (!pendiente || typeof archivoId !== 'string' || pendiente.id !== archivoId) {
    throw new ApiError(404, 'El archivo ya no está en el servidor (se descarta a los 15 minutos). Subilo de nuevo.');
  }

  restaurando = true;
  try {
    const resultado = await restaurarBackup(pendiente.ruta, passwordBackup);
    await descartarPendiente(); // ya usado: no queda en disco
    return resultado;
  } catch (err) {
    // Los errores de restaurarBackup con mensaje propio (contraseña incorrecta, versión más nueva,
    // archivo dañado…) son del pedido: 400. Los de Postgres (tienen `code`) los traduce error.middleware.
    // Con contraseña incorrecta el archivo queda para reintentar sin volver a subirlo.
    if (err instanceof ApiError || err.code) throw err;
    throw new ApiError(400, err.message);
  } finally {
    restaurando = false;
  }
}

// Para los tests: descarta lo pendiente sin esperar los 15 minutos.
export const _descartarPendienteParaTests = descartarPendiente;
