// Venta por pack y precio por cantidad (2026-10-11, modelo de CEAVital-Somnia). Las mismas
// reglas que el servidor (src/services/presentacion.js), que es el que decide el precio
// real; acá solo se muestran antes de confirmar.

export function tienePack(producto) {
  return Boolean(producto?.pack_nombre && producto?.pack_unidades);
}

export function tienePrecioCantidad(producto) {
  return producto?.precio_cantidad_desde != null && producto?.precio_cantidad != null;
}

/** "Pack x 24". */
export function etiquetaPack(nombre, unidades) {
  return `${nombre} x ${unidades}`;
}

/**
 * Precio de una línea: por pack, el del pack; por unidad, el normal o, desde N unidades
 * inclusive, el precio por cantidad para toda la línea.
 */
export function precioLinea(producto, cantidad, presentacion) {
  if (presentacion === 'pack') return { precio: producto.precio_pack, aplicaPrecioCantidad: false };
  const aplica = tienePrecioCantidad(producto) && cantidad >= producto.precio_cantidad_desde;
  return { precio: aplica ? producto.precio_cantidad : producto.precio_venta, aplicaPrecioCantidad: aplica };
}

/** Cuántas unidades faltan para el precio por cantidad (0 si ya llegó o no tiene). */
export function faltanParaPrecioCantidad(producto, cantidad) {
  if (!tienePrecioCantidad(producto)) return 0;
  return Math.max(0, producto.precio_cantidad_desde - cantidad);
}

export function unidadesDeLinea(producto, cantidad, presentacion) {
  return presentacion === 'pack' ? cantidad * producto.pack_unidades : cantidad;
}

/** Las unidades en packs: "10 pack" / "10 pack + 10", o null si no tiene pack o no llega a uno. */
export function describirPacks(unidades, producto) {
  if (!tienePack(producto) || unidades < producto.pack_unidades) return null;
  const packs = Math.floor(unidades / producto.pack_unidades);
  const resto = unidades % producto.pack_unidades;
  return `${packs} ${producto.pack_nombre.toLowerCase()}${resto ? ` + ${resto}` : ''}`;
}

/** "240" o, con pack, "240 (10 pack)" / "250 (10 pack + 10)". */
export function describirStock(unidades, producto) {
  const packs = describirPacks(unidades, producto);
  return packs ? `${unidades} (${packs})` : String(unidades);
}

/** Cantidad de una línea de pedido o venta: "3" o "2 Pack x 24". */
export function describirCantidadLinea(item) {
  if (!item.pack_nombre) return String(item.cantidad_presentacion ?? item.cantidad);
  return `${item.cantidad_presentacion} ${etiquetaPack(item.pack_nombre, item.pack_unidades)}`;
}
