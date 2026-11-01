import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { describirCantidad, subtotalRenglon, tienePack } from './presentacion.js';

// Combos con precio (pedido del usuario, 2026-11-01; migraciones 036, 037 y 038). Un combo lleva
// renglones, uno por producto, cada uno con su forma (suelto o su caja o pack), su cantidad y su
// precio en la promo: "1 Fernet a $11.000 + 2 Coca-Cola a $3.250". Ese precio vale solo para el
// combo; el del producto no cambia ("No debe cambiar el valor en el sistema. Por algo es promo... El
// stock sí, pero precio no"). El precio del combo es la suma de sus renglones. En Caja se cobra solo
// cuando el carrito tiene todo lo del combo (presentacion.js → aplicarCombos). Sin fecha y solo en
// Caja. Los arma, cambia y borra solo el Administrador, en Configuración → Promociones; los ven los
// tres roles, porque Caja los necesita.

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

// Precio en la promo de un renglón (por unidad, kg, litro o pack). Puede ser $0 (va de regalo).
// Solo número o texto numérico: Number(true) vale 1.
function validarPrecio(valor) {
  if (typeof valor !== 'number' && typeof valor !== 'string') throw new ApiError(400, 'Cargá el precio en la promo');
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) throw new ApiError(400, 'El precio en la promo tiene que ser un número entero, de $0 en adelante');
  if (n > MAX_PRECIO) throw new ApiError(400, `El precio en la promo no puede superar $ ${MAX_PRECIO.toLocaleString('es-AR')}`);
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
  const combo = await db.prepare('SELECT id, nombre FROM combos WHERE id = ? AND eliminado_en IS NULL').get(id);
  if (!combo) throw new ApiError(404, 'Combo no encontrado');
  return combo;
}

async function obtenerRenglon(comboId, renglonId) {
  const renglon = await db
    .prepare('SELECT id, nombre, presentacion, cantidad, precio FROM combo_renglones WHERE id = ? AND combo_id = ? AND eliminado_en IS NULL')
    .get(renglonId, comboId);
  if (!renglon) throw new ApiError(404, 'Ese producto ya no está en el combo');
  return renglon;
}

const COLUMNAS_FORMA = 'id, nombre, medida, vende_suelto, pack_nombre, pack_unidades, precio_venta, precio_pack';

async function obtenerProducto(productoId) {
  const producto = await db.prepare(`SELECT ${COLUMNAS_FORMA} FROM productos WHERE id = ? AND eliminado_en IS NULL`).get(productoId);
  if (!producto) throw new ApiError(404, 'Producto no encontrado');
  return producto;
}

// El producto de un renglón (desde la migración 038, uno solo), con lo que hace falta para controlar la forma.
function productoDelRenglon(renglonId) {
  return db
    .prepare(
      `SELECT p.id, p.nombre, p.medida, p.vende_suelto, p.pack_nombre, p.pack_unidades
       FROM combo_renglon_productos rp JOIN productos p ON p.id = rp.producto_id
       WHERE rp.renglon_id = ? AND rp.eliminado_en IS NULL
       ORDER BY rp.id`
    )
    .get(renglonId);
}

// Por qué el producto no se puede cobrar en la forma del renglón, o null.
function problemaDeForma(producto, presentacion) {
  if (presentacion === 'pack' && !tienePack(producto)) return 'No se vende por caja ni por pack';
  if (presentacion === 'unidad' && producto.vende_suelto === false) return 'No se vende suelto';
  return null;
}

function verificarForma(producto, presentacion) {
  const problema = problemaDeForma(producto, presentacion);
  if (problema) throw new ApiError(400, `"${producto.nombre}": ${problema.toLowerCase()}`);
}

// Un producto va una sola vez por forma en todo el combo: si no, se contaría dos veces.
async function verificarQueNoEsteEnOtro(comboId, renglonId, productoId, presentacion, nombreProducto) {
  const otro = await db
    .prepare(
      `SELECT r.id FROM combo_renglones r
       JOIN combo_renglon_productos rp ON rp.renglon_id = r.id AND rp.eliminado_en IS NULL
       WHERE r.combo_id = ? AND r.eliminado_en IS NULL AND r.id != ? AND rp.producto_id = ? AND r.presentacion = ?`
    )
    .get(comboId, renglonId ?? -1, productoId, presentacion);
  if (otro) throw new ApiError(409, `"${nombreProducto}" ya está en este combo así: cambiale la cantidad`);
}

const pesos = (n) => `$ ${n.toLocaleString('es-AR')}`;

/** "Coca-Cola 2,25 L: 2 unidades a $ 3.250", "Hielo: 1 caja o pack a $ 9.000": un renglón, para el registro. */
function describirRenglon(nombre, presentacion, cantidad, precio, medida) {
  const cuanto =
    presentacion === 'pack' ? `${cantidad} ${cantidad === 1 ? 'caja o pack' : 'cajas o packs'}` : describirCantidad(cantidad, medida);
  return `${nombre}: ${cuanto} a ${pesos(precio)}`;
}

/**
 * Los combos activos con sus renglones y el producto de cada uno (con lo necesario para mostrarlo y
 * calcular el precio normal), en `productos` (una lista de uno, como antes de la 038). `precio`: la
 * suma de los renglones. `problema` del producto: por qué no se puede cobrar en la forma del renglón
 * (se eliminó, o ya no se vende así). `vigente`: tiene renglones y ninguno tiene problema; uno que no
 * está vigente no se aplica en Caja. Ordenados por id: en ese orden se aplican.
 */
