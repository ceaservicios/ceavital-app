// Tests de integración del superadmin (/api/sa). Necesitan un Postgres: TEST_DATABASE_URL
// apunta a cualquier base del servidor de TEST (solo se usa para crear y borrar una base
// descartable propia). Nunca apuntarlo a producción.
//   TEST_DATABASE_URL=postgres://... npm test
//
// El login del superadmin tiene un tope de 10 pedidos cada 15 minutos por IP: la suite
// está armada para gastar menos que eso.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const PUERTO = 19000 + Math.floor(Math.random() * 1000);
const HOST = `127.0.0.1:${PUERTO}`;
const BASE_URL = `http://${HOST}/api`;
const nombreBase = `ceavital_test_sa_${randomBytes(4).toString('hex')}`;
const CLAVE_SA = 'ClaveSuperadmin-2026';

let servidor;
let servidor2; // segundo servidor (contador de ingresos por IP propio)
let urlBase;
let entorno;
const admin = ADMIN_URL ? new pg.Client({ connectionString: ADMIN_URL }) : null;

// Cada "navegador" guarda sus cookies aparte (negocio y superadmin no se mezclan).
function nuevoNavegador() {
  return { cookies: new Map(), csrf: null };
}

async function api(nav, metodo, ruta, cuerpo, extra = {}) {
  const headers = { 'content-type': 'application/json', ...extra.headers };
  if (nav.cookies.size) headers.cookie = [...nav.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  if (extra.csrf !== null && (extra.csrf ?? nav.csrf)) headers['x-csrf-token'] = extra.csrf ?? nav.csrf;
  const res = await fetch(BASE_URL + ruta, { method: metodo, headers, body: cuerpo && metodo !== 'GET' ? JSON.stringify(cuerpo) : undefined });
  for (const c of res.headers.getSetCookie()) {
    const [par] = c.split(';');
    const i = par.indexOf('=');
    const valor = par.slice(i + 1);
    if (valor) nav.cookies.set(par.slice(0, i), valor);
    else nav.cookies.delete(par.slice(0, i));
  }
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

// Ingreso al segundo servidor (puerto PUERTO + 1), que tiene su propio contador por IP.
async function loginServidor2(nav, cuerpo) {
  const res = await fetch(`http://127.0.0.1:${PUERTO + 1}/api/sa/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  for (const c of res.headers.getSetCookie()) nav.cookies.set(c.split(';')[0].split('=')[0], 'x');
  return { status: res.status };
}

describe('superadmin', { skip: !ADMIN_URL && 'falta TEST_DATABASE_URL' }, () => {
  const sa = nuevoNavegador();
  const negocio = nuevoNavegador();

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
      SUPERADMIN_USUARIO: 'cea',
      SUPERADMIN_PASSWORD: CLAVE_SA,
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
  });

  after(async () => {
    servidor?.kill();
    servidor2?.kill();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${nombreBase} WITH (FORCE)`);
      await admin.end();
    }
  });

  it('la cuenta se crea sola con las variables de entorno, y la contraseña no queda en claro', async () => {
    const filas = await consultar('SELECT usuario, password_hash FROM superadmin');
    assert.equal(filas.length, 1);
    assert.equal(filas[0].usuario, 'cea');
    assert.ok(filas[0].password_hash.startsWith('$2'), 'tiene que ser un hash bcrypt');
    assert.ok(!filas[0].password_hash.includes(CLAVE_SA));
  });

  it('sin sesión, todo el panel da 401 y las credenciales malas dan el mismo mensaje', async () => {
    const anonimo = nuevoNavegador();
    for (const [m, r] of [['GET', '/sa/me'], ['GET', '/sa/panel'], ['GET', '/sa/acciones'], ['PUT', '/sa/plan'], ['PUT', '/sa/cuota'], ['POST', '/sa/suspender'], ['POST', '/sa/reactivar'], ['POST', '/sa/logout']]) {
      assert.equal((await api(anonimo, m, r, {})).status, 401, `${m} ${r}`);
    }
    const usuarioMalo = await api(anonimo, 'POST', '/sa/login', { usuario: 'nadie', password: 'x'.repeat(14) });
    const passwordMala = await api(anonimo, 'POST', '/sa/login', { usuario: 'cea', password: 'x'.repeat(14) });
    assert.equal(usuarioMalo.status, 401);
    assert.equal(passwordMala.status, 401);
    assert.equal(usuarioMalo.data.error, passwordMala.data.error, 'no debe delatar si el usuario existe');
  });

  it('login correcto: cookie propia HttpOnly, SameSite=Strict y limitada a /api/sa, más el token CSRF', async () => {
    const r = await api(sa, 'POST', '/sa/login', { usuario: 'cea', password: CLAVE_SA });
    assert.equal(r.status, 200);
    assert.equal(r.data.superadmin.usuario, 'cea');
    assert.match(r.data.csrf_token, /^[0-9a-f]{64}$/);
    sa.csrf = r.data.csrf_token;

    const cookie = r.res.headers.getSetCookie().find((c) => c.startsWith('sa_token='));
    assert.ok(cookie, 'tiene que fijar sa_token');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\/api\/sa/i);
    assert.match(cookie, /Secure/i);
    assert.match(r.res.headers.get('cache-control'), /no-store/);

    const me = await api(sa, 'GET', '/sa/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.csrf_token, sa.csrf);
  });

  it('el panel muestra plan, planes, versión, estado y cuota', async () => {
    const { status, data } = await api(sa, 'GET', '/sa/panel');
    assert.equal(status, 200);
    assert.equal(data.plan.id, 'empresas');
    assert.deepEqual(data.planes.map((p) => p.id), ['comercio', 'empresas']);
    assert.ok(data.version);
    assert.equal(data.instancia.estado, 'activa');
    assert.equal(data.instancia.cuota.estado, 'sin_definir');
    assert.ok(Array.isArray(data.acciones));
  });

  it('CSRF: un pedido que modifica algo sin token, con token ajeno o desde otro origen se rechaza', async () => {
    const sinToken = await api(sa, 'PUT', '/sa/plan', { plan: 'comercio' }, { csrf: null });
    assert.equal(sinToken.status, 403);
    const tokenAjeno = await api(sa, 'PUT', '/sa/plan', { plan: 'comercio' }, { csrf: 'a'.repeat(64) });
    assert.equal(tokenAjeno.status, 403);
    const otroOrigen = await api(sa, 'PUT', '/sa/plan', { plan: 'comercio' }, { headers: { origin: 'http://sitio-malo.example' } });
    assert.equal(otroOrigen.status, 403);
    // Nada de eso cambió el plan.
    assert.equal((await api(sa, 'GET', '/sa/panel')).data.plan.id, 'empresas');
    // Con el token y el origen propios sí pasa el filtro (el mismo pedido válido se usa abajo).
    const propio = await api(sa, 'PUT', '/sa/plan', { plan: 'empresas' }, { headers: { origin: `http://${HOST}` } });
    assert.equal(propio.status, 200);
  });

  it('aislamiento: la sesión del negocio no abre el panel y la del superadmin no abre el sistema', async () => {
    const login = await api(negocio, 'POST', '/auth/login', { usuario: 'admin_test', password: 'ClaveSegura123' });
    assert.equal(login.status, 200);
    assert.ok(negocio.cookies.has('sesion_token'));
    assert.equal((await api(negocio, 'GET', '/sa/panel')).status, 401);
    assert.equal((await api(negocio, 'PUT', '/sa/plan', { plan: 'comercio' })).status, 401);

    // Un token de superadmin mandado como si fuera la cookie del negocio no vale.
    const impostor = nuevoNavegador();
    impostor.cookies.set('sesion_token', sa.cookies.get('sa_token'));
    assert.equal((await api(impostor, 'GET', '/auth/me')).status, 401);
    const conSa = nuevoNavegador();
    conSa.cookies.set('sa_token', sa.cookies.get('sa_token'));
    assert.equal((await api(conSa, 'GET', '/productos')).status, 401);
    // Y al revés: un token del negocio como cookie de superadmin tampoco.
    const alReves = nuevoNavegador();
    alReves.cookies.set('sa_token', negocio.cookies.get('sesion_token'));
    assert.equal((await api(alReves, 'GET', '/sa/panel')).status, 401);
  });

  it('cambiar el plan desde el panel se aplica al instante y queda registrado', async () => {
    assert.equal((await api(sa, 'PUT', '/sa/plan', { plan: 'inexistente' })).status, 400);
    assert.equal((await api(sa, 'PUT', '/sa/plan', {})).status, 400);

    const r = await api(sa, 'PUT', '/sa/plan', { plan: 'comercio' });
    assert.equal(r.status, 200);
    assert.deepEqual((await api(negocio, 'GET', '/modulos')).data.modulos, ['nucleo']);
    assert.equal((await api(negocio, 'GET', '/clientes-empresa')).status, 404);

    assert.equal((await api(sa, 'PUT', '/sa/plan', { plan: 'empresas' })).status, 200);
    assert.equal((await api(negocio, 'GET', '/clientes-empresa')).status, 200);

    const acciones = (await api(sa, 'GET', '/sa/acciones')).data.acciones;
    assert.ok(acciones.some((a) => a.accion === 'plan' && a.detalle === 'plan: comercio' && a.usuario === 'cea'));
  });

  it('cuota: estados por vencer / vencida / vigente, validaciones y borrado', async () => {
    const dia = (delta) => new Date(Date.now() + delta * 86_400_000).toISOString().slice(0, 10);
    const cuota = async (cuerpo) => (await api(sa, 'PUT', '/sa/cuota', cuerpo)).data?.instancia?.cuota;

    assert.equal((await cuota({ vence: dia(5), aviso_dias: 15 })).estado, 'por_vencer');
    assert.equal((await cuota({ vence: dia(-3), aviso_dias: 15 })).estado, 'vencida');
    assert.equal((await cuota({ vence: dia(60), aviso_dias: 15 })).estado, 'vigente');
    assert.equal((await cuota({ vence: null })).estado, 'sin_definir');

    for (const malo of [{ vence: '2026-02-30' }, { vence: 'mañana' }, { vence: 20260101 }, { vence: dia(5), aviso_dias: -1 }, { vence: dia(5), aviso_dias: 1.5 }, { vence: dia(5), aviso_dias: 999 }]) {
      assert.equal((await api(sa, 'PUT', '/sa/cuota', malo)).status, 400, JSON.stringify(malo));
    }
  });

  it('una cuota vencida solo avisa: no suspende ni bloquea a nadie', async () => {
    await api(sa, 'PUT', '/sa/cuota', { vence: '2020-01-01', aviso_dias: 15 });
    assert.equal((await api(negocio, 'GET', '/caja/resumen')).status, 200);
    assert.equal((await api(sa, 'GET', '/sa/panel')).data.instancia.estado, 'activa');
  });

  it('suspender: pide motivo, corta las sesiones abiertas, bloquea los ingresos y no borra nada', async () => {
    assert.equal((await api(sa, 'POST', '/sa/suspender', {})).status, 400);
    assert.equal((await api(sa, 'POST', '/sa/suspender', { motivo: '   ' })).status, 400);
    assert.equal((await api(sa, 'POST', '/sa/suspender', { motivo: 'x'.repeat(501) })).status, 400);

    const usuariosAntes = (await consultar('SELECT COUNT(*)::int AS n FROM usuarios'))[0].n;
    const r = await api(sa, 'POST', '/sa/suspender', { motivo: 'Cuota impaga' });
    assert.equal(r.status, 200);
    assert.equal(r.data.instancia.estado, 'suspendida');
    assert.equal(r.data.instancia.motivo_suspension, 'Cuota impaga');

    // La sesión del negocio que estaba adentro queda cortada.
    assert.equal((await api(negocio, 'GET', '/auth/me')).status, 401);
    // Nadie del negocio ni ningún cliente puede ingresar, y el motivo interno no se filtra.
    const nuevo = nuevoNavegador();
    const loginNegocio = await api(nuevo, 'POST', '/auth/login', { usuario: 'admin_test', password: 'ClaveSegura123' });
    assert.equal(loginNegocio.status, 403);
    assert.ok(!JSON.stringify(loginNegocio.data).includes('Cuota impaga'));
    assert.equal((await api(nuevo, 'POST', '/portal/login', { usuario: 'cliente', password: 'ClaveCliente123' })).status, 403);
    // Los datos se conservan.
    assert.equal((await consultar('SELECT COUNT(*)::int AS n FROM usuarios'))[0].n, usuariosAntes);
    // El superadmin sigue adentro para poder reactivar; suspender dos veces es un error.
    assert.equal((await api(sa, 'POST', '/sa/suspender', { motivo: 'otra vez' })).status, 409);
  });

  it('reactivar: se vuelve a poder ingresar (con una sesión nueva), y no se puede reactivar dos veces', async () => {
    const r = await api(sa, 'POST', '/sa/reactivar', {});
    assert.equal(r.status, 200);
    assert.equal(r.data.instancia.estado, 'activa');
    assert.equal(r.data.instancia.motivo_suspension, null);
    assert.equal((await api(sa, 'POST', '/sa/reactivar', {})).status, 409);

    assert.equal((await api(negocio, 'GET', '/auth/me')).status, 401, 'la sesión vieja no revive');
    const nuevo = nuevoNavegador();
    assert.equal((await api(nuevo, 'POST', '/auth/login', { usuario: 'admin_test', password: 'ClaveSegura123' })).status, 200);
  });

  it('el registro de acciones guarda todo lo que hizo el superadmin, del más nuevo al más viejo', async () => {
    const { acciones } = (await api(sa, 'GET', '/sa/acciones?limite=200')).data;
    const tipos = acciones.map((a) => a.accion);
    for (const esperado of ['login', 'plan', 'cuota', 'suspender', 'reactivar']) assert.ok(tipos.includes(esperado), esperado);
    assert.ok(acciones.every((a, i) => i === 0 || a.id < acciones[i - 1].id));
    assert.ok(acciones.some((a) => a.accion === 'suspender' && a.detalle === 'Cuota impaga'));
  });

  it('el script de reinicio cambia la contraseña, desbloquea y cierra las sesiones abiertas', async () => {
    const corto = spawnSync(process.execPath, ['src/db/reset-superadmin-password.js'], {
      cwd: RAIZ,
      env: { ...entorno, SUPERADMIN_PASSWORD_NUEVA: 'corta' },
      encoding: 'utf8',
    });
    assert.notEqual(corto.status, 0, 'una contraseña corta se rechaza');

    const anterior = (await consultar('SELECT password_hash FROM superadmin'))[0].password_hash;
    const ok = spawnSync(process.execPath, ['src/db/reset-superadmin-password.js'], {
      cwd: RAIZ,
      env: { ...entorno, SUPERADMIN_PASSWORD_NUEVA: 'OtraClaveSuperadmin-2027' },
      encoding: 'utf8',
    });
    assert.equal(ok.status, 0, ok.stderr || ok.stdout);
    assert.notEqual((await consultar('SELECT password_hash FROM superadmin'))[0].password_hash, anterior);
    assert.equal((await consultar(`SELECT COUNT(*)::int AS n FROM sesiones_superadmin WHERE estado = 'activa'`))[0].n, 0);
    assert.equal((await api(sa, 'GET', '/sa/panel')).status, 401, 'la sesión abierta quedó cortada');
  });

  it('SUPERADMIN_USUARIO cambia el nombre de usuario al arrancar (con un email), corta sesiones y deja registro', async () => {
    const puerto2 = PUERTO + 1;
    const proc = spawn(process.execPath, ['src/server.js'], {
      cwd: RAIZ,
      env: { ...entorno, PORT: String(puerto2), SUPERADMIN_USUARIO: 'admin@ceavital.net' },
      stdio: 'ignore',
    });
    servidor2 = proc;
    {
      for (let i = 0; i < 60; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${puerto2}/api/health`)).ok) break;
        } catch {
          /* todavía arrancando */
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.equal((await consultar('SELECT usuario FROM superadmin'))[0].usuario, 'admin@ceavital.net');
      const registro = await consultar(`SELECT detalle FROM superadmin_acciones WHERE accion = 'usuario_cambiado'`);
      assert.equal(registro[0].detalle, 'cea -> admin@ceavital.net');
      // La contraseña guardada no cambia; el usuario viejo ya no entra y el nuevo sí (sin distinguir mayúsculas).
      const otro = nuevoNavegador();
      assert.equal((await api(otro, 'POST', '/sa/login', { usuario: 'cea', password: 'OtraClaveSuperadmin-2027' })).status, 401);
      assert.equal((await api(otro, 'POST', '/sa/login', { usuario: 'Admin@CEAvital.net', password: 'OtraClaveSuperadmin-2027' })).status, 200);
    }
  });

  it('bloqueo: a los 5 intentos fallidos la cuenta se bloquea, incluso para la contraseña correcta', async () => {
    const intruso = nuevoNavegador();
    const estados = [];
    for (let i = 0; i < 5; i++) {
      estados.push((await loginServidor2(intruso, { usuario: 'admin@ceavital.net', password: 'incorrecta-incorrecta' })).status);
    }
    assert.deepEqual(estados, [401, 401, 401, 401, 423]);
    const conLaBuena = await loginServidor2(intruso, { usuario: 'admin@ceavital.net', password: 'OtraClaveSuperadmin-2027' });
    assert.equal(conLaBuena.status, 423);
    assert.ok(!intruso.cookies.has('sa_token'));
  });
});
