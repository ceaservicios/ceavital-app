import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import config from '../config/env.js';
import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { hoyNegocio } from '../utils/fecha-negocio.js';
import { encolarCorreo } from './cola-correo.service.js';
import { borrarArchivo, buscarCarpeta, carpeta, driveConfigurado, listarArchivos, subirArchivo } from './google-drive.service.js';
import { armarCorreoCopiaFallida, correoCeaDisponible } from './mail.service.js';
import { enMantenimiento } from './mantenimiento.service.js';

// Copias de seguridad de la base (Fase 4, 2026-10-11; método DaleFit, decisión del usuario del
// 2026-10-10). pg_dump en formato propio (-Fc) → "Copias CEAVital/<dominio>/" en el Drive de CEA
// (admin@ceaservicios.com.ar), una subcarpeta por instalación. Una automática por día desde las 3
// (hora argentina); si el servidor estuvo caído, corre apenas vuelve; si falla, se avisa al
// superadmin por el correo de CEA y no se reintenta sola hasta el día siguiente. Las de Drive con
// más de 30 días se borran, siempre después de subir una nueva. Nunca corren dos a la vez (una sola
// fila 'en_curso', índice único de la migración 016). El historial queda en `copias_seguridad`.
// Restaurar: bajar el .dump de Drive y `pg_restore --clean --if-exists --no-owner -d <base> <archivo>`.

export const CARPETA_COPIAS = 'Copias CEAVital';
export const HORA_COPIA = 3;
export const DIAS_RETENCION = 30;
const MINUTOS_PG_DUMP = 30;
// Una copia en curso desde hace más que esto se da por cortada (el servidor se reinició a mitad).
const MINUTOS_CORTADA = 60;
const MAX_DETALLE = 2000;

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

// ---- Reglas puras (sin base ni red) ----

// Desde cuándo vale la automática de hoy: las 3 de la mañana de hoy en Argentina (UTC−3, sin
// horario de verano).
export function inicioCopiaDelDia(ahora = new Date()) {
  return new Date(`${hoyNegocio(ahora)}T${String(HORA_COPIA).padStart(2, '0')}:00:00-03:00`);
}

// 'AAAA-MM-DD HH:MM:SS' en UTC, como guarda las fechas la base.
const textoUtc = (fecha) => fecha.toISOString().slice(0, 19).replace('T', ' ');

// Dominio de esta instalación (de PUBLIC_URL): nombre de su carpeta y de sus archivos. Sin él no
// hay copias, para no mezclar las de dos instalaciones en una misma carpeta.
export function instalacion() {
  try {
    return new URL(config.publicUrl).hostname || null;
  } catch {
    return null;
  }
}

// Lo que falta en el servidor para que haya copias (vacío = configuradas).
export function faltantes() {
  const faltan = [];
  if (!driveConfigurado()) faltan.push('GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET y GDRIVE_REFRESH_TOKEN');
  if (!instalacion()) faltan.push('PUBLIC_URL');
  return faltan;
}

// La copia de cómo estaba todo justo antes de una restauración (el "deshacer").
export const SUFIJO_RESGUARDO = 'antes-de-restaurar';

// ceavital_<dominio>_AAAAMMDD_HHMMSS[_sufijo].dump, con la hora argentina.
export function nombreCopia(host, fecha, sufijo = null) {
  const ar = new Date(fecha.getTime() - 3 * HORA_MS).toISOString();
  const sello = `${ar.slice(0, 10).replaceAll('-', '')}_${ar.slice(11, 19).replaceAll(':', '')}`;
  return `ceavital_${host}_${sello}${sufijo ? `_${sufijo}` : ''}.dump`;
}

