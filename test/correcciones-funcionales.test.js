// Tests de las correcciones de la verificación funcional (topes de longitud, usuario sin
// distinguir mayúsculas, contención SERIALIZABLE, plan inexistente, montos no numéricos, orden
// de los ítems de una venta, barrido de temporales de restauración, detalle del PDF).
// Necesitan un Postgres: TEST_DATABASE_URL apunta a cualquier base del servidor de TEST
// (solo se usa para crear y borrar una base descartable propia). Nunca apuntarlo a producción.
//   TEST_DATABASE_URL=postgres://... npm test
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
const BASE_URL = `http://127.0.0.1:${PUERTO}/api`;
const sufijo = randomBytes(4).toString('hex');
const nombreBase = `ceavital_test_corr_${sufijo}`;
const CLAVE_SA = 'ClaveSuperadmin-2026';
// Carpeta temporal propia del servidor (ver restauracion-web.test.js): el barrido de arranque
// no puede llevarse los archivos pendientes de otros tests que corren en paralelo.
const carpetaTemporal = fs.mkdtempSync(path.join(os.tmpdir(), 'ceavital-test-corr-'));
const dirRestauracion = path.join(carpetaTemporal, 'ceavital-restauracion');

let servidor;
let urlBase;
let cookie = '';
let cookieSa = '';
let csrfSa = '';
const admin = ADMIN_URL ? new pg.Client({ connectionString: ADMIN_URL }) : null;

