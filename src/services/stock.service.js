import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

const CAMPOS_PRECIO = ['precio_costo', 'precio_venta'];

function validarString(valor, campo, { requerido = true } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ApiError(400, `${campo} es requerido`);
    return null;
  }
  if (typeof valor !== 'string') throw new ApiError(400, `${campo} tiene que ser texto`);
  return valor.trim();
}

function validarEntero(valor, campo, { requerido = true, minimo = null } = {}) {
  if (valor === undefined || valor === null) {
    if (requerido) throw new ApiError(400, `${campo} es requerido`);
    return null;
  }
  const n = Number(valor);
  if (!Number.isInteger(n)) throw new ApiError(400, `${campo} tiene que ser un número entero`);
  if (minimo !== null && n < minimo) throw new ApiError(400, `${campo} no puede ser menor a ${minimo}`);
  return n;
}

function validarFecha(valor, campo) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new ApiError(400, `${campo} tiene que tener formato YYYY-MM-DD`);
  }
  return valor;
}

// "Costos y márgenes -- Ver" es exclusivo del Admin (Docs\Roles-y-Permisos.md):
// ni Encargado ni Cajero ven precio_costo, ni siquiera de un producto que ellos
// mismos crearon (Ver y Editar son permisos distintos en la matriz).
function ocultarCosto(producto, rol) {
  if (rol === 'admin') return producto;
  const { precio_costo, ...resto } = producto;
  return resto;
}

function conAlerta(producto) {
  return { ...producto, alerta_stock_bajo: producto.stock_total <= producto.stock_minimo };
}

function verificarProveedorActivo(proveedorId) {
  if (proveedorId === null || proveedorId === undefined) return;
  const proveedor = db
    .prepare('SELECT id FROM proveedores WHERE id = ? AND eliminado_en IS NULL')
    .get(proveedorId);
  if (!proveedor) throw new ApiError(400, 'El proveedor indicado no existe o está eliminado');
}

function verificarCodigoBarrasLibre(codigoBarras, excluirProductoId = null) {
  if (!codigoBarras) return;
  const existente = db
    .prepare(`SELECT id FROM productos WHERE codigo_barras = ? AND eliminado_en IS NULL AND id != ?`)
    .get(codigoBarras, excluirProductoId ?? -1);
  if (existente) throw new ApiError(409, 'Ya existe un producto activo con ese código de barras');
}

function obtenerProductoActivo(productoId) {
  const producto = db.prepare('SELECT id FROM productos WHERE id = ? AND eliminado_en IS NULL').get(productoId);
  if (!producto) throw new ApiError(404, 'Producto no encontrado');
  return producto;
}

function obtenerLoteActivo(productoId, loteId) {
  const lote = db
    .prepare('SELECT * FROM lotes WHERE id = ? AND producto_id = ? AND eliminado_en IS NULL')
    .get(loteId, productoId);
  if (!lote) throw new ApiError(404, 'Lote no encontrado');
  return lote;
}

// stock_total: suma de todos los lotes activos. stock_vendible: igual pero
// excluyendo lotes vencidos (Docs\Modelo-de-Datos.md > productos/lotes).
const SELECT_PRODUCTOS_CON_STOCK = `
  SELECT
    p.*,
    COALESCE(SUM(l.cantidad), 0) AS stock_total,
    COALESCE(SUM(CASE WHEN l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= date('now') THEN l.cantidad ELSE 0 END), 0) AS stock_vendible
  FROM productos p
  LEFT JOIN lotes l ON l.producto_id = p.id AND l.eliminado_en IS NULL
`;

export function listarProductos({ rol, buscar, codigoBarras }) {
  const condiciones = ['p.eliminado_en IS NULL'];
  const params = [];

  if (codigoBarras) {
    condiciones.push('p.codigo_barras = ?');
    params.push(codigoBarras);
  } else if (buscar) {
    condiciones.push('(p.nombre LIKE ? OR p.codigo_barras LIKE ?)');
    params.push(`%${buscar}%`, `%${buscar}%`);
  }

  const sql = `${SELECT_PRODUCTOS_CON_STOCK} WHERE ${condiciones.join(' AND ')} GROUP BY p.id ORDER BY p.nombre`;
  const productos = db.prepare(sql).all(...params);

  return productos.map((p) => ocultarCosto(conAlerta(p), rol));
}

