import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

export const FRECUENCIAS = ['diario', 'cierre_caja', 'manual'];
export const DESTINOS = ['local', 'usb', 'nube'];

// configuracion.valor es TEXT NOT NULL -- no hay NULL real en la tabla. Una
// ruta/horario "sin configurar" se guarda como '' y se traduce a null acá al
// leer (ver Docs/Modelo-de-Datos.md > configuracion).
const DEFAULTS = {
  backup_frecuencia: 'manual',
  backup_horario: '',
  backup_retencion_cantidad: '7',
  backup_destino_local_habilitado: 'false',
  backup_destino_local_ruta: '',
  backup_destino_usb_habilitado: 'false',
  backup_destino_usb_ruta: '',
  backup_destino_nube_habilitado: 'false',
  backup_destino_nube_ruta: '',
};

function leerCrudo() {
  const filas = db.prepare('SELECT clave, valor FROM configuracion').all();
  return { ...DEFAULTS, ...Object.fromEntries(filas.map((f) => [f.clave, f.valor])) };
}

function escribirClaves(cambios) {
  const stmt = db.prepare(
    `INSERT INTO configuracion (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = CURRENT_TIMESTAMP`
  );
  for (const [clave, valor] of Object.entries(cambios)) {
    stmt.run(clave, valor);
  }
}

function validarFrecuencia(v) {
  if (!FRECUENCIAS.includes(v)) throw new ApiError(400, `frecuencia tiene que ser una de: ${FRECUENCIAS.join(', ')}`);
  return v;
}

function validarHorario(v) {
  if (v === null) return '';
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
    throw new ApiError(400, 'horario tiene que tener formato HH:MM (24hs)');
  }
  return v;
}

function validarRetencion(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError(400, 'retencion_cantidad tiene que ser un entero mayor o igual a 1');
  }
  return String(n);
}

function validarRuta(v, campo) {
  if (v === null) return '';
  if (typeof v !== 'string' || v.trim() === '') throw new ApiError(400, `${campo} no puede estar vacío`);
  return v.trim();
}

export function obtenerConfiguracionBackups() {
  const c = leerCrudo();
  return {
    frecuencia: c.backup_frecuencia,
    horario: c.backup_horario || null,
    retencion_cantidad: Number(c.backup_retencion_cantidad),
    destinos: Object.fromEntries(
      DESTINOS.map((d) => [
        d,
        {
          habilitado: c[`backup_destino_${d}_habilitado`] === 'true',
          ruta: c[`backup_destino_${d}_ruta`] || null,
        },
      ])
    ),
  };
}

// Alcance: solo backups (frecuencia/horario/retención/destinos). El resto de
// "Configuración y Seguridad" (contraseñas, HTTPS) ya está resuelto por
// código fijo (bcryptjs, bloqueo, certificado autofirmado) -- no son opciones
// que el Admin edite en runtime, según Docs/Instructivo-Funcional.md.
export function editarConfiguracionBackups(datos) {
  const cambios = {};

  if (datos.frecuencia !== undefined) cambios.backup_frecuencia = validarFrecuencia(datos.frecuencia);
  if (datos.horario !== undefined) cambios.backup_horario = validarHorario(datos.horario);
  if (datos.retencion_cantidad !== undefined) {
    cambios.backup_retencion_cantidad = validarRetencion(datos.retencion_cantidad);
  }

  if (datos.destinos !== undefined) {
    if (typeof datos.destinos !== 'object' || datos.destinos === null || Array.isArray(datos.destinos)) {
      throw new ApiError(400, 'destinos tiene que ser un objeto');
    }
    for (const destino of DESTINOS) {
      const d = datos.destinos[destino];
      if (d === undefined) continue;
      if (typeof d !== 'object' || d === null) throw new ApiError(400, `destinos.${destino} tiene que ser un objeto`);
      if (d.habilitado !== undefined) {
        if (typeof d.habilitado !== 'boolean') {
          throw new ApiError(400, `destinos.${destino}.habilitado tiene que ser booleano`);
        }
        cambios[`backup_destino_${destino}_habilitado`] = String(d.habilitado);
      }
      if (d.ruta !== undefined) {
        cambios[`backup_destino_${destino}_ruta`] = validarRuta(d.ruta, `destinos.${destino}.ruta`);
      }
    }
  }

  if (Object.keys(cambios).length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');

  // No tiene sentido habilitar un destino sin ruta (ni la que ya tenía, ni una
  // nueva en este mismo request) -- evita un estado de configuración roto que
  // recién se notaría al intentar hacer un backup.
  const actual = leerCrudo();
  for (const destino of DESTINOS) {
    const claveHabilitado = `backup_destino_${destino}_habilitado`;
    const claveRuta = `backup_destino_${destino}_ruta`;
    const quedaHabilitado =
      cambios[claveHabilitado] !== undefined ? cambios[claveHabilitado] === 'true' : actual[claveHabilitado] === 'true';
    if (quedaHabilitado) {
      const quedaRuta = cambios[claveRuta] !== undefined ? cambios[claveRuta] : actual[claveRuta];
      if (!quedaRuta) {
        throw new ApiError(400, `No se puede habilitar el destino "${destino}" sin configurar su ruta`);
      }
    }
  }

  escribirClaves(cambios);
  return obtenerConfiguracionBackups();
}
