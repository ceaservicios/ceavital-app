// Venta por pack y precio por cantidad (2026-10-11, modelo de CEAVital-Somnia). Las mismas
// reglas que el servidor (src/services/presentacion.js), que es el que decide el precio
// real; acá solo se muestran antes de confirmar.
//
// Forma de medir (migración 019): 'unidad' se cuenta; 'kg' y 'litro' tienen decimales y el
// sistema los guarda en gramos / mililitros (enteros). Toda cantidad que viaja con la API
// (stock, lotes, líneas, "trae", "desde", mínimo) va en esa medida chica; los precios son por
// unidad, por kg o por litro. Acá se convierte para mostrar y para leer lo que se tipea.

export const MEDIDAS = [
  { valor: 'unidad', texto: 'Por unidad', ayuda: 'Se cuenta: alfajor, gaseosa, paquete de fideos' },
  { valor: 'kg', texto: 'Por peso (kg)', ayuda: 'Se pesa: queso, fiambre, pan, alimento suelto' },
  { valor: 'litro', texto: 'Por litro', ayuda: 'Se mide: productos sueltos a granel' },
];

export function esFraccionable(medida) {
  return medida === 'kg' || medida === 'litro';
}

export function factorMedida(medida) {
  return esFraccionable(medida) ? 1000 : 1;
}

/** "kg", "L" o "unidad(es)". */
export function simboloMedida(medida, cantidad = 2) {
  if (medida === 'kg') return 'kg';
  if (medida === 'litro') return 'L';
  return cantidad === 1 ? 'unidad' : 'unidades';
}

/** "por unidad" / "por kg" / "por litro". */
export function porMedida(medida) {
  if (medida === 'kg') return 'por kg';
  if (medida === 'litro') return 'por litro';
  return 'por unidad';
}

/** Precio con su medida: "$600", "$12.000/kg". */
export function sufijoPrecio(medida) {
  if (medida === 'kg') return '/kg';
  if (medida === 'litro') return '/L';
  return '';
}

function numeroCorto(valor) {
  return valor.toLocaleString('es-AR', { maximumFractionDigits: 3 });
}

/**
 * Cantidad en la medida chica → texto: "12 unidades", "0,35 kg", "1,5 L".
 * `corta`: sin la palabra "unidades" ("12"), para tablas.
 */
export function formatearCantidad(base, medida, { corta = false } = {}) {
  const n = Number(base) || 0;
  if (!esFraccionable(medida)) return corta ? String(n) : `${n} ${simboloMedida(medida, n)}`;
  return `${numeroCorto(n / 1000)} ${simboloMedida(medida)}`;
}

/** Lo que se tipea ("0,350", "12") → cantidad en la medida chica, o null si no es válida. */
export function parsearCantidad(texto, medida) {
  // En unidades el punto es de miles ("1.000"); en kg/litro, decimal salvo que haya coma ("1.250,5").
  const crudo = String(texto ?? '').trim();
  const sinMiles = !esFraccionable(medida) || crudo.includes(',') ? crudo.replace(/\./g, '') : crudo;
  const limpio = sinMiles.replace(',', '.');
  if (!limpio) return null;
  const n = Number(limpio);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!esFraccionable(medida)) return Number.isInteger(n) ? n : null;
  const base = Math.round(n * 1000);
  return base > 0 ? base : null;
}

/** Cantidad en la medida chica → texto para un campo ("0,35", "12"). */
export function textoDeCantidad(base, medida) {
  if (base == null || base === '') return '';
  if (!esFraccionable(medida)) return String(base);
  return String(Number(base) / 1000).replace('.', ',');
}

export function tienePack(producto) {
  return Boolean(producto?.pack_nombre && producto?.pack_unidades);
}

/** Se vende suelto (por unidad, kg o litro). Los productos viejos no traen el dato: sí. */
export function vendeSuelto(producto) {
  return producto?.vende_suelto !== false;
}

/** Precio por cantidad del suelto o, con presentacion 'pack', del pack (migración 020). */
export function tienePrecioCantidad(producto, presentacion = 'unidad') {
  if (presentacion === 'pack') return producto?.pack_cantidad_desde != null && producto?.precio_pack_cantidad != null;
  return producto?.precio_cantidad_desde != null && producto?.precio_cantidad != null;
}

/** Desde cuánto y a qué precio rige el precio por cantidad de esa forma de venta. */
export function precioCantidadDe(producto, presentacion = 'unidad') {
  return presentacion === 'pack'
    ? { desde: producto.pack_cantidad_desde, precio: producto.precio_pack_cantidad }
    : { desde: producto.precio_cantidad_desde, precio: producto.precio_cantidad };
}

