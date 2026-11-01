import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

// Grupos de promoción (pedido del usuario, 2026-11-01, como en Somnia; migración 035). Los productos
// de un mismo grupo suman juntos para llegar al precio por cantidad de cada uno, sueltos con sueltos
// y packs con packs (la regla está en presentacion.js → armarLineas). Los arma, cambia y borra solo
// el Administrador, en Configuración → Promociones. Cada producto conserva su propio "desde" y su
// precio, que se cargan en su ficha.

const MAX_NOMBRE = 60;

const POR_MEDIDA = { unidad: 'por unidad', kg: 'por kg', litro: 'por litro' };

// Lo que muestra la pantalla de cada producto del grupo: sus precios por cantidad (sin costos).
const COLUMNAS_PRODUCTO = `p.id, p.nombre, p.medida, p.vende_suelto, p.precio_venta, p.precio_cantidad_desde, p.precio_cantidad,
  p.pack_nombre, p.pack_unidades, p.precio_pack, p.pack_cantidad_desde, p.precio_pack_cantidad, p.grupo_promocion_id`;

function validarNombre(valor) {
  if (typeof valor !== 'string' || valor.trim() === '') throw new ApiError(400, 'Escribí el nombre del grupo');
  const limpio = valor.trim();
  if (limpio.length > MAX_NOMBRE) throw new ApiError(400, `El nombre no puede superar ${MAX_NOMBRE} caracteres`);
  return limpio;
}

async function verificarNombreLibre(nombre, excluirId = null) {
  const existente = await db
    .prepare('SELECT id FROM grupos_promocion WHERE LOWER(nombre) = LOWER(?) AND eliminado_en IS NULL AND id != ?')
    .get(nombre, excluirId ?? -1);
  if (existente) throw new ApiError(409, `Ya hay un grupo llamado "${nombre}"`);
}

async function obtenerActivo(id) {
  const grupo = await db.prepare('SELECT id, nombre FROM grupos_promocion WHERE id = ? AND eliminado_en IS NULL').get(id);
  if (!grupo) throw new ApiError(404, 'Grupo no encontrado');
  return grupo;
}

/** Los grupos activos, cada uno con sus productos activos. */
export async function listarGrupos() {
  const grupos = await db
    .prepare('SELECT id, nombre FROM grupos_promocion WHERE eliminado_en IS NULL ORDER BY LOWER(nombre)')
    .all();
  const productos = await db
    .prepare(
      `SELECT ${COLUMNAS_PRODUCTO} FROM productos p
       WHERE p.grupo_promocion_id IS NOT NULL AND p.eliminado_en IS NULL ORDER BY LOWER(p.nombre)`
    )
    .all();
  return grupos.map((g) => ({ ...g, productos: productos.filter((p) => p.grupo_promocion_id === g.id) }));
}

export function crearGrupo({ nombre }) {
  const nombreValido = validarNombre(nombre);
  return db.transaction(async () => {
    await verificarNombreLibre(nombreValido);
    return db.prepare('INSERT INTO grupos_promocion (nombre) VALUES (?) RETURNING id, nombre').get(nombreValido);
  });
}

/** Devuelve el grupo y el nombre que tenía (para el registro). */
export function renombrarGrupo(id, { nombre }) {
  const nombreValido = validarNombre(nombre);
  return db.transaction(async () => {
    const anterior = await obtenerActivo(id);
    await verificarNombreLibre(nombreValido, id);
    const grupo = await db
      .prepare(
        'UPDATE grupos_promocion SET nombre = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ? RETURNING id, nombre'
      )
      .get(nombreValido, id);
    return { grupo, anterior: anterior.nombre };
  });
}

/**
 * Baja lógica del grupo. Sus productos quedan sin grupo (vuelven a contar solos): ninguno apunta a
 * un grupo eliminado. Devuelve el grupo y los nombres de los productos que tenía, para el registro.
 * Las ventas y pedidos ya hechos no cambian (guardan su copia del nombre).
 */
