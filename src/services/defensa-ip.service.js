import net from 'node:net';
import db from '../db/connection.js';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import { correoCeaDisponible, enviarCorreo, escaparHtml } from './mail.service.js';

// Defensa activa por IP. Detecta ataques conocidos, bloquea la IP en el acto (403 en todo
// lo que pida después, sin tocar la lógica de negocio) y avisa por mail. Modelo tomado del
// sistema de ELPE Salud (Docs/manual-seguridad.md §1.5), con dos agregados: los bloqueos se
// guardan en la base (sobreviven a un reinicio del servidor) y la duración escala con la
// reincidencia (1 hora, 24 horas, 7 días).
//
// Qué se detecta:
//   sondeo        pedidos a /.env, /.git, /wp-admin, *.php, /phpmyadmin, backups, etc.
//   traversal     ../ o %2e%2e/ para salir de la carpeta del sitio
//   inyeccion_sql UNION SELECT, ' OR 1=1, ; DROP TABLE, pg_sleep(), etc. en URL o cuerpo
//   xss           <script>, javascript:, onerror=, etc. en URL o cuerpo
//   comando       cat /etc/passwd, whoami, wget http..., bash -c, etc.
//   herramienta   User-Agent de sqlmap, nikto, nmap, nuclei, burp, zap...
//   enumeracion   15 o más rutas de /api inexistentes en 5 minutos (mapeo/clonado de la API)
//   fuerza_bruta  15 ingresos fallidos en 10 minutos desde la misma IP (cualquier cuenta)
//   rafaga        más de 1200 pedidos por minuto (scraping / clonado masivo / DoS simple)
//   manual        bloqueada a mano desde el panel del superadmin

const MINUTO = 60_000;
const DURACIONES_MINUTOS = [60, 24 * 60, 7 * 24 * 60]; // 1.er, 2.º y 3.er bloqueo (o más) en 30 días
const DIAS_HISTORIAL_REINCIDENCIA = 30;
const DIAS_RETENCION_EVENTOS = 30;
const MAX_MAILS_POR_HORA = 10; // tope global: un atacante no puede usarnos para llenar una casilla

const LIMITES = {
  enumeracion: { cantidad: 15, ventanaMs: 5 * MINUTO },
  fuerza_bruta: { cantidad: 15, ventanaMs: 10 * MINUTO },
  rafaga: { cantidad: 1200, ventanaMs: MINUTO },
};

export const MOTIVOS = {
  sondeo: 'Sondeo de archivos o paneles (malware / escáner)',
  traversal: 'Intento de salir de la carpeta del sitio (path traversal)',
  inyeccion_sql: 'Inyección SQL',
  xss: 'Inyección de scripts (XSS)',
  comando: 'Inyección de comandos',
  herramienta: 'Herramienta de hacking',
  enumeracion: 'Enumeración de rutas (mapeo o clonado de la API)',
  fuerza_bruta: 'Fuerza bruta de credenciales',
  rafaga: 'Ráfaga de pedidos (scraping / clonado masivo)',
  manual: 'Bloqueo manual del superadmin',
};

// ---------- Patrones ----------

const PATRON_SONDEO = new RegExp(
  [
    String.raw`(^|/)\.(env|git|svn|hg|htaccess|htpasswd|aws|ssh|docker|npmrc|bash_history|ds_store)(/|$|\.|\?)`,
    String.raw`wp-(admin|login|content|includes|json)|xmlrpc\.php|wlwmanifest`,
    String.raw`\.(php\d?|phtml|asp|aspx|jsp|jspx|cgi|pl)(/|$|\?)`,
    String.raw`/(phpmyadmin|pma|myadmin|adminer|cpanel|webmail|actuator|cgi-bin|boaform|solr|jenkins|manager/html|vendor/phpunit|telescope|_profiler|server-status)(/|$)`,
    String.raw`/(backup|backups|dump|database|db|site|www|html|old|dbdump)\.(sql|zip|tar|tgz|gz|rar|7z|bak|db|sqlite)$`,
    String.raw`/(config|configuration|settings|secrets|credentials)\.(json|ya?ml|inc|ini|bak|old|txt|js)(\?|$)`,
    String.raw`/(web\.config|composer\.json|composer\.lock|id_rsa|id_dsa|authorized_keys|docker-compose\.ya?ml|dockerfile)(\?|$)`,
    String.raw`/etc/(passwd|shadow|hosts)|/proc/self|win\.ini|boot\.ini`,
  ].join('|'),
  'i'
);

