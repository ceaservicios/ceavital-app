import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config/env.js';

// Copia de los backups a Google Drive con una CUENTA DE SERVICIO (sin pantallas de permiso ni
// tokens que venzan): se crea en Google Cloud, se habilita la API de Drive, y la carpeta de
// destino se comparte con el mail de la cuenta de servicio (con permiso de editor).
//   GDRIVE_CREDENCIALES_B64  el JSON de la clave de la cuenta de servicio, en base64
//   GDRIVE_CARPETA_ID        el id de la carpeta de Drive (lo que va después de /folders/ en su URL)
// Los archivos ya viajan cifrados (AES-256-GCM): Drive no ve datos del negocio.
//
// Sin dependencias: JWT firmado a mano y la API REST de Drive v3 por fetch.

const SCOPE = 'https://www.googleapis.com/auth/drive';
const base64url = (buf) => Buffer.from(buf).toString('base64url');

export function driveConfigurado(cfg = config.bkps.drive) {
  return Boolean(cfg.credencialesB64 && cfg.carpetaId);
}

export function crearDrive(cfg = config.bkps.drive) {
  let cred = null;
  let cache = null; // { token, vence }

  const credenciales = () => {
    if (!cred) {
      try {
        cred = JSON.parse(Buffer.from(cfg.credencialesB64, 'base64').toString('utf8'));
      } catch {
        throw new Error('GDRIVE_CREDENCIALES_B64 no es un JSON válido en base64');
      }
      if (!cred.client_email || !cred.private_key) throw new Error('Las credenciales de Google no tienen client_email o private_key');
    }
    return cred;
  };

  async function tokenDeAcceso() {
    if (cache && cache.vence > Date.now() + 60_000) return cache.token;
    const c = credenciales();
    const uri = c.token_uri || 'https://oauth2.googleapis.com/token';
    const ahora = Math.floor(Date.now() / 1000);
    const cuerpo = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
      JSON.stringify({ iss: c.client_email, scope: SCOPE, aud: uri, iat: ahora, exp: ahora + 3600 })
    )}`;
    const firma = crypto.createSign('RSA-SHA256').update(cuerpo).sign(c.private_key);
    const res = await fetch(uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cuerpo}.${base64url(firma)}` }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(`Google no dio acceso (${res.status}): ${data.error_description || data.error || 'sin detalle'}`);
    cache = { token: data.access_token, vence: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return cache.token;
  }

  async function llamar(url, opciones = {}) {
    const res = await fetch(url, {
      ...opciones,
      headers: { authorization: `Bearer ${await tokenDeAcceso()}`, ...opciones.headers },
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`Drive respondió ${res.status}: ${data.error?.message || data.error || 'sin detalle'}`);
    }
    return res;
  }

  return {
    // Sube el archivo a la carpeta y devuelve { id, name }. Subida "resumable" de Drive.
    async subir(ruta, nombre = path.basename(ruta)) {
      const contenido = await fs.promises.readFile(ruta);
      const inicio = await llamar(`${cfg.apiUrl}/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': 'application/octet-stream',
          'x-upload-content-length': String(contenido.length),
        },
        body: JSON.stringify({ name: nombre, parents: [cfg.carpetaId] }),
      });
      const destino = inicio.headers.get('location');
      if (!destino) throw new Error('Drive no devolvió dónde subir el archivo');
      const res = await llamar(destino, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: contenido });
      return res.json();
    },

    // Archivos de la carpeta cuyo nombre empieza con el prefijo: [{ id, name }].
    async listar(prefijo = 'ceavital-backup-') {
      const salida = [];
      let pagina = '';
      do {
        const q = `'${cfg.carpetaId}' in parents and trashed = false and name contains '${prefijo}'`;
        const url = `${cfg.apiUrl}/drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pagina}`;
        const data = await (await llamar(url)).json();
        salida.push(...(data.files ?? []));
        pagina = data.nextPageToken ? `&pageToken=${encodeURIComponent(data.nextPageToken)}` : '';
      } while (pagina);
      return salida;
    },

    async borrar(id) {
      await llamar(`${cfg.apiUrl}/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: 'DELETE' });
    },
  };
}
