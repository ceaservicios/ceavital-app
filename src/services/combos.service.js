import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { describirCantidad, tienePack } from './presentacion.js';

// Combos con precio (pedido del usuario, 2026-11-01; migración 036). Un combo es un conjunto fijo de
// productos, cada uno con su forma (suelto o su pack) y su cantidad, y un precio total: "1 Fernet +
// 1 Pack x 6 de Coca a $15.000". En Caja se cobra solo cuando el carrito tiene todo lo del combo
// (presentacion.js → aplicarCombos). Sin fecha y solo en Caja. Los arma, cambia y borra solo el
// Administrador, en Configuración → Promociones; los ven los tres roles, porque Caja los necesita.

const MAX_NOMBRE = 60;
const MAX_PRECIO = 1_000_000_000;
// Tope de una cantidad: en la medida chica (unidades, gramos o ml) o en packs.
const MAX_SUELTO = 10_000_000;
const MAX_PACKS = 100_000;

function validarNombre(valor) {
  if (typeof valor !== 'string' || valor.trim() === '') throw new ApiError(400, 'Escribí el nombre del combo');
  const limpio = valor.trim();
  if (limpio.length > MAX_NOMBRE) throw new ApiError(400, `El nombre no puede superar ${MAX_NOMBRE} caracteres`);
  return limpio;
}

// Solo número o texto numérico: Number(true) vale 1.
function validarPrecio(valor) {
  if (typeof valor !== 'number' && typeof valor !== 'string') throw new ApiError(400, 'Cargá el precio del combo');
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, 'El precio del combo tiene que ser un número entero mayor a 0');
  if (n > MAX_PRECIO) throw new ApiError(400, `El precio del combo no puede superar $ ${MAX_PRECIO.toLocaleString('es-AR')}`);
  return n;
}

function validarId(valor, campo) {
  const n = Number(valor);
  if (typeof valor === 'boolean' || !Number.isInteger(n) || n <= 0) throw new ApiError(400, `${campo} inválido`);
  return n;
}

async function verificarNombreLibre(nombre, excluirId = null) {
  const existente = await db
    .prepare('SELECT id FROM combos WHERE LOWER(nombre) = LOWER(?) AND eliminado_en IS NULL AND id != ?')
    .get(nombre, excluirId ?? -1);
  if (existente) throw new ApiError(409, `Ya hay un combo llamado "${nombre}"`);
}

async function obtenerActivo(id) {
  const combo = await db.prepare('SELECT id, nombre, precio FROM combos WHERE id = ? AND eliminado_en IS NULL').get(id);
  if (!combo) throw new ApiError(404, 'Combo no encontrado');
  return combo;
}

/** "2 unidades", "0,5 kg", "1 Caja x 12", "2 Bolsa x 15 kg": lo que lleva el combo de ese producto (para el registro). */
function describirItem(producto, presentacion, cantidad) {
  if (presentacion === 'pack') {
    const trae = producto.medida === 'unidad' ? producto.pack_unidades : describirCantidad(producto.pack_unidades, producto.medida);
    return `${cantidad} ${producto.pack_nombre} x ${trae}`;
  }
  return describirCantidad(cantidad, producto.medida);
}

// Por qué un producto del combo ya no se puede cobrar así (cambió su ficha después de armarlo), o null.
function problemaDelItem(item) {
  if (item.producto_eliminado) return 'El producto se eliminó';
  if (item.presentacion === 'pack' && !tienePack(item)) return 'Ya no se vende por caja o pack';
  if (item.presentacion === 'unidad' && item.vende_suelto === false) return 'Ya no se vende suelto';
  return null;
}

/**
 * Los combos activos, cada uno con sus productos (forma, cantidad y lo necesario para mostrarlos y
 * calcular el precio normal). `vigente`: tiene productos y todos se pueden cobrar como están en el
 * combo; uno que no está vigente no se aplica en Caja. Ordenados por id: en ese orden se aplican.
 */
export async function listarCombos() {
  const combos = await db.prepare('SELECT id, nombre, precio FROM combos WHERE eliminado_en IS NULL ORDER BY id').all();
  const items = await db
    .prepare(
      `SELECT ci.id, ci.combo_id, ci.producto_id, ci.presentacion, ci.cantidad,
              p.nombre AS producto_nombre, p.medida, p.vende_suelto, p.precio_venta,
              p.pack_nombre, p.pack_unidades, p.precio_pack, (p.eliminado_en IS NOT NULL) AS producto_eliminado
       FROM combo_items ci
       JOIN combos c ON c.id = ci.combo_id AND c.eliminado_en IS NULL
       JOIN productos p ON p.id = ci.producto_id
       WHERE ci.eliminado_en IS NULL
       ORDER BY ci.id`
    )
    .all();
  return combos.map((combo) => {
    const propios = items.filter((i) => i.combo_id === combo.id).map((i) => ({ ...i, problema: problemaDelItem(i) }));
    return { ...combo, items: propios, vigente: propios.length > 0 && propios.every((i) => !i.problema) };
  });
}

/** Los que se aplican al cobrar en Caja: [{ id, nombre, precio, items: [{ producto_id, presentacion, cantidad }] }]. */
export async function combosVigentes() {
  return (await listarCombos())
    .filter((c) => c.vigente)
    .map((c) => ({
      id: c.id,
      nombre: c.nombre,
      precio: c.precio,
      items: c.items.map((i) => ({ producto_id: i.producto_id, presentacion: i.presentacion, cantidad: i.cantidad })),
    }));
}

