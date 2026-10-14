import { mkdtemp, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import config from '../config/env.js';
import db from '../db/connection.js';
import { CLAVE_CANDADO, listarMigraciones } from '../db/migrate.js';
import { ApiError } from '../utils/api-error.js';
import { encolarCorreo } from './cola-correo.service.js';
import { carpetaExistente, correr, faltantes, hacerResguardo, instalacion, leerNombreCopia, variablesPg } from './copias.service.js';
import { cargarBloqueos } from './defensa-ip.service.js';
import { datosArchivo, descargarArchivo } from './google-drive.service.js';
import { armarCorreoRestauracion, correoCeaDisponible } from './mail.service.js';
import { entrarEnMantenimiento, salirDeMantenimiento } from './mantenimiento.service.js';
import { invalidarCachePlan } from './modulos.service.js';
import { ACTOR_SISTEMA, registrarAccion } from './registro.service.js';

// Restaurar una copia de seguridad del Drive sobre la base real, desde el panel /sa (pedido del
// usuario, 2026-10-11; diseño de los agentes ingeniero-software y disenador-ux).
//
// Cómo: con el sistema en mantenimiento, primero una copia de cómo está todo (el "deshacer"); después
// se baja la copia elegida y, en UNA sola transacción de psql (si algo falla, o se corta, no cambia
// nada):
//   1. se frenan todas las tablas y la base actual se guarda entera como el esquema
//      restauracion_<id> (queda en la base, nunca se borra);
//   2. se carga la copia en un public nuevo (pg_restore -L, sin los datos de PRESERVADAS ni SIN_DATOS);
//   3. se aplican las migraciones que la copia no tenía (copia de una versión anterior);
//   4. se traen de la base de recién las tablas que no vuelven atrás y se cierran las sesiones.
// No se usa pg_restore --clean: no borra lo que agregaron migraciones posteriores a la copia y su
// DROP esquivaría el trigger del registro inmutable.

const { escapeIdentifier, escapeLiteral } = pg;
const MINUTO = 60_000;
const MAX_BYTES = 1024 ** 3; // 1 GB: más grande, se restaura a mano
const MINUTOS_CORTADA = 90;
const MAX_RECHAZOS = 5; // contraseña o código mal en 15 minutos

// No vuelven atrás: se traen de la base de recién, en este orden (las que apuntan a otra, después).
//   registro_acciones (EST-01 §6), copias_seguridad y restauraciones (historial real), defensa por IP,
//   cuenta y sesiones del superadmin, instancia/plan/cuota/pagos (son de CEA) y la cola de correos
//   (así no vuelven a salir mails viejos de la copia).
export const PRESERVADAS = [
  'superadmin',
  'sesiones_superadmin',
  'instancia',
  'configuracion',
  'pagos_cuota',
  'cuota_avisos',
  'ips_bloqueadas',
  'eventos_seguridad',
  'registro_acciones',
  'correos',
  'copias_seguridad',
  'restauraciones',
];
// Quedan vacías (sus filas siguen en el esquema anterior y en la copia): códigos de ingreso a medio
// usar y navegadores de confianza. Apuntan a cuentas que pueden no existir en la copia; al volver a
// entrar se pide la verificación de nuevo.
export const SIN_DATOS = ['codigos_ingreso', 'dispositivos_2fa'];
const SIN_DATOS_DE_LA_COPIA = new Set([...PRESERVADAS, ...SIN_DATOS]);

// ---- Reglas puras ----

// Tipos de entrada de `pg_restore -l` (los de varias palabras primero).
const TIPOS = [
  'TABLE DATA', 'SEQUENCE SET', 'SEQUENCE OWNED BY', 'FK CONSTRAINT', 'DEFAULT ACL', 'MATERIALIZED VIEW DATA',
  'MATERIALIZED VIEW', 'DATABASE PROPERTIES', 'STATISTICS DATA', 'INDEX ATTACH', 'TABLE ATTACH', 'ROW SECURITY',
  'EVENT TRIGGER', 'FOREIGN TABLE', 'LARGE OBJECT', 'BLOB METADATA', 'ACCESS METHOD', 'OPERATOR CLASS', 'OPERATOR FAMILY',
  'TEXT SEARCH CONFIGURATION', 'TEXT SEARCH DICTIONARY', 'PUBLICATION TABLE', 'PROCEDURAL LANGUAGE', 'USER MAPPING',
  'FOREIGN DATA WRAPPER', 'TABLE', 'SEQUENCE', 'INDEX', 'CONSTRAINT', 'TRIGGER', 'FUNCTION', 'PROCEDURE', 'AGGREGATE',
  'VIEW', 'TYPE', 'DOMAIN', 'DEFAULT', 'RULE', 'POLICY', 'STATISTICS', 'COLLATION', 'CONVERSION', 'CAST', 'OPERATOR',
  'EXTENSION', 'SCHEMA', 'COMMENT', 'ACL', 'DATABASE', 'ENCODING', 'STDSTRINGS', 'SEARCHPATH', 'BLOBS', 'BLOB',
  'PUBLICATION', 'SUBSCRIPTION', 'SERVER', 'TRANSFORM', 'LANGUAGE',
].sort((a, b) => b.length - a.length);
const ENCABEZADOS = new Set(['ENCODING', 'STDSTRINGS', 'SEARCHPATH']);
const IGNORABLES = new Set(['SCHEMA', 'COMMENT', 'ACL', 'DEFAULT ACL', 'DATABASE', 'DATABASE PROPERTIES']);

// Entradas de `pg_restore -l`: "ID; OID OID TIPO ESQUEMA NOMBRE DUEÑO".
export function parsearToc(texto) {
  const entradas = [];
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\d+; \d+ \d+ (.+)$/.exec(linea);
    if (!m) continue;
    const tipo = TIPOS.find((t) => m[1] === t || m[1].startsWith(`${t} `)) ?? null;
    const [esquema = '-', nombre = ''] = tipo ? m[1].slice(tipo.length + 1).split(' ') : [];
    entradas.push({ linea, tipo, esquema, nombre });
  }
  return entradas;
}