export function obtenerProducto(id, { rol }) {
  const producto = db
    .prepare(`${SELECT_PRODUCTOS_CON_STOCK} WHERE p.id = ? AND p.eliminado_en IS NULL GROUP BY p.id`)
    .get(id);
  if (!producto) throw new ApiError(404, 'Producto no encontrado');

  // Orden FEFO: primero los lotes con fecha de vencimiento (el que vence
  // antes, primero); los que no tienen fecha (no perecederos) van al final,
  // ordenados entre si por fecha_ingreso (FIFO). "(fecha_vencimiento IS NULL)"
  // vale 0/1 en SQLite -- ordenar ASC por eso deja primero a los que SI tienen fecha.
  const lotes = db
    .prepare(
      `SELECT *, (fecha_vencimiento IS NOT NULL AND fecha_vencimiento < date('now')) AS vencido
       FROM lotes
       WHERE producto_id = ? AND eliminado_en IS NULL
       ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC, fecha_ingreso ASC`
    )
    .all(id);

  return {
    ...ocultarCosto(conAlerta(producto), rol),
    lotes: lotes.map((l) => ({ ...l, vencido: Boolean(l.vencido) })),
  };
}

export function crearProducto(datos, { rol }) {
  const nombre = validarString(datos.nombre, 'nombre');
  const categoria = validarString(datos.categoria, 'categoria', { requerido: false });
  const codigoBarras = validarString(datos.codigo_barras, 'codigo_barras', { requerido: false });
  const unidadMedida = validarString(datos.unidad_medida, 'unidad_medida');
  const precioCosto = validarEntero(datos.precio_costo, 'precio_costo', { minimo: 0 });
  const precioVenta = validarEntero(datos.precio_venta, 'precio_venta', { minimo: 0 });
  const proveedorId = datos.proveedor_id != null ? validarEntero(datos.proveedor_id, 'proveedor_id') : null;
  const stockMinimo =
    datos.stock_minimo != null ? validarEntero(datos.stock_minimo, 'stock_minimo', { minimo: 0 }) : 0;
  const diasAviso =
    datos.dias_aviso_vencimiento != null
      ? validarEntero(datos.dias_aviso_vencimiento, 'dias_aviso_vencimiento', { minimo: 0 })
      : null;

  verificarProveedorActivo(proveedorId);
  verificarCodigoBarrasLibre(codigoBarras);

  const resultado = db
    .prepare(
      `INSERT INTO productos
         (nombre, categoria, codigo_barras, precio_costo, precio_venta, unidad_medida, proveedor_id, stock_minimo, dias_aviso_vencimiento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(nombre, categoria, codigoBarras, precioCosto, precioVenta, unidadMedida, proveedorId, stockMinimo, diasAviso);

  return obtenerProducto(resultado.lastInsertRowid, { rol });
}

export function editarProducto(id, datos, { rol }) {
  obtenerProductoActivo(id);

  // "Precios (costo/venta) -- Editar" es exclusivo del Admin (distinto de
  // "Stock -- Editar: alta, lotes, ajustes", que incluye tambien al Encargado).
  const tocaPrecios = CAMPOS_PRECIO.some((c) => datos[c] !== undefined);
  if (tocaPrecios && rol !== 'admin') {
    throw new ApiError(403, 'Solo el Admin puede editar precios (costo/venta)');
  }

  const actualizaciones = {};

  if (datos.nombre !== undefined) actualizaciones.nombre = validarString(datos.nombre, 'nombre');
  if (datos.categoria !== undefined) {
    actualizaciones.categoria = validarString(datos.categoria, 'categoria', { requerido: false });
  }
  if (datos.unidad_medida !== undefined) {
    actualizaciones.unidad_medida = validarString(datos.unidad_medida, 'unidad_medida');
  }
  if (datos.stock_minimo !== undefined) {
    actualizaciones.stock_minimo = validarEntero(datos.stock_minimo, 'stock_minimo', { minimo: 0 });
  }
  if (datos.dias_aviso_vencimiento !== undefined) {
    actualizaciones.dias_aviso_vencimiento =
      datos.dias_aviso_vencimiento === null
        ? null
        : validarEntero(datos.dias_aviso_vencimiento, 'dias_aviso_vencimiento', { minimo: 0 });
  }
  if (datos.proveedor_id !== undefined) {
    actualizaciones.proveedor_id = datos.proveedor_id === null ? null : validarEntero(datos.proveedor_id, 'proveedor_id');
    verificarProveedorActivo(actualizaciones.proveedor_id);
  }
  if (datos.codigo_barras !== undefined) {
    actualizaciones.codigo_barras = validarString(datos.codigo_barras, 'codigo_barras', { requerido: false });
    verificarCodigoBarrasLibre(actualizaciones.codigo_barras, id);
  }
  if (datos.precio_costo !== undefined) {
    actualizaciones.precio_costo = validarEntero(datos.precio_costo, 'precio_costo', { minimo: 0 });
  }
  if (datos.precio_venta !== undefined) {
    actualizaciones.precio_venta = validarEntero(datos.precio_venta, 'precio_venta', { minimo: 0 });
  }

  const claves = Object.keys(actualizaciones);
  if (claves.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');

  const set = claves.map((c) => `${c} = ?`).join(', ');
  const valores = claves.map((c) => actualizaciones[c]);

  db.prepare(`UPDATE productos SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(...valores, id);

  return obtenerProducto(id, { rol });
}

export function eliminarProducto(id) {
  obtenerProductoActivo(id);
  db.prepare('UPDATE productos SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

export function crearLote(productoId, datos) {
  obtenerProductoActivo(productoId);

  const cantidad = validarEntero(datos.cantidad, 'cantidad', { minimo: 1 });
  const fechaIngreso =
    datos.fecha_ingreso !== undefined && datos.fecha_ingreso !== null
      ? validarFecha(datos.fecha_ingreso, 'fecha_ingreso')
      : new Date().toISOString().slice(0, 10);
  const fechaVencimiento = datos.fecha_vencimiento != null ? validarFecha(datos.fecha_vencimiento, 'fecha_vencimiento') : null;

  const resultado = db
    .prepare(`INSERT INTO lotes (producto_id, cantidad, fecha_ingreso, fecha_vencimiento) VALUES (?, ?, ?, ?)`)
    .run(productoId, cantidad, fechaIngreso, fechaVencimiento);

  return db.prepare('SELECT * FROM lotes WHERE id = ?').get(resultado.lastInsertRowid);
}

export function editarLote(productoId, loteId, datos) {
  obtenerProductoActivo(productoId);
  obtenerLoteActivo(productoId, loteId);

  const actualizaciones = {};
  if (datos.cantidad !== undefined) actualizaciones.cantidad = validarEntero(datos.cantidad, 'cantidad', { minimo: 0 });
  if (datos.fecha_ingreso !== undefined) actualizaciones.fecha_ingreso = validarFecha(datos.fecha_ingreso, 'fecha_ingreso');
  if (datos.fecha_vencimiento !== undefined) {
    actualizaciones.fecha_vencimiento =
      datos.fecha_vencimiento === null ? null : validarFecha(datos.fecha_vencimiento, 'fecha_vencimiento');
  }

  const claves = Object.keys(actualizaciones);
  if (claves.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');

  const set = claves.map((c) => `${c} = ?`).join(', ');
  const valores = claves.map((c) => actualizaciones[c]);

  db.prepare(`UPDATE lotes SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(...valores, loteId);

  return db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
}

export function eliminarLote(productoId, loteId) {
  obtenerProductoActivo(productoId);
  obtenerLoteActivo(productoId, loteId);
  db.prepare('UPDATE lotes SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(loteId);
}
