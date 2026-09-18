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

// Categoría/unidad de medida pasaron a ser FK reales contra los catálogos
// nuevos (corrección 2026-09-15) -- antes eran texto libre sin ningún
// control ("Kg"/"kg" convivían como 2 valores distintos). Devuelven la fila
// completa (no solo validan) porque productos.categoria/unidad_medida -- las
// columnas de texto libre originales -- siguen existiendo en el esquema con
// unidad_medida NOT NULL (agregada en la migración 004, antes de este
// catálogo) y SQLite no permite relajar un NOT NULL con un ALTER simple ni
// reconstruir la tabla dentro de una transacción con foreign_keys activado
// (migrate.js envuelve cada migración en BEGIN/COMMIT, y foreign_keys no se
// puede togglear con una transacción pendiente) -- en vez de una migración
// riesgosa de reconstrucción de tabla, se mantienen esas 2 columnas viejas
// espejando el nombre de la FK en cada escritura. Nadie las lee más (el
// contrato de la API se arma por JOIN, ver SELECT_PRODUCTOS_CON_STOCK).
function obtenerCategoriaActiva(categoriaId) {
  if (categoriaId === null || categoriaId === undefined) return null;
  const fila = db.prepare('SELECT * FROM categorias WHERE id = ? AND eliminado_en IS NULL').get(categoriaId);
  if (!fila) throw new ApiError(400, 'La categoría indicada no existe o está eliminada');
  return fila;
}

function obtenerUnidadMedidaActiva(unidadMedidaId) {
  const fila = db.prepare('SELECT * FROM unidades_medida WHERE id = ? AND eliminado_en IS NULL').get(unidadMedidaId);
  if (!fila) throw new ApiError(400, 'La unidad de medida indicada no existe o está eliminada');
  return fila;
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
// categoria/unidad_medida acá SIEMPRE salen del JOIN contra los catálogos
// nuevos (no de las columnas de texto libre de productos, que solo se
// mantienen escritas por compatibilidad de esquema -- ver comentario en
// obtenerCategoriaActiva/obtenerUnidadMedidaActiva), así el contrato de la
// API (categoria/unidad_medida como string) no cambia para el frontend. El
// JOIN no filtra por eliminado_en del catálogo a propósito: un producto ya
// cargado con una categoría que después se desactivó sigue mostrando su
// nombre real, no un "—" (mismo espíritu del proyecto: nunca perder historial).
const SELECT_PRODUCTOS_CON_STOCK = `
  SELECT
    p.id, p.nombre, p.codigo_barras, p.precio_costo, p.precio_venta,
    p.proveedor_id, p.stock_minimo, p.dias_aviso_vencimiento,
    p.eliminado_en, p.creado_en, p.actualizado_en,
    p.categoria_id, c.nombre AS categoria,
    p.unidad_medida_id, u.nombre AS unidad_medida,
    COALESCE(SUM(l.cantidad), 0) AS stock_total,
    COALESCE(SUM(CASE WHEN l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= date('now') THEN l.cantidad ELSE 0 END), 0) AS stock_vendible
  FROM productos p
  LEFT JOIN lotes l ON l.producto_id = p.id AND l.eliminado_en IS NULL
  LEFT JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN unidades_medida u ON u.id = p.unidad_medida_id
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
  const codigoBarras = validarString(datos.codigo_barras, 'codigo_barras', { requerido: false });
  const categoriaId = datos.categoria_id != null ? validarEntero(datos.categoria_id, 'categoria_id') : null;
  const unidadMedidaId = validarEntero(datos.unidad_medida_id, 'unidad_medida_id');
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
  const categoria = obtenerCategoriaActiva(categoriaId);
  const unidadMedida = obtenerUnidadMedidaActiva(unidadMedidaId);

  // Lote inicial opcional, directo en la misma alta (corrección 2026-09-15:
  // antes había que crear el producto y recién en un segundo paso separado
  // -- "Ingreso de Nuevo Lote", pensado para reponer stock de un producto YA
  // existente -- cargar el primer lote). Si no se manda (o cantidad es 0),
  // el producto queda creado sin stock -- catálogo cargado antes de que
  // llegue la mercadería sigue siendo un caso válido.
  let loteInicial = null;
  if (datos.lote_inicial != null) {
    if (typeof datos.lote_inicial !== 'object') throw new ApiError(400, 'lote_inicial tiene que ser un objeto');
    // Cantidad vacía/0: se interpreta como "sin lote inicial todavía", no
    // como un error -- catálogo cargado antes de que llegue la mercadería.
    if (Number(datos.lote_inicial.cantidad) > 0) {
      loteInicial = {
        cantidad: validarEntero(datos.lote_inicial.cantidad, 'lote_inicial.cantidad', { minimo: 1 }),
        fecha_ingreso:
          datos.lote_inicial.fecha_ingreso != null
            ? validarFecha(datos.lote_inicial.fecha_ingreso, 'lote_inicial.fecha_ingreso')
            : new Date().toISOString().slice(0, 10),
        fecha_vencimiento:
          datos.lote_inicial.fecha_vencimiento != null
            ? validarFecha(datos.lote_inicial.fecha_vencimiento, 'lote_inicial.fecha_vencimiento')
            : null,
      };
    }
  }

  // Transacción manual (node:sqlite no tiene .transaction() como
  // better-sqlite3): si el lote inicial falla su validación, el producto no
  // queda huérfano creado sin querer.
  db.exec('BEGIN');
  let productoId;
  try {
    const resultado = db
      .prepare(
        `INSERT INTO productos
           (nombre, categoria, codigo_barras, precio_costo, precio_venta, unidad_medida, categoria_id, unidad_medida_id, proveedor_id, stock_minimo, dias_aviso_vencimiento)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nombre,
        categoria?.nombre ?? null,
        codigoBarras,
        precioCosto,
        precioVenta,
        unidadMedida.nombre,
        categoriaId,
        unidadMedidaId,
        proveedorId,
        stockMinimo,
        diasAviso
      );
    productoId = resultado.lastInsertRowid;

    if (loteInicial) {
      db.prepare(`INSERT INTO lotes (producto_id, cantidad, fecha_ingreso, fecha_vencimiento) VALUES (?, ?, ?, ?)`).run(
        productoId,
        loteInicial.cantidad,
        loteInicial.fecha_ingreso,
        loteInicial.fecha_vencimiento
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return obtenerProducto(productoId, { rol });
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
  if (datos.categoria_id !== undefined) {
    actualizaciones.categoria_id = datos.categoria_id === null ? null : validarEntero(datos.categoria_id, 'categoria_id');
    actualizaciones.categoria = obtenerCategoriaActiva(actualizaciones.categoria_id)?.nombre ?? null;
  }
  if (datos.unidad_medida_id !== undefined) {
    actualizaciones.unidad_medida_id = validarEntero(datos.unidad_medida_id, 'unidad_medida_id');
    actualizaciones.unidad_medida = obtenerUnidadMedidaActiva(actualizaciones.unidad_medida_id).nombre;
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