// Lo que se restaura: todo lo del esquema public, salvo los datos de las tablas que no vuelven atrás.
// Si aparece algo que no es de este sistema (una extensión, otro esquema), no se restaura nada.
export function filtrarToc(entradas) {
  const lista = [];
  const raros = [];
  for (const e of entradas) {
    if (e.esquema === 'public') {
      if (!(e.tipo === 'TABLE DATA' && SIN_DATOS_DE_LA_COPIA.has(e.nombre))) lista.push(e.linea);
    } else if (ENCABEZADOS.has(e.tipo)) {
      lista.push(e.linea);
    } else if (!IGNORABLES.has(e.tipo) && !(e.tipo === 'EXTENSION' && e.nombre === 'plpgsql')) {
      raros.push(e.linea);
    }
  }
  if (raros.length) throw new Error(`La copia tiene objetos que esta restauración no sabe manejar: ${raros.slice(0, 3).join(' | ')}`);
  if (!lista.some((l) => / TABLE public usuarios /.test(l))) throw new Error('La copia no tiene la tabla de usuarios: no parece una copia de este sistema.');
  return lista;
}

// Las migraciones que tenía la copia, de `pg_restore --data-only -t _migrations -f -`.
export function migracionesDeLaCopia(texto) {
  const lineas = texto.split(/\r?\n/);
  const i = lineas.findIndex((l) => /^COPY public\._migrations \(/.test(l));
  if (i < 0) throw new Error('La copia no tiene el registro de versiones (_migrations): no parece una copia de este sistema.');
  const columna = /\(([^)]*)\)/.exec(lineas[i])[1].split(',').map((c) => c.trim().replaceAll('"', '')).indexOf('archivo');
  const archivos = [];
  for (const l of lineas.slice(i + 1)) {
    if (l === '\\.') break;
    if (l) archivos.push(l.split('\t')[columna]);
  }
  return archivos;
}

