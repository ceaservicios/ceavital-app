// Tests de la defensa activa por IP y del backup completo del superadmin.
// Necesitan un Postgres: TEST_DATABASE_URL apunta a cualquier base del servidor de TEST
// (solo se usa para crear y borrar bases descartables propias). Nunca apuntarlo a producción.
//   TEST_DATABASE_URL=postgres://... npm test
//
// Los "atacantes" se simulan con X-Forwarded-For (el servidor corre en modo proxy, igual que
// en Easypanel). El superadmin entra desde 127.0.0.1, que la defensa no bloquea.
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
const PUERTO = 20000 + Math.floor(Math.random() * 1000);
const HOST = `127.0.0.1:${PUERTO}`;
const BASE_URL = `http://${HOST}/api`;
const sufijo = randomBytes(4).toString('hex');
const nombreBase = `ceavital_test_def_${sufijo}`;
const nombreBase2 = `ceavital_test_def2_${sufijo}`;
const CLAVE_SA = 'ClaveSuperadmin-2026';
const CLAVE_BACKUP = 'una-clave-larga-de-backup';

let servidor;
let urlBase;
let urlBase2;
let entorno;
const admin = ADMIN_URL ? new pg.Client({ connectionString: ADMIN_URL }) : null;
let n = 0;
const ipNueva = () => `203.0.113.${(n += 1)}`; // rango de documentación (TEST-NET-3)

