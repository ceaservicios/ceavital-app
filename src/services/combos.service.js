import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { describirCantidad, tienePack } from './presentacion.js';

// Combos con precio (pedido del usuario, 2026-11-01; migraciones 036 y 037). Un combo lleva
// renglones ("Fernet", "Cola"), cada uno con su forma (suelto o la caja o pack de cada marca), su
// cantidad y las marcas que valen, y un precio total: "1 Fernet + 2 Cola (Coca, Pepsi o Manaos) a
// $15.000". En Caja se cobra solo cuando el carrito tiene todo lo del combo, con cualquier marca de
// cada renglón, mezcladas (presentacion.js → aplicarCombos). Sin fecha y solo en Caja. Los arma,
// cambia y borra solo el Administrador, en Configuración → Promociones; los ven los tres roles,
// porque Caja los necesita.

const MAX_NOMBRE = 60;
const MAX_PRECIO = 1_000_000_000;
// Tope de una cantidad: en la medida chica (unidades, gramos o ml) o en packs.
const MAX_SUELTO = 10_000_000;
const MAX_PACKS = 100_000;

function validarNombre(valor, que = 'del combo') {
  if (typeof valor !== 'string' || valor.trim() === '') throw new ApiError(400, `Escribí el nombre ${que}`);
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

function validarPresentacion(presentacion) {
  if (presentacion !== 'unidad' && presentacion !== 'pack') throw new ApiError(400, 'presentacion tiene que ser "unidad" o "pack"');
  return presentacion;
}

// Cantidad de un renglón: suelto, en la medida chica; pack, en packs.
function validarCantidad(cantidad, presentacion) {
  if (typeof cantidad !== 'number' && typeof cantidad !== 'string') throw new ApiError(400, 'Cargá la cantidad');
  const n = Number(cantidad);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, 'La cantidad tiene que ser mayor a 0');
  if (n > (presentacion === 'pack' ? MAX_PACKS : MAX_SUELTO)) throw new ApiError(400, 'La cantidad es demasiado grande');
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

async function obtenerRenglon(comboId, renglonId) {
  const renglon = await db
    .prepare('SELECT id, nombre, presentacion, cantidad FROM combo_renglones WHERE id = ? AND combo_id = ? AND eliminado_en IS NULL')
    .get(renglonId, comboId);
  if (!renglon) throw new ApiError(404, 'Ese renglón no está en el combo');
  return renglon;
}

const COLUMNAS_FORMA = 'id, nombre, medida, vende_suelto, pack_nombre, pack_unidades';

async function obtenerProducto(productoId) {
  const producto = await db.prepare(`SELECT ${COLUMNAS_FORMA} FROM productos WHERE id = ? AND eliminado_en IS NULL`).get(productoId);
  if (!producto) throw new ApiError(404, 'Producto no encontrado');
  return producto;
}

// Las marcas activas de un renglón, con lo que hace falta para controlar la forma y la medida.
function marcasDelRenglon(renglonId) {
  return db
    .prepare(
      `SELECT p.id, p.nombre, p.medida, p.vende_suelto, p.pack_nombre, p.pack_unidades
       FROM combo_renglon_productos rp JOIN productos p ON p.id = rp.producto_id
       WHERE rp.renglon_id = ? AND rp.eliminado_en IS NULL
       ORDER BY rp.id`
    )
    .all(renglonId);
}

// Por qué una marca no se puede cobrar en la forma del renglón, o null.
function problemaDeForma(producto, presentacion) {
  if (presentacion === 'pack' && !tienePack(producto)) return 'No se vende por caja ni por pack';
  if (presentacion === 'unidad' && producto.vende_suelto === false) return 'No se vende suelto';
  return null;
}

function verificarForma(producto, presentacion) {
  const problema = problemaDeForma(producto, presentacion);
  if (problema) throw new ApiError(400, `"${producto.nombre}": ${problema.toLowerCase()}`);
}

// Las marcas de un renglón se miden igual: la cantidad (unidades, gramos o ml) vale para todas.
function verificarMedida(producto, marcas) {
  const otra = marcas.find((m) => m.id !== producto.id && m.medida !== producto.medida);
  if (otra) {
    const por = { unidad: 'por unidad', kg: 'por kg', litro: 'por litro' };
    throw new ApiError(409, `"${producto.nombre}" se vende ${por[producto.medida]} y "${otra.nombre}" ${por[otra.medida]}: no van en el mismo renglón`);
  }
}

// Una marca va una sola vez por forma en todo el combo: si no, se contaría dos veces.
async function verificarQueNoEsteEnOtro(comboId, renglonId, productoId, presentacion, nombreProducto) {
  const otro = await db
    .prepare(
      `SELECT r.nombre FROM combo_renglones r
       JOIN combo_renglon_productos rp ON rp.renglon_id = r.id AND rp.eliminado_en IS NULL
       WHERE r.combo_id = ? AND r.eliminado_en IS NULL AND r.id != ? AND rp.producto_id = ? AND r.presentacion = ?`
    )
    .get(comboId, renglonId ?? -1, productoId, presentacion);
  if (otro) throw new ApiError(409, `"${nombreProducto}" ya está en el renglón "${otro.nombre}" de este combo`);
}

/** "Cola: 2 unidades", "Hielo: 2 cajas o packs", "Queso: 0,5 kg": un renglón, para el registro. */
function describirRenglon(nombre, presentacion, cantidad, medida) {
  const cuanto =
    presentacion === 'pack' ? `${cantidad} ${cantidad === 1 ? 'caja o pack' : 'cajas o packs'}` : describirCantidad(cantidad, medida);
  return `${nombre}: ${cuanto}`;
}

/**
 * Los combos activos con sus renglones y las marcas de cada uno (con lo necesario para mostrarlas y
 * calcular el precio normal). `problema` de una marca: por qué no se puede cobrar en la forma del
 * renglón (se eliminó, o ya no se vende así); esa marca no cuenta. `vigente`: tiene renglones y cada
 * uno, al menos una marca que cuenta; uno que no está vigente no se aplica en Caja. Ordenados por id:
 * en ese orden se aplican.
 */
export async function listarCombos() {
  const combos = await db.prepare('SELECT id, nombre, precio FROM combos WHERE eliminado_en IS NULL ORDER BY id').all();
  const renglones = await db
    .prepare(
      `SELECT r.id, r.combo_id, r.nombre, r.presentacion, r.cantidad
       FROM combo_renglones r JOIN combos c ON c.id = r.combo_id AND c.eliminado_en IS NULL
       WHERE r.eliminado_en IS NULL ORDER BY r.id`
    )
    .all();
  const marcas = await db
    .prepare(
      `SELECT rp.renglon_id, rp.producto_id, p.nombre AS producto_nombre, p.medida, p.vende_suelto, p.precio_venta,
              p.pack_nombre, p.pack_unidades, p.precio_pack, (p.eliminado_en IS NOT NULL) AS producto_eliminado
       FROM combo_renglon_productos rp
       JOIN combo_renglones r ON r.id = rp.renglon_id AND r.eliminado_en IS NULL
       JOIN productos p ON p.id = rp.producto_id
       WHERE rp.eliminado_en IS NULL ORDER BY rp.id`
    )
    .all();
  return combos.map((combo) => {
    const propios = renglones
      .filter((r) => r.combo_id === combo.id)
      .map((r) => ({
        ...r,
        productos: marcas
          .filter((m) => m.renglon_id === r.id)
          .map((m) => ({ ...m, problema: m.producto_eliminado ? 'Se eliminó' : problemaDeForma(m, r.presentacion) })),
      }));
    return {
      ...combo,
      renglones: propios,
      vigente: propios.length > 0 && propios.every((r) => r.productos.some((m) => !m.problema)),
    };
  });
}

/** Los que se aplican al cobrar en Caja, con las marcas que cuentan de cada renglón. */
export async function combosVigentes() {
  return (await listarCombos())
    .filter((c) => c.vigente)
    .map((c) => ({
      id: c.id,
      nombre: c.nombre,
      precio: c.precio,
      renglones: c.renglones.map((r) => ({
        presentacion: r.presentacion,
        cantidad: r.cantidad,
        productos: r.productos.filter((m) => !m.problema).map((m) => m.producto_id),
      })),
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
 * Agrega un renglón con un producto, su forma y su cantidad; el renglón se llama como el producto
 * (después se le cambia el nombre y se le suman otras marcas). Devuelve { combo, renglon }.
 */
export function agregarRenglon(comboId, { producto_id, presentacion, cantidad }) {
  const productoId = validarId(producto_id, 'producto_id');
  const forma = validarPresentacion(presentacion);
  const n = validarCantidad(cantidad, forma);
  return db.transaction(async () => {
    const combo = await obtenerActivo(comboId);
    const producto = await obtenerProducto(productoId);
    verificarForma(producto, forma);
    await verificarQueNoEsteEnOtro(comboId, null, productoId, forma, producto.nombre);
    const nombre = producto.nombre.slice(0, MAX_NOMBRE);
    const renglon = await db
      .prepare('INSERT INTO combo_renglones (combo_id, nombre, presentacion, cantidad) VALUES (?, ?, ?, ?) RETURNING id')
      .get(comboId, nombre, forma, n);
    await db.prepare('INSERT INTO combo_renglon_productos (renglon_id, producto_id) VALUES (?, ?)').run(renglon.id, productoId);
    return { combo, renglon: describirRenglon(nombre, forma, n, producto.medida) };
  });
}

/**
 * Cambia el nombre, la forma y/o la cantidad de un renglón. Con otra forma, todas sus marcas tienen
 * que venderse así. Devuelve { combo, antes, despues }, o null si no cambió nada.
 */
export function editarRenglon(comboId, renglonId, { nombre, presentacion, cantidad }) {
  return db.transaction(async () => {
    const combo = await obtenerActivo(comboId);
    const actual = await obtenerRenglon(comboId, renglonId);
    const nuevoNombre = nombre === undefined ? actual.nombre : validarNombre(nombre, 'del renglón');
    const forma = presentacion === undefined ? actual.presentacion : validarPresentacion(presentacion);
    const n = cantidad === undefined ? actual.cantidad : validarCantidad(cantidad, forma);
    if (nuevoNombre === actual.nombre && forma === actual.presentacion && n === actual.cantidad) return null;
    const marcas = await marcasDelRenglon(renglonId);
    if (forma !== actual.presentacion) {
      for (const marca of marcas) {
        verificarForma(marca, forma);
        await verificarQueNoEsteEnOtro(comboId, renglonId, marca.id, forma, marca.nombre);
      }
    }
    await db
      .prepare('UPDATE combo_renglones SET nombre = ?, presentacion = ?, cantidad = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
      .run(nuevoNombre, forma, n, renglonId);
    const medida = marcas[0]?.medida ?? 'unidad';
    return {
      combo,
      antes: describirRenglon(actual.nombre, actual.presentacion, actual.cantidad, medida),
      despues: describirRenglon(nuevoNombre, forma, n, medida),
    };
  });
}

/** Saca un renglón del combo (baja lógica). Devuelve { combo, renglon }. */
export function sacarRenglon(comboId, renglonId) {
  return db.transaction(async () => {
    const combo = await obtenerActivo(comboId);
    const renglon = await obtenerRenglon(comboId, renglonId);
    await db.prepare('UPDATE combo_renglones SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(renglonId);
    return { combo, renglon: renglon.nombre };
  });
}

/**
 * Suma una marca a un renglón: tiene que venderse en la forma del renglón y medirse igual que las
 * otras. Devuelve { combo, renglon, producto }, o null si ya estaba.
 */
export function agregarMarca(comboId, renglonId, productoId) {
  return db.transaction(async () => {
    const combo = await obtenerActivo(comboId);
    const renglon = await obtenerRenglon(comboId, renglonId);
    const producto = await obtenerProducto(productoId);
    const marcas = await marcasDelRenglon(renglonId);
    if (marcas.some((m) => m.id === productoId)) return null;
    verificarForma(producto, renglon.presentacion);
    verificarMedida(producto, marcas);
    await verificarQueNoEsteEnOtro(comboId, renglonId, productoId, renglon.presentacion, producto.nombre);
    await db.prepare('INSERT INTO combo_renglon_productos (renglon_id, producto_id) VALUES (?, ?)').run(renglonId, productoId);
    return { combo, renglon: renglon.nombre, producto: producto.nombre };
  });
}

/** Saca una marca de un renglón (baja lógica). La última no: se saca el renglón. Devuelve { combo, renglon, producto }. */
export function sacarMarca(comboId, renglonId, productoId) {
  return db.transaction(async () => {
    const combo = await obtenerActivo(comboId);
    const renglon = await obtenerRenglon(comboId, renglonId);
    const marcas = await marcasDelRenglon(renglonId);
    const marca = marcas.find((m) => m.id === productoId);
    if (!marca) throw new ApiError(404, 'Esa marca no está en el renglón');
    if (marcas.length === 1) throw new ApiError(409, `Es la única marca de "${renglon.nombre}": si no va, sacá el renglón`);
    await db
      .prepare('UPDATE combo_renglon_productos SET eliminado_en = CURRENT_TIMESTAMP WHERE renglon_id = ? AND producto_id = ? AND eliminado_en IS NULL')
      .run(renglonId, productoId);
    return { combo, renglon: renglon.nombre, producto: marca.nombre };
  });
}