const PATRON_TRAVERSAL = /\.\.[/\\]|%2e%2e|%252e|\.\.%2f|\.\.%5c/i;

const PATRON_SQL = new RegExp(
  [
    String.raw`\bunion\s+(all\s+)?select\b`,
    String.raw`\bselect\b[^;]{0,80}\bfrom\s+(information_schema|pg_catalog|pg_user|pg_shadow|sqlite_master|mysql\.user)`,
    String.raw`;\s*(drop|truncate|alter)\s+(table|database|schema)\b`,
    String.raw`;\s*delete\s+from\b`,
    String.raw`;\s*insert\s+into\b.{0,40}\bvalues\b`,
    String.raw`['"]\s*(or|and)\s+['"]?\w+['"]?\s*=\s*['"]?\w+`,
    String.raw`\b(or|and)\s+\d+\s*=\s*\d+\s*(--|#|/\*|$)`,
    String.raw`\b(pg_sleep|sleep|benchmark|load_file)\s*\(`,
    String.raw`\bwaitfor\s+delay\b|xp_cmdshell|\bpg_read_file\b|\bcopy\s+\w+\s+(to|from)\s+program\b`,
    String.raw`/\*\*/`,
  ].join('|'),
  'i'
);

const PATRON_XSS = /<\s*script|<\s*iframe|<\s*svg[^>]*\bon\w+\s*=|javascript\s*:|\bon(error|load|click|mouseover|focus)\s*=|document\.(cookie|location)|\beval\s*\(/i;

const PATRON_COMANDO = new RegExp(
  [
    String.raw`[;&|\`]\s*(cat|wget|curl|nc|ncat|bash|powershell)\s+(-|/|http)`,
    String.raw`[;&|\`]\s*(whoami|uname)\s*($|[;&|]|\s-)`,
    String.raw`\$\(\s*(cat|ls|id|whoami|wget|curl)\b`,
    String.raw`/bin/(ba)?sh\b|cmd\.exe|powershell(\.exe)?\s+-`,
    String.raw`\b(cat|type)\s+/?etc/passwd`,
  ].join('|'),
  'i'
);

const PATRON_HERRAMIENTA =
  /sqlmap|nikto|nmap|masscan|nuclei|burp|zaproxy|owasp[\s_-]?zap|acunetix|nessus|openvas|wpscan|dirbuster|gobuster|ffuf|feroxbuster|hydra|havij|metasploit|zgrab|wfuzz|arachni|w3af|skipfish|jaeles|commix/i;

// Campos que no se revisan (una contraseña puede tener cualquier carácter).
const CAMPOS_EXENTOS = /pass|clave|token|secret/i;
const MAX_TEXTO_ESCANEADO = 200_000;

// ---------- Estado en memoria ----------

const bloqueos = new Map(); // ip -> instante (ms) hasta el que está bloqueada
const contadores = new Map(); // clave -> [instantes]
let mailsEnviados = []; // instantes de los mails de alerta de la última hora
let temporizadores = [];

// "::ffff:1.2.3.4" (IPv4 dentro de IPv6) -> "1.2.3.4"
export function normalizarIp(ip) {
  const limpia = String(ip ?? '').trim();
  return limpia.startsWith('::ffff:') && net.isIPv4(limpia.slice(7)) ? limpia.slice(7) : limpia;
}

export const ipDe = (req) => normalizarIp(req.ip || req.socket?.remoteAddress);

function esLoopback(ip) {
  return ip === '::1' || ip.startsWith('127.');
}

export function esExenta(ip) {
  if (!ip) return true; // sin IP no hay a quién bloquear
  if (config.defensa.permitidas.some((p) => normalizarIp(p) === ip)) return true;
  return esLoopback(ip) && !config.defensa.bloquearLoopback;
}

export function estaBloqueada(ip) {
  const hasta = bloqueos.get(ip);
  if (!hasta) return false;
  if (hasta <= Date.now()) {
    bloqueos.delete(ip);
    return false;
  }
  return true;
}

// Cuenta un hecho de esa clave dentro de la ventana y devuelve cuántos van.
function contar(clave, ventanaMs) {
  const ahora = Date.now();
  const lista = (contadores.get(clave) ?? []).filter((t) => t > ahora - ventanaMs);
  lista.push(ahora);
  contadores.set(clave, lista);
  return lista.length;
}

function barrerContadores() {
  const corte = Date.now() - 15 * MINUTO;
  for (const [clave, lista] of contadores) {
    if (lista.length === 0 || lista[lista.length - 1] < corte) contadores.delete(clave);
  }
}

// ---------- Base de datos ----------

export async function cargarBloqueos() {
  const filas = await db
    .prepare(
      `SELECT ip, (EXTRACT(EPOCH FROM bloqueada_hasta) * 1000) AS hasta_ms
       FROM ips_bloqueadas WHERE liberada_en IS NULL AND bloqueada_hasta > LOCALTIMESTAMP`
    )
    .all();
  bloqueos.clear();
  for (const f of filas) bloqueos.set(f.ip, Math.max(bloqueos.get(f.ip) ?? 0, f.hasta_ms));
}

async function purgar() {
  await db.prepare(`DELETE FROM eventos_seguridad WHERE creado_en < LOCALTIMESTAMP - (?::int * INTERVAL '1 day')`).run(DIAS_RETENCION_EVENTOS);
  // Se conserva más tiempo que los eventos: es lo que alimenta la reincidencia.
  await db
    .prepare(
      `DELETE FROM ips_bloqueadas
       WHERE bloqueada_hasta < LOCALTIMESTAMP - INTERVAL '90 days' AND (liberada_en IS NOT NULL OR bloqueada_hasta < LOCALTIMESTAMP)`
    )
    .run();
}

export async function iniciarDefensa() {
  if (!config.defensa.activa) {
    console.warn('[defensa] DEFENSA_IP=off: la defensa activa por IP está apagada');
    return;
  }
  await cargarBloqueos();
  detenerDefensa();
  temporizadores = [
    // Vuelve a leer la lista (por si se desbloqueó/bloqueó desde otra instancia) y limpia.
    setInterval(() => cargarBloqueos().catch((e) => console.error('[defensa] no se pudo recargar:', e.message)), MINUTO),
    setInterval(barrerContadores, 5 * MINUTO),
    setInterval(() => purgar().catch((e) => console.error('[defensa] no se pudo purgar:', e.message)), 60 * MINUTO),
  ];
  for (const t of temporizadores) t.unref();
  console.log(`[defensa] activa (${bloqueos.size} IP bloqueada(s) vigente(s))`);
}

export function detenerDefensa() {
  for (const t of temporizadores) clearInterval(t);
  temporizadores = [];
}

async function registrarEvento({ ip, tipo, metodo, ruta, userAgent, bloqueo }) {
  await db
    .prepare('INSERT INTO eventos_seguridad (ip, tipo, metodo, ruta, user_agent, bloqueo) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ip, tipo, metodo ?? null, ruta ? String(ruta).slice(0, 300) : null, userAgent ? String(userAgent).slice(0, 300) : null, bloqueo);
}

// ---------- Bloqueo ----------

async function avisarPorMail({ ip, tipo, minutos, reincidencia, ruta, metodo, userAgent }) {
  const para = config.defensa.alertaEmail;
  if (!para || !correoCeaDisponible()) return;
  const hace1h = Date.now() - 60 * MINUTO;
  mailsEnviados = mailsEnviados.filter((t) => t > hace1h);
  if (mailsEnviados.length >= MAX_MAILS_POR_HORA) return;
  mailsEnviados.push(Date.now());

  const duracion = minutos >= 1440 ? `${Math.round(minutos / 1440)} día(s)` : `${minutos} minutos`;
  const sitio = config.publicUrl || 'CEAVital';
  const filas = [
    ['Motivo', MOTIVOS[tipo] ?? tipo],
    ['IP', ip],
    ['Bloqueo', `${duracion}${reincidencia > 1 ? ` (reincidencia n.º ${reincidencia})` : ''}`],
    ['Pedido', `${metodo ?? ''} ${ruta ?? ''}`.trim() || '—'],
    ['User-Agent', userAgent || '—'],
    ['Hora (UTC)', new Date().toISOString()],
  ];
  await enviarCorreo(
    {
      para,
      asunto: `[CEAVital] IP bloqueada: ${ip} — ${MOTIVOS[tipo] ?? tipo}`,
      texto: [`Se bloqueó una IP en ${sitio}.`, '', ...filas.map(([k, v]) => `${k}: ${v}`), '', 'Si fue un falso positivo, desbloqueala desde el panel del superadmin (sección Seguridad).'].join('\n'),
      html: `<p>Se bloqueó una IP en <b>${escaparHtml(sitio)}</b>.</p><table cellpadding="6">${filas
        .map(([k, v]) => `<tr><td><b>${escaparHtml(k)}</b></td><td>${escaparHtml(v)}</td></tr>`)
        .join('')}</table><p>Si fue un falso positivo, desbloqueala desde el panel del superadmin (sección Seguridad).</p>`,
    },
    'cea'
  );
}

// Bloquea la IP (si no está exenta ni ya bloqueada). La memoria se actualiza ANTES de
// escribir en la base: el bloqueo es inmediato aunque la base tarde o falle.
export async function bloquearIp(ip, tipo, { detalle, minutos, origen = 'automatico', metodo, ruta, userAgent } = {}) {
  if (esExenta(ip) || estaBloqueada(ip)) return null;

  let reincidencia = 1;
  let duracion = minutos ?? DURACIONES_MINUTOS[0];
  bloqueos.set(ip, Date.now() + duracion * MINUTO); // provisorio, hasta calcular la reincidencia
  try {
    const previos = await db
      .prepare(`SELECT COUNT(*) AS n FROM ips_bloqueadas WHERE ip = ? AND origen = 'automatico' AND bloqueada_en > LOCALTIMESTAMP - (?::int * INTERVAL '1 day')`)
      .get(ip, DIAS_HISTORIAL_REINCIDENCIA);
    reincidencia = previos.n + 1;
    if (minutos === undefined) duracion = DURACIONES_MINUTOS[Math.min(reincidencia, DURACIONES_MINUTOS.length) - 1];
    bloqueos.set(ip, Date.now() + duracion * MINUTO);
    await db
      .prepare(
        `INSERT INTO ips_bloqueadas (ip, motivo, detalle, reincidencia, bloqueada_hasta, origen)
         VALUES (?, ?, ?, ?, LOCALTIMESTAMP + (?::int * INTERVAL '1 minute'), ?)`
      )
      .run(ip, tipo, detalle ? String(detalle).slice(0, 300) : null, reincidencia, duracion, origen);
    await registrarEvento({ ip, tipo, metodo, ruta, userAgent, bloqueo: true });
  } catch (err) {
    console.error('[defensa] no se pudo guardar el bloqueo (queda vigente en memoria):', err.message);
  }
  console.log(`[defensa] IP ${ip} bloqueada ${duracion} min: ${tipo}`);
  if (origen === 'automatico') {
    avisarPorMail({ ip, tipo, minutos: duracion, reincidencia, ruta, metodo, userAgent }).catch((e) =>
      console.error('[defensa] no se pudo mandar el aviso:', e.message)
    );
  }
  return { minutos: duracion, reincidencia };
}

// ---------- Detección ----------

function textoDeCuerpo(valor, salida = { texto: '' }, profundidad = 0) {
  if (salida.texto.length > MAX_TEXTO_ESCANEADO || profundidad > 6 || valor == null) return salida.texto;
  if (typeof valor === 'string') salida.texto += `${valor}\n`;
  else if (Array.isArray(valor)) valor.forEach((v) => textoDeCuerpo(v, salida, profundidad + 1));
  else if (typeof valor === 'object') {
    for (const [clave, v] of Object.entries(valor)) {
      if (CAMPOS_EXENTOS.test(clave)) continue;
      salida.texto += `${clave}\n`;
      textoDeCuerpo(v, salida, profundidad + 1);
    }
  }
  return salida.texto;
}

function clasificarTexto(texto) {
  if (!texto) return null;
  if (PATRON_SQL.test(texto)) return 'inyeccion_sql';
  if (PATRON_XSS.test(texto)) return 'xss';
  if (PATRON_COMANDO.test(texto)) return 'comando';
  return null;
}

function decodificar(texto) {
  try {
    return decodeURIComponent(texto);
  } catch {
    return texto; // %-secuencia rota: se revisa tal cual
  }
}

// Tipo de ataque que se ve en la URL o el User-Agent, o null. Se revisa antes de leer el cuerpo.
export function detectarEnPedido(req) {
  const url = req.originalUrl || req.url || '';
  if (PATRON_TRAVERSAL.test(url)) return 'traversal';
  const decodificada = decodificar(url);
  if (PATRON_TRAVERSAL.test(decodificada)) return 'traversal';
  const ruta = decodificada.split('?')[0];
  if (PATRON_SONDEO.test(ruta)) return 'sondeo';
  if (PATRON_HERRAMIENTA.test(req.get('user-agent') || '')) return 'herramienta';
  return clasificarTexto(decodificada.slice(0, MAX_TEXTO_ESCANEADO));
}

// Tipo de ataque que se ve en el cuerpo del pedido (JSON ya interpretado), o null.
export function detectarEnCuerpo(req) {
  if (!req.body || typeof req.body !== 'object') return null;
  return clasificarTexto(textoDeCuerpo(req.body));
}

async function rechazar(req, res, ip, tipo) {
  await bloquearIp(ip, tipo, { detalle: `${req.method} ${req.originalUrl}`.slice(0, 200), metodo: req.method, ruta: req.originalUrl, userAgent: req.get('user-agent') });
  return res.status(403).json({ error: 'Acceso denegado' });
}

// Ingresos por usuario/contraseña y por token de la app de backups: los fallos cuentan igual.
const RUTAS_DE_LOGIN = /^\/api\/((auth|portal)\/login|backup-sync\/(export|estado))$/;
const RESPUESTAS_DE_FALLO = new Set([401, 423, 429]);

// Primer middleware de la app (después de trust proxy): corta a las IPs bloqueadas y a lo
// que trae un ataque en la URL o el User-Agent, y cuenta ráfagas e ingresos fallidos.
export async function defensaIp(req, res, next) {
  if (!config.defensa.activa) return next();
  const ip = ipDe(req);
  if (esExenta(ip)) return next();

  if (estaBloqueada(ip)) return res.status(403).json({ error: 'Acceso denegado' });

  const ataque = detectarEnPedido(req);
  if (ataque) return rechazar(req, res, ip, ataque);

  if (req.path.startsWith('/api') && contar(`rafaga:${ip}`, LIMITES.rafaga.ventanaMs) > LIMITES.rafaga.cantidad) {
    return rechazar(req, res, ip, 'rafaga');
  }

  if (req.method === 'POST' && RUTAS_DE_LOGIN.test(req.path)) {
    res.on('finish', () => {
      if (!RESPUESTAS_DE_FALLO.has(res.statusCode)) return;
      if (contar(`login:${ip}`, LIMITES.fuerza_bruta.ventanaMs) >= LIMITES.fuerza_bruta.cantidad) {
        bloquearIp(ip, 'fuerza_bruta', { detalle: `${LIMITES.fuerza_bruta.cantidad} ingresos fallidos en 10 min`, metodo: req.method, ruta: req.path, userAgent: req.get('user-agent') }).catch(() => {});
      }
    });
  }
  next();
}

// Va después de express.json(): revisa el contenido de lo que se envía.
export async function defensaCuerpoIp(req, res, next) {
  if (!config.defensa.activa) return next();
  const ip = ipDe(req);
  if (esExenta(ip)) return next();
  // El cuerpo de backup-sync lo manda la app de backups (texto de errores incluido) y solo se
  // usa con consultas parametrizadas: escanearlo bloquearía a la app de backups por un falso positivo.
  if (req.path.startsWith('/api/backup-sync/')) return next();
  const ataque = detectarEnCuerpo(req);
  if (ataque) return rechazar(req, res, ip, ataque);
  next();
}

// Último manejador de /api: una ruta que no existe. Muchas seguidas = alguien mapeando la API.
export async function rutaApiInexistente(req, res) {
  const ip = ipDe(req);
  if (config.defensa.activa && !esExenta(ip) && !estaBloqueada(ip)) {
    const { cantidad, ventanaMs } = LIMITES.enumeracion;
    if (contar(`404:${ip}`, ventanaMs) >= cantidad) {
      await bloquearIp(ip, 'enumeracion', { detalle: `${cantidad} rutas inexistentes en 5 min`, metodo: req.method, ruta: req.originalUrl, userAgent: req.get('user-agent') });
      return res.status(403).json({ error: 'Acceso denegado' });
    }
  }
  res.status(404).json({ error: 'No encontrado' });
}

// ---------- Panel del superadmin ----------

const SQL_MINUTOS_RESTANTES = `GREATEST(0, CEIL(EXTRACT(EPOCH FROM (bloqueada_hasta - LOCALTIMESTAMP)) / 60))::int`;

export async function estadoDefensa() {
  const [bloqueadas, eventos, resumen] = await Promise.all([
    db
      .prepare(
        `SELECT id, ip, motivo, detalle, reincidencia, origen, bloqueada_en, bloqueada_hasta, ${SQL_MINUTOS_RESTANTES} AS minutos_restantes
         FROM ips_bloqueadas WHERE liberada_en IS NULL AND bloqueada_hasta > LOCALTIMESTAMP ORDER BY bloqueada_en DESC`
      )
      .all(),
    db.prepare('SELECT id, creado_en, ip, tipo, metodo, ruta, user_agent, bloqueo FROM eventos_seguridad ORDER BY id DESC LIMIT 50').all(),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM ips_bloqueadas WHERE bloqueada_en > LOCALTIMESTAMP - INTERVAL '24 hours') AS bloqueos_24h,
                (SELECT COUNT(*) FROM eventos_seguridad WHERE creado_en > LOCALTIMESTAMP - INTERVAL '24 hours') AS eventos_24h`
      )
      .get(),
  ]);
  return {
    activa: config.defensa.activa,
    alerta_email: config.defensa.alertaEmail || null,
    correo_disponible: correoCeaDisponible(),
    permitidas: config.defensa.permitidas,
    motivos: MOTIVOS,
    bloqueadas,
    eventos,
    resumen,
  };
}

export async function desbloquearIp(id) {
  const fila = await db.prepare('SELECT ip FROM ips_bloqueadas WHERE id = ? AND liberada_en IS NULL').get(id);
  if (!fila) throw new ApiError(404, 'Ese bloqueo no existe o ya estaba liberado');
  await liberar(fila.ip);
  return { ip: fila.ip };
}

export async function desbloquearTodas() {
  const filas = await db.prepare('SELECT DISTINCT ip FROM ips_bloqueadas WHERE liberada_en IS NULL AND bloqueada_hasta > LOCALTIMESTAMP').all();
  for (const { ip } of filas) await liberar(ip);
  bloqueos.clear();
  return { liberadas: filas.length };
}

// Libera todos los bloqueos vigentes de esa IP y reinicia sus contadores (si no, el
// siguiente error suyo la volvería a bloquear al instante).
async function liberar(ip) {
  await db.prepare('UPDATE ips_bloqueadas SET liberada_en = CURRENT_TIMESTAMP WHERE ip = ? AND liberada_en IS NULL').run(ip);
  bloqueos.delete(ip);
  for (const prefijo of ['rafaga', 'login', '404']) contadores.delete(`${prefijo}:${ip}`);
}

export async function bloquearManual(ip, minutos, detalle) {
  const limpia = normalizarIp(ip);
  if (!net.isIP(limpia)) throw new ApiError(400, 'La IP no es válida');
  const dur = Number(minutos);
  if (!Number.isInteger(dur) || dur < 1 || dur > 60 * 24 * 365) throw new ApiError(400, 'La duración tiene que ser de 1 minuto a 365 días');
  if (config.defensa.permitidas.some((p) => normalizarIp(p) === limpia)) {
    throw new ApiError(409, 'Esa IP está en la lista de permitidas (DEFENSA_IP_PERMITIDAS)');
  }
  if (estaBloqueada(limpia)) throw new ApiError(409, 'Esa IP ya está bloqueada');
  // El bloqueo manual no depende del filtro de loopback: si se pide, se hace.
  bloqueos.set(limpia, Date.now() + dur * MINUTO);
  await db
    .prepare(
      `INSERT INTO ips_bloqueadas (ip, motivo, detalle, reincidencia, bloqueada_hasta, origen)
       VALUES (?, 'manual', ?, 1, LOCALTIMESTAMP + (?::int * INTERVAL '1 minute'), 'manual')`
    )
    .run(limpia, detalle ? String(detalle).trim().slice(0, 300) || null : null, dur);
  return { ip: limpia, minutos: dur };
}
