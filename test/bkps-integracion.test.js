// Circuito completo de los backups automáticos: producción (servidor real, base A) <-> app de
// backups (src/bkps/ahora.js, base de verificación B). Necesitan un Postgres de TEST
// (TEST_DATABASE_URL); solo crean y borran bases descartables propias.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const PUERTO = 21000 + Math.floor(Math.random() * 1000);
const HOST = `127.0.0.1:${PUERTO}`;
const sufijo = randomBytes(4).toString('hex');
const baseA = `ceavital_test_bk_a_${sufijo}`; // "producción"
const baseB = `ceavital_test_bk_b_${sufijo}`; // ceavital-bd-bkps
const CLAVE_SA = 'ClaveSuperadmin-2026';
const TOKEN = randomBytes(24).toString('hex'); // 48 caracteres
const CLAVE_BACKUP = 'clave-de-los-backups-automaticos';

let servidor;
let urlA;
let urlB;
let entornoProd;
let dirBkps;
const admin = ADMIN_URL ? new pg.Client({ connectionString: ADMIN_URL }) : null;
let n = 0;
const ipNueva = () => `198.51.100.${(n += 1)}`;

async function pedir(metodo, ruta, { cuerpo, token, ip, cookie, csrf } = {}) {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  if (ip) h['x-forwarded-for'] = ip;
  if (cookie) h.cookie = cookie;
  if (csrf) h['x-csrf-token'] = csrf;
  const res = await fetch(`http://${HOST}/api${ruta}`, { method: metodo, headers: h, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo (descarga) */
  }
  return { status: res.status, data, res };
}

async function consultar(url, texto, params = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(texto, params)).rows;
  } finally {
    await c.end();
  }
}

// Corre la app de backups una vez (npm run bkps:ahora) con la configuración indicada.
function correrBkps(extra = {}) {
  return spawnSync(process.execPath, ['src/bkps/ahora.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      DATABASE_URL: urlB,
      BKPS_INSTANCIA_URL: `http://${HOST}`,
      BKPS_TOKEN: TOKEN,
      BKPS_BACKUP_PASSWORD: CLAVE_BACKUP,
      BKPS_DIR: dirBkps,
      GDRIVE_CREDENCIALES_B64: '',
      GDRIVE_CARPETA_ID: '',
      ...extra,
    },
    encoding: 'utf8',
    timeout: 240_000,
  });
}

const TABLAS = ['usuarios', 'categorias', 'unidades_medida', 'proveedores', 'productos', 'lotes', 'ventas', 'venta_items'];
async function foto(url) {
  const out = {};
  for (const t of TABLAS) out[t] = (await consultar(url, `SELECT to_jsonb(x)::text AS r FROM ${t} x ORDER BY 1`)).map((f) => f.r);
  return out;
}