export function eliminarGrupo(id) {
  return db.transaction(async () => {
    const grupo = await obtenerActivo(id);
    const productos = await db
      .prepare('SELECT nombre FROM productos WHERE grupo_promocion_id = ? AND eliminado_en IS NULL ORDER BY LOWER(nombre)')
      .all(id);
    await db
      .prepare('UPDATE productos SET grupo_promocion_id = NULL, actualizado_en = CURRENT_TIMESTAMP WHERE grupo_promocion_id = ?')
      .run(id);
    await db.prepare('UPDATE grupos_promocion SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return { grupo, productos: productos.map((p) => p.nombre) };
  });
}

/**
 * Suma un producto al grupo; si estaba en otro, pasa a este. Solo productos con precio por
 * cantidad (suelto o por pack) y de la misma medida que los del grupo: un kg no suma con una unidad.
 * Devuelve { grupo, producto, anterior } (anterior: el grupo de donde salió, o null), o null si ya
 * estaba en este grupo.
 */
export function agregarProducto(grupoId, productoId) {
  return db.transaction(async () => {
    const grupo = await obtenerActivo(grupoId);
    const producto = await db
      .prepare(
        `SELECT p.id, p.nombre, p.medida, p.precio_cantidad_desde, p.pack_cantidad_desde, p.grupo_promocion_id,
                g.nombre AS grupo_anterior
         FROM productos p LEFT JOIN grupos_promocion g ON g.id = p.grupo_promocion_id
         WHERE p.id = ? AND p.eliminado_en IS NULL`
      )
      .get(productoId);
    if (!producto) throw new ApiError(404, 'Producto no encontrado');
    if (producto.grupo_promocion_id === grupoId) return null;
    if (producto.precio_cantidad_desde == null && producto.pack_cantidad_desde == null) {
      throw new ApiError(409, `"${producto.nombre}" no tiene precio por cantidad: cargalo en su ficha (Stock) y después sumalo al grupo`);
    }
    const otra = await db
      .prepare('SELECT medida FROM productos WHERE grupo_promocion_id = ? AND eliminado_en IS NULL AND medida <> ? LIMIT 1')
      .get(grupoId, producto.medida);
    if (otra) {
      throw new ApiError(
        409,
        `"${grupo.nombre}" tiene productos que se venden ${POR_MEDIDA[otra.medida]} y "${producto.nombre}" se vende ` +
          `${POR_MEDIDA[producto.medida]}: no se pueden sumar entre sí`
      );
    }
    await db
      .prepare('UPDATE productos SET grupo_promocion_id = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
      .run(grupoId, productoId);
    return { grupo, producto: producto.nombre, anterior: producto.grupo_anterior };
  });
}

const MAX_PRECIO = 1_000_000_000;

// "desde 10 a $ 1.150" / "sin precio por cantidad", para el registro. `desde` va en la medida chica
// (suelto) o en packs.
function describirPrecioCantidad(producto, presentacion, desde, precio) {
  if (desde == null) return 'sin precio por cantidad';
  const cuantos =
    presentacion === 'pack'
      ? `${desde} ${String(producto.pack_nombre).toLowerCase()}`
      : producto.medida === 'unidad'
        ? String(desde)
        : `${(desde / 1000).toLocaleString('es-AR')} ${producto.medida === 'kg' ? 'kg' : 'L'}`;
  return `desde ${cuantos} a $ ${Number(precio).toLocaleString('es-AR')}`;
}

/**
 * Cambia, desde el grupo, el precio por cantidad de un producto del grupo en una de sus formas
 * (pedido del usuario, 2026-11-01: "no puedo editar los productos que voy agregando"). Es el mismo
 * dato que se carga en su ficha: suelto, `desde` en la medida chica (unidades, gramos o ml); pack,
 * en packs. `desde` null lo saca. Devuelve { grupo, producto, forma, antes, despues }, o null si no
 * cambió nada.
 */
export function cambiarPrecioCantidad(grupoId, productoId, { presentacion, desde, precio }) {
  if (presentacion !== 'unidad' && presentacion !== 'pack') throw new ApiError(400, 'presentacion tiene que ser "unidad" o "pack"');
  let nuevoDesde = null;
  let nuevoPrecio = null;
  if (desde !== null && desde !== undefined && desde !== '') {
    nuevoDesde = Number(desde);
    nuevoPrecio = Number(precio);
    if (typeof desde === 'boolean' || !Number.isInteger(nuevoDesde) || nuevoDesde < 2) {
      throw new ApiError(400, 'El precio por cantidad rige desde 2 o más');
    }
    if (nuevoDesde > (presentacion === 'pack' ? 100_000 : 10_000_000)) throw new ApiError(400, 'La cantidad es demasiado grande');
    if (typeof precio === 'boolean' || precio === null || precio === '' || !Number.isInteger(nuevoPrecio) || nuevoPrecio < 0) {
      throw new ApiError(400, 'Cargá el precio por cantidad');
    }
    if (nuevoPrecio > MAX_PRECIO) throw new ApiError(400, `El precio no puede superar $ ${MAX_PRECIO.toLocaleString('es-AR')}`);
  }

  return db.transaction(async () => {
    const grupo = await obtenerActivo(grupoId);
    const producto = await db
      .prepare(
        `SELECT id, nombre, medida, vende_suelto, pack_nombre, pack_unidades, precio_cantidad_desde, precio_cantidad,
                pack_cantidad_desde, precio_pack_cantidad
         FROM productos WHERE id = ? AND grupo_promocion_id = ? AND eliminado_en IS NULL`
      )
      .get(productoId, grupoId);
    if (!producto) throw new ApiError(404, 'Ese producto no está en el grupo');
    const porPack = presentacion === 'pack';
    if (porPack && !producto.pack_nombre) throw new ApiError(400, `"${producto.nombre}" no se vende por caja ni por pack`);
    if (!porPack && producto.vende_suelto === false) {
      throw new ApiError(400, `"${producto.nombre}" no se vende suelto: el precio por cantidad va en su ${String(producto.pack_nombre).toLowerCase()}`);
    }
    const antesDesde = porPack ? producto.pack_cantidad_desde : producto.precio_cantidad_desde;
    const antesPrecio = porPack ? producto.precio_pack_cantidad : producto.precio_cantidad;
    if (antesDesde === nuevoDesde && (nuevoDesde === null || antesPrecio === nuevoPrecio)) return null;
    await db
      .prepare(
        porPack
          ? 'UPDATE productos SET pack_cantidad_desde = ?, precio_pack_cantidad = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?'
          : 'UPDATE productos SET precio_cantidad_desde = ?, precio_cantidad = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?'
      )
      .run(nuevoDesde, nuevoPrecio, productoId);
    return {
      grupo,
      producto: producto.nombre,
      forma: porPack ? `${producto.pack_nombre} x ${producto.pack_unidades}` : 'suelto',
      antes: describirPrecioCantidad(producto, presentacion, antesDesde, antesPrecio),
      despues: describirPrecioCantidad(producto, presentacion, nuevoDesde, nuevoPrecio),
    };
  });
}

/** Saca un producto del grupo: vuelve a contar solo. Devuelve { grupo, producto }. */
export function sacarProducto(grupoId, productoId) {
  return db.transaction(async () => {
    const grupo = await obtenerActivo(grupoId);
    const producto = await db
      .prepare('SELECT id, nombre FROM productos WHERE id = ? AND grupo_promocion_id = ?')
      .get(productoId, grupoId);
    if (!producto) throw new ApiError(404, 'Ese producto no está en el grupo');
    await db
      .prepare('UPDATE productos SET grupo_promocion_id = NULL, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
      .run(productoId);
    return { grupo, producto: producto.nombre };
  });
}
