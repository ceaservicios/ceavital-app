import { ApiError } from '../utils/api-error.js';

// Venta por pack y precio por cantidad (2026-10-11, modelo de CEAVital-Somnia: lib/pack.ts y
// lib/precio-cantidad.ts). Modulo puro, sin base: lo usan Caja (ventas.service) y el portal
// (pedidos-cliente.service), y el frontend repite las mismas reglas en utils/presentacion.js.
//
// Reglas que eligio el usuario (las mismas de Somnia):
// - El stock es uno solo, en la unidad del producto. Un pack descuenta pack_unidades.
// - Precio por cantidad: desde N inclusive TODA la linea sale al precio menor. El suelto se
//   cuenta en unidades (o gramos/ml) y el pack en packs, cada uno con su propio "desde".
// - Grupos de promocion (2026-11-01, migracion 035): los productos de un mismo grupo suman juntos
//   para llegar, sueltos con sueltos y packs con packs (decision del usuario); sin grupo cuenta solo
//   ese producto. Cada producto usa su propio "desde" y su precio contra el total del grupo.
// - Combos (2026-11-01, migracion 036): ver aplicarCombos y lineasDeCombo, mas abajo.

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

// Columnas de productos que necesita armarLinea (para los SELECT de quien la llama, que van
// siempre sobre "FROM productos" sin alias). grupo_promocion: el nombre del grupo, o null.
export const COLUMNAS_PRESENTACION =
  'medida, vende_suelto, pack_nombre, pack_unidades, precio_pack, codigo_barras_pack, precio_cantidad_desde, precio_cantidad, ' +
  'pack_cantidad_desde, precio_pack_cantidad, grupo_promocion_id, ' +
  '(SELECT g.nombre FROM grupos_promocion g WHERE g.id = productos.grupo_promocion_id AND g.eliminado_en IS NULL) AS grupo_promocion';

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
 * Con qué suma una línea para llegar al precio por cantidad: su grupo (en la misma presentación y
 * medida: una caja no suma con una unidad, ni un kg con una unidad) o, sin grupo, el producto solo.
 */
export function claveDeSuma(producto, presentacion) {
  return producto.grupo_promocion_id != null
    ? `grupo:${producto.grupo_promocion_id}:${producto.medida}:${presentacion}`
    : `producto:${producto.id}:${presentacion}`;
}

/**
 * Arma una linea de venta o pedido con el precio vigente del producto. `cantidad` es la que
 * eligio el usuario en esa presentacion (unidades o packs); `cuenta`, la que se mira para el
 * precio por cantidad: la de todo su grupo de promocion (armarLineas), o la de la linea sola.
 * Devuelve las unidades de stock que mueve y la copia de la presentacion que se guarda en la
 * linea (con el nombre del grupo si llego al precio por cantidad con el).
 */
export function armarLinea(producto, { cantidad, presentacion }, cuenta = cantidad) {
  const grupoSiAplica = (aplica) => (aplica && producto.grupo_promocion ? producto.grupo_promocion : null);
  if (presentacion === 'pack') {
    if (!tienePack(producto)) throw new ApiError(400, `"${producto.nombre}" no se vende por pack`);
    const unidades = cantidad * producto.pack_unidades;
    if (unidades > MAX_UNIDADES_LINEA) throw new ApiError(400, `Cantidad demasiado grande para "${producto.nombre}"`);
    // Precio por cantidad del pack (migración 020): desde N packs, toda la línea a ese precio.
    const aplicaPrecioCantidad = producto.pack_cantidad_desde != null && producto.precio_pack_cantidad != null
      && cuenta >= producto.pack_cantidad_desde;
    const precio = aplicaPrecioCantidad ? producto.precio_pack_cantidad : producto.precio_pack;
    return {
      producto_id: producto.id,
      pack_nombre: producto.pack_nombre,
      pack_unidades: producto.pack_unidades,
      precio_unitario: precio,
      // En una línea por pack, "desde" se lee en packs.
      precio_cantidad_desde: aplicaPrecioCantidad ? producto.pack_cantidad_desde : null,
      precio_cantidad_grupo: grupoSiAplica(aplicaPrecioCantidad),
      unidades,
      subtotal: cantidad * precio,
    };
  }

  // Suelto: por unidad, o en gramos/ml para kg/litro (el precio es por kg o litro).
  if (producto.vende_suelto === false) {
    throw new ApiError(400, `"${producto.nombre}" no se vende suelto: solo por ${String(producto.pack_nombre).toLowerCase()}`);
  }
  if (cantidad > MAX_UNIDADES_LINEA) throw new ApiError(400, `Cantidad demasiado grande para "${producto.nombre}"`);
  const aplicaPrecioCantidad = producto.precio_cantidad_desde !== null && producto.precio_cantidad_desde !== undefined
    && producto.precio_cantidad !== null && producto.precio_cantidad !== undefined
    && cuenta >= producto.precio_cantidad_desde;
  const precio = aplicaPrecioCantidad ? producto.precio_cantidad : producto.precio_venta;
  return {
    producto_id: producto.id,
    pack_nombre: null,
    pack_unidades: null,
    precio_unitario: precio,
    precio_cantidad_desde: aplicaPrecioCantidad ? producto.precio_cantidad_desde : null,
    precio_cantidad_grupo: grupoSiAplica(aplicaPrecioCantidad),
    unidades: cantidad,
    subtotal: Math.round((cantidad * precio) / factorMedida(producto.medida)),
  };
}