// Al revés: de qué instalación, cuándo (UTC, 'AAAA-MM-DD HH:MM:SS') y si es un resguardo. null si el
// nombre no es el de una copia de esta instalación.
export function leerNombreCopia(nombre, host) {
  if (!host || !nombre.startsWith(`ceavital_${host}_`)) return null;
  const m = /^_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_([a-z-]+))?\.dump$/.exec(nombre.slice(`ceavital_${host}`.length));
  if (!m) return null;
  const [, a, me, d, h, mi, s, sufijo] = m;
  const fecha = new Date(`${a}-${me}-${d}T${h}:${mi}:${s}-03:00`);
  if (Number.isNaN(fecha.getTime())) return null;
  return { fecha: textoUtc(fecha), resguardo: sufijo === SUFIJO_RESGUARDO };
}

// Copias de Drive que pasaron la retención (solo .dump: nada más de la carpeta se toca).
export function copiasVencidas(archivos, ahora = new Date()) {
  const limite = ahora.getTime() - DIAS_RETENCION * DIA_MS;
  return archivos.filter((a) => a.name.endsWith('.dump') && new Date(a.createdTime).getTime() < limite);
}

export function tamanio(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

// Variables de libpq para pg_dump a partir de DATABASE_URL: así la contraseña no viaja en los
// argumentos del proceso (los ve cualquiera con `ps`) y los parámetros que no son de libpq no lo
// hacen fallar. Solo se pasa `sslmode`, si la URL lo trae.
export function variablesPg(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('DATABASE_URL no es una URL válida.');
  }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') throw new Error('DATABASE_URL no es de PostgreSQL.');
  const base = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!u.hostname || !base) throw new Error('DATABASE_URL no tiene servidor o base.');
  const variables = { PGHOST: u.hostname, PGPORT: u.port || '5432', PGDATABASE: base };
  if (u.username) variables.PGUSER = decodeURIComponent(u.username);
  if (u.password) variables.PGPASSWORD = decodeURIComponent(u.password);
  const sslmode = u.searchParams.get('sslmode');
  if (sslmode) variables.PGSSLMODE = sslmode;
  return variables;
}

// ---- La copia ----

// Corre un programa y devuelve su salida; si termina con error o se pasa del tiempo, rechaza.
export function correr(comando, args, env, tiempoMs) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(comando, args, { env, timeout: tiempoMs });
    let salida = '';
    let errores = '';
    hijo.stdout.on('data', (d) => (salida += d.toString()));
    hijo.stderr.on('data', (d) => (errores += d.toString()));
    hijo.on('error', (e) => reject(new Error(`No se pudo ejecutar ${comando}: ${e.message}`)));
    hijo.on('close', (codigo) => {
      if (codigo === 0) resolve(salida);
      else if (hijo.killed) reject(new Error(`${comando} tardó más de ${Math.round(tiempoMs / 60_000)} minutos y se cortó.`));
      else reject(new Error(`${comando} terminó con error (${codigo}): ${errores.trim().slice(0, 500)}`));
    });
  });
}

// Carpeta de las copias de esta instalación en Drive, sin crearla (null si todavía no hay).
export async function carpetaExistente() {
  const madre = await buscarCarpeta(CARPETA_COPIAS);
  return madre ? buscarCarpeta(instalacion(), madre) : null;
}

