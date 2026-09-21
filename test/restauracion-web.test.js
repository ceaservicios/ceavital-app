// Tests del botón "Restaurar un backup" del panel del superadmin (subida del .ceavbak +
// restauración en dos pasos, pidiendo de nuevo la contraseña del superadmin).
// Necesitan un Postgres: TEST_DATABASE_URL apunta a cualquier base del servidor de TEST
// (solo se usa para crear y borrar una base descartable propia). Nunca apuntarlo a producción.
//   TEST_DATABASE_URL=postgres://... npm test
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const PUERTO = 21000 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://127.0.0.1:${PUERTO}/api`;
const sufijo = randomBytes(4).toString('hex');
const nombreBase = `ceavital_test_rest_${sufijo}`;
const CLAVE_SA = 'ClaveSuperadmin-2026';
const CLAVE_BACKUP = 'una-clave-larga-de-backup';

let servidor;
let urlBase;
let entorno;
const admin = ADMIN_URL ? new pg.Client({ connectionString: ADMIN_URL }) : null;

async function pedir(metodo, ruta, { cuerpo, cookie, csrf, binario, raw } = {}) {
  const h = {};
  if (cuerpo !== undefined) h['content-type'] = 'application/json';
  if (binario !== undefined) h['content-type'] = 'application/octet-stream';
  if (cookie) h.cookie = cookie;
  if (csrf) h['x-csrf-token'] = csrf;
  const res = await fetch(BASE_URL + ruta, {
    method: metodo,
    headers: h,
    body: binario !== undefined ? binario : cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  if (raw) return res;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: res.status, data };
}

async function consultar(texto, params = []) {
  const c = new pg.Client({ connectionString: urlBase });
  await c.connect();
  try {
    return (await c.query(texto, params)).rows;
  } finally {
    await c.end();
  }
}

const categorias = async () => (await consultar('SELECT nombre FROM categorias ORDER BY nombre')).map((f) => f.nombre);

async function arrancar() {
  servidor = spawn(process.execPath, ['src/server.js'], { cwd: RAIZ, env: entorno, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(BASE_URL + '/health')).ok) return;
    } catch {
      /* todavía arrancando */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('el servidor no arrancó');
}

describe('restaurar un backup desde el panel', { skip: !ADMIN_URL && 'falta TEST_DATABASE_URL' }, () => {
  let cookie;
  let csrf;
  let backup; // Buffer con el .ceavbak del estado inicial

  before(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nombreBase}`);
    const u = new URL(ADMIN_URL);
    u.pathname = `/${nombreBase}`;
    urlBase = u.toString();

    entorno = {
      ...process.env,
      DATABASE_URL: urlBase,
      PORT: String(PUERTO),
      HTTPS_MODE: 'proxy',
      NODE_ENV: 'test',
      PLAN_CACHE_SEGUNDOS: '0',
      AVISOS_CUOTA: 'off',
      SUPERADMIN_USUARIO: 'cea',
      SUPERADMIN_PASSWORD: CLAVE_SA,
    };
    const semilla = spawnSync(process.execPath, ['src/db/seed-admin.js', 'Admin Test', 'admin_test', 'ClaveSegura123'], {
      cwd: RAIZ,
      env: entorno,
      encoding: 'utf8',
    });
    assert.equal(semilla.status, 0, semilla.stderr || semilla.stdout);
    await arrancar();

    const login = await fetch(BASE_URL + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario: 'cea', password: CLAVE_SA }),
    });
    assert.equal(login.status, 200);
    cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    csrf = (await login.json()).csrf_token;

    // Estado inicial (el que se resguarda) y su backup, bajado como lo hace el panel.
    await consultar(`INSERT INTO categorias (nombre) VALUES ('Almacén'), ('Bebidas')`);
    const bajada = await pedir('POST', '/sa/backup', { cuerpo: { password: CLAVE_BACKUP }, cookie, csrf, raw: true });
    assert.equal(bajada.status, 200);
    backup = Buffer.from(await bajada.arrayBuffer());
  });

  after(async () => {
    servidor?.kill();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${nombreBase} WITH (FORCE)`);
      await admin.end();
    }
  });

  const subir = (cuerpo = backup, opciones = {}) => pedir('POST', '/sa/restaurar/archivo', { binario: cuerpo, cookie, csrf, ...opciones });
  const restaurar = (cuerpo, opciones = {}) => pedir('POST', '/sa/restaurar', { cuerpo, cookie, csrf, ...opciones });

  it('sin sesión de superadmin no se puede subir ni restaurar (401)', async () => {
    assert.equal((await pedir('POST', '/sa/restaurar/archivo', { binario: backup })).status, 401);
    assert.equal((await pedir('POST', '/sa/restaurar', { cuerpo: {} })).status, 401);
  });

  it('sin el token de seguridad (CSRF) tampoco (403)', async () => {
    assert.equal((await pedir('POST', '/sa/restaurar/archivo', { binario: backup, cookie })).status, 403);
    assert.equal((await pedir('POST', '/sa/restaurar', { cuerpo: {}, cookie })).status, 403);
  });

  it('un archivo que no es un backup se rechaza al subirlo (400) y no queda pendiente', async () => {
    const r = await subir(Buffer.from('esto no es un backup, es solo texto'));
    assert.equal(r.status, 400);
    assert.match(r.data.error, /no es un backup/i);
    const vacio = await subir(Buffer.alloc(0));
    assert.equal(vacio.status, 400);
  });

  it('restaurar sin haber subido nada, o con un id inventado, da 404', async () => {
    const r = await restaurar({ archivo_id: 'inventado', password_backup: CLAVE_BACKUP, password_superadmin: CLAVE_SA });
    assert.equal(r.status, 404);
  });

  it('con la contraseña de superadmin incorrecta no restaura (403) y no toca nada', async () => {
    await consultar(`INSERT INTO categorias (nombre) VALUES ('Nueva')`);
    const { data } = await subir();
    const r = await restaurar({ archivo_id: data.archivo_id, password_backup: CLAVE_BACKUP, password_superadmin: 'otra-clave-cualquiera' });
    assert.equal(r.status, 403);
    assert.deepEqual(await categorias(), ['Almacén', 'Bebidas', 'Nueva'], 'los datos siguen como estaban');
    const sinClave = await restaurar({ archivo_id: data.archivo_id, password_backup: CLAVE_BACKUP });
    assert.equal(sinClave.status, 403, 'falta la contraseña del superadmin');
  });

  it('con la contraseña del backup incorrecta no restaura (400), no toca nada, y se puede reintentar sin volver a subir', async () => {
    const { data } = await subir();
    const mala = await restaurar({ archivo_id: data.archivo_id, password_backup: 'clave-equivocada-123', password_superadmin: CLAVE_SA });
    assert.equal(mala.status, 400);
    assert.match(mala.data.error, /Contraseña incorrecta o archivo dañado/);
    assert.deepEqual(await categorias(), ['Almacén', 'Bebidas', 'Nueva']);

    const buena = await restaurar({ archivo_id: data.archivo_id, password_backup: CLAVE_BACKUP, password_superadmin: CLAVE_SA });
    assert.equal(buena.status, 200, JSON.stringify(buena.data));
    assert.ok(buena.data.filas > 0 && buena.data.tablas > 0);
    assert.deepEqual(await categorias(), ['Almacén', 'Bebidas'], 'volvió al estado del backup: "Nueva" desapareció');
  });

  it('el mismo archivo no se puede usar dos veces (queda descartado tras restaurar)', async () => {
    const { data } = await subir();
    const primera = await restaurar({ archivo_id: data.archivo_id, password_backup: CLAVE_BACKUP, password_superadmin: CLAVE_SA });
    assert.equal(primera.status, 200);
    const segunda = await restaurar({ archivo_id: data.archivo_id, password_backup: CLAVE_BACKUP, password_superadmin: CLAVE_SA });
    assert.equal(segunda.status, 404);
  });

  it('un backup alterado se rechaza (400) y no toca nada', async () => {
    await consultar(`INSERT INTO categorias (nombre) VALUES ('Extra')`);
    const roto = Buffer.from(backup);
    roto[Math.floor(roto.length / 2)] ^= 0xff;
    const { data } = await subir(roto);
    const r = await restaurar({ archivo_id: data.archivo_id, password_backup: CLAVE_BACKUP, password_superadmin: CLAVE_SA });
    assert.equal(r.status, 400);
    assert.deepEqual(await categorias(), ['Almacén', 'Bebidas', 'Extra']);
  });

  it('después de restaurar, el Admin del negocio y el superadmin siguen pudiendo entrar', async () => {
    const admin1 = await pedir('POST', '/auth/login', { cuerpo: { usuario: 'admin_test', password: 'ClaveSegura123' } });
    assert.equal(admin1.status, 200);
    const sa = await pedir('GET', '/sa/me', { cookie });
    assert.equal(sa.status, 200, 'la sesión del superadmin no se toca');
  });

  it('errores repetidos con la contraseña de superadmin bloquean la cuenta (423), igual que en el login', async () => {
    const { data } = await subir();
    let ultimo;
    for (let i = 0; i < 6; i++) {
      ultimo = await restaurar({ archivo_id: data.archivo_id, password_backup: CLAVE_BACKUP, password_superadmin: `mala-${i}` });
      if (ultimo.status === 423) break;
    }
    assert.equal(ultimo.status, 423);
    const conLaBuena = await restaurar({ archivo_id: data.archivo_id, password_backup: CLAVE_BACKUP, password_superadmin: CLAVE_SA });
    assert.equal(conLaBuena.status, 423, 'bloqueada aunque ahora ponga la correcta');
  });
});
