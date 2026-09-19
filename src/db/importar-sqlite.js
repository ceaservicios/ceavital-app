import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import db, { pool } from './connection.js';
import { runMigrations } from './migrate.js';

// Importa los datos de una base SQLite de la epoca anterior (un archivo
// ceavital.db) a PostgreSQL. Se usa una sola vez, en el pase a produccion:
//   * Todo en UNA transaccion: si algo falla o no coincide, no queda nada a medias.
//   * Solo importa si Postgres esta VACIO (nunca mezcla ni pisa datos).
//   * No modifica ni borra el archivo SQLite: queda como respaldo.
//   * Verifica cantidad de filas de cada tabla y las sumas de dinero antes de confirmar.
//   * No copia las sesiones abiertas: todos vuelven a iniciar sesion una vez.

// Orden por dependencias de claves foraneas.
const TABLAS = [
  'usuarios', 'proveedores', 'categorias', 'unidades_medida', 'condiciones_pago',
  'productos', 'lotes', 'clientes_empresa', 'ventas', 'venta_items',
  'cuenta_corriente_movimientos', 'pedidos_proveedor', 'pedido_items', 'cierres_caja',
  'backups_historial', 'configuracion', 'gastos_caja', 'pedidos_cliente', 'pedido_cliente_items',
];
const TABLAS_CON_ID = TABLAS.filter((t) => t !== 'configuracion');
const SUMAS = [
  ['ventas', 'total'], ['venta_items', 'subtotal'], ['cuenta_corriente_movimientos', 'monto'],
  ['gastos_caja', 'monto'], ['cierres_caja', 'total_general'], ['pedidos_cliente', 'total'],
];

async function postgresEstaVacio(client) {
  for (const tabla of TABLAS) {
    const { rows } = await client.query(`SELECT EXISTS (SELECT 1 FROM ${tabla}) AS hay`);
    if (rows[0].hay) return false;
  }
  return true;
}

function tablaExiste(sqlite, tabla) {
  return Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla));
}

async function columnasPostgres(client, tabla) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tabla]
  );
  return new Set(rows.map((r) => r.column_name));
}

// Bases viejas guardaban categoria/unidad de medida/condicion de pago como texto libre
// ademas de la clave foranea. Si una fila quedo sin clave, se busca (o crea) el catalogo por su nombre.
function crearResolutorDeCatalogo(client) {
  const cache = new Map();
  return async (tabla, nombre, porDefecto = null) => {
    const limpio = (nombre ?? porDefecto ?? '').toString().trim();
    if (!limpio) return null;
    const clave = `${tabla}:${limpio.toLowerCase()}`;
    if (cache.has(clave)) return cache.get(clave);
    let { rows } = await client.query(`SELECT id FROM ${tabla} WHERE LOWER(nombre) = LOWER($1) AND eliminado_en IS NULL`, [limpio]);
    if (rows.length === 0) {
      ({ rows } = await client.query(`INSERT INTO ${tabla} (nombre) VALUES ($1) RETURNING id`, [limpio]));
    }
    cache.set(clave, rows[0].id);
    return rows[0].id;
  };
}

async function copiarTabla(client, sqlite, tabla, resolverCatalogo) {
  if (!tablaExiste(sqlite, tabla)) return 0;

  const columnasPg = await columnasPostgres(client, tabla);
  const columnasSqlite = sqlite.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
  const columnas = columnasSqlite.filter((c) => columnasPg.has(c));
  const filas = sqlite.prepare(`SELECT * FROM ${tabla}`).all();

  for (const fila of filas) {
    if (tabla === 'productos') {
      fila.unidad_medida_id ??= await resolverCatalogo('unidades_medida', fila.unidad_medida, 'Unidad');
      fila.categoria_id ??= await resolverCatalogo('categorias', fila.categoria);
    }
    if (tabla === 'clientes_empresa') {
      fila.condicion_pago_id ??= await resolverCatalogo('condiciones_pago', fila.condicion_pago);
    }
    const valores = columnas.map((c) => fila[c] ?? null);
    const marcadores = columnas.map((_, i) => `$${i + 1}`).join(', ');
    await client.query(`INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${marcadores})`, valores);
  }
  return filas.length;
}

/**
 * @param {string} rutaSqlite ruta del archivo .db de SQLite
 * @returns {Promise<{importado: boolean, motivo?: string, filas?: Record<string, number>}>}
 */
export async function importarDesdeSqlite(rutaSqlite) {
  if (!fs.existsSync(rutaSqlite)) return { importado: false, motivo: `no existe el archivo ${rutaSqlite}` };

  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(rutaSqlite, { readOnly: true });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // Candado para que dos instancias arrancando a la vez no importen dos veces.
    await client.query('SELECT pg_advisory_xact_lock(727002)');

    if (!(await postgresEstaVacio(client))) {
      await client.query('ROLLBACK');
      return { importado: false, motivo: 'PostgreSQL ya tiene datos (no se importa nada)' };
    }

    const resolverCatalogo = crearResolutorDeCatalogo(client);
    const filas = {};
    for (const tabla of TABLAS) filas[tabla] = await copiarTabla(client, sqlite, tabla, resolverCatalogo);

    // Las secuencias de ids siguen desde el maximo importado.
    for (const tabla of TABLAS_CON_ID) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${tabla}', 'id'), m.mx, true)
         FROM (SELECT MAX(id) AS mx FROM ${tabla}) m WHERE m.mx IS NOT NULL`
      );
    }

    // Verificacion: mismas cantidades y mismas sumas de dinero que en el origen.
    for (const tabla of TABLAS) {
      if (!tablaExiste(sqlite, tabla)) continue;
      const origen = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n;
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${tabla}`);
      // Los catalogos pueden tener filas de mas si hubo que crearlas desde texto libre.
      const catalogo = ['categorias', 'unidades_medida', 'condiciones_pago'].includes(tabla);
      if (rows[0].n < origen || (!catalogo && rows[0].n !== origen)) {
        throw new Error(`[importar] ${tabla}: ${origen} filas en SQLite y ${rows[0].n} en PostgreSQL`);
      }
    }
    for (const [tabla, columna] of SUMAS) {
      if (!tablaExiste(sqlite, tabla)) continue;
      const origen = Number(sqlite.prepare(`SELECT COALESCE(SUM(${columna}), 0) AS s FROM ${tabla}`).get().s);
      const { rows } = await client.query(`SELECT COALESCE(SUM(${columna}), 0)::float8 AS s FROM ${tabla}`);
      if (Number(rows[0].s) !== origen) {
        throw new Error(`[importar] suma de ${tabla}.${columna}: ${origen} en SQLite y ${rows[0].s} en PostgreSQL`);
      }
    }

    await client.query('COMMIT');
    return { importado: true, filas };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    sqlite.close();
  }
}

// Uso desde la terminal: node src/db/importar-sqlite.js <ruta/al/ceavital.db>
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error('Uso: npm run importar:sqlite -- <ruta/al/ceavital.db>');
    process.exit(1);
  }
  try {
    await runMigrations();
    const r = await importarDesdeSqlite(ruta);
    if (r.importado) console.log('[importar] listo. Filas por tabla:', r.filas);
    else console.log(`[importar] no se importo: ${r.motivo}`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await db.cerrar();
  }
}
