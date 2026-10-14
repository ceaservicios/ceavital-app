import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import config from '../config/env.js';

// Cliente mínimo de Google Drive (API v3) para las copias de seguridad (copias.service.js). Mismo
// cliente OAuth que IntelDrive y DaleFit: app "Interna" del Workspace de CEA con el permiso
// drive.file, así la app solo ve las carpetas y archivos que ella misma creó. Portado de DaleFit.

const API = 'https://www.googleapis.com/drive/v3';
const API_SUBIDA = 'https://www.googleapis.com/upload/drive/v3';
const TIPO_CARPETA = 'application/vnd.google-apps.folder';
// Las subidas van por partes: múltiplo de 256 KiB (lo exige Drive), con memoria acotada.
const TAMANIO_PARTE = 8 * 1024 * 1024;

let token = null; // { valor, vence }

export const driveConfigurado = () => Boolean(config.gdrive.clientId && config.gdrive.clientSecret && config.gdrive.refreshToken);

async function tokenDeAcceso() {
  if (token && Date.now() < token.vence) return token.valor;
  if (!driveConfigurado()) {
    throw new Error('Las copias de seguridad no están configuradas (GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN).');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: config.gdrive.clientId,
      client_secret: config.gdrive.clientSecret,
      refresh_token: config.gdrive.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '');
    throw new Error(
      `Google rechazó la autorización (${res.status}): ${cuerpo.slice(0, 200)}. Si se revocó el acceso, hay que generar un refresh token nuevo.`
    );
  }
  const datos = await res.json();
  token = { valor: datos.access_token, vence: Date.now() + (datos.expires_in - 60) * 1000 };
  return token.valor;
}

async function pedir(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await tokenDeAcceso()}` } });
  // 308 = "seguí mandando partes" en una subida por partes: no es un error.
  if (!res.ok && res.status !== 308) {
    const cuerpo = await res.text().catch(() => '');
    throw new Error(`Google Drive respondió ${res.status}: ${cuerpo.slice(0, 300)}`);
  }
  return res;
}

// Archivos (no borrados) de una carpeta: [{ id, name, createdTime, size, md5Checksum }].
export async function listarArchivos(carpetaId) {
  const archivos = [];
  let pagina;
  do {
    const params = new URLSearchParams({
      q: `'${carpetaId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, createdTime, size, md5Checksum)',
      pageSize: '1000',
      ...(pagina ? { pageToken: pagina } : {}),
    });
    const datos = await (await pedir(`${API}/files?${params}`)).json();
    archivos.push(...datos.files);
    pagina = datos.nextPageToken;
  } while (pagina);
  return archivos;
}

// Id de la carpeta `nombre` dentro de `padreId`, o null. Sin padre se busca en todo el Drive: con
// drive.file solo aparecen las de esta app, así que la carpeta madre se puede mover adonde se quiera.
export async function buscarCarpeta(nombre, padreId) {
  const nombreQ = nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `name = '${nombreQ}' and mimeType = '${TIPO_CARPETA}' and trashed = false${padreId ? ` and '${padreId}' in parents` : ''}`,
    fields: 'files(id)',
  });
  const existente = await (await pedir(`${API}/files?${params}`)).json();
  return existente.files[0]?.id ?? null;
}

// Id de la carpeta `nombre` dentro de `padreId` (sin padre, en la raíz); la crea si no existe.
export async function carpeta(nombre, padreId) {
  const existente = await buscarCarpeta(nombre, padreId);
  if (existente) return existente;
  const res = await pedir(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombre, mimeType: TIPO_CARPETA, parents: [padreId ?? 'root'] }),
  });
  return (await res.json()).id;
}

// Sube un archivo del disco a una carpeta (subida reanudable, por partes).
export async function subirArchivo(carpetaId, nombre, ruta) {
  const total = (await stat(ruta)).size;
  if (total === 0) throw new Error('La copia salió vacía: no se sube.');
  const inicio = await pedir(`${API_SUBIDA}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/octet-stream',
      'X-Upload-Content-Length': String(total),
    },
    body: JSON.stringify({ name: nombre, parents: [carpetaId] }),
  });
  const sesion = inicio.headers.get('location');
  if (!sesion) throw new Error('Google Drive no devolvió la sesión de subida.');

  const archivo = await open(ruta, 'r');
  try {
    for (let desde = 0; desde < total; desde += TAMANIO_PARTE) {
      const largo = Math.min(TAMANIO_PARTE, total - desde);
      const parte = Buffer.alloc(largo);
      await archivo.read(parte, 0, largo, desde);
      const res = await pedir(sesion, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${desde}-${desde + largo - 1}/${total}` },
        body: parte,
      });
      const ultima = desde + largo >= total;
      if (ultima !== (res.status !== 308)) {
        throw new Error(`Subida de ${nombre} cortada: Google Drive respondió ${res.status} en la parte que empieza en ${desde}.`);
      }
    }
  } finally {
    await archivo.close();
  }
}

// Datos de un archivo: { id, name, parents, size, md5Checksum, trashed }.
export async function datosArchivo(id) {
  const params = new URLSearchParams({ fields: 'id, name, parents, size, md5Checksum, trashed' });
  return (await pedir(`${API}/files/${encodeURIComponent(id)}?${params}`)).json();
}

// Baja un archivo al disco sin cargarlo entero en memoria. Corta si pasa de maxBytes. Devuelve
// { bytes, md5 } (el md5 se compara con el que informa Drive: que no se haya bajado a medias).
export async function descargarArchivo(id, ruta, maxBytes) {
  const res = await pedir(`${API}/files/${encodeURIComponent(id)}?alt=media`);
  const md5 = createHash('md5');
  let bytes = 0;
  const contar = new Transform({
    transform(parte, _codificacion, listo) {
      bytes += parte.length;
      if (bytes > maxBytes) return listo(new Error('La copia es más grande que el máximo permitido.'));
      md5.update(parte);
      listo(null, parte);
    },
  });
  await pipeline(Readable.fromWeb(res.body), contar, createWriteStream(ruta));
  return { bytes, md5: md5.digest('hex') };
}

// Borra un archivo de Drive definitivamente (solo los que creó esta app: las copias vencidas).
export async function borrarArchivo(id) {
  await pedir(`${API}/files/${id}`, { method: 'DELETE' });
}