export async function listarCombos() {
  const combos = await db.prepare('SELECT id, nombre FROM combos WHERE eliminado_en IS NULL ORDER BY id').all();
  const renglones = await db
    .prepare(
      `SELECT r.id, r.combo_id, r.nombre, r.presentacion, r.cantidad, r.precio
       FROM combo_renglones r JOIN combos c ON c.id = r.combo_id AND c.eliminado_en IS NULL
       WHERE r.eliminado_en IS NULL ORDER BY r.id`
    )
    .all();
  const productos = await db
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
        productos: productos
          .filter((m) => m.renglon_id === r.id)
          .map((m) => ({ ...m, problema: m.producto_eliminado ? 'Se eliminó' : problemaDeForma(m, r.presentacion) })),
      }));
    return {
      ...combo,
      precio: propios.reduce((acc, r) => acc + subtotalRenglon(r, r.productos[0]?.medida), 0),
      renglones: propios,
      vigente: propios.length > 0 && propios.every((r) => r.productos.some((m) => !m.problema)),
    };
  });
}

/** Los que se aplican al cobrar en Caja, con el producto de cada renglón y su precio en la promo. */
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
        precio: r.precio,
        productos: r.productos.filter((m) => !m.problema).map((m) => m.producto_id),
      })),
    }));
}

export function crearCombo({ nombre }) {
  const nombreValido = validarNombre(nombre);
  return db.transaction(async () => {
    await verificarNombreLibre(nombreValido);
    return db.prepare('INSERT INTO combos (nombre) VALUES (?) RETURNING id, nombre').get(nombreValido);
  });
}

/** Cambia el nombre (el precio es la suma de los renglones). Devuelve el combo y cómo estaba (para el registro). */
export function editarCombo(id, { nombre }) {
  const nombreValido = validarNombre(nombre);
  return db.transaction(async () => {
    const anterior = await obtenerActivo(id);
    await verificarNombreLibre(nombreValido, id);
    const combo = await db
      .prepare('UPDATE combos SET nombre = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ? RETURNING id, nombre')
      .get(nombreValido, id);
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
 * Agrega un producto al combo con su forma, su cantidad y su precio en la promo (sin precio, el normal
 * de esa forma). El renglón se llama como el producto. Devuelve { combo, renglon }.
 */
export function agregarRenglon(comboId, { producto_id, presentacion, cantidad, precio }) {
  const productoId = validarId(producto_id, 'producto_id');
  const forma = validarPresentacion(presentacion);
  const n = validarCantidad(cantidad, forma);
  const precioValido = precio === undefined || precio === null ? null : validarPrecio(precio);
  return db.transaction(async () => {
    const combo = await obtenerActivo(comboId);
    const producto = await obtenerProducto(productoId);
    verificarForma(producto, forma);
    await verificarQueNoEsteEnOtro(comboId, null, productoId, forma, producto.nombre);
    const nombre = producto.nombre.slice(0, MAX_NOMBRE);
    const precioFinal = precioValido ?? (forma === 'pack' ? producto.precio_pack : producto.precio_venta) ?? 0;
    const renglon = await db
      .prepare('INSERT INTO combo_renglones (combo_id, nombre, presentacion, cantidad, precio) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .get(comboId, nombre, forma, n, precioFinal);
    await db.prepare('INSERT INTO combo_renglon_productos (renglon_id, producto_id) VALUES (?, ?)').run(renglon.id, productoId);
    return { combo, renglon: describirRenglon(nombre, forma, n, precioFinal, producto.medida) };
  });
}

/**
 * Cambia la forma, la cantidad y/o el precio en la promo de un renglón. Con otra forma, el producto
 * tiene que venderse así. Devuelve { combo, antes, despues }, o null si no cambió nada.
 */
export function editarRenglon(comboId, renglonId, { presentacion, cantidad, precio }) {
  return db.transaction(async () => {
    const combo = await obtenerActivo(comboId);
    const actual = await obtenerRenglon(comboId, renglonId);
    const forma = presentacion === undefined ? actual.presentacion : validarPresentacion(presentacion);
    const n = cantidad === undefined ? actual.cantidad : validarCantidad(cantidad, forma);
    const nuevoPrecio = precio === undefined ? actual.precio : validarPrecio(precio);
    if (forma === actual.presentacion && n === actual.cantidad && nuevoPrecio === actual.precio) return null;
    const producto = await productoDelRenglon(renglonId);
    if (producto && forma !== actual.presentacion) {
      verificarForma(producto, forma);
      await verificarQueNoEsteEnOtro(comboId, renglonId, producto.id, forma, producto.nombre);
    }
    await db
      .prepare('UPDATE combo_renglones SET presentacion = ?, cantidad = ?, precio = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
      .run(forma, n, nuevoPrecio, renglonId);
    const medida = producto?.medida ?? 'unidad';
    return {
      combo,
      antes: describirRenglon(actual.nombre, actual.presentacion, actual.cantidad, actual.precio, medida),
      despues: describirRenglon(actual.nombre, forma, n, nuevoPrecio, medida),
    };
  });
}

/** Saca un producto del combo (baja lógica del renglón). Devuelve { combo, renglon }. */
export function sacarRenglon(comboId, renglonId) {
  return db.transaction(async () => {
    const combo = await obtenerActivo(comboId);
    const renglon = await obtenerRenglon(comboId, renglonId);
    await db.prepare('UPDATE combo_renglones SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(renglonId);
    return { combo, renglon: renglon.nombre };
  });
}
