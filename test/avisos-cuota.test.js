// Tests de los avisos de cuota por mail del superadmin. Usan un servidor SMTP falso (un
// servidor TCP que captura los mails) y una base descartable en el Postgres de TEST.
//   TEST_DATABASE_URL=postgres://... npm test
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const PUERTO = 20000 + Math.floor(Math.random() * 800);
const PUERTO_SIN_CORREO = PUERTO + 900;
const nombreBase = `ceavital_test_av_${randomBytes(4).toString('hex')}`;
const CLAVE_SA = 'ClaveSuperadmin-2026';
const EMPRESA = 'empresa@example.com';

const admin = ADMIN_URL ? new pg.Client({ connectionString: ADMIN_URL }) : null;
let urlBase;
let entorno;
let servidores = [];
let smtp;
let servicio; // avisos-cuota.service, en proceso
let dbEnProceso;

// --- SMTP falso ---------------------------------------------------------------

function decodificarEncabezado(valor) {
  return valor
    .replace(/\r\n\s+/g, ' ')
    .replace(/=\?UTF-8\?([QB])\?([^?]*)\?=\s*/gi, (_, tipo, texto) =>
      tipo.toUpperCase() === 'B'
        ? Buffer.from(texto, 'base64').toString('utf8')
        : Buffer.from(texto.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')
    );
}

function crearSmtpFalso() {
  const correos = [];
  const estado = { rechazar: false };
  const servidor = net.createServer((sock) => {
    let enDatos = false;
    let buf = '';
    let actual = { para: [], de: '', datos: '' };
    sock.write('220 falso ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (enDatos) {
          const fin = buf.indexOf('\r\n.\r\n');
          if (fin < 0) return;
          actual.datos = buf.slice(0, fin);
          buf = buf.slice(fin + 5);
          const asunto = /^Subject:\s*((?:.|\r\n\s)*?)\r\n(?=\S)/im.exec(actual.datos)?.[1] ?? '';
          correos.push({ ...actual, asunto: decodificarEncabezado(asunto) });
          actual = { para: [], de: '', datos: '' };
          enDatos = false;
          sock.write('250 OK\r\n');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const linea = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const u = linea.toUpperCase();
        if (u.startsWith('EHLO') || u.startsWith('HELO')) sock.write('250 falso\r\n');
        else if (u.startsWith('MAIL FROM')) {
          actual.de = linea;
          sock.write('250 OK\r\n');
        } else if (u.startsWith('RCPT TO')) {
          if (estado.rechazar) sock.write('550 rechazado\r\n');
          else {
            actual.para.push(linea);
            sock.write('250 OK\r\n');
          }
        } else if (u === 'DATA') {
          enDatos = true;
          sock.write('354 adelante\r\n');
        } else if (u === 'QUIT') {
          sock.write('221 chau\r\n');
          sock.end();
        } else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => servidor.listen(0, '127.0.0.1', () => resolve({ servidor, correos, estado, puerto: servidor.address().port })));
}

// --- Helpers ------------------------------------------------------------------

function nuevoNavegador() {
  return { cookies: new Map(), csrf: null };
}

async function api(nav, puerto, metodo, ruta, cuerpo, extra = {}) {
  const headers = { 'content-type': 'application/json' };
  if (nav.cookies.size) headers.cookie = [...nav.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  if (extra.csrf !== null && (extra.csrf ?? nav.csrf)) headers['x-csrf-token'] = extra.csrf ?? nav.csrf;
  const res = await fetch(`http://127.0.0.1:${puerto}/api${ruta}`, {
    method: metodo,
    headers,
    body: cuerpo && metodo !== 'GET' ? JSON.stringify(cuerpo) : undefined,
  });
  for (const c of res.headers.getSetCookie()) {
    const [par] = c.split(';');
    const i = par.indexOf('=');
    if (par.slice(i + 1)) nav.cookies.set(par.slice(0, i), par.slice(i + 1));
  }
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

// AAAA-MM-DD a `delta` días de hoy, en hora argentina (igual que el servidor).
function dia(delta) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const [a, m, d] = hoy.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + delta)).toISOString().slice(0, 10);
}

async function levantar(puerto, extraEntorno) {
  const proc = spawn(process.execPath, ['src/server.js'], { cwd: RAIZ, env: { ...entorno, PORT: String(puerto), ...extraEntorno }, stdio: 'ignore' });
  servidores.push(proc);
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${puerto}/api/health`)).ok) return;
    } catch {
      /* todavía arrancando */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('el servidor de prueba no arrancó');
}

async function ingresar(puerto) {
  const nav = nuevoNavegador();
  const r = await api(nav, puerto, 'POST', '/auth/login', { usuario: 'cea', password: CLAVE_SA });
  assert.equal(r.status, 200);
  nav.csrf = r.data.csrf_token;
  return nav;
}

describe('avisos de cuota por mail', { skip: !ADMIN_URL && 'falta TEST_DATABASE_URL' }, () => {
  let sa;
  // Una sola sesión de superadmin a la vez: consultar el servidor sin correo cierra la del
  // otro, así que se ingresa ahí solo cuando hace falta y después se vuelve a ingresar acá.
  async function sinCorreo(metodo, ruta, cuerpo) {
    const nav = await ingresar(PUERTO_SIN_CORREO);
    const r = await api(nav, PUERTO_SIN_CORREO, metodo, ruta, cuerpo);
    sa = await ingresar(PUERTO);
    return r;
  }

  before(async () => {
    smtp = await crearSmtpFalso();
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nombreBase}`);
    const u = new URL(ADMIN_URL);
    u.pathname = `/${nombreBase}`;
    urlBase = u.toString();

    entorno = {
      ...process.env,
      DATABASE_URL: urlBase,
      HTTPS_MODE: 'proxy',
      NODE_ENV: 'test',
      AVISOS_CUOTA: 'off', // el temporizador no compite con las pruebas
      SUPERADMIN_USUARIO: 'cea',
      SUPERADMIN_PASSWORD: CLAVE_SA,
      SA_SMTP_HOST: '127.0.0.1',
      SA_SMTP_PORT: String(smtp.puerto),
      SA_SMTP_FROM: 'CEA Servicios <admin@ceavital.net>',
    };
    // Servidor sin correo de CEA configurado (para el caso "no configurado").
    const sinCorreo = { SA_SMTP_HOST: '', SA_SMTP_FROM: '' };

    await levantar(PUERTO, {});
    await levantar(PUERTO_SIN_CORREO, sinCorreo);
    sa = await ingresar(PUERTO);

    // El servicio, en proceso y contra la misma base, para correr la revisión sin esperar la hora.
    Object.assign(process.env, {
      DATABASE_URL: urlBase,
      SA_SMTP_HOST: '127.0.0.1',
      SA_SMTP_PORT: String(smtp.puerto),
      SA_SMTP_FROM: entorno.SA_SMTP_FROM,
    });
    servicio = await import('../src/services/avisos-cuota.service.js');
    dbEnProceso = (await import('../src/db/connection.js')).default;
  });

  after(async () => {
    for (const s of servidores) s.kill();
    smtp?.servidor.close();
    try {
      await dbEnProceso?.cerrar();
    } catch {
      /* nunca se llegó a conectar */
    }
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${nombreBase} WITH (FORCE)`);
      await admin.end();
    }
  });

  it('el panel informa si el correo de CEA está configurado y el email de la empresa', async () => {
    const con = (await api(sa, PUERTO, 'GET', '/sa/panel')).data;
    assert.equal(con.correo.disponible, true);
    assert.equal(con.instancia.empresa_email, null);
    assert.deepEqual(con.correo.avisos, []);
    assert.equal((await sinCorreo('GET', '/sa/panel')).data.correo.disponible, false);
  });

  it('email de la empresa: valida el formato, exige CSRF, se guarda y se puede quitar', async () => {
    for (const malo of ['sin-arroba', 'a@b', 'con espacio@x.com', `${'a'.repeat(200)}@x.com`, 123]) {
      assert.equal((await api(sa, PUERTO, 'PUT', '/sa/empresa-email', { email: malo })).status, 400, String(malo).slice(0, 20));
    }
    assert.equal((await api(sa, PUERTO, 'PUT', '/sa/empresa-email', { email: EMPRESA }, { csrf: null })).status, 403);

    const ok = await api(sa, PUERTO, 'PUT', '/sa/empresa-email', { email: `  ${EMPRESA}  ` });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.instancia.empresa_email, EMPRESA);

    assert.equal((await api(sa, PUERTO, 'PUT', '/sa/empresa-email', { email: '' })).data.instancia.empresa_email, null);
    await api(sa, PUERTO, 'PUT', '/sa/empresa-email', { email: EMPRESA });
  });

  it('mail de prueba: 503 sin correo de CEA, 400 sin email, y sale con remitente de CEA', async () => {
    assert.equal((await sinCorreo('POST', '/sa/correo-prueba', {})).status, 503);

    await api(sa, PUERTO, 'PUT', '/sa/empresa-email', { email: '' });
    assert.equal((await api(sa, PUERTO, 'POST', '/sa/correo-prueba', {})).status, 400);
    await api(sa, PUERTO, 'PUT', '/sa/empresa-email', { email: EMPRESA });

    assert.equal((await api(sa, PUERTO, 'POST', '/sa/correo-prueba', {}, { csrf: null })).status, 403);
    const antes = smtp.correos.length;
    const r = await api(sa, PUERTO, 'POST', '/sa/correo-prueba', {});
    assert.equal(r.status, 200);
    assert.equal(r.data.enviado_a, EMPRESA);
    assert.equal(smtp.correos.length, antes + 1);
    const mail = smtp.correos.at(-1);
    assert.ok(mail.de.includes('admin@ceavital.net'), mail.de);
    assert.ok(mail.para[0].includes(EMPRESA));
    assert.match(mail.asunto, /mail de prueba/);
  });

  it('cuota lejana o sin definir: no se manda nada', async () => {
    await api(sa, PUERTO, 'PUT', '/sa/cuota', { vence: null });
    assert.equal(await servicio.revisarAvisosCuota(), null);
    await api(sa, PUERTO, 'PUT', '/sa/cuota', { vence: dia(30), aviso_dias: 15 });
    const antes = smtp.correos.length;
    assert.equal(await servicio.revisarAvisosCuota(), null);
    assert.equal(smtp.correos.length, antes);
  });

  it('por vencer: un solo mail por fecha, con asunto y destinatario correctos', async () => {
    await api(sa, PUERTO, 'PUT', '/sa/cuota', { vence: dia(5), aviso_dias: 15 });
    const antes = smtp.correos.length;
    assert.equal(await servicio.revisarAvisosCuota(), 'por_vencer');
    assert.equal(await servicio.revisarAvisosCuota(), null, 'no se repite');
    assert.equal(await servicio.revisarAvisosCuota(), null);
    assert.equal(smtp.correos.length, antes + 1);
    const mail = smtp.correos.at(-1);
    const [a, m, d] = dia(5).split('-');
    assert.match(mail.asunto, new RegExp(`tu cuota vence el ${d}/${m}/${a}`));
    assert.ok(mail.para[0].includes(EMPRESA));
  });

  it('el día del vencimiento y ya vencida mandan su propio mail, cada uno una vez', async () => {
    const antes = smtp.correos.length;
    await api(sa, PUERTO, 'PUT', '/sa/cuota', { vence: dia(0), aviso_dias: 15 });
    assert.equal(await servicio.revisarAvisosCuota(), 'vence_hoy');
    assert.equal(await servicio.revisarAvisosCuota(), null);
    assert.match(smtp.correos.at(-1).asunto, /vence hoy/);

    await api(sa, PUERTO, 'PUT', '/sa/cuota', { vence: dia(-2), aviso_dias: 15 });
    assert.equal(await servicio.revisarAvisosCuota(), 'vencida');
    assert.equal(await servicio.revisarAvisosCuota(), null);
    assert.match(smtp.correos.at(-1).asunto, /vencida desde el/);
    assert.equal(smtp.correos.length, antes + 2);
  });

  it('una fecha de vencimiento nueva reinicia los avisos', async () => {
    await api(sa, PUERTO, 'PUT', '/sa/cuota', { vence: dia(6), aviso_dias: 15 });
    assert.equal(await servicio.revisarAvisosCuota(), 'por_vencer');
  });

  it('sin email de la empresa no se manda nada (y no se marca como enviado)', async () => {
    await api(sa, PUERTO, 'PUT', '/sa/empresa-email', { email: '' });
    await api(sa, PUERTO, 'PUT', '/sa/cuota', { vence: dia(-9), aviso_dias: 15 });
    const antes = smtp.correos.length;
    assert.equal(await servicio.revisarAvisosCuota(), null);
    assert.equal(smtp.correos.length, antes);
    assert.equal((await consultar(`SELECT COUNT(*)::int AS n FROM cuota_avisos WHERE cuota_vence = $1`, [dia(-9)]))[0].n, 0);
    // Al cargar el email, el aviso pendiente sale en la siguiente revisión.
    await api(sa, PUERTO, 'PUT', '/sa/empresa-email', { email: EMPRESA });
    assert.equal(await servicio.revisarAvisosCuota(), 'vencida');
  });

  it('si el correo falla, el aviso no queda como enviado y se reintenta en la próxima revisión', async () => {
    await api(sa, PUERTO, 'PUT', '/sa/cuota', { vence: dia(-20), aviso_dias: 15 });
    smtp.estado.rechazar = true;
    const antes = smtp.correos.length;
    assert.equal(await servicio.revisarAvisosCuota(), null);
    assert.equal(smtp.correos.length, antes);
    assert.equal((await consultar(`SELECT COUNT(*)::int AS n FROM cuota_avisos WHERE cuota_vence = $1`, [dia(-20)]))[0].n, 0);

    smtp.estado.rechazar = false;
    assert.equal(await servicio.revisarAvisosCuota(), 'vencida');
    assert.equal(smtp.correos.length, antes + 1);
  });

  it('una cuota vencida solo avisa: la instalación sigue activa', async () => {
    assert.equal((await api(sa, PUERTO, 'GET', '/sa/panel')).data.instancia.estado, 'activa');
  });

  it('el panel lista los avisos ya enviados', async () => {
    assert.ok((await api(sa, PUERTO, 'GET', '/sa/panel')).data.correo.avisos.length > 0);
  });
});