async function api(metodo, ruta, cuerpo, { sa = false } = {}) {
  const headers = { 'content-type': 'application/json', cookie: sa ? cookieSa : cookie };
  if (sa) headers['x-csrf-token'] = csrfSa;
  const res = await fetch(BASE_URL + ruta, { method: metodo, headers, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: res.status, data, res };
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

const cookiesDe = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

describe('correcciones de la verificación funcional', { skip: !ADMIN_URL && 'falta TEST_DATABASE_URL' }, () => {
  before(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nombreBase}`);
    const u = new URL(ADMIN_URL);
    u.pathname = `/${nombreBase}`;
    urlBase = u.toString();

    const entorno = {
      ...process.env,
      DATABASE_URL: urlBase,
      PORT: String(PUERTO),
      HTTPS_MODE: 'proxy',
      NODE_ENV: 'test',
      TMPDIR: carpetaTemporal,
      TMP: carpetaTemporal,
      TEMP: carpetaTemporal,
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

    // Restos de una restauración anterior: el servidor tiene que barrerlos al arrancar.
    fs.mkdirSync(dirRestauracion, { recursive: true });
    fs.writeFileSync(path.join(dirRestauracion, 'viejo-1.ceavbak.tmp'), 'cifrado');
    fs.writeFileSync(path.join(dirRestauracion, 'viejo-2.ceavbak.tmp'), 'cifrado');
    fs.writeFileSync(path.join(dirRestauracion, 'otro-archivo.txt'), 'no es un temporal de backup');

    servidor = spawn(process.execPath, ['src/server.js'], { cwd: RAIZ, env: entorno, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(BASE_URL + '/health')).ok) break;
      } catch {
        /* todavía arrancando */
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    // El login del negocio no distingue mayúsculas: se entra con el usuario en mayúsculas.
    const login = await api('POST', '/auth/login', { usuario: 'ADMIN_TEST', password: 'ClaveSegura123' });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    cookie = cookiesDe(login.res);

    const loginSa = await api('POST', '/auth/login', { usuario: 'cea', password: CLAVE_SA });
    assert.equal(loginSa.status, 200, JSON.stringify(loginSa.data));
    cookieSa = cookiesDe(loginSa.res);
    csrfSa = loginSa.data.csrf_token;

    await consultar(`INSERT INTO unidades_medida (nombre) VALUES ('unidad')`);
  });

  after(async () => {
    servidor?.kill();
    try {
      const { default: db } = await import('../src/db/connection.js');
      await db.cerrar();
    } catch {
      /* nunca se llegó a conectar */
    }
    fs.rmSync(carpetaTemporal, { recursive: true, force: true });
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${nombreBase} WITH (FORCE)`);
      await admin.end();
    }
  });

  describe('topes de longitud (nombre, código de barras, usuario)', () => {
    it('productos: nombre y código de barras muy largos dan 400 (alta y PATCH); en el tope se aceptan', async () => {
      const base = { unidad_medida_id: 1, precio_costo: 10, precio_venta: 20 };
      const largo = await api('POST', '/productos', { ...base, nombre: 'x'.repeat(90_000) });
      assert.equal(largo.status, 400);
      assert.match(largo.data.error, /nombre no puede superar 200 caracteres/);
      assert.equal((await api('POST', '/productos', { ...base, nombre: 'Ok', codigo_barras: '7'.repeat(51) })).status, 400);

      const ok = await api('POST', '/productos', { ...base, nombre: 'n'.repeat(200), codigo_barras: '7'.repeat(50) });
      assert.equal(ok.status, 201, JSON.stringify(ok.data));
      const id = ok.data.id;
      assert.equal((await api('PATCH', `/productos/${id}`, { nombre: 'x'.repeat(201) })).status, 400);
      assert.equal((await api('PATCH', `/productos/${id}`, { codigo_barras: '8'.repeat(51) })).status, 400);
      assert.equal((await api('PATCH', `/productos/${id}`, { nombre: 'Corto' })).status, 200);
    });

    it('proveedores: nombre (y el resto de los textos) muy largos dan 400 (alta y PATCH)', async () => {
      const largo = await api('POST', '/proveedores', { nombre: 'x'.repeat(90_000) });
      assert.equal(largo.status, 400);
      assert.match(largo.data.error, /nombre no puede superar 200 caracteres/);
      assert.equal((await api('POST', '/proveedores', { nombre: 'Ok', email: 'a'.repeat(201) })).status, 400);
      const ok = await api('POST', '/proveedores', { nombre: 'n'.repeat(200) });
      assert.equal(ok.status, 201, JSON.stringify(ok.data));
      assert.equal((await api('PATCH', `/proveedores/${ok.data.id}`, { nombre: 'x'.repeat(201) })).status, 400);
      assert.equal((await api('PATCH', `/proveedores/${ok.data.id}`, { nombre: 'Corto' })).status, 200);
    });

    it('usuarios: nombre y usuario muy largos dan 400 (alta y PATCH)', async () => {
      const base = { rol: 'cajero', password: 'ClaveSegura123' };
      const largo = await api('POST', '/usuarios', { ...base, nombre: 'x'.repeat(90_000), usuario: 'largo_1' });
      assert.equal(largo.status, 400);
      assert.match(largo.data.error, /nombre no puede superar 200 caracteres/);
      assert.equal((await api('POST', '/usuarios', { ...base, nombre: 'Ok', usuario: 'u'.repeat(101) })).status, 400);

      const ok = await api('POST', '/usuarios', { ...base, nombre: 'Cajero Largo', usuario: 'u'.repeat(100) });
      assert.equal(ok.status, 201, JSON.stringify(ok.data));
      assert.equal((await api('PATCH', `/usuarios/${ok.data.id}`, { nombre: 'x'.repeat(201) })).status, 400);
      assert.equal((await api('PATCH', `/usuarios/${ok.data.id}`, { usuario: 'u'.repeat(101) })).status, 400);
    });
  });

  describe('usuario del negocio sin distinguir mayúsculas', () => {
    it('no se puede crear ni renombrar a un usuario que solo cambia en mayúsculas', async () => {
      const base = { nombre: 'Encargado V', rol: 'encargado', password: 'ClaveSegura123' };
      const primero = await api('POST', '/usuarios', { ...base, usuario: 'admin_v' });
      assert.equal(primero.status, 201, JSON.stringify(primero.data));

      const repetido = await api('POST', '/usuarios', { ...base, usuario: 'Admin_V' });
      assert.equal(repetido.status, 409, JSON.stringify(repetido.data));
      assert.match(repetido.data.error, /Ya existe un usuario activo/);

      const otro = await api('POST', '/usuarios', { ...base, usuario: 'otro_v' });
      assert.equal(otro.status, 201);
      assert.equal((await api('PATCH', `/usuarios/${otro.data.id}`, { usuario: 'ADMIN_V' })).status, 409);
      // Su propio usuario, cambiando solo las mayúsculas, sí se puede.
      assert.equal((await api('PATCH', `/usuarios/${primero.data.id}`, { usuario: 'Admin_V' })).status, 200);
    });

    it('el índice único de la base también lo impide (respaldo de la validación)', async () => {
      await assert.rejects(
        consultar(`INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('X', 'OTRO_V', 'hash', 'cajero')`),
        (err) => err.code === '23505'
      );
    });

    it('el login acepta el usuario en cualquier combinación de mayúsculas', async () => {
      // Otro rol que el del admin: el login duplicado del mismo rol expulsaría la sesión de los demás tests.
      const login = await api('POST', '/auth/login', { usuario: 'ADMIN_v', password: 'ClaveSegura123' });
      assert.equal(login.status, 200, JSON.stringify(login.data));
      assert.equal(login.data.usuario?.rol ?? login.data.rol, 'encargado');
      const mala = await api('POST', '/auth/login', { usuario: 'ADMIN_v', password: 'incorrecta-123' });
      assert.equal(mala.status, 401);
    });
  });

  describe('contención SERIALIZABLE', () => {
    it('20 ventas simultáneas del mismo producto: ninguna da 500, las que fallan dan 409 y el stock cuadra', async () => {
      await consultar(
        `INSERT INTO productos (nombre, precio_costo, precio_venta, unidad_medida_id) VALUES ('Producto Concurrido', 10, 20, 1)`
      );
      const [{ id: productoId }] = await consultar(`SELECT id FROM productos WHERE nombre = 'Producto Concurrido'`);
      await consultar(`INSERT INTO lotes (producto_id, cantidad, fecha_ingreso) VALUES ($1, 1000, '2026-09-01')`, [productoId]);

      const N = 20;
      const respuestas = await Promise.all(
        Array.from({ length: N }, () => api('POST', '/ventas', { medio_pago: 'efectivo', items: [{ producto_id: productoId, cantidad: 1 }] }))
      );
      const estados = respuestas.map((r) => r.status);
      assert.ok(!estados.includes(500), `no puede haber 500: ${estados.join(',')}`);
      for (const r of respuestas) {
        assert.ok(r.status === 201 || r.status === 409, `estado inesperado ${r.status}: ${JSON.stringify(r.data)}`);
        if (r.status === 409) assert.match(r.data.error, /ocupado, volvé a intentar/);
      }
      const exitosas = estados.filter((s) => s === 201).length;
      assert.ok(exitosas > 0);

      const [{ restante }] = await consultar(`SELECT SUM(cantidad)::int AS restante FROM lotes WHERE producto_id = $1`, [productoId]);
      assert.equal(restante, 1000 - exitosas, 'el stock descontado coincide con las ventas que salieron');
      const [{ ventas }] = await consultar(`SELECT COUNT(*)::int AS ventas FROM venta_items WHERE producto_id = $1`, [productoId]);
      assert.equal(ventas, exitosas);
    });

    it('si se agotan los reintentos por conflicto, db.transaction responde un 409 amable (no un 500)', async () => {
      process.env.DATABASE_URL = urlBase;
      const { default: db } = await import('../src/db/connection.js');
      let intentos = 0;
      await assert.rejects(
        db.transaction(async () => {
          intentos += 1;
          throw Object.assign(new Error('could not serialize access'), { code: '40001' });
        }),
        (err) => err.status === 409 && err.message === 'El sistema está ocupado, volvé a intentar'
      );
      assert.equal(intentos, 6, 'reintenta antes de rendirse');
      // Un error que no es de contención sigue saliendo tal cual.
      await assert.rejects(
        db.transaction(async () => {
          throw Object.assign(new Error('otro'), { code: '23505' });
        }),
        (err) => err.code === '23505'
      );
    });
  });

  describe('plan inexistente', () => {
    it('PUT /sa/plan con "constructor" o "__proto__" da 400 y el plan no cambia', async () => {
      for (const plan of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        const r = await api('PUT', '/sa/plan', { plan }, { sa: true });
        assert.equal(r.status, 400, `${plan}: ${JSON.stringify(r.data)}`);
        assert.match(r.data.error, /plan tiene que ser uno de/);
      }
      assert.equal((await api('PUT', '/sa/plan', { plan: 'empresas' }, { sa: true })).status, 200);
      assert.equal((await api('GET', '/modulos')).status, 200);
    });
  });

  describe('montos que no son números', () => {
    let clienteId;
    before(async () => {
      const c = await api('POST', '/clientes-empresa', { razon_social: 'Cliente Montos SA' });
      assert.equal(c.status, 201, JSON.stringify(c.data));
      clienteId = c.data.id;
    });

    it('pagos y ajustes de cuenta corriente rechazan true, arrays y objetos con 400', async () => {
      for (const ruta of ['pagos', 'ajustes']) {
        for (const monto of [true, [5], { a: 1 }]) {
          const r = await api('POST', `/clientes-empresa/${clienteId}/${ruta}`, { monto, descripcion: 'x' });
          assert.equal(r.status, 400, `${ruta} monto=${JSON.stringify(monto)}: ${JSON.stringify(r.data)}`);
        }
      }
      const [{ n }] = await consultar(`SELECT COUNT(*)::int AS n FROM cuenta_corriente_movimientos WHERE cliente_empresa_id = $1`, [clienteId]);
      assert.equal(n, 0, 'no se guardó ningún movimiento');
      assert.equal((await api('POST', `/clientes-empresa/${clienteId}/pagos`, { monto: 500 })).status, 201);
      assert.equal((await api('POST', `/clientes-empresa/${clienteId}/pagos`, { monto: '300' })).status, 201);
      assert.equal((await api('POST', `/clientes-empresa/${clienteId}/ajustes`, { monto: -100, descripcion: 'corrección' })).status, 201);
    });

    it('gastos y cierre de caja también rechazan booleanos y arrays', async () => {
      assert.equal((await api('POST', '/caja/gastos', { concepto: 'Flete', monto: true })).status, 400);
      assert.equal((await api('POST', '/caja/gastos', { concepto: 'Flete', monto: [5] })).status, 400);
      assert.equal((await api('POST', '/caja/gastos', { concepto: 'Flete', monto: 5 })).status, 201);
      assert.equal((await api('POST', '/caja/cierres', { total_efectivo_contado: true })).status, 400);
      assert.equal((await api('POST', '/caja/cierres', { total_efectivo_contado: 100, fondo_dejado: [5] })).status, 400);
    });
  });

  describe('detalle de una venta', () => {
    it('los ítems salen en orden de creación (los lotes consumidos, en el orden FEFO en que se tomaron)', async () => {
      await consultar(
        `INSERT INTO productos (nombre, precio_costo, precio_venta, unidad_medida_id) VALUES ('Producto en tres lotes', 10, 20, 1)`
      );
      const [{ id: productoId }] = await consultar(`SELECT id FROM productos WHERE nombre = 'Producto en tres lotes'`);
      await consultar(
        `INSERT INTO lotes (producto_id, cantidad, fecha_ingreso, fecha_vencimiento) VALUES
           ($1, 2, '2026-09-01', '2030-03-01'), ($1, 2, '2026-09-01', '2030-01-01'), ($1, 2, '2026-09-01', '2030-02-01')`,
        [productoId]
      );
      const venta = await api('POST', '/ventas', { medio_pago: 'efectivo', items: [{ producto_id: productoId, cantidad: 6 }] });
      assert.equal(venta.status, 201, JSON.stringify(venta.data));
      const detalle = await api('GET', `/ventas/${venta.data.id}`);
      const ids = detalle.data.items.map((i) => i.id);
      assert.equal(ids.length, 3);
      assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    });
  });

  describe('temporales de restauración', () => {
    it('al arrancar, el servidor borra los *.ceavbak.tmp de la carpeta temporal y deja el resto', () => {
      assert.deepEqual(fs.readdirSync(dirRestauracion).sort(), ['otro-archivo.txt']);
    });
  });

  describe('detalle del resumen de cuenta en PDF', () => {
    it('un cargo por venta no repite "Venta #N" en el detalle', async () => {
      process.env.DATABASE_URL = urlBase;
      const { detalleDe } = await import('../src/services/resumen-cuenta-pdf.service.js');
      assert.equal(detalleDe({ venta_id: 385, descripcion: 'Venta #385' }), 'Venta #385');
      assert.equal(detalleDe({ venta_id: 385, descripcion: 'Reversión por anulación de venta #385' }), 'Reversión por anulación de venta #385');
      assert.equal(detalleDe({ venta_id: 12, descripcion: 'Venta #123' }), 'Venta #12 - Venta #123', 'otro número no cuenta como repetido');
      assert.equal(detalleDe({ venta_id: 7, descripcion: null }), 'Venta #7');
      assert.equal(detalleDe({ venta_id: null, descripcion: 'Pago en efectivo' }), 'Pago en efectivo');
    });
  });
});