/** "Caja x 12", "Bolsa x 15 kg". */
export function etiquetaPack(nombre, unidades, medida = 'unidad') {
  if (esFraccionable(medida)) return `${nombre} x ${formatearCantidad(unidades, medida)}`;
  return `${nombre} x ${unidades}`;
}

/**
 * Precio de una línea: por pack, el del pack; suelto, el normal o, desde N inclusive, el
 * precio por cantidad para toda la línea. En kg/litro el precio es por kg/litro.
 */
export function precioLinea(producto, cantidad, presentacion) {
  const aplica = tienePrecioCantidad(producto, presentacion) && cantidad >= precioCantidadDe(producto, presentacion).desde;
  const normal = presentacion === 'pack' ? producto.precio_pack : producto.precio_venta;
  return { precio: aplica ? precioCantidadDe(producto, presentacion).precio : normal, aplicaPrecioCantidad: aplica };
}

/** Subtotal de una línea: packs × precio del pack; suelto, cantidad × precio (÷1000 en kg/litro). */
export function subtotalLinea(producto, cantidad, presentacion) {
  const { precio } = precioLinea(producto, cantidad, presentacion);
  if (presentacion === 'pack') return precio * cantidad;
  return Math.round((cantidad * precio) / factorMedida(producto.medida));
}

/** Cuánto falta para el precio por cantidad (0 si ya llegó o no tiene): en la medida chica, o en packs. */
export function faltanParaPrecioCantidad(producto, cantidad, presentacion = 'unidad') {
  if (!tienePrecioCantidad(producto, presentacion)) return 0;
  return Math.max(0, precioCantidadDe(producto, presentacion).desde - cantidad);
}

export function unidadesDeLinea(producto, cantidad, presentacion) {
  return presentacion === 'pack' ? cantidad * producto.pack_unidades : cantidad;
}

/** Cuántos packs son: "10 cajas" / "10 cajas + 4" / "2 bolsas + 3,5 kg", o null si no llega a uno. */
export function describirPacks(base, producto) {
  if (!tienePack(producto) || base < producto.pack_unidades) return null;
  const packs = Math.floor(base / producto.pack_unidades);
  const resto = base % producto.pack_unidades;
  const textoResto = resto ? ` + ${formatearCantidad(resto, producto.medida, { corta: true })}` : '';
  return `${packs} ${plural(producto.pack_nombre, packs)}${textoResto}`;
}

/** Corto, para tablas: "240 (10 cajas)", "3,5 kg". */
export function describirStock(base, producto) {
  const texto = formatearCantidad(base, producto?.medida, { corta: true });
  const packs = describirPacks(base, producto);
  return packs ? `${texto} (${packs})` : texto;
}

/** Largo: "64 unidades (5 cajas + 4)", "12,35 kg". */
export function describirStockLargo(base, producto) {
  const texto = formatearCantidad(base, producto?.medida);
  const packs = describirPacks(base, producto);
  return packs ? `${texto} (${packs})` : texto;
}

/** "caja" → "cajas", "pack" → "packs" (para "5 cajas"). */
export function plural(nombre, cantidad) {
  const n = String(nombre || '').toLowerCase();
  if (cantidad === 1 || n.endsWith('s')) return n;
  if (/ón$/.test(n)) return `${n.slice(0, -2)}ones`; // cajón → cajones
  return `${n}s`;
}

// Unidades de medida del catálogo viejo que en realidad son un envase (2026-10-11): con
// "Caja x 12" como unidad, el sistema cuenta, cobra y descuenta de a una caja. Desde la
// migración 019 la unidad ya no se elige de esa lista; esto solo detecta productos viejos.
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

/** Producto viejo cargado con un envase como unidad (y todavía sin convertir). */
export function cargadoConEnvase(producto) {
  return (producto?.medida ?? 'unidad') === 'unidad' && !tienePack(producto) && Boolean(envaseEnNombre(producto?.unidad_medida));
}

/** Cantidad de una línea de pedido o venta: "3", "0,35 kg" o "2 Caja x 12". */
export function describirCantidadLinea(item) {
  if (!item.pack_nombre) return formatearCantidad(item.cantidad, item.medida, { corta: true });
  return `${item.cantidad_presentacion} ${etiquetaPack(item.pack_nombre, item.pack_unidades, item.medida)}`;
}