async function pedir(metodo, ruta, { cuerpo, ip, headers = {}, cookie, csrf, raw } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (ip) h['x-forwarded-for'] = ip;
  if (cookie) h.cookie = cookie;
  if (csrf) h['x-csrf-token'] = csrf;
  const res = await fetch(BASE_URL + ruta, { method: metodo, headers: h, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  if (raw) return res;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo */
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

describe('defensa por IP y backup', { skip: !ADMIN_URL && 'falta TEST_DATABASE_URL' }, () => {
  let cookie;
  let csrf;

  before(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nombreBase}`);
    await admin.query(`CREATE DATABASE ${nombreBase2}`);
    const u = new URL(ADMIN_URL);
    u.pathname = `/${nombreBase}`;
    urlBase = u.toString();
    u.pathname = `/${nombreBase2}`;
    urlBase2 = u.toString();

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

    const login = await pedir('POST', '/auth/login', { cuerpo: { usuario: 'cea', password: CLAVE_SA } });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    cookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    csrf = login.data.csrf_token;
  });

  after(async () => {
    servidor?.kill();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${nombreBase} WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS ${nombreBase2} WITH (FORCE)`);
      await admin.end();
    }
  });

  const sa = (metodo, ruta, cuerpo) => pedir(metodo, `/sa${ruta}`, { cuerpo: cuerpo ?? (metodo === 'GET' ? undefined : {}), cookie, csrf });

  describe('defensa por IP', () => {
    it('un sondeo de /.env bloquea la IP: todo lo que pida después da 403, otras IPs no se ven afectadas', async () => {
      const ip = ipNueva();
      const otra = ipNueva();
      assert.equal((await pedir('GET', '/health', { ip })).status, 200);
      const directo = await fetch(`http://${HOST}/.env`, { headers: { 'x-forwarded-for': ip } });
      assert.equal(directo.status, 403);
      assert.equal((await pedir('GET', '/health', { ip })).status, 403, 'bloqueada');
      assert.equal((await pedir('GET', '/health', { ip: otra })).status, 200, 'otra IP sigue bien');
    });

    it('detecta inyección SQL en la URL y en el cuerpo, XSS, comandos, traversal y herramientas', async () => {
      const casos = [
        ['GET', `/productos?q=${encodeURIComponent("x' UNION SELECT usuario, password_hash FROM usuarios--")}`, undefined, {}],
        ['POST', '/auth/login', { usuario: "admin' OR '1'='1", password: 'x' }, {}],
        ['POST', '/auth/login', { usuario: '<script>alert(1)</script>', password: 'x' }, {}],
        ['POST', '/auth/login', { usuario: 'a; cat /etc/passwd', password: 'x' }, {}],
        ['GET', `/productos?archivo=${encodeURIComponent('../../etc/passwd')}`, undefined, {}],
        ['GET', '/health', undefined, { 'user-agent': 'sqlmap/1.7' }],
        ['GET', '/health', undefined, { 'user-agent': 'Mozilla/5.0 (compatible; Nuclei - Open-source project)' }],
      ];
      for (const [metodo, ruta, cuerpo, headers] of casos) {
        const ip = ipNueva();
        const r = await pedir(metodo, ruta, { cuerpo, ip, headers });
        assert.equal(r.status, 403, `${metodo} ${ruta} ${JSON.stringify(cuerpo)}`);
        assert.equal((await pedir('GET', '/health', { ip })).status, 403, `la IP quedó bloqueada (${ruta})`);
      }
    });

    it('no da falsos positivos con texto normal ni con contraseñas raras', async () => {
      const ip = ipNueva();
      const r1 = await pedir('POST', '/auth/login', { cuerpo: { usuario: 'Pan & cat food; 500g -- oferta', password: 'x' }, ip });
      assert.equal(r1.status, 401);
      const r2 = await pedir('POST', '/auth/login', { cuerpo: { usuario: 'nadie', password: "x' OR 1=1 --<script>" }, ip });
      assert.equal(r2.status, 401, 'las contraseñas no se revisan');
      assert.equal((await pedir('GET', '/health', { ip })).status, 200);
    });

    it('15 rutas inexistentes de /api en pocos minutos = enumeración: se bloquea', async () => {
      const ip = ipNueva();
      let ultimo;
      for (let i = 1; i <= 15; i++) {
        ultimo = await pedir('GET', `/no-existe-${i}`, { ip });
        if (i < 15) assert.equal(ultimo.status, 404, `pedido ${i}`);
      }
      assert.equal(ultimo.status, 403);
      assert.equal((await pedir('GET', '/health', { ip })).status, 403);
    });

    it('15 ingresos fallidos desde una IP (cualquier cuenta) = fuerza bruta: se bloquea', async () => {
      const ip = ipNueva();
      for (let i = 1; i <= 15; i++) {
        const r = await pedir('POST', '/auth/login', { cuerpo: { usuario: `cuenta${i}`, password: 'incorrecta-123' }, ip });
        assert.equal(r.status, 401, `intento ${i}`);
      }
      await new Promise((r) => setTimeout(r, 300));
      assert.equal((await pedir('GET', '/health', { ip })).status, 403);
    });

    it('el panel lista los bloqueos con su motivo y permite desbloquear (falso positivo)', async () => {
      const ip = ipNueva();
      await fetch(`http://${HOST}/wp-admin/setup.php`, { headers: { 'x-forwarded-for': ip } });
      const { status, data } = await sa('GET', '/defensa');
      assert.equal(status, 200);
      const fila = data.bloqueadas.find((b) => b.ip === ip);
      assert.ok(fila, 'aparece en la lista');
      assert.equal(fila.motivo, 'sondeo');
      assert.ok(fila.minutos_restantes > 55 && fila.minutos_restantes <= 60);
      assert.ok(data.eventos.some((e) => e.ip === ip && e.tipo === 'sondeo'));
      assert.ok(data.motivos.sondeo);

      assert.equal((await sa('POST', '/defensa/desbloquear', { id: fila.id })).status, 200);
      assert.equal((await pedir('GET', '/health', { ip })).status, 200, 'ya puede entrar');
      assert.equal((await sa('POST', '/defensa/desbloquear', { id: fila.id })).status, 404, 'ya estaba liberado');
    });

    it('la reincidencia escala la duración: 1 hora, 24 horas, 7 días', async () => {
      const ip = ipNueva();
      const esperado = [60, 1440, 10080];
      for (const minutos of esperado) {
        await fetch(`http://${HOST}/.git/config`, { headers: { 'x-forwarded-for': ip } });
        const { data } = await sa('GET', '/defensa');
        const fila = data.bloqueadas.find((b) => b.ip === ip);
        assert.ok(fila);
        assert.ok(Math.abs(fila.minutos_restantes - minutos) <= 1, `esperaba ~${minutos} y fue ${fila.minutos_restantes}`);
        await sa('POST', '/defensa/desbloquear', { id: fila.id });
      }
      const filas = await consultar(urlBase, 'SELECT reincidencia FROM ips_bloqueadas WHERE ip = $1 ORDER BY id', [ip]);
      assert.deepEqual(filas.map((f) => f.reincidencia), [1, 2, 3]);
    });

    it('bloqueo manual: valida la IP y la duración, y bloquea de verdad', async () => {
      assert.equal((await sa('POST', '/defensa/bloquear', { ip: 'no-es-una-ip', minutos: 10 })).status, 400);
      assert.equal((await sa('POST', '/defensa/bloquear', { ip: '198.51.100.7', minutos: 0 })).status, 400);
      const ip = ipNueva();
      assert.equal((await sa('POST', '/defensa/bloquear', { ip, minutos: 30, detalle: 'prueba' })).status, 200);
      assert.equal((await pedir('GET', '/health', { ip })).status, 403);
      assert.equal((await sa('POST', '/defensa/bloquear', { ip, minutos: 30 })).status, 409, 'ya estaba bloqueada');
    });

    it('los bloqueos sobreviven a un reinicio del servidor y "desbloquear todas" los libera', async () => {
      const ip = ipNueva();
      await fetch(`http://${HOST}/phpmyadmin/`, { headers: { 'x-forwarded-for': ip } });
      assert.equal((await pedir('GET', '/health', { ip })).status, 403);

      servidor.kill();
      await new Promise((r) => setTimeout(r, 500));
      await arrancar();
      assert.equal((await pedir('GET', '/health', { ip })).status, 403, 'sigue bloqueada tras reiniciar');

      // La sesión del superadmin sigue vigente (está en la base).
      const r = await sa('POST', '/defensa/desbloquear-todas');
      assert.equal(r.status, 200);
      assert.ok(r.data.liberadas >= 1);
      assert.equal((await pedir('GET', '/health', { ip })).status, 200);
      const { data } = await sa('GET', '/defensa');
      assert.equal(data.bloqueadas.length, 0);
    });

    it('la IP del propio servidor (127.0.0.1) y las de la lista de permitidas nunca se bloquean', async () => {
      const r = await fetch(`http://${HOST}/.env`);
      assert.notEqual(r.status, 403, 'loopback exenta');
      assert.equal((await pedir('GET', '/health')).status, 200);
    });

    it('el panel de defensa exige sesión de superadmin', async () => {
      for (const [m, r] of [['GET', '/sa/defensa'], ['POST', '/sa/defensa/desbloquear-todas'], ['POST', '/sa/backup']]) {
        assert.equal((await pedir(m, r, { cuerpo: m === 'POST' ? {} : undefined })).status, 401, `${m} ${r}`);
      }
    });
  });

  describe('backup completo', () => {
    const TABLAS = ['usuarios', 'categorias', 'unidades_medida', 'proveedores', 'productos', 'lotes', 'ventas', 'venta_items', 'configuracion', 'instancia'];
    let archivo;
    let antes;

    async function foto(url) {
      const out = {};
      for (const t of TABLAS) {
        out[t] = (await consultar(url, `SELECT to_jsonb(x)::text AS r FROM ${t} x ORDER BY 1`)).map((f) => f.r);
      }
      return out;
    }

    it('descargar: exige contraseña de 12+ caracteres y el archivo sale cifrado', async () => {
      // Datos con casos difíciles: tildes, comillas, montos que no caben en 32 bits, fechas, NULL.
      await consultar(urlBase, `INSERT INTO unidades_medida (nombre) VALUES ('unidad')`);
      await consultar(urlBase, `INSERT INTO categorias (nombre) VALUES ('Bebidas "frías" ñ')`);
      await consultar(urlBase, `INSERT INTO proveedores (nombre, telefono) VALUES ('Ñandú S.A. ''Sur'' \\ /', NULL)`);
      await consultar(
        urlBase,
        `INSERT INTO productos (nombre, codigo_barras, precio_costo, precio_venta, proveedor_id, unidad_medida_id, categoria_id)
         VALUES ('Vino 🍷 2026', '7791234567890', 2500000000, 4200000000, 1, 1, 1)`
      );
      await consultar(urlBase, `INSERT INTO lotes (producto_id, cantidad, fecha_ingreso, fecha_vencimiento) VALUES (1, 24, '2026-09-01', NULL), (1, 6, '2026-09-02', '2027-01-31')`);
      await consultar(urlBase, `INSERT INTO ventas (usuario_id, medio_pago, total) VALUES (1, 'efectivo', 8400000000)`);
      await consultar(urlBase, `INSERT INTO venta_items (venta_id, producto_id, lote_id, cantidad, precio_unitario, subtotal) VALUES (1, 1, 1, 2, 4200000000, 8400000000)`);
      antes = await foto(urlBase);
      assert.ok(antes.productos.length === 1 && antes.usuarios.length === 1);

      assert.equal((await sa('POST', '/backup', {})).status, 400, 'sin contraseña');
      assert.equal((await sa('POST', '/backup', { password: 'corta' })).status, 400, 'contraseña corta');

      const res = await pedir('POST', '/sa/backup', { cuerpo: { password: CLAVE_BACKUP }, cookie, csrf, raw: true });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-disposition'), /attachment; filename="ceavital-backup-\d{8}-\d{6}\.ceavbak"/);
      assert.match(res.headers.get('cache-control'), /no-store/);
      const bytes = Buffer.from(await res.arrayBuffer());
      archivo = path.join(os.tmpdir(), `test-${sufijo}.ceavbak`);
      fs.writeFileSync(archivo, bytes);

      assert.equal(bytes.subarray(0, 8).toString(), 'CEAVBK01');
      for (const secreto of ['Ñandú', '7791234567890', 'password_hash', 'admin_test', '"tablas"']) {
        assert.ok(!bytes.includes(Buffer.from(secreto)), `no puede haber texto legible (${secreto})`);
      }
      assert.equal((await sa('POST', '/backup', {})).status, 400);
    });

    it('sin csrf no se puede descargar', async () => {
      const r = await pedir('POST', '/sa/backup', { cuerpo: { password: CLAVE_BACKUP }, cookie });
      assert.equal(r.status, 403);
    });

    it('restaurar con otra contraseña, o con el archivo alterado, falla y no toca nada', async () => {
      const correr = (ruta, clave, url = urlBase) =>
        spawnSync(process.execPath, ['src/db/restaurar-backup.js', ruta, '--confirmar'], {
          cwd: RAIZ,
          env: { ...entorno, DATABASE_URL: url, BACKUP_PASSWORD: clave },
          encoding: 'utf8',
        });

      const mala = correr(archivo, 'otra-clave-distinta-1');
      assert.notEqual(mala.status, 0);
      assert.match(mala.stderr, /Contraseña incorrecta o archivo dañado/);

      const alterado = Buffer.from(fs.readFileSync(archivo));
      alterado[Math.floor(alterado.length / 2)] ^= 0xff;
      const rutaAlterada = archivo.replace('.ceavbak', '-alterado.ceavbak');
      fs.writeFileSync(rutaAlterada, alterado);
      const r2 = correr(rutaAlterada, CLAVE_BACKUP);
      assert.notEqual(r2.status, 0);
      assert.match(r2.stderr, /Contraseña incorrecta o archivo dañado/);

      const cortado = alterado.subarray(0, Math.floor(alterado.length * 0.6));
      const rutaCortada = archivo.replace('.ceavbak', '-cortado.ceavbak');
      fs.writeFileSync(rutaCortada, cortado);
      assert.notEqual(correr(rutaCortada, CLAVE_BACKUP).status, 0);

      const sinConfirmar = spawnSync(process.execPath, ['src/db/restaurar-backup.js', archivo], { cwd: RAIZ, env: { ...entorno, BACKUP_PASSWORD: CLAVE_BACKUP }, encoding: 'utf8' });
      assert.match(sinConfirmar.stdout, /--confirmar/);

      assert.deepEqual(await foto(urlBase), antes, 'los datos siguen intactos');
    });

    it('restaura en OTRA base (migrar a otra app) y queda idéntica, con los contadores al día', async () => {
      const r = spawnSync(process.execPath, ['src/db/restaurar-backup.js', archivo, '--confirmar'], {
        cwd: RAIZ,
        env: { ...entorno, DATABASE_URL: urlBase2, BACKUP_PASSWORD: CLAVE_BACKUP },
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stderr || r.stdout);
      assert.match(r.stdout, /restaurado/);

      const despues = await foto(urlBase2);
      // instancia lleva su propia fecha de actualización: se compara igual porque viaja en el backup.
      assert.deepEqual(despues, antes);
      assert.equal((await consultar(urlBase2, 'SELECT COUNT(*)::int AS n FROM superadmin'))[0].n, 0, 'la cuenta de CEA no viaja');

      // El siguiente alta toma un id nuevo, no choca con los restaurados.
      await consultar(urlBase2, `INSERT INTO categorias (nombre) VALUES ('Nueva')`);
      const ids = (await consultar(urlBase2, 'SELECT id FROM categorias ORDER BY id')).map((f) => f.id);
      assert.deepEqual(ids, [1, 2]);
    });

    it('restaura sobre la misma base después de un desastre, y todo vuelve como estaba', async () => {
      await consultar(urlBase, 'DELETE FROM venta_items');
      await consultar(urlBase, 'DELETE FROM ventas');
      await consultar(urlBase, 'DELETE FROM lotes');
      await consultar(urlBase, `UPDATE productos SET nombre = 'ROTO', precio_venta = 1`);
      await consultar(urlBase, `INSERT INTO proveedores (nombre) VALUES ('Basura posterior al backup')`);
      assert.notDeepEqual(await foto(urlBase), antes);

      const r = spawnSync(process.execPath, ['src/db/restaurar-backup.js', archivo, '--confirmar'], {
        cwd: RAIZ,
        env: { ...entorno, BACKUP_PASSWORD: CLAVE_BACKUP },
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stderr || r.stdout);
      assert.deepEqual(await foto(urlBase), antes);
    });

    it('el backup no arrastra sesiones ni la cuenta del superadmin, y la app sigue andando', async () => {
      // La restauración vació sesiones_activas (cascada desde usuarios) pero no tocó al superadmin.
      const login = await pedir('POST', '/auth/login', { cuerpo: { usuario: 'admin_test', password: 'ClaveSegura123' } });
      assert.equal(login.status, 200, 'el Admin del negocio restaurado puede entrar con su contraseña');
      assert.equal((await sa('GET', '/panel')).status, 200, 'el superadmin sigue con su sesión');
    });

  });
});
