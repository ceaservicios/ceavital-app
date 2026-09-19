// Tests de integración del interruptor de módulos (planes fijos). Necesitan un
// Postgres: TEST_DATABASE_URL apunta a cualquier base del servidor de TEST (solo se
// usa para crear y borrar una base descartable propia). Nunca apuntarlo a producción.
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
const PUERTO = 18000 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://127.0.0.1:${PUERTO}/api`;
const nombreBase = `ceavital_test_${randomBytes(4).toString('hex')}`;

let servidor;
let urlBase;
let cookie = '';
let servicio;
const admin = ADMIN_URL ? new pg.Client({ connectionString: ADMIN_URL }) : null;

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(BASE_URL + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', cookie },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: res.status, data, res };
}

// Consulta directa a la base descartable (para preparar estados que la API no permite).
async function consultar(texto, params = []) {
  const c = new pg.Client({ connectionString: urlBase });
  await c.connect();
  try {
    return (await c.query(texto, params)).rows;
  } finally {
    await c.end();
  }
}

const fijarPlan = (plan) =>
  consultar(
    `INSERT INTO configuracion (clave, valor) VALUES ('plan', $1)
     ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor`,
    [plan]
  );

describe('módulos por plan', { skip: !ADMIN_URL && 'falta TEST_DATABASE_URL' }, () => {
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
      PLAN_CACHE_SEGUNDOS: '0',
    };
    const semilla = spawnSync(process.execPath, ['src/db/seed-admin.js', 'Admin Test', 'admin_test', 'ClaveSegura123'], {
      cwd: RAIZ,
      env: entorno,
      encoding: 'utf8',
    });
    assert.equal(semilla.status, 0, semilla.stderr || semilla.stdout);

    servidor = spawn(process.execPath, ['src/server.js'], { cwd: RAIZ, env: entorno, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(BASE_URL + '/health')).ok) break;
      } catch {
        /* todavía arrancando */
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    const login = await api('POST', '/auth/login', { usuario: 'admin_test', password: 'ClaveSegura123' });
    assert.equal(login.status, 200);
    cookie = login.res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');

    // Servicio en proceso, contra la misma base, para probar cambiarPlan.
    process.env.DATABASE_URL = urlBase;
    process.env.PLAN_CACHE_SEGUNDOS = '0';
    servicio = await import('../src/services/modulos.service.js');
  });

  after(async () => {
    servidor?.kill();
    try {
      const { default: db } = await import('../src/db/connection.js');
      await db.cerrar();
    } catch {
      /* nunca se llegó a conectar */
    }
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${nombreBase} WITH (FORCE)`);
      await admin.end();
    }
  });

  it('sin plan guardado rige el plan por defecto, con todos los módulos', async () => {
    const { status, data } = await api('GET', '/modulos');
    assert.equal(status, 200);
    assert.deepEqual(data.modulos, ['nucleo', 'clientes_empresa', 'pedidos', 'portal']);
    assert.equal((await api('GET', '/clientes-empresa')).status, 200);
    assert.equal((await api('GET', '/pedidos-cliente')).status, 200);
    assert.equal((await api('GET', '/condiciones-pago')).status, 200);
    assert.notEqual((await api('POST', '/portal/login', {})).status, 404);
  });

  it('plan Comercio: solo núcleo, y las rutas de los otros módulos dan 404', async () => {
    await fijarPlan('comercio');
    assert.deepEqual((await api('GET', '/modulos')).data.modulos, ['nucleo']);
    for (const ruta of ['/clientes-empresa', '/clientes-empresa/1/acceso', '/pedidos-cliente', '/condiciones-pago', '/portal/catalogo']) {
      assert.equal((await api('GET', ruta)).status, 404, ruta);
    }
    assert.equal((await api('POST', '/portal/login', {})).status, 404);
    // El núcleo sigue andando.
    assert.equal((await api('GET', '/categorias')).status, 200);
    assert.equal((await api('GET', '/caja/resumen')).status, 200);
  });

  it('plan Comercio: no se puede vender a cuenta corriente', async () => {
    const { status, data } = await api('POST', '/ventas', { medio_pago: 'cta_cte', cliente_empresa_id: 1, items: [] });
    assert.equal(status, 400);
    assert.match(data.error, /medio_pago/);
  });

  it('plan Comercio: el resumen de caja sigue trayendo el total de cuenta corriente (en 0)', async () => {
    const { data } = await api('GET', '/caja/resumen');
    assert.equal(data.total_cta_cte, 0);
  });

  it('un plan desconocido en la base usa el más chico, nunca abre módulos', async () => {
    await fijarPlan('inventado');
    assert.deepEqual((await api('GET', '/modulos')).data.modulos, ['nucleo']);
  });

  it('cambiarPlan rechaza un plan que no existe', async () => {
    await assert.rejects(() => servicio.cambiarPlan('nada'), { status: 400 });
  });

  it('apagar y volver a encender un módulo conserva los datos', async () => {
    await servicio.cambiarPlan('empresas');
    const creado = await api('POST', '/clientes-empresa', { razon_social: 'Cliente Prueba SA' });
    assert.equal(creado.status, 201, JSON.stringify(creado.data));
    const id = creado.data.id ?? creado.data.cliente?.id;
    assert.ok(id);

    await servicio.cambiarPlan('comercio');
    assert.equal((await api('GET', '/clientes-empresa')).status, 404);

    await servicio.cambiarPlan('empresas');
    const lista = await api('GET', '/clientes-empresa');
    assert.equal(lista.status, 200);
    assert.ok(lista.data.clientes.some((c) => c.id === id));
  });

  it('bajar a un plan sin portal cierra las sesiones de clientes abiertas', async () => {
    await servicio.cambiarPlan('empresas');
    const [{ id: clienteId }] = await consultar(`SELECT id FROM clientes_empresa LIMIT 1`);
    await consultar(`INSERT INTO sesiones_cliente (cliente_empresa_id, token) VALUES ($1, 'token-de-prueba')`, [clienteId]);

    await servicio.cambiarPlan('comercio');
    const [sesion] = await consultar(`SELECT estado, motivo_cierre FROM sesiones_cliente WHERE token = 'token-de-prueba'`);
    assert.equal(sesion.estado, 'cerrada');
    assert.equal(sesion.motivo_cierre, 'portal_deshabilitado');
  });

  it('bajar a un plan sin Pedidos se bloquea mientras haya pedidos pendientes', async () => {
    await servicio.cambiarPlan('empresas');
    const [{ id: clienteId }] = await consultar(`SELECT id FROM clientes_empresa LIMIT 1`);
    await consultar(`INSERT INTO pedidos_cliente (cliente_empresa_id, total) VALUES ($1, 100)`, [clienteId]);

    await assert.rejects(() => servicio.cambiarPlan('comercio'), { status: 409 });
    assert.equal((await api('GET', '/modulos')).data.modulos.length, 4, 'el plan no cambió');

    await consultar(`UPDATE pedidos_cliente SET estado = 'rechazado'`);
    await servicio.cambiarPlan('comercio');
    assert.deepEqual((await api('GET', '/modulos')).data.modulos, ['nucleo']);
  });
});
