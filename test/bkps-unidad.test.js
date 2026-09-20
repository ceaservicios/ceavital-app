// Tests sin base de datos de la app de backups: retención (7 diarios + 4 semanales) y la copia a
// Google Drive, contra un servidor de Drive falso que valida el JWT de la cuenta de servicio.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// El módulo de Drive importa la configuración, que no necesita DATABASE_URL.
const { crearDrive, driveConfigurado } = await import('../src/bkps/drive.js');
const { fechaDeArchivo, planDeRetencion } = await import('../src/bkps/retencion.js');

const nombre = (y, m, d, h = 6) => `ceavital-backup-${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}-${String(h).padStart(2, '0')}0000.ceavbak`;

describe('retención de backups', () => {
  it('reconoce solo los nombres propios y su fecha', () => {
    assert.equal(fechaDeArchivo(nombre(2026, 9, 19)).toISOString(), '2026-09-19T06:00:00.000Z');
    for (const ajeno of ['foto.png', 'ceavital-backup-2026-09-19.ceavbak', 'ceavital-backup-20260919-060000.zip', 'ceavital-backup-20261319-060000.ceavbak']) {
      assert.equal(fechaDeArchivo(ajeno), null, ajeno);
    }
  });

  it('con pocos archivos no borra nada', () => {
    const nombres = [nombre(2026, 9, 17), nombre(2026, 9, 18), nombre(2026, 9, 19)];
    const { conservar, borrar } = planDeRetencion(nombres);
    assert.equal(conservar.length, 3);
    assert.deepEqual(borrar, []);
  });

  it('conserva los 7 días más recientes y un archivo por cada una de las 4 últimas semanas', () => {
    // 60 días seguidos, uno por día, hasta el 19/9/2026 (sábado).
    const nombres = [];
    for (let i = 0; i < 60; i++) {
      const f = new Date(Date.UTC(2026, 8, 19 - i));
      nombres.push(nombre(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()));
    }
    const { conservar, borrar } = planDeRetencion(nombres);
    const set = new Set(conservar);
    for (let i = 0; i < 7; i++) {
      const f = new Date(Date.UTC(2026, 8, 19 - i));
      assert.ok(set.has(nombre(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate())), `día -${i}`);
    }
    // Semanas (lunes 14/9, 7/9, 31/8, 24/8): el más nuevo de cada una. Las dos primeras (19/9 y
    // 13/9) ya están entre los diarios; se suman el 6/9 y el 30/8.
    for (const semanal of [nombre(2026, 9, 19), nombre(2026, 9, 13), nombre(2026, 9, 6), nombre(2026, 8, 30)]) assert.ok(set.has(semanal), semanal);
    assert.equal(conservar.length, 7 + 2, '7 diarios + 2 semanales extra');
    assert.equal(conservar.length + borrar.length, 60);
    assert.ok(!set.has(nombre(2026, 8, 1)), 'lo viejo se borra');
  });

  it('de varios backups en un mismo día se queda con el más nuevo', () => {
    const { conservar, borrar } = planDeRetencion([nombre(2026, 9, 19, 6), nombre(2026, 9, 19, 9), nombre(2026, 9, 19, 12)]);
    assert.deepEqual(conservar, [nombre(2026, 9, 19, 12)]);
    assert.equal(borrar.length, 2);
  });

  it('nunca borra archivos ajenos y siempre deja el más nuevo', () => {
    const { conservar, borrar } = planDeRetencion(['notas.txt', 'ceavital-backup-final.ceavbak', nombre(2026, 9, 19)]);
    assert.deepEqual(conservar, [nombre(2026, 9, 19)]);
    assert.deepEqual(borrar, []);
    assert.deepEqual(planDeRetencion([]), { conservar: [], borrar: [] });
  });
});

