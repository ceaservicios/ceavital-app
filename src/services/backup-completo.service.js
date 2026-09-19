import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { pool } from '../db/connection.js';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

// Backup completo de la base de datos, pensado para llevarse a OTRA instalación de CEAVital
// (o a la misma después de un desastre) y restaurarse entero.
//
// Cómo se hace, sin pg_dump (que tendría que coincidir con la versión del servidor y no
// viene en la imagen de Node):
//  * Todas las tablas se leen dentro de UNA transacción REPEATABLE READ de solo lectura:
//    el archivo es una foto consistente aunque el negocio siga vendiendo mientras tanto.
//  * Cada fila viaja como JSON exacto (to_jsonb): la restauración usa jsonb_populate_recordset,
//    que devuelve cada valor a su tipo de columna sin pérdida (montos BIGINT, NUMERIC, fechas).
//  * El archivo es NDJSON -> gzip -> AES-256-GCM con una clave derivada (scrypt) de la
//    contraseña que se elige al descargar. Adentro hay hashes de contraseñas y datos de
//    clientes: sin contraseña, el archivo no se puede leer, y cualquier alteración lo invalida.
//
// Formato del archivo (.ceavbak):  "CEAVBK01" | salt(16) | iv(12) | ciphertext | tag(16)
//
// NO viajan: las sesiones abiertas, la cuenta del superadmin (es de CEA, no del negocio) y
// las tablas de defensa por IP (ips_bloqueadas, eventos_seguridad): son estado de la
// instalación, no datos del negocio.

const scrypt = promisify(crypto.scrypt);
const MAGIC = Buffer.from('CEAVBK01');
const LARGO_CABECERA = MAGIC.length + 16 + 12;
const LARGO_TAG = 16;
const FORMATO = 1;
const FILAS_POR_LOTE = 500;
export const PASSWORD_MIN_BACKUP = 12;

const TABLAS_EXCLUIDAS = new Set([
  '_migrations',
  'sesiones_activas',
  'sesiones_cliente',
  'sesiones_superadmin',
  'superadmin',
  'ips_bloqueadas',
  'eventos_seguridad',
]);

const ident = (nombre) => `"${String(nombre).replace(/"/g, '""')}"`;
const NOMBRE_SEGURO = /^[a-z_][a-z0-9_]*$/;

let enCurso = false;

function claveDe(password, salt) {
  // N=2^15 (~32 MB): lento a propósito para frenar el adivinar contraseñas por fuerza bruta.
  return scrypt(password, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}

function validarPassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_BACKUP || password.length > 200) {
    throw new ApiError(400, `La contraseña del backup tiene que tener entre ${PASSWORD_MIN_BACKUP} y 200 caracteres`);
  }
}

async function tablasDelBackup(client) {
  const { rows } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  return rows.map((r) => r.tablename).filter((t) => !TABLAS_EXCLUIDAS.has(t));
}

// ---------- Exportar ----------