// Las del código que la copia no tiene. Una copia de una versión MÁS NUEVA que el código no se restaura.
export function migracionesPendientes(enCopia, delCodigo) {
  const conocidas = new Set(delCodigo.map((m) => m.archivo));
  const desconocidas = enCopia.filter((a) => !conocidas.has(a));
  if (desconocidas.length) {
    throw new Error(`La copia es de una versión más nueva del sistema (${desconocidas.join(', ')}): no se puede restaurar con esta.`);
  }
  const ya = new Set(enCopia);
  return delCodigo.filter((m) => !ya.has(m.archivo));
}

export const esquemaPrevio = (id) => `restauracion_${Number(id)}`;

// 1: frena todo y guarda la base actual entera en `esquema`; deja un public vacío para la copia.
export function sqlPrevio(esquema) {
  return `SET lock_timeout = '30s';
SELECT pg_advisory_xact_lock(${CLAVE_CANDADO});
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t.tablename);
  END LOOP;
END $$;
ALTER SCHEMA public RENAME TO ${escapeIdentifier(esquema)};
CREATE SCHEMA public;
SET lock_timeout = 0;
`;
}

// 3: las migraciones que le faltan a la copia, cada una con su fila en _migrations.
export function sqlPendientes(migraciones) {
  const partes = ['SET search_path TO public;'];
  for (const m of migraciones) {
    partes.push(`-- ${m.archivo}`, m.sql, `;\nINSERT INTO _migrations (archivo) VALUES (${escapeLiteral(m.archivo)});`);
  }
  return `${partes.join('\n')}\n`;
}

// 4: lo que no vuelve atrás, sesiones cerradas, restauración terminada y su registro (todo en la
// misma transacción: si esto falla, tampoco se restauró nada).
export function sqlPosterior({ esquema, id, migraciones, superadmin, ip, copia, resguardo }) {
  const previo = escapeLiteral(esquema);
  const detalle = { restauracion_id: Number(id), copia, resguardo, migraciones, esquema_previo: esquema };
  return `SET search_path TO public;
DO $$
DECLARE t text; columnas text; secuencia text;
BEGIN
  FOREACH t IN ARRAY ARRAY[${PRESERVADAS.map(escapeLiteral).join(', ')}] LOOP
    CONTINUE WHEN to_regclass(format('%I.%I', ${previo}, t)) IS NULL OR to_regclass(format('public.%I', t)) IS NULL;
    SELECT string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position) INTO columnas
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = t AND c.is_generated = 'NEVER'
       AND EXISTS (SELECT 1 FROM information_schema.columns o
                    WHERE o.table_schema = ${previo} AND o.table_name = t AND o.column_name = c.column_name);
    EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM %I.%I', t, columnas, columnas, ${previo}, t);
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'id') THEN
      secuencia := pg_get_serial_sequence(format('public.%I', t), 'id');
      IF secuencia IS NOT NULL THEN
        EXECUTE format('SELECT setval(%L, COALESCE(MAX(id), 0) + 1, false) FROM public.%I', secuencia, t);
      END IF;
    END IF;
  END LOOP;
END $$;
UPDATE sesiones_activas SET estado = 'cerrada', motivo_cierre = 'expulsada', cerrada_en = CURRENT_TIMESTAMP WHERE estado = 'activa';
UPDATE sesiones_cliente SET estado = 'cerrada', motivo_cierre = 'expulsada', cerrada_en = CURRENT_TIMESTAMP WHERE estado = 'activa';
UPDATE restauraciones SET estado = 'ok', fase = 'terminada', terminada_en = CURRENT_TIMESTAMP,
       migraciones = ARRAY[${migraciones.map(escapeLiteral).join(', ')}]::text[]
 WHERE id = ${Number(id)};
INSERT INTO registro_acciones (actor_tipo, actor_id, actor, rol, categoria, accion, detalle, ip)
VALUES ('superadmin', ${Number(superadmin.id)}, ${escapeLiteral(String(superadmin.usuario).slice(0, 200))}, 'superadmin', 'instalacion',
        'restauracion-terminada', ${escapeLiteral(JSON.stringify(detalle))}::jsonb, ${ip ? escapeLiteral(String(ip).slice(0, 64)) : 'NULL'});
`;
}

