import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import db from '../db/connection.js';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import { DESTINOS, obtenerConfiguracionBackups } from './configuracion.service.js';

const PREFIJO_ARCHIVO = 'ceavital_backup_';
const PATRON_ARCHIVO = /^ceavital_backup_\d{8}_\d{6}\.db$/;

function timestampArchivo() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${ahora.getFullYear()}${pad(ahora.getMonth() + 1)}${pad(ahora.getDate())}_` +
    `${pad(ahora.getHours())}${pad(ahora.getMinutes())}${pad(ahora.getSeconds())}`
  );
}

function nombreArchivoBackup() {
  return `${PREFIJO_ARCHIVO}${timestampArchivo()}.db`;
}

// Copia consistente del archivo SQLite: el checkpoint vuelca el WAL al
// archivo principal antes de copiarlo. node:sqlite es síncrono y no hay
// `await` entre el checkpoint y el fs.copyFileSync -- corre todo en el mismo
// tick del único hilo de Node, así que no puede colarse otra escritura de
// otra request en el medio.
function copiarBaseA(rutaDestino) {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(config.dbPath, rutaDestino);
  return fs.statSync(rutaDestino).size;
}

// Retiene las últimas `retencionCantidad` copias en la carpeta (por fecha de
// modificación, la más nueva primero) y borra el resto -- Docs/Instructivo-
// Funcional.md > Backups > Retención. Solo toca archivos con el patrón de
// nombre de backup, nunca borra otra cosa que haya en esa carpeta.
function rotarBackups(carpeta, retencionCantidad) {
  if (!fs.existsSync(carpeta)) return;
  const archivos = fs
    .readdirSync(carpeta)
    .filter((f) => PATRON_ARCHIVO.test(f))
    .map((f) => {
      const ruta = path.join(carpeta, f);
      return { nombre: f, ruta, mtime: fs.statSync(ruta).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const archivo of archivos.slice(retencionCantidad)) {
    fs.unlinkSync(archivo.ruta);
  }
}

function registrarHistorial({ destino, estado, tamanoBytes = null, mensajeError = null }) {
  db.prepare(
    'INSERT INTO backups_historial (destino, estado, tamano_bytes, mensaje_error) VALUES (?, ?, ?, ?)'
  ).run(destino, estado, tamanoBytes, mensajeError);
}

// Hace el backup a TODOS los destinos habilitados (uno o varios a la vez).
// Cada destino se procesa en forma independiente -- si uno falla (ej. el USB
// no está conectado), no aborta a los demás; cada uno deja su propia fila en
// backups_historial, éxito o error.
export function ejecutarBackup() {
  const cfg = obtenerConfiguracionBackups();
  const habilitados = DESTINOS.filter((d) => cfg.destinos[d].habilitado);

  if (habilitados.length === 0) {
    throw new ApiError(400, 'No hay ningún destino de backup habilitado en la configuración');
  }

  const resultados = [];

  for (const destino of habilitados) {
    const { ruta } = cfg.destinos[destino];
    try {
      if (!ruta) throw new Error('No tiene una ruta configurada');

      // USB: la ruta puede no estar disponible si el dispositivo no está
      // conectado en este momento -- no se crea el directorio, se reporta el
      // error puntual (Docs/Instructivo-Funcional.md: "el backup se hace
      // cuando ese USB está conectado"). Local/nube sí se crean si faltan
      // (nube es, en la práctica, una carpeta local sincronizada por otra
      // app -- ej. cliente de Google Drive -- nunca una llamada a una API externa).
      if (destino === 'usb' && !fs.existsSync(ruta)) {
        throw new Error('La ruta configurada no está disponible (¿el USB está conectado?)');
      }
      fs.mkdirSync(ruta, { recursive: true });

      const archivoDestino = path.join(ruta, nombreArchivoBackup());
      const tamano = copiarBaseA(archivoDestino);
      rotarBackups(ruta, cfg.retencion_cantidad);

      registrarHistorial({ destino, estado: 'exito', tamanoBytes: tamano });
      resultados.push({ destino, estado: 'exito', tamano_bytes: tamano });
    } catch (err) {
      registrarHistorial({ destino, estado: 'error', mensajeError: err.message });
      resultados.push({ destino, estado: 'error', mensaje_error: err.message });
    }
  }

  return resultados;
}

export function listarHistorial() {
  return db.prepare('SELECT * FROM backups_historial ORDER BY creado_en DESC').all();
}

// Lista los archivos de backup reales que hay en la carpeta de un destino
// (para que el Admin elija cuál restaurar sin tener que adivinar el nombre
// exacto) -- separado del historial, que es solo metadata/auditoría y no
// guarda la ruta ni el nombre de archivo de cada copia.
export function listarArchivosDestino(destino) {
  if (!DESTINOS.includes(destino)) throw new ApiError(400, `destino tiene que ser uno de: ${DESTINOS.join(', ')}`);

  const cfg = obtenerConfiguracionBackups();
  const carpeta = cfg.destinos[destino].ruta;
  if (!carpeta) throw new ApiError(400, `El destino "${destino}" no tiene una ruta configurada`);
  if (!fs.existsSync(carpeta)) return [];

  return fs
    .readdirSync(carpeta)
    .filter((f) => PATRON_ARCHIVO.test(f))
    .map((f) => {
      const ruta = path.join(carpeta, f);
      const stat = fs.statSync(ruta);
      return { nombre_archivo: f, tamano_bytes: stat.size, modificado_en: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.modificado_en < b.modificado_en ? 1 : -1));
}

// Restauración (Docs/Instructivo-Funcional.md > Restauración de un backup):
// Admin + PC servidor únicamente (verificado en la ruta, no acá) + confirmación
// explícita (verificado en el controller) + backup de seguridad automático del
// estado ACTUAL antes de sobrescribir.
//
// Limitación arquitectónica real, no un atajo: `db` es una única conexión
// node:sqlite compartida por todo el proceso (import default en connection.js).
// Sobrescribir el archivo con esa conexión abierta es indefinido/riesgoso, así
// que acá se la cierra, se reemplaza el archivo, y se le pide al proceso que
// termine -- igual que el flujo ya documentado en CLAUDE.md > "Actualizaciones
// en producción" (detener servicio / reemplazar / reiniciar), solo que acá el
// primer paso lo dispara el propio botón de Restaurar en vez de un operador
// manual. El reinicio (`npm start` / futuro servicio de Windows) es un paso
// aparte, después de esta llamada.
export function restaurarBackup({ destino, nombre_archivo }) {
  if (!DESTINOS.includes(destino)) throw new ApiError(400, `destino tiene que ser uno de: ${DESTINOS.join(', ')}`);
  if (typeof nombre_archivo !== 'string' || !PATRON_ARCHIVO.test(nombre_archivo)) {
    throw new ApiError(400, 'nombre_archivo inválido');
  }

  const cfg = obtenerConfiguracionBackups();
  const carpeta = cfg.destinos[destino].ruta;
  if (!carpeta) throw new ApiError(400, `El destino "${destino}" no tiene una ruta configurada`);

  // Defensa en profundidad contra path traversal: aunque nombre_archivo ya
  // está validado contra PATRON_ARCHIVO (sin "/", "\" ni ".."), se resuelve la
  // ruta final y se confirma que sigue dentro de la carpeta configurada antes
  // de tocar cualquier archivo.
  const rutaArchivo = path.join(carpeta, nombre_archivo);
  if (path.resolve(path.dirname(rutaArchivo)) !== path.resolve(carpeta)) {
    throw new ApiError(400, 'Ruta de archivo inválida');
  }
  if (!fs.existsSync(rutaArchivo)) {
    throw new ApiError(404, 'El archivo de backup no existe en el destino configurado');
  }

  const carpetaSeguridad = cfg.destinos.local.ruta || config.dataDir;
  fs.mkdirSync(carpetaSeguridad, { recursive: true });
  const archivoSeguridad = path.join(carpetaSeguridad, nombreArchivoBackup());
  const tamanoSeguridad = copiarBaseA(archivoSeguridad);

  db.close();

  fs.copyFileSync(rutaArchivo, config.dbPath);
  // El archivo restaurado ya fue checkpointeado al crearse como backup (no
  // trae WAL propio) -- pero el WAL/SHM viejo de ESTA instalación, si quedó
  // alguno, ya no corresponde al contenido nuevo. Se limpia para que la
  // próxima apertura (tras el reinicio) parta de un estado consistente.
  for (const sufijo of ['-wal', '-shm']) {
    const rutaSidecar = `${config.dbPath}${sufijo}`;
    if (fs.existsSync(rutaSidecar)) fs.unlinkSync(rutaSidecar);
  }

  // El registro del backup de seguridad NO puede escribirse en `db` (la
  // conexión vieja, ya cerrada, sobre un archivo que este mismo paso acaba de
  // descartar) -- se perdería junto con esa base reemplazada. Se abre una
  // conexión efímera sobre el archivo YA restaurado (el que sobrevive) para
  // dejar ahí esa fila, y se la cierra de inmediato.
  const dbPosRestauracion = new DatabaseSync(config.dbPath);
  try {
    dbPosRestauracion
      .prepare('INSERT INTO backups_historial (destino, estado, tamano_bytes, mensaje_error) VALUES (?, ?, ?, ?)')
      .run('local', 'exito', tamanoSeguridad, null);
  } finally {
    dbPosRestauracion.close();
  }

  return {
    restaurado_desde: { destino, nombre_archivo },
    backup_seguridad: path.basename(archivoSeguridad),
  };
}
