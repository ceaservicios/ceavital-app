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
  return `${packs} ${plural(producto.pack_nombre, packs)}${resto ? ` + ${resto}` : ''}`;
}

/** "240" o, con pack, "240 (10 pack)" / "250 (10 pack + 10)". */
export function describirStock(unidades, producto) {
  const packs = describirPacks(unidades, producto);
  return packs ? `${unidades} (${packs})` : String(unidades);
}

/** "caja" → "cajas", "pack" → "packs" (para "5 cajas"). */
export function plural(nombre, cantidad) {
  const n = String(nombre || '').toLowerCase();
  if (cantidad === 1 || n.endsWith('s')) return n;
  if (/ón$/.test(n)) return `${n.slice(0, -2)}ones`; // cajón → cajones
  return `${n}s`;
}

/**
 * Stock legible con la unidad del producto y, si tiene pack, cuántos son:
 * "64 unidades (5 cajas + 4)", "3 kg". `unidad` es el nombre de la unidad de medida.
 */
export function describirStockLargo(unidades, producto, unidad) {
  const nombre = nombreUnidadSuelta(unidad, unidades);
  const base = `${unidades} ${nombre}`;
  if (!tienePack(producto) || unidades < producto.pack_unidades) return base;
  const packs = Math.floor(unidades / producto.pack_unidades);
  const resto = unidades % producto.pack_unidades;
  return `${base} (${packs} ${plural(producto.pack_nombre, packs)}${resto ? ` + ${resto}` : ''})`;
}

/** "1 unidad" / "Unidad" / vacío → "unidad(es)"; "Kg" → "kg". */
export function nombreUnidadSuelta(unidad, cantidad = 2) {
  const limpio = String(unidad || '').trim().toLowerCase().replace(/^1\s+/, '');
  if (!limpio || /^unidad(es)?$/.test(limpio)) return cantidad === 1 ? 'unidad' : 'unidades';
  return limpio;
}

// Unidades de medida que en realidad son un envase (2026-10-11): con "Caja x 12" como
// unidad, el sistema cuenta, cobra y descuenta de a una caja, sin relación con las unidades
// que trae. Para eso está la casilla del pack. Se avisa al cargar el producto.
const ENVASES = /\b(pack|caja|cajita|bulto|fardo|display|blister|blíster|docena|maple|tira|bandeja)\b/i;
// "x 12", "de 24", "por 6", pero no un peso o volumen ("de 5 kg", "x 500 ml").
const CANTIDAD_ENVASE = /(?:x|de|por)\s*(\d+)(?!\s*(?:kg|kgs|g|gr|grs|l|lt|lts|ml|cc|cm|m)\b)(?!\d)/i;

/** null, o { nombre: 'Caja', unidades: 12 | null } si el nombre de la unidad es un envase. */
export function envaseEnNombre(nombreUnidad) {
  const texto = String(nombreUnidad || '');
  const tipo = texto.match(ENVASES);
  const cantidad = texto.match(CANTIDAD_ENVASE);
  if (!tipo && !cantidad) return null;
  let unidades = cantidad ? Number(cantidad[1]) : null;
  if (!unidades && tipo && /docena/i.test(tipo[1])) unidades = 12;
  if (!unidades && tipo && /maple/i.test(tipo[1])) unidades = 30;
  const nombre = tipo ? tipo[1][0].toUpperCase() + tipo[1].slice(1).toLowerCase() : 'Pack';
  return { nombre, unidades: unidades >= 2 ? unidades : null };
}

/** Cantidad de una línea de pedido o venta: "3" o "2 Pack x 24". */
export function describirCantidadLinea(item) {
  if (!item.pack_nombre) return String(item.cantidad_presentacion ?? item.cantidad);
  return `${item.cantidad_presentacion} ${etiquetaPack(item.pack_nombre, item.pack_unidades)}`;
}