describe('Google Drive (servidor falso)', () => {
  let servidor;
  let apiUrl;
  let claves;
  let credencialesB64;
  const archivos = new Map(); // id -> { name, parents, bytes }
  const registro = { tokens: 0, jwtValido: null };
  let n = 0;

  before(async () => {
    claves = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    servidor = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      const cuerpo = await new Promise((r) => {
        const partes = [];
        req.on('data', (c) => partes.push(c));
        req.on('end', () => r(Buffer.concat(partes)));
      });
      const json = (codigo, dato, headers = {}) => res.writeHead(codigo, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(dato));

      if (url.pathname === '/token') {
        registro.tokens += 1;
        const jwt = new URLSearchParams(cuerpo.toString()).get('assertion') ?? '';
        const [cabeza, datos, firma] = jwt.split('.');
        const ok = crypto.createVerify('RSA-SHA256').update(`${cabeza}.${datos}`).verify(claves.publicKey, Buffer.from(firma, 'base64url'));
        const claim = JSON.parse(Buffer.from(datos, 'base64url').toString());
        registro.jwtValido = ok && claim.iss === 'bkps@proyecto.iam.gserviceaccount.com' && claim.scope.includes('/auth/drive');
        return ok ? json(200, { access_token: 'tok-1', expires_in: 3600 }) : json(400, { error: 'invalid_grant' });
      }
      if (req.headers.authorization !== 'Bearer tok-1') return json(401, { error: { message: 'sin token' } });

      if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
        const meta = JSON.parse(cuerpo.toString());
        const id = `f${(n += 1)}`;
        archivos.set(id, { name: meta.name, parents: meta.parents, bytes: null });
        return res.writeHead(200, { location: `http://${req.headers.host}/upload-destino/${id}` }).end();
      }
      if (url.pathname.startsWith('/upload-destino/') && req.method === 'PUT') {
        const id = url.pathname.split('/').pop();
        archivos.get(id).bytes = cuerpo;
        return json(200, { id, name: archivos.get(id).name });
      }
      if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
        const carpeta = /'([^']+)' in parents/.exec(url.searchParams.get('q'))?.[1];
        const files = [...archivos].filter(([, a]) => a.parents.includes(carpeta)).map(([id, a]) => ({ id, name: a.name }));
        return json(200, { files });
      }
      if (url.pathname.startsWith('/drive/v3/files/') && req.method === 'DELETE') {
        archivos.delete(url.pathname.split('/').pop());
        return res.writeHead(204).end();
      }
      return json(404, { error: { message: 'ruta desconocida' } });
    });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    apiUrl = `http://127.0.0.1:${servidor.address().port}`;
    const credenciales = {
      client_email: 'bkps@proyecto.iam.gserviceaccount.com',
      private_key: claves.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      token_uri: `${apiUrl}/token`,
    };
    credencialesB64 = Buffer.from(JSON.stringify(credenciales)).toString('base64');
  });

  after(() => servidor?.close());

  it('sin credenciales o sin carpeta no está configurado', () => {
    assert.equal(driveConfigurado({ credencialesB64: '', carpetaId: 'x' }), false);
    assert.equal(driveConfigurado({ credencialesB64: 'abc', carpetaId: '' }), false);
    assert.equal(driveConfigurado({ credencialesB64: 'abc', carpetaId: 'x' }), true);
  });

  it('sube el archivo con un JWT firmado, lo lista y aplica la retención borrando lo viejo', async () => {
    const drive = crearDrive({ credencialesB64, carpetaId: 'carpeta-1', apiUrl });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bkps-drive-'));
    const contenido = crypto.randomBytes(300_000);
    const ruta = path.join(tmp, nombre(2026, 9, 19));
    fs.writeFileSync(ruta, contenido);

    const subido = await drive.subir(ruta, nombre(2026, 9, 19));
    assert.equal(subido.name, nombre(2026, 9, 19));
    assert.equal(registro.jwtValido, true, 'el JWT lleva la firma y los datos correctos');
    assert.deepEqual(archivos.get(subido.id).bytes, contenido, 'el contenido llega intacto');
    assert.deepEqual(archivos.get(subido.id).parents, ['carpeta-1']);

    // Un archivo ajeno en la carpeta y uno en otra carpeta: no se tocan.
    archivos.set('ajeno', { name: 'no-es-un-backup.txt', parents: ['carpeta-1'], bytes: null });
    archivos.set('otra', { name: nombre(2026, 1, 1), parents: ['otra-carpeta'], bytes: null });
    for (let i = 0; i < 12; i++) archivos.set(`viejo${i}`, { name: nombre(2026, 7, 1 + i), parents: ['carpeta-1'], bytes: null });

    const listados = await drive.listar();
    assert.ok(!listados.some((a) => a.id === 'otra'), 'solo la carpeta configurada');
    const { borrar } = planDeRetencion(listados.map((a) => a.name));
    for (const a of listados) if (borrar.includes(a.name)) await drive.borrar(a.id);

    assert.ok(archivos.has(subido.id), 'el de hoy se conserva');
    assert.ok(archivos.has('ajeno') && archivos.has('otra'));
    assert.ok(archivos.size < 12 + 3, 'los viejos sobrantes se borraron');
    assert.equal(registro.tokens, 1, 'el token de acceso se reutiliza entre llamadas');
  });

  it('una firma que Google no acepta da un error claro', async () => {
    const otra = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const cred = JSON.parse(Buffer.from(credencialesB64, 'base64').toString());
    cred.private_key = otra.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const drive = crearDrive({ credencialesB64: Buffer.from(JSON.stringify(cred)).toString('base64'), carpetaId: 'c', apiUrl });
    await assert.rejects(() => drive.listar(), /Google no dio acceso \(400\)/);
  });

  it('credenciales mal armadas se explican', async () => {
    const drive = crearDrive({ credencialesB64: Buffer.from('no es json').toString('base64'), carpetaId: 'c', apiUrl });
    await assert.rejects(() => drive.listar(), /no es un JSON válido/);
  });
});