// Qué Administradores cambian con la copia (antes = la base de recién; ahora = la restaurada).
export function compararAdmins(antes, ahora) {
  const previos = new Map(antes.map((a) => [a.id, a]));
  const nombre = (a) => a.email || a.usuario;
  const cambios = [];
  for (const a of ahora) {
    const b = previos.get(a.id);
    previos.delete(a.id);
    if (a.activo && !b?.activo) cambios.push(`${nombre(a)}: vuelve a estar activo`);
    else if (!a.activo && b?.activo) cambios.push(`${nombre(a)}: queda dado de baja`);
    else if (a.activo) {
      if (a.password_hash !== b.password_hash) cambios.push(`${nombre(a)}: vuelve a la contraseña que tenía en la copia`);
      if ((a.dosfa_metodo ?? null) !== (b.dosfa_metodo ?? null)) cambios.push(`${nombre(a)}: vuelve a la verificación en dos pasos de la copia`);
    }
  }
  for (const b of previos.values()) if (b.activo) cambios.push(`${nombre(b)}: no estaba en la copia, ya no existe`);
  return cambios;
}

// ---- Validaciones del pedido ----

// Contraseña o código mal en los últimos 15 minutos (del registro inmutable).
export async function demasiadosRechazos(superadminId) {
  const fila = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM registro_acciones
       WHERE accion = 'restauracion-rechazada' AND actor_id = ? AND creado_en > LOCALTIMESTAMP - INTERVAL '15 minutes'`
    )
    .get(superadminId);
  return Number(fila.n) >= MAX_RECHAZOS;
}

// La copia elegida: que esté en la carpeta de ESTA instalación en Drive, con nombre de copia y tamaño razonable.
export async function validarCopiaElegida(archivoId) {
  if (faltantes().length) throw new ApiError(503, `Las copias no están configuradas en el servidor: falta ${faltantes().join(' y ')}.`);
  if (typeof archivoId !== 'string' || !/^[\w-]{10,200}$/.test(archivoId)) throw new ApiError(400, 'Elegí una copia de la lista.');
  const carpetaId = await carpetaExistente();
  let a = null;
  try {
    a = carpetaId ? await datosArchivo(archivoId) : null;
  } catch {
    a = null;
  }
  if (!a || a.trashed || !(a.parents ?? []).includes(carpetaId)) {
    throw new ApiError(404, 'Esa copia ya no está en el Drive de esta instalación. Actualizá la lista.');
  }
  const datos = leerNombreCopia(a.name, instalacion());
  if (!datos) throw new ApiError(400, 'Ese archivo no es una copia de esta instalación.');
  const bytes = Number(a.size) || 0;
  if (!bytes) throw new ApiError(400, 'Esa copia está vacía.');
  if (bytes > MAX_BYTES) throw new ApiError(400, 'La copia pesa más de 1 GB: hay que restaurarla a mano.');
  return { id: a.id, nombre: a.name, bytes, md5: a.md5Checksum ?? null, fecha: datos.fecha };
}

// ---- La restauración ----

async function espacioLibre(dir, necesario) {
  const s = await statfs(dir);
  if (s.bavail * s.bsize < necesario) throw new Error('No hay espacio libre suficiente en el servidor para bajar y preparar la copia.');
}

async function cambiosDeAdministradores(esquema) {
  const consulta = (esq) =>
    `SELECT id, usuario, email, password_hash, dosfa_metodo, (eliminado_en IS NULL) AS activo
     FROM ${escapeIdentifier(esq)}.usuarios WHERE rol = 'admin'`;
  const [antes, ahora] = await Promise.all([db.prepare(consulta(esquema)).all(), db.prepare(consulta('public')).all()]);
  return compararAdmins(antes, ahora);
}

async function avisar({ ok, copia, resguardo, detalle }) {
  const para = config.defensa.alertaEmail || config.superadmin.email;
  if (!para || !correoCeaDisponible()) return;
  try {
    const enlace = `${config.publicUrl}/sa?pestana=copias`;
    await encolarCorreo({ para, ...armarCorreoRestauracion({ instalacion: instalacion(), ok, copia, resguardo, detalle, enlace }) }, { canal: 'cea', tipo: 'restauracion' });
  } catch (err) {
    console.error('[restauracion] no se pudo encolar el aviso:', err.message);
  }
}

async function correrRestauracion(id, copia, superadmin, ip) {
  const esquema = esquemaPrevio(id);
  const avanzar = (fase, { resguardo = null, previo = null } = {}) =>
    db
      .prepare(
        `UPDATE restauraciones SET fase = ?, resguardo = COALESCE(?, resguardo), esquema_previo = COALESCE(?, esquema_previo) WHERE id = ?`
      )
      .run(fase, resguardo, previo, id);
  let fase = 'resguardo';
  let resguardo = null;
  let resultado;
  const dir = await mkdtemp(join(tmpdir(), 'ceavital-restauracion-'));
  entrarEnMantenimiento();
  try {
    await avanzar('resguardo');
    resguardo = await hacerResguardo();

    fase = 'descargando';
    await avanzar('descargando', { resguardo });
    await espacioLibre(dir, copia.bytes * 3);
    const ruta = join(dir, 'copia.dump');
    const bajada = await descargarArchivo(copia.id, ruta, MAX_BYTES);
    if (bajada.bytes !== copia.bytes || (copia.md5 && bajada.md5 !== copia.md5)) {
      throw new Error('La copia se bajó incompleta o distinta de la que está en el Drive.');
    }

    fase = 'restaurando';
    await avanzar('restaurando', { previo: esquema });
    const lista = filtrarToc(parsearToc(await correr('pg_restore', ['-l', ruta], process.env, 5 * MINUTO)));
    const enCopia = migracionesDeLaCopia(await correr('pg_restore', ['--data-only', '-t', '_migrations', '-f', '-', ruta], process.env, 5 * MINUTO));
    const pendientes = migracionesPendientes(enCopia, listarMigraciones());
    const archivo = (n) => join(dir, n);
    await writeFile(archivo('lista.txt'), `${lista.join('\n')}\n`);
    await correr('pg_restore', ['-L', archivo('lista.txt'), '--no-owner', '--no-privileges', '-f', archivo('2-copia.sql'), ruta], process.env, 15 * MINUTO);
    await writeFile(archivo('1-previo.sql'), sqlPrevio(esquema));
    await writeFile(archivo('3-pendientes.sql'), sqlPendientes(pendientes));
    const migraciones = pendientes.map((m) => m.archivo);
    await writeFile(archivo('4-posterior.sql'), sqlPosterior({ esquema, id, migraciones, superadmin, ip, copia: copia.nombre, resguardo }));
    const sql = ['1-previo.sql', '2-copia.sql', '3-pendientes.sql', '4-posterior.sql'].flatMap((n) => ['-f', archivo(n)]);
    const env = { ...process.env, ...variablesPg(config.databaseUrl) };
    await correr('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', ...sql], env, 30 * MINUTO);

    // Ya está confirmada. Lo que sigue no la puede deshacer.
    invalidarCachePlan();
    await cargarBloqueos().catch((err) => console.error('[restauracion] no se pudieron recargar los bloqueos:', err.message));
    const cambios = await cambiosDeAdministradores(esquema).catch((err) => [`No se pudieron comparar los Administradores: ${err.message}`]);
    await db.prepare('UPDATE restauraciones SET cambios_admins = ?::jsonb WHERE id = ?').run(JSON.stringify(cambios), id);
    resultado = { ok: true, detalle: migraciones.length ? `Se aplicaron ${migraciones.length} actualizaciones del sistema.` : '' };
    console.log(`[restauracion] #${id} OK: ${copia.nombre} (resguardo ${resguardo}, base anterior en ${esquema})`);
  } catch (err) {
    const error = String(err?.message ?? err).slice(0, 2000);
    console.error(`[restauracion] #${id} falló en ${fase}: ${error}`);
    await db
      .prepare(`UPDATE restauraciones SET estado = 'error', terminada_en = CURRENT_TIMESTAMP, detalle = ? WHERE id = ? AND estado = 'en_curso'`)
      .run(error, id)
      .catch((e) => console.error('[restauracion] no se pudo guardar la falla:', e.message));
    await registrarAccion('restauracion-fallida', { actor: ACTOR_SISTEMA, detalle: { restauracion_id: Number(id), fase, error: error.slice(0, 300) } });
    resultado = { ok: false, detalle: error };
  } finally {
    salirDeMantenimiento();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  await avisar({ ...resultado, copia: copia.nombre, resguardo });
}

