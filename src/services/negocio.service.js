import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

// Datos del negocio (tabla datos_negocio, migraciones 022 y 023): nombre, teléfono, mail,
// dirección e Instagram. Van, con el logo (frontend/public/logo-negocio.png), al pie de los mails
// que el sistema manda a sus usuarios y a los clientes del portal, en el resumen de cuenta en PDF
// y en el portal. Los carga el Administrador en Configuración > Datos del negocio. Vacíos, no se
// muestran.

const TOPES = { nombre: 100, telefono: 40, direccion: 200, email: 100 };
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // mismo criterio que usuarios.service
const INSTAGRAM_VALIDO = /^[A-Za-z0-9._]{1,30}$/;

export async function obtenerDatosNegocio() {
  const fila = await db.prepare('SELECT nombre, telefono, email, direccion, instagram FROM datos_negocio WHERE id = 1').get();
  return fila ?? { nombre: 'CEAVital', telefono: null, email: null, direccion: null, instagram: null };
}

// Para un mail: si la base falla, el mail sale igual, sin los datos del pie.
export function datosNegocioParaMail() {
  return obtenerDatosNegocio().catch((err) => {
    console.error('[negocio] no se pudieron leer los datos del negocio:', err.message);
    return null;
  });
}

function texto(valor, campo, etiqueta, { requerido = false } = {}) {
  if (valor === undefined || valor === null || (typeof valor === 'string' && !valor.trim())) {
    if (requerido) throw new ApiError(400, `${etiqueta} es requerido`);
    return null;
  }
  if (typeof valor !== 'string') throw new ApiError(400, `${etiqueta} tiene que ser texto`);
  const limpio = valor.trim().replace(/\s+/g, ' ');
  if (limpio.length > TOPES[campo]) throw new ApiError(400, `${etiqueta} no puede superar ${TOPES[campo]} caracteres`);
  return limpio;
}

// Acepta "tu.negocio", "@tu.negocio" o el enlace de Instagram.
function instagram(valor) {
  if (valor === undefined || valor === null || (typeof valor === 'string' && !valor.trim())) return null;
  if (typeof valor !== 'string') throw new ApiError(400, 'El Instagram tiene que ser texto');
  const usuario = valor
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '');
  if (!INSTAGRAM_VALIDO.test(usuario)) {
    throw new ApiError(400, 'El Instagram tiene que ser el nombre de la cuenta (letras, números, punto o guion bajo; hasta 30)');
  }
  return usuario;
}

function email(valor) {
  const limpio = texto(valor, 'email', 'El mail');
  if (limpio && !EMAIL_VALIDO.test(limpio)) throw new ApiError(400, 'El mail no tiene un formato válido');
  return limpio;
}

// Guarda todos los datos (la pantalla manda siempre todos). Devuelve los anteriores y los nuevos
// para el registro de acciones.
export async function guardarDatosNegocio(datos = {}) {
  const nuevos = {
    nombre: texto(datos.nombre, 'nombre', 'El nombre', { requerido: true }),
    telefono: texto(datos.telefono, 'telefono', 'El teléfono'),
    email: email(datos.email),
    direccion: texto(datos.direccion, 'direccion', 'La dirección'),
    instagram: instagram(datos.instagram),
  };
  const anteriores = await db.transaction(async () => {
    const actual = await obtenerDatosNegocio();
    await db
      .prepare(
        `INSERT INTO datos_negocio (id, nombre, telefono, email, direccion, instagram) VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, telefono = EXCLUDED.telefono, email = EXCLUDED.email,
           direccion = EXCLUDED.direccion, instagram = EXCLUDED.instagram, actualizado_en = CURRENT_TIMESTAMP`
      )
      .run(nuevos.nombre, nuevos.telefono, nuevos.email, nuevos.direccion, nuevos.instagram);
    return actual;
  });
  return { anteriores, datos: nuevos };
}