async function respaldar(sufijo) {
  const host = instalacion();
  const carpetaId = await carpeta(host, await carpeta(CARPETA_COPIAS));
  const dir = await mkdtemp(join(tmpdir(), 'ceavital-copia-'));
  let nombre;
  let bytes;
  try {
    nombre = nombreCopia(host, new Date(), sufijo);
    const ruta = join(dir, nombre);
    const env = { ...process.env, ...variablesPg(config.databaseUrl) };
    // Sin las bases anteriores que dejan las restauraciones (esquemas restauracion_<id>): quedan
    // guardadas en la base, pero no viajan en cada copia.
    const args = ['-Fc', '--no-owner', '--no-privileges', '-N', 'restauracion_*', '-f', ruta];
    await correr('pg_dump', args, env, MINUTOS_PG_DUMP * 60_000);
    bytes = (await stat(ruta)).size;
    await subirArchivo(carpetaId, nombre, ruta);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  // Recién con la nueva arriba se borran las viejas: la carpeta nunca queda vacía.
  const viejas = copiasVencidas(await listarArchivos(carpetaId));
  for (const a of viejas) await borrarArchivo(a.id);
  const borradas = viejas.length
    ? ` · ${viejas.length} ${viejas.length === 1 ? 'copia borrada' : 'copias borradas'} de Drive (más de ${DIAS_RETENCION} días)`
    : '';
  return { archivo: nombre, bytes, detalle: `${tamanio(bytes)}${borradas}` };
}

// Aviso al superadmin por el correo de CEA cuando falla la automática.
async function avisarFalla(error) {
  const para = config.superadmin.email;
  if (!para || !correoCeaDisponible()) return;
  try {
    await encolarCorreo(
      { para, ...armarCorreoCopiaFallida({ instalacion: instalacion(), error, enlace: `${config.publicUrl}/sa?pestana=copias` }) },
      { canal: 'cea', tipo: 'copia-fallida' }
    );
  } catch (err) {
    console.error('[copias] no se pudo encolar el aviso de la falla:', err.message);
  }
}

// Toma el turno: deja la fila 'en_curso' y devuelve su id, o null si ya hay una copia corriendo, si
// hay una restauración en curso (salvo para el resguardo que hace esa misma restauración) o, para la
// automática, si hoy ya corrió. La condición y el alta van en una sola sentencia: dos contenedores a
// la vez no pueden hacer dos.
const SIN_RESTAURACION = `NOT EXISTS (SELECT 1 FROM restauraciones WHERE estado = 'en_curso')`;

async function tomarTurno(manual, { porRestauracion = false } = {}) {
  await db
    .prepare(
      `UPDATE copias_seguridad
       SET estado = 'error', terminada_en = CURRENT_TIMESTAMP,
           detalle = 'Se cortó a mitad de camino (el servidor se reinició o tardó demasiado).'
       WHERE estado = 'en_curso' AND iniciada_en < LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')`
    )
    .run(MINUTOS_CORTADA);
  const fila = manual
    ? await db
        .prepare(
          `INSERT INTO copias_seguridad (manual) SELECT TRUE WHERE ${porRestauracion ? 'TRUE' : SIN_RESTAURACION}
           ON CONFLICT DO NOTHING RETURNING id`
        )
        .get()
    : await db
        .prepare(
          `INSERT INTO copias_seguridad (manual)
           SELECT FALSE WHERE NOT EXISTS (SELECT 1 FROM copias_seguridad WHERE NOT manual AND iniciada_en >= ?) AND ${SIN_RESTAURACION}
           ON CONFLICT DO NOTHING RETURNING id`
        )
        .get(textoUtc(inicioCopiaDelDia()));
  return fila?.id ?? null;
}

async function correrCopia(id, manual, sufijo = null) {
  let r;
  try {
    r = { estado: 'ok', ...(await respaldar(sufijo)) };
  } catch (err) {
    r = { estado: 'error', archivo: null, bytes: null, detalle: String(err?.message ?? err) };
  }
  await db
    .prepare(
      `UPDATE copias_seguridad SET estado = ?, archivo = ?, bytes = ?, detalle = ?, terminada_en = CURRENT_TIMESTAMP WHERE id = ?`
    )
    .run(r.estado, r.archivo, r.bytes, r.detalle.slice(0, MAX_DETALLE), id)
    .catch((err) => console.error(`[copias] no se pudo guardar el resultado de la copia #${id}:`, err.message));
  if (r.estado === 'ok') {
    console.log(`[copias] OK: ${r.archivo} · ${r.detalle}`);
  } else {
    console.error(`[copias] falló la copia #${id}: ${r.detalle}`);
    if (!manual) await avisarFalla(r.detalle);
  }
  return r;
}

// "Respaldar ahora" del panel: arranca la copia y vuelve enseguida (el panel sigue el avance).
export async function pedirCopia() {
  const faltan = faltantes();
  if (faltan.length) throw new ApiError(503, `Las copias no están configuradas en el servidor: falta ${faltan.join(' y ')}.`);
  const id = await tomarTurno(true);
  if (!id) throw new ApiError(409, 'Hay una copia o una restauración en curso. Esperá a que termine.');
  correrCopia(id, true).catch((err) => console.error('[copias]', err.message));
  return { id };
}

// La copia de cómo estaba todo, justo antes de restaurar (con el sistema ya en mantenimiento).
// Devuelve el nombre del archivo; si no sale, lanza y la restauración no sigue.
export async function hacerResguardo() {
  const id = await tomarTurno(true, { porRestauracion: true });
  if (!id) throw new Error('Hay una copia en curso: esperá a que termine y volvé a intentar.');
  const r = await correrCopia(id, true, SUFIJO_RESGUARDO);
  if (r.estado !== 'ok') throw new Error(`No se pudo hacer la copia de resguardo, así que no se restauró nada: ${r.detalle}`);
  return r.archivo;
}

// Las copias que hay en Drive para elegir cuál restaurar, de la más nueva a la más vieja.
// tipo: automatica | manual | resguardo (null si no figura en el historial).
export async function listarCopiasDrive() {
  if (faltantes().length) throw new ApiError(503, `Las copias no están configuradas en el servidor: falta ${faltantes().join(' y ')}.`);
  const carpetaId = await carpetaExistente();
  if (!carpetaId) return [];
  const host = instalacion();
  const archivos = (await listarArchivos(carpetaId))
    .map((a) => ({ a, datos: leerNombreCopia(a.name, host) }))
    .filter((x) => x.datos);
  const nombres = archivos.map((x) => x.a.name);
  const manuales = new Map(
    (nombres.length ? await db.prepare('SELECT archivo, manual FROM copias_seguridad WHERE archivo = ANY(?)').all(nombres) : []).map((f) => [
      f.archivo,
      f.manual,
    ])
  );
  return archivos
    .map(({ a, datos }) => ({
      id: a.id,
      nombre: a.name,
      fecha: datos.fecha,
      bytes: Number(a.size) || 0,
      tipo: datos.resguardo ? 'resguardo' : manuales.has(a.name) ? (manuales.get(a.name) ? 'manual' : 'automatica') : null,
    }))
    .sort((x, y) => (x.fecha < y.fecha ? 1 : -1));
}

// Tarea horaria: la automática del día, desde las 3 (si el servidor estuvo caído, al volver).
export async function revisarCopiaDiaria() {
  if (enMantenimiento() || faltantes().length || new Date() < inicioCopiaDelDia()) return;
  const id = await tomarTurno(false);
  if (id) await correrCopia(id, false);
}

// Pestaña Copias del panel.
export async function estadoCopias() {
  const [historial, ultimaOk, versionBase, versionCliente] = await Promise.all([
    db
      .prepare(
        `SELECT id, estado, manual, archivo, bytes, detalle, iniciada_en, terminada_en
         FROM copias_seguridad ORDER BY id DESC LIMIT 30`
      )
      .all(),
    db.prepare(`SELECT MAX(terminada_en) AS fecha FROM copias_seguridad WHERE estado = 'ok'`).get(),
    db
      .prepare('SHOW server_version')
      .get()
      .then((f) => f?.server_version ?? null)
      .catch(() => null),
    correr('pg_dump', ['--version'], process.env, 10_000)
      .then((s) => s.trim().replace(/^pg_dump \(PostgreSQL\) /, ''))
      .catch(() => null),
  ]);
  const host = instalacion();
  return {
    faltan: faltantes(),
    carpeta: `${CARPETA_COPIAS} / ${host ?? '—'}`,
    hora: HORA_COPIA,
    retencion_dias: DIAS_RETENCION,
    ultima_ok: ultimaOk?.fecha ?? null,
    version_base: versionBase,
    version_pg_dump: versionCliente,
    historial,
  };
}