// Arranca la restauración (ya validados la copia, la contraseña, el código y el dominio) y vuelve
// enseguida: el panel sigue el avance con estadoRestauraciones().
export async function iniciarRestauracion({ copia, superadmin, ip }) {
  await db
    .prepare(
      `UPDATE restauraciones SET estado = 'error', terminada_en = CURRENT_TIMESTAMP, detalle = 'Se cortó a mitad de camino.'
       WHERE estado = 'en_curso' AND iniciada_en < LOCALTIMESTAMP - (?::int * INTERVAL '1 minute')`
    )
    .run(MINUTOS_CORTADA);
  const fila = await db
    .prepare(
      `INSERT INTO restauraciones (archivo_id, archivo, superadmin_id, superadmin, ip)
       SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM copias_seguridad WHERE estado = 'en_curso')
       ON CONFLICT DO NOTHING RETURNING id`
    )
    .get(copia.id, copia.nombre, superadmin.id, superadmin.usuario, ip ? String(ip).slice(0, 64) : null);
  if (!fila) throw new ApiError(409, 'Hay una copia o una restauración en curso. Esperá a que termine.');
  correrRestauracion(fila.id, copia, superadmin, ip).catch((err) => console.error('[restauracion]', err));
  return { id: fila.id };
}

// Al arrancar: una restauración que quedó "en curso" se cortó con el servidor. Su transacción no se
// confirmó, así que la base quedó como estaba.
export async function cerrarRestauracionesCortadas() {
  await db
    .prepare(
      `UPDATE restauraciones SET estado = 'error', terminada_en = CURRENT_TIMESTAMP,
              detalle = 'Se cortó porque el servidor se reinició. No se restauró nada: la base quedó como estaba.'
       WHERE estado = 'en_curso'`
    )
    .run();
}

// Pestaña Copias: las últimas restauraciones y si el usuario de la base puede hacerlas.
export async function estadoRestauraciones() {
  const [ultimas, permiso] = await Promise.all([
    db
      .prepare(
        `SELECT id, estado, fase, archivo, resguardo, esquema_previo, migraciones, cambios_admins, superadmin, detalle, iniciada_en, terminada_en
         FROM restauraciones ORDER BY id DESC LIMIT 5`
      )
      .all(),
    db
      .prepare(
        `SELECT has_database_privilege(current_database(), 'CREATE')
                AND pg_has_role((SELECT nspowner FROM pg_namespace WHERE nspname = 'public'), 'MEMBER') AS ok`
      )
      .get()
      .then((f) => Boolean(f?.ok))
      .catch(() => false),
  ]);
  return { ultimas, permiso, dominio: instalacion() };
}
