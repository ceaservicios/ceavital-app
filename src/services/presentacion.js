import { ApiError } from '../utils/api-error.js';

// Venta por pack y precio por cantidad (2026-10-11, modelo de CEAVital-Somnia: lib/pack.ts y
// lib/precio-cantidad.ts). Modulo puro, sin base: lo usan Caja (ventas.service) y el portal
// (pedidos-cliente.service), y el frontend repite las mismas reglas en utils/presentacion.js.
//
// Reglas que eligio el usuario (las mismas de Somnia):
// - El stock es uno solo, en la unidad del producto. Un pack descuenta pack_unidades.
// - Precio por cantidad: cuenta solo ese producto; desde N inclusive TODA la linea sale al
//   precio menor; vale para la venta por unidad, no para el pack.

export const PRESENTACIONES = ['unidad', 'pack'];

// Forma de medir (migración 019): 'unidad' se cuenta; 'kg' y 'litro' tienen decimales y se
// guardan en gramos / mililitros (enteros). Los precios son por unidad, por kg o por litro.
export const MEDIDAS = ['unidad', 'kg', 'litro'];
export function factorMedida(medida) {
  return medida === 'kg' || medida === 'litro' ? 1000 : 1;
}

/** Cantidad legible para mensajes: "3 unidades", "13,999 kg", "1,5 L". */
export function describirCantidad(base, medida) {
  if (factorMedida(medida) === 1) return `${base} ${base === 1 ? 'unidad' : 'unidades'}`;
  const texto = (base / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 });
  return `${texto} ${medida === 'kg' ? 'kg' : 'L'}`;
}

// Columnas de productos que necesita armarLinea (para los SELECT de quien la llama).
export const COLUMNAS_PRESENTACION =
  'medida, vende_suelto, pack_nombre, pack_unidades, precio_pack, codigo_barras_pack, precio_cantidad_desde, precio_cantidad';

// Tope de una linea en la medida más chica (unidades, gramos o ml): lotes.cantidad es INTEGER.
const MAX_UNIDADES_LINEA = 10_000_000;

export function validarPresentacion(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return 'unidad';
  if (!PRESENTACIONES.includes(valor)) throw new ApiError(400, `${campo} tiene que ser "unidad" o "pack"`);
  return valor;
}

export function tienePack(producto) {
  return Boolean(producto.pack_nombre && producto.pack_unidades);
}

/** "Pack x 24". */
export function etiquetaPack(nombre, unidades) {
  return `${nombre} x ${unidades}`;
}

/**
 * Arma una linea de venta o pedido con el precio vigente del producto. `cantidad` es la que
 * eligio el usuario en esa presentacion (unidades o packs). Devuelve las unidades de stock que
 * mueve y la copia de la presentacion que se guarda en la linea.
 */
export function armarLinea(producto, { cantidad, presentacion }) {
  if (presentacion === 'pack') {
    if (!tienePack(producto)) throw new ApiError(400, `"${producto.nombre}" no se vende por pack`);
    const unidades = cantidad * producto.pack_unidades;
    if (unidades > MAX_UNIDADES_LINEA) throw new ApiError(400, `Cantidad demasiado grande para "${producto.nombre}"`);
    return {
      producto_id: producto.id,
      pack_nombre: producto.pack_nombre,
      pack_unidades: producto.pack_unidades,
      precio_unitario: producto.precio_pack,
      precio_cantidad_desde: null,
      unidades,
      subtotal: cantidad * producto.precio_pack,
    };
  }

  // Suelto: por unidad, o en gramos/ml para kg/litro (el precio es por kg o litro).
  if (producto.vende_suelto === false) {
    throw new ApiError(400, `"${producto.nombre}" no se vende suelto: solo por ${String(producto.pack_nombre).toLowerCase()}`);
  }
  if (cantidad > MAX_UNIDADES_LINEA) throw new ApiError(400, `Cantidad demasiado grande para "${producto.nombre}"`);
  const aplicaPrecioCantidad = producto.precio_cantidad_desde !== null && producto.precio_cantidad_desde !== undefined
    && producto.precio_cantidad !== null && producto.precio_cantidad !== undefined
    && cantidad >= producto.precio_cantidad_desde;
  const precio = aplicaPrecioCantidad ? producto.precio_cantidad : producto.precio_venta;
  return {
    producto_id: producto.id,
    pack_nombre: null,
    pack_unidades: null,
    precio_unitario: precio,
    precio_cantidad_desde: aplicaPrecioCantidad ? producto.precio_cantidad_desde : null,
    unidades: cantidad,
    subtotal: Math.round((cantidad * precio) / factorMedida(producto.medida)),
  };
}

/**
 * Junta las lineas repetidas del mismo producto y la misma presentacion (el precio por
 * cantidad se mira sobre el total de esa linea). `items` ya validados: { producto_id,
 * cantidad, presentacion }.
 */
export function juntarLineas(items) {
  const porClave = new Map();
  for (const item of items) {
    const clave = `${item.producto_id}:${item.presentacion}`;
    const previa = porClave.get(clave);
    porClave.set(clave, previa ? { ...previa, cantidad: previa.cantidad + item.cantidad } : { ...item });
  }
  return [...porClave.values()];
}