/**
 * Arma todas las lineas de una venta o pedido: primero suma lo de cada grupo de promocion (o de
 * cada producto sin grupo) y despues le pone precio a cada linea contra ese total. `items` ya
 * juntados (juntarLineas); `productos`: Map producto_id -> fila con COLUMNAS_PRESENTACION.
 */
export function armarLineas(items, productos) {
  const cuentas = new Map();
  for (const item of items) {
    const clave = claveDeSuma(productos.get(item.producto_id), item.presentacion);
    cuentas.set(clave, (cuentas.get(clave) ?? 0) + item.cantidad);
  }
  return items.map((item) => {
    const producto = productos.get(item.producto_id);
    return armarLinea(producto, item, cuentas.get(claveDeSuma(producto, item.presentacion)));
  });
}

// Combos (2026-11-01, migracion 036): un conjunto fijo de productos, cada uno con su forma (suelto o
// su pack) y su cantidad, con un precio total. Solo Caja. La misma regla esta en
// frontend/src/utils/presentacion.js, para mostrar el total antes de cobrar.

const claveDeLinea = (productoId, presentacion) => `${productoId}:${presentacion}`;

/**
 * Saca de las lineas lo que entra en combos: cada combo, en orden, las veces que entre completo con
 * lo que va quedando. `items`: lineas juntadas [{ producto_id, presentacion, cantidad }]; `combos`:
 * [{ id, nombre, precio, items: [{ producto_id, presentacion, cantidad }] }], ordenados por id.
 * Devuelve { aplicados: [{ combo, veces }], resto }: `resto` son las lineas con lo que no entro en
 * ningun combo (sin las que quedaron en 0), que se cobran como siempre (armarLineas).
 */
export function aplicarCombos(items, combos) {
  const quedan = new Map(items.map((i) => [claveDeLinea(i.producto_id, i.presentacion), i.cantidad]));
  const aplicados = [];
  for (const combo of combos) {
    if (combo.items.length === 0) continue;
    const veces = Math.min(
      ...combo.items.map((ci) => Math.floor((quedan.get(claveDeLinea(ci.producto_id, ci.presentacion)) ?? 0) / ci.cantidad))
    );
    if (!(veces >= 1)) continue;
    for (const ci of combo.items) {
      const clave = claveDeLinea(ci.producto_id, ci.presentacion);
      quedan.set(clave, quedan.get(clave) - veces * ci.cantidad);
    }
    aplicados.push({ combo, veces });
  }
  const resto = items
    .map((i) => ({ ...i, cantidad: quedan.get(claveDeLinea(i.producto_id, i.presentacion)) }))
    .filter((i) => i.cantidad > 0);
  return { aplicados, resto };
}

/**
 * Las lineas de un combo cobrado `veces` veces: cada producto con su cantidad, y el precio del combo
 * repartido entre ellos en proporcion a su precio normal, redondeando sobre lo acumulado (asi suman
 * justo el precio del combo). Sin precio por cantidad; guardan el combo y una copia de su nombre.
 * `productos`: Map producto_id -> fila con COLUMNAS_PRESENTACION.
 */
export function lineasDeCombo(combo, veces, productos) {
  const partes = combo.items.map((ci) => {
    const producto = productos.get(ci.producto_id);
    const cantidad = ci.cantidad * veces;
    // Con cuenta 0 nunca llega al precio por cantidad: da el precio normal, que se usa para repartir.
    return { producto, cantidad, presentacion: ci.presentacion, linea: armarLinea(producto, { cantidad, presentacion: ci.presentacion }, 0) };
  });
  const total = combo.precio * veces;
  const sumaNormal = partes.reduce((acc, p) => acc + p.linea.subtotal, 0);
  let acumulado = 0;
  let asignado = 0;
  return partes.map(({ producto, cantidad, presentacion, linea }) => {
    acumulado += sumaNormal > 0 ? linea.subtotal : 1;
    const subtotal = Math.round((total * acumulado) / (sumaNormal > 0 ? sumaNormal : partes.length)) - asignado;
    asignado += subtotal;
    // Precio de referencia de la linea: por pack, por unidad, o por kg/litro.
    const precio =
      presentacion === 'pack' ? Math.round(subtotal / cantidad) : Math.round((subtotal * factorMedida(producto.medida)) / cantidad);
    return {
      ...linea,
      precio_unitario: precio,
      precio_cantidad_desde: null,
      precio_cantidad_grupo: null,
      subtotal,
      combo_id: combo.id,
      combo_nombre: combo.nombre,
    };
  });
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