// Genera el backup cifrado en un archivo temporal y devuelve su ruta. Quien lo llama lo
// entrega y lo borra. El archivo temporal ya está cifrado (nunca hay datos en claro en disco).
export async function generarBackup(password) {
  validarPassword(password);
  if (enCurso) throw new ApiError(409, 'Ya hay un backup generándose. Esperá a que termine.');
  enCurso = true;

  const sello = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const nombre = `ceavital-backup-${sello}.ceavbak`;
  const ruta = path.join(os.tmpdir(), `ceavital-${crypto.randomBytes(8).toString('hex')}.ceavbak.tmp`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    // Las tablas viajan ya en orden de dependencias (los padres primero): así la restauración
    // puede leer en streaming sin cargar todo en memoria.
    const tablas = await ordenarPorDependencias(client, await tablasDelBackup(client));
    const conteos = {};
    for (const t of tablas) {
      conteos[t] = Number((await client.query(`SELECT COUNT(*) AS n FROM ${ident(t)}`)).rows[0].n);
    }
    const migraciones = (await client.query('SELECT archivo FROM _migrations ORDER BY archivo')).rows.map((r) => r.archivo);

    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', await claveDe(password, salt), iv);
    const gzip = zlib.createGzip();
    const destino = fs.createWriteStream(ruta, { mode: 0o600 });
    destino.write(Buffer.concat([MAGIC, salt, iv]));

    const fallo = new Promise((_, rechazar) => {
      for (const flujo of [gzip, cipher, destino]) flujo.once('error', rechazar);
    });
    fallo.catch(() => {});
    const cifradoTerminado = new Promise((resolver) => cipher.once('end', resolver));
    gzip.pipe(cipher);
    cipher.pipe(destino, { end: false }); // el destino se cierra a mano, agregando el tag
    const escribir = async (linea) => {
      if (!gzip.write(linea)) await Promise.race([new Promise((r) => gzip.once('drain', r)), fallo]);
    };

    await escribir(
      `${JSON.stringify({ formato: FORMATO, app: 'ceavital', version: config.version, creado_en: new Date().toISOString(), migraciones, tablas: conteos })}\n`
    );
    let cursorN = 0;
    for (const t of tablas) {
      const cursor = `bk_${cursorN++}`;
      await client.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR SELECT to_jsonb(x)::text AS r FROM ${ident(t)} x`);
      const cabeza = `{"t":${JSON.stringify(t)},"r":`;
      for (;;) {
        const { rows } = await client.query(`FETCH 1000 FROM ${cursor}`);
        if (rows.length === 0) break;
        await escribir(rows.map((f) => `${cabeza}${f.r}}\n`).join(''));
      }
      await client.query(`CLOSE ${cursor}`);
    }
    await escribir(`${JSON.stringify({ fin: true })}\n`);
    gzip.end();
    await Promise.race([cifradoTerminado, fallo]);
    await Promise.race([new Promise((r) => destino.end(cipher.getAuthTag(), r)), fallo]);
    await client.query('COMMIT');

    return { ruta, nombre, tablas: conteos };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await fs.promises.rm(ruta, { force: true });
    throw err;
  } finally {
    client.release();
    enCurso = false;
  }
}

// ---------- Restaurar ----------

async function abrirBackup(ruta, password) {
  validarPassword(password);
  const info = await fs.promises.stat(ruta).catch(() => null);
  if (!info || !info.isFile()) throw new Error(`No se encontró el archivo ${ruta}`);
  if (info.size < LARGO_CABECERA + LARGO_TAG + 1) throw new Error('El archivo no es un backup de CEAVital (es muy chico)');

  const fd = await fs.promises.open(ruta, 'r');
  try {
    const cabecera = Buffer.alloc(LARGO_CABECERA);
    await fd.read(cabecera, 0, LARGO_CABECERA, 0);
    if (!cabecera.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('El archivo no es un backup de CEAVital (formato no reconocido)');
    const tag = Buffer.alloc(LARGO_TAG);
    await fd.read(tag, 0, LARGO_TAG, info.size - LARGO_TAG);

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      await claveDe(password, cabecera.subarray(MAGIC.length, MAGIC.length + 16)),
      cabecera.subarray(MAGIC.length + 16)
    );
    decipher.setAuthTag(tag);
    return { inicio: LARGO_CABECERA, fin: info.size - LARGO_TAG - 1, decipher };
  } finally {
    await fd.close();
  }
}

const MENSAJE_CLAVE_O_ARCHIVO = 'Contraseña incorrecta o archivo dañado: no se pudo descifrar el backup';

// Recorre las líneas del backup ya descifradas y descomprimidas.
async function* leerLineas(ruta, password) {
  const { inicio, fin, decipher } = await abrirBackup(ruta, password);
  const origen = fs.createReadStream(ruta, { start: inicio, end: fin });
  const gunzip = zlib.createGunzip();
  origen.pipe(decipher).pipe(gunzip);
  // Un error de cualquier etapa (clave mala = la autenticación GCM falla) corta la lectura.
  const fallo = new Promise((_, rechazar) => {
    for (const s of [origen, decipher, gunzip]) s.once('error', rechazar);
  });
  fallo.catch(() => {});
  const lineas = readline.createInterface({ input: gunzip, crlfDelay: Infinity });
  try {
    for await (const linea of lineas) yield linea;
  } catch {
    throw new Error(MENSAJE_CLAVE_O_ARCHIVO);
  } finally {
    origen.destroy();
  }
}

// Orden de carga que respeta las claves foráneas (los padres primero).
async function ordenarPorDependencias(client, tablas) {
  const { rows } = await client.query(
    `SELECT c.conrelid::regclass::text AS hijo, c.confrelid::regclass::text AS padre FROM pg_constraint c WHERE c.contype = 'f'`
  );
  const conjunto = new Set(tablas);
  const faltan = new Map(tablas.map((t) => [t, new Set()]));
  for (const { hijo, padre } of rows) {
    const h = hijo.replace(/"/g, '');
    const p = padre.replace(/"/g, '');
    if (h !== p && conjunto.has(h) && conjunto.has(p)) faltan.get(h).add(p);
  }
  const orden = [];
  while (faltan.size) {
    const listas = [...faltan].filter(([, deps]) => deps.size === 0).map(([t]) => t);
    if (listas.length === 0) throw new Error('Las tablas tienen dependencias circulares: no se puede fijar un orden de carga');
    for (const t of listas.sort()) {
      orden.push(t);
      faltan.delete(t);
      for (const deps of faltan.values()) deps.delete(t);
    }
  }
  return orden;
}

/**
 * Restaura un backup .ceavbak en la base de ESTA instalación, reemplazando los datos de
 * negocio (todo o nada: una sola transacción, si algo falla no se toca nada). La base tiene
 * que tener el esquema al día (npm run migrate, o simplemente haber arrancado la app).
 * No toca la cuenta del superadmin, las sesiones ni la defensa por IP.
 */
export async function restaurarBackup(ruta, password) {
  const lineas = leerLineas(ruta, password);
  const primera = await lineas.next();
  if (primera.done) throw new Error(MENSAJE_CLAVE_O_ARCHIVO);
  let manifiesto;
  try {
    manifiesto = JSON.parse(primera.value);
  } catch {
    throw new Error(MENSAJE_CLAVE_O_ARCHIVO);
  }
  if (manifiesto.app !== 'ceavital' || manifiesto.formato !== FORMATO) {
    throw new Error(`Formato de backup no soportado (formato ${manifiesto.formato}, esta versión lee el ${FORMATO})`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // El esquema de destino tiene que ser igual o más nuevo que el del backup.
    const enDestino = new Set((await client.query('SELECT archivo FROM _migrations')).rows.map((r) => r.archivo));
    const sinAplicar = manifiesto.migraciones.filter((m) => !enDestino.has(m));
    if (sinAplicar.length) {
      throw new Error(
        `El backup es de una versión más nueva que esta instalación (faltan las migraciones: ${sinAplicar.join(', ')}). Actualizá la app destino y volvé a intentar.`
      );
    }

    const tablas = Object.keys(manifiesto.tablas);
    for (const t of tablas) {
      if (!NOMBRE_SEGURO.test(t) || TABLAS_EXCLUIDAS.has(t)) throw new Error(`El backup trae una tabla no válida: ${t}`);
    }
    const existentes = new Set(await tablasDelBackup(client));
    const desconocidas = tablas.filter((t) => !existentes.has(t));
    if (desconocidas.length) throw new Error(`El backup trae tablas que esta instalación no tiene: ${desconocidas.join(', ')}`);

    await client.query(`TRUNCATE ${tablas.map(ident).join(', ')} CASCADE`);

    const columnasValidas = new Map();
    const cargadas = Object.fromEntries(tablas.map((t) => [t, 0]));
    const terminadas = new Set();
    let actual = null;
    let lote = [];
    let vieronFin = false;

    const volcar = async () => {
      if (lote.length === 0) return;
      if (!columnasValidas.has(actual)) {
        const { rows } = await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
          [actual]
        );
        columnasValidas.set(actual, new Set(rows.map((r) => r.column_name)));
      }
      const columnas = Object.keys(lote[0]);
      const ajenas = columnas.filter((c) => !columnasValidas.get(actual).has(c));
      if (ajenas.length) throw new Error(`La tabla ${actual} del backup tiene columnas que esta instalación no tiene: ${ajenas.join(', ')}`);
      const lista = columnas.map(ident).join(', ');
      await client.query(
        `INSERT INTO ${ident(actual)} (${lista}) SELECT ${lista} FROM jsonb_populate_recordset(NULL::${ident(actual)}, $1::jsonb)`,
        [JSON.stringify(lote)]
      );
      cargadas[actual] += lote.length;
      lote = [];
    };

    for await (const linea of lineas) {
      const o = JSON.parse(linea);
      if (o.fin) {
        vieronFin = true;
        break;
      }
      if (!(o.t in cargadas)) throw new Error(`El backup trae filas de una tabla no declarada: ${o.t}`);
      if (o.t !== actual) {
        await volcar();
        if (actual) terminadas.add(actual);
        if (terminadas.has(o.t)) throw new Error(`El backup está desordenado (la tabla ${o.t} aparece dos veces)`);
        actual = o.t;
      }
      lote.push(o.r);
      if (lote.length >= FILAS_POR_LOTE) await volcar();
    }
    await volcar();
    // Sin la línea final el archivo quedó cortado (o la clave era otra: GCM falla al cerrar).
    if (!vieronFin) throw new Error(MENSAJE_CLAVE_O_ARCHIVO);

    // Los contadores de las columnas id siguen después del mayor id restaurado.
    const { rows: identidades } = await client.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND is_identity = 'YES' AND table_name = ANY($1)`,
      [tablas]
    );
    for (const { table_name: tabla, column_name: columna } of identidades) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${ident(columna)}) FROM ${ident(tabla)}), 0) + 1, false)`,
        [ident(tabla), columna]
      );
    }

    // Comprobación final: lo que quedó en cada tabla coincide con lo que se resguardó.
    for (const tabla of tablas) {
      const { n } = (await client.query(`SELECT COUNT(*) AS n FROM ${ident(tabla)}`)).rows[0];
      if (Number(n) !== manifiesto.tablas[tabla] || cargadas[tabla] !== manifiesto.tablas[tabla]) {
        throw new Error(`Falló la comprobación de ${tabla}: el backup tenía ${manifiesto.tablas[tabla]} filas y quedaron ${n}`);
      }
    }

    await client.query('COMMIT');
    return { creado_en: manifiesto.creado_en, version: manifiesto.version, tablas: manifiesto.tablas };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await lineas.return?.();
  }
}