describe('backups automáticos', { skip: !ADMIN_URL && 'falta TEST_DATABASE_URL' }, () => {
  let cookie;
  let csrf;

  before(async () => {
    dirBkps = fs.mkdtempSync(path.join(os.tmpdir(), 'bkps-test-'));
    await admin.connect();
    await admin.query(`CREATE DATABASE ${baseA}`);
    await admin.query(`CREATE DATABASE ${baseB}`);
    const u = new URL(ADMIN_URL);
    u.pathname = `/${baseA}`;
    urlA = u.toString();
    u.pathname = `/${baseB}`;
    urlB = u.toString();

    entornoProd = {
      ...process.env,
      DATABASE_URL: urlA,
      PORT: String(PUERTO),
      HTTPS_MODE: 'proxy',
      NODE_ENV: 'test',
      PLAN_CACHE_SEGUNDOS: '0',
      AVISOS_CUOTA: 'off',
      SUPERADMIN_USUARIO: 'cea',
      SUPERADMIN_PASSWORD: CLAVE_SA,
      BACKUP_SYNC_TOKEN: TOKEN,
      DEFENSA_IP_LOOPBACK: 'on',
    };
    const semilla = spawnSync(process.execPath, ['src/db/seed-admin.js', 'Admin Test', 'admin_test', 'ClaveSegura123'], { cwd: RAIZ, env: entornoProd, encoding: 'utf8' });
    assert.equal(semilla.status, 0, semilla.stderr || semilla.stdout);
    servidor = spawn(process.execPath, ['src/server.js'], { cwd: RAIZ, env: entornoProd, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(`http://${HOST}/api/health`)).ok) break;
      } catch {
        /* arrancando */
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    await consultar(urlA, `INSERT INTO unidades_medida (nombre) VALUES ('unidad')`);
    await consultar(urlA, `INSERT INTO categorias (nombre) VALUES ('Bebidas ñ')`);
    await consultar(urlA, `INSERT INTO proveedores (nombre) VALUES ('Ñandú S.A.')`);
    await consultar(urlA, `INSERT INTO productos (nombre, precio_costo, precio_venta, proveedor_id, unidad_medida_id, categoria_id) VALUES ('Vino', 2500000000, 4200000000, 1, 1, 1)`);
    await consultar(urlA, `INSERT INTO lotes (producto_id, cantidad, fecha_ingreso, fecha_vencimiento) VALUES (1, 24, '2026-09-01', '2027-01-31')`);

    const login = await pedir('POST', '/auth/login', { cuerpo: { usuario: 'cea', password: CLAVE_SA } });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    cookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    csrf = login.data.csrf_token;
  });

  after(async () => {
    servidor?.kill();
    fs.rmSync(dirBkps, { recursive: true, force: true });
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${baseA} WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS ${baseB} WITH (FORCE)`);
      await admin.end();
    }
  });

  describe('la ruta de producción', () => {
    it('exige el token: sin token o con uno incorrecto da 401 y no genera nada', async () => {
      assert.equal((await pedir('POST', '/backup-sync/export', { cuerpo: { password: CLAVE_BACKUP } })).status, 401);
      assert.equal((await pedir('POST', '/backup-sync/export', { token: 'x'.repeat(48), cuerpo: { password: CLAVE_BACKUP } })).status, 401);
      assert.equal((await pedir('POST', '/backup-sync/estado', { cuerpo: { resultado: 'ok', iniciada_en: new Date().toISOString() } })).status, 401);
      assert.equal((await consultar(urlA, 'SELECT COUNT(*)::int AS n FROM backup_corridas'))[0].n, 0);
    });

    it('con el token entrega el backup cifrado, y valida la contraseña', async () => {
      assert.equal((await pedir('POST', '/backup-sync/export', { token: TOKEN, cuerpo: { password: 'corta' } })).status, 400);
      const res = await fetch(`http://${HOST}/api/backup-sync/export`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ password: CLAVE_BACKUP }),
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-disposition'), /filename="ceavital-backup-\d{8}-\d{6}\.ceavbak"/);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(bytes.subarray(0, 8).toString(), 'CEAVBK01');
      assert.ok(!bytes.includes(Buffer.from('Ñandú')), 'va cifrado');
    });

    it('sin BACKUP_SYNC_TOKEN configurado (o muy corto) la ruta no existe', async () => {
      // Estos imports fijan el pool de este proceso de test: se ata a la base de verificación (B),
      // que es la que consulta el test de corridasDeHoy más abajo.
      process.env.DATABASE_URL = urlB;
      const { requireBackupSync } = await import('../src/controllers/backup-sync.controller.js');
      const { default: config } = await import('../src/config/env.js');
      const original = config.backupSync.token;
      try {
        for (const token of ['', 'corto']) {
          config.backupSync.token = token;
          let estado = null;
          const res = { status: (c) => ({ json: () => (estado = c) }) };
          requireBackupSync({ get: () => `Bearer ${token}` }, res, () => (estado = 'paso'));
          assert.equal(estado, 404, `token "${token}"`);
        }
      } finally {
        config.backupSync.token = original;
      }
    });

    it('/estado valida lo que recibe', async () => {
      const bien = { resultado: 'ok', iniciada_en: new Date().toISOString(), verificado: true, drive: 'no_configurado' };
      assert.equal((await pedir('POST', '/backup-sync/estado', { token: TOKEN, cuerpo: { ...bien, resultado: 'quizas' } })).status, 400);
      assert.equal((await pedir('POST', '/backup-sync/estado', { token: TOKEN, cuerpo: { ...bien, drive: 'otro' } })).status, 400);
      assert.equal((await pedir('POST', '/backup-sync/estado', { token: TOKEN, cuerpo: { ...bien, iniciada_en: 'ayer' } })).status, 400);
      assert.equal((await pedir('POST', '/backup-sync/estado', { token: TOKEN, cuerpo: bien })).status, 200);
      await consultar(urlA, 'DELETE FROM backup_corridas');
    });

    it('la defensa por IP cuenta los tokens incorrectos, pero no bloquea a la app de backups por el texto de un error', async () => {
      const atacante = ipNueva();
      for (let i = 0; i < 15; i++) assert.equal((await pedir('POST', '/backup-sync/export', { token: 'y'.repeat(48), ip: atacante, cuerpo: { password: 'x' } })).status, 401, `intento ${i + 1}`);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal((await pedir('GET', '/health', { ip: atacante })).status, 403, 'la IP quedó bloqueada');

      const legitima = ipNueva();
      const raro = "Error SQL: SELECT id FROM information_schema.tables; ' OR 1=1 --";
      const r = await pedir('POST', '/backup-sync/estado', { token: TOKEN, ip: legitima, cuerpo: { resultado: 'error', iniciada_en: new Date().toISOString(), detalle: raro } });
      assert.equal(r.status, 200, 'un detalle con texto parecido a un ataque se acepta');
      assert.equal((await pedir('GET', '/health', { ip: legitima })).status, 200);
      await consultar(urlA, 'DELETE FROM backup_corridas');
    });
  });

  describe('la app de backups', () => {
    let antes;

    it('una corrida completa: descarga, guarda, restaura en la base de verificación, compara e informa', async () => {
      antes = await foto(urlA);
      const r = correrBkps();
      assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /corrida ok/);

      const archivos = fs.readdirSync(dirBkps).filter((f) => f.endsWith('.ceavbak'));
      assert.equal(archivos.length, 1);
      assert.match(archivos[0], /^ceavital-backup-\d{8}-\d{6}\.ceavbak$/);
      assert.ok(!fs.readdirSync(dirBkps).some((f) => f.endsWith('.tmp')), 'no quedan temporales');
      assert.ok(!fs.readFileSync(path.join(dirBkps, archivos[0])).includes(Buffer.from('Ñandú')), 'el archivo guardado va cifrado');

      assert.deepEqual(await foto(urlB), antes, 'la base de verificación quedó idéntica a producción');

      const [local] = await consultar(urlB, 'SELECT * FROM backup_corridas ORDER BY id');
      assert.equal(local.resultado, 'ok');
      assert.equal(local.verificado, true);
      assert.equal(local.drive, 'no_configurado');
      assert.equal(local.origen, 'local');
      assert.ok(local.filas >= 5 && local.bytes > 100);

      const informada = await consultar(urlA, 'SELECT * FROM backup_corridas ORDER BY id');
      assert.equal(informada.length, 1, 'producción recibió el estado');
      assert.equal(informada[0].origen, 'informada');
      assert.equal(informada[0].archivo, archivos[0]);
    });

    it('el panel del superadmin muestra el estado del último backup', async () => {
      const { status, data } = await pedir('GET', '/sa/backup-estado', { cookie });
      assert.equal(status, 200);
      assert.equal(data.configurado, true);
      assert.equal(data.atrasado, false);
      assert.equal(data.ultimo_ok.resultado, 'ok');
      assert.equal(data.ultimo_ok.verificado, true);
      assert.equal(data.corridas.length, 1);
      assert.equal((await pedir('GET', '/sa/backup-estado')).status, 401, 'exige sesión de superadmin');
    });

    it('SEGURO: apuntada a la base de producción se niega y no toca nada', async () => {
      const r = correrBkps({ DATABASE_URL: urlA });
      assert.notEqual(r.status, 0);
      assert.match(r.stdout + r.stderr, /PRODUCCIÓN/);
      assert.deepEqual(await foto(urlA), antes, 'producción intacta');
      assert.equal((await consultar(urlA, `SELECT to_regclass('public.bkps_marca') IS NOT NULL AS hay`))[0].hay, false);
    });

    it('con un token incorrecto la corrida queda registrada como error y no deja archivos a medias', async () => {
      const antesArchivos = fs.readdirSync(dirBkps).sort();
      const r = correrBkps({ BKPS_TOKEN: 'z'.repeat(48) });
      assert.notEqual(r.status, 0);
      assert.match(r.stdout, /respondió 401/);
      assert.deepEqual(fs.readdirSync(dirBkps).sort(), antesArchivos, 'nada nuevo en el volumen');
      const filas = await consultar(urlB, 'SELECT resultado, detalle FROM backup_corridas ORDER BY id');
      assert.equal(filas.at(-1).resultado, 'error');
      assert.match(filas.at(-1).detalle, /401/);
      assert.equal(filas.length, 2);
    });

    it('si Google Drive falla, el backup local igual queda bueno y el fallo se informa', async () => {
      const credenciales = Buffer.from(
        JSON.stringify({
          client_email: 'x@y.iam.gserviceaccount.com',
          private_key: (await import('node:crypto')).generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
          token_uri: 'http://127.0.0.1:1/token', // nadie escucha
        })
      ).toString('base64');
      const r = correrBkps({ GDRIVE_CREDENCIALES_B64: credenciales, GDRIVE_CARPETA_ID: 'carpeta', GDRIVE_API_URL: 'http://127.0.0.1:1' });
      assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
      const filas = await consultar(urlB, 'SELECT resultado, verificado, drive, detalle FROM backup_corridas ORDER BY id');
      assert.equal(filas.length, 3, 'el historial de la base de verificación NO se borra al restaurar');
      assert.equal(filas.at(-1).resultado, 'ok');
      assert.equal(filas.at(-1).verificado, true);
      assert.equal(filas.at(-1).drive, 'error');
      assert.match(filas.at(-1).detalle, /Drive/);
    });

    it('corridasDeHoy cuenta las corridas del día argentino y cómo terminó la última', async () => {
      const { corridasDeHoy } = await import('../src/services/backup-corridas.service.js');
      const hoy = await corridasDeHoy();
      assert.equal(hoy.cantidad, 3);
      assert.equal(hoy.ultimoResultado, 'ok');
      assert.ok(hoy.segundosDesdeLaUltima >= 0 && hoy.segundosDesdeLaUltima < 600);
    });
  });
});