export function crearCombo({ nombre, precio }) {
  const nombreValido = validarNombre(nombre);
  const precioValido = validarPrecio(precio);
  return db.transaction(async () => {
    await verificarNombreLibre(nombreValido);
    return db
      .prepare('INSERT INTO combos (nombre, precio) VALUES (?, ?) RETURNING id, nombre, precio')
      .get(nombreValido, precioValido);
  });
}

/** Cambia el nombre y/o el precio. Devuelve el combo y cómo estaba (para el registro). */
export function editarCombo(id, { nombre, precio }) {
  const nombreValido = nombre === undefined ? null : validarNombre(nombre);
  const precioValido = precio === undefined ? null : validarPrecio(precio);
  if (nombreValido === null && precioValido === null) throw new ApiError(400, 'No se envió ningún cambio');
  return db.transaction(async () => {
    const anterior = await obtenerActivo(id);
    if (nombreValido !== null) await verificarNombreLibre(nombreValido, id);
    const combo = await db
      .prepare(
        `UPDATE combos SET nombre = ?, precio = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?
         RETURNING id, nombre, precio`
      )
      .get(nombreValido ?? anterior.nombre, precioValido ?? anterior.precio, id);
    return { combo, anterior };
  });
}

/** Baja lógica del combo: deja de aplicarse. Las ventas ya hechas no cambian (guardan su copia del nombre). */
export function eliminarCombo(id) {
  return db.transaction(async () => {
    const combo = await obtenerActivo(id);
    await db.prepare('UPDATE combos SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return combo;
  });
}

/**
 * Suma un producto al combo con su forma y su cantidad; si ya estaba con esa forma, le cambia la
 * cantidad. `cantidad`: suelto, en la medida chica (unidades, gramos o ml); pack, en packs.
 * Devuelve { combo, producto, lleva, antes } (antes: lo que llevaba, o null si es nuevo), o null si
 * no cambió nada.
 */
export function guardarProducto(comboId, { producto_id, presentacion, cantidad }) {
  const productoId = validarId(producto_id, 'producto_id');
  if (presentacion !== 'unidad' && presentacion !== 'pack') throw new ApiError(400, 'presentacion tiene que ser "unidad" o "pack"');
  if (typeof cantidad !== 'number' && typeof cantidad !== 'string') throw new ApiError(400, 'Cargá la cantidad');
  const n = Number(cantidad);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, 'La cantidad tiene que ser mayor a 0');
  if (n > (presentacion === 'pack' ? MAX_PACKS : MAX_SUELTO)) throw new ApiError(400, 'La cantidad es demasiado grande');

  return db.transaction(async () => {
    const combo = await obtenerActivo(comboId);
    const producto = await db
      .prepare('SELECT id, nombre, medida, vende_suelto, pack_nombre, pack_unidades FROM productos WHERE id = ? AND eliminado_en IS NULL')
      .get(productoId);
    if (!producto) throw new ApiError(404, 'Producto no encontrado');
    if (presentacion === 'pack' && !tienePack(producto)) throw new ApiError(400, `"${producto.nombre}" no se vende por caja ni por pack`);
    if (presentacion === 'unidad' && producto.vende_suelto === false) {
      throw new ApiError(400, `"${producto.nombre}" no se vende suelto: solo por ${String(producto.pack_nombre).toLowerCase()}`);
    }
    const lleva = describirItem(producto, presentacion, n);
    const existente = await db
      .prepare('SELECT id, cantidad FROM combo_items WHERE combo_id = ? AND producto_id = ? AND presentacion = ? AND eliminado_en IS NULL')
      .get(comboId, productoId, presentacion);
    if (existente) {
      if (existente.cantidad === n) return null;
      await db
        .prepare('UPDATE combo_items SET cantidad = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
        .run(n, existente.id);
      return { combo, producto: producto.nombre, lleva, antes: describirItem(producto, presentacion, existente.cantidad) };
    }
    await db
      .prepare('INSERT INTO combo_items (combo_id, producto_id, presentacion, cantidad) VALUES (?, ?, ?, ?)')
      .run(comboId, productoId, presentacion, n);
    return { combo, producto: producto.nombre, lleva, antes: null };
  });
}

/** Saca un producto del combo (baja lógica de esa fila). Devuelve { combo, producto, lleva }. */
export function sacarProducto(comboId, itemId) {
  return db.transaction(async () => {
    const combo = await obtenerActivo(comboId);
    const item = await db
      .prepare(
        `SELECT ci.id, ci.presentacion, ci.cantidad, p.nombre, p.medida, p.pack_nombre, p.pack_unidades
         FROM combo_items ci JOIN productos p ON p.id = ci.producto_id
         WHERE ci.id = ? AND ci.combo_id = ? AND ci.eliminado_en IS NULL`
      )
      .get(itemId, comboId);
    if (!item) throw new ApiError(404, 'Ese producto no está en el combo');
    await db.prepare('UPDATE combo_items SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(itemId);
    return { combo, producto: item.nombre, lleva: describirItem(item, item.presentacion, item.cantidad) };
  });
}
