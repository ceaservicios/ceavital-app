import db from '../db/connection.js';
import { hoyNegocio, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
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
  // Un campo vacío ("" o solo espacios) es "no cargado", no 0: Number('') vale 0 y un
  // precio en blanco terminaba guardado como $0.
  if (valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '')) {
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
  // El formato solo no alcanza: "2026-99-99" lo cumple. Se comprueba que el día exista.
  const fecha = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
    throw new ApiError(400, `${campo} no es una fecha válida`);
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

// stock_reservado: unidades apartadas por pedidos de clientes-empresa pendientes
// (B2B Fase 2). stock_vendible sigue siendo lo físico no vencido; lo que Caja
// puede vender de verdad es stock_disponible = vendible - reservado.
function conAlerta(producto) {
  return {
    ...producto,
    stock_disponible: Math.max(0, producto.stock_vendible - producto.stock_reservado),
    alerta_stock_bajo: producto.stock_total <= producto.stock_minimo,
  };
}

async function verificarProveedorActivo(proveedorId) {
  if (proveedorId === null || proveedorId === undefined) return;
  const proveedor = await db
    .prepare('SELECT id FROM proveedores WHERE id = ? AND eliminado_en IS NULL')
    .get(proveedorId);
  if (!proveedor) throw new ApiError(400, 'El proveedor indicado no existe o está eliminado');
}

// Categoría y unidad de medida son claves foráneas a los catálogos
// (Configuración): nada de texto libre ("Kg"/"kg" como 2 valores distintos).
async function obtenerCategoriaActiva(categoriaId) {
  if (categoriaId === null || categoriaId === undefined) return null;
  const fila = await db.prepare('SELECT * FROM categorias WHERE id = ? AND eliminado_en IS NULL').get(categoriaId);
  if (!fila) throw new ApiError(400, 'La categoría indicada no existe o está eliminada');
  return fila;
}

async function obtenerUnidadMedidaActiva(unidadMedidaId) {
  const fila = await db
    .prepare('SELECT * FROM unidades_medida WHERE id = ? AND eliminado_en IS NULL')
    .get(unidadMedidaId);
  if (!fila) throw new ApiError(400, 'La unidad de medida indicada no existe o está eliminada');
  return fila;
}

async function verificarCodigoBarrasLibre(codigoBarras, excluirProductoId = null) {
  if (!codigoBarras) return;
  const existente = await db
    .prepare(`SELECT id FROM productos WHERE codigo_barras = ? AND eliminado_en IS NULL AND id != ?`)
    .get(codigoBarras, excluirProductoId ?? -1);
  if (existente) throw new ApiError(409, 'Ya existe un producto activo con ese código de barras');
}

async function obtenerProductoActivo(productoId) {
  const producto = await db.prepare('SELECT id FROM productos WHERE id = ? AND eliminado_en IS NULL').get(productoId);
  if (!producto) throw new ApiError(404, 'Producto no encontrado');
  return producto;
}

async function obtenerLoteActivo(productoId, loteId) {
  const lote = await db
    .prepare('SELECT * FROM lotes WHERE id = ? AND producto_id = ? AND eliminado_en IS NULL')
    .get(loteId, productoId);
  if (!lote) throw new ApiError(404, 'Lote no encontrado');
  return lote;
}

// stock_total: suma de todos los lotes activos. stock_vendible: igual pero
// excluyendo lotes vencidos (Docs\Modelo-de-Datos.md > productos/lotes). "Vencido"
// se mide contra el día de hoy en Argentina. categoria/unidad_medida salen del
// JOIN contra los catálogos (contrato de la API: strings). El JOIN no filtra
// por eliminado_en del catálogo a propósito: un producto ya cargado con una
// categoría que después se desactivó sigue mostrando su nombre real, no un "—"
// (mismo espíritu del proyecto: nunca perder historial).
const SELECT_PRODUCTOS_CON_STOCK = `
  SELECT
    p.id, p.nombre, p.codigo_barras, p.precio_costo, p.precio_venta,
    p.proveedor_id, p.stock_minimo, p.dias_aviso_vencimiento,
    p.eliminado_en, p.creado_en, p.actualizado_en,
    p.categoria_id, c.nombre AS categoria,
    p.unidad_medida_id, u.nombre AS unidad_medida,
    COALESCE(SUM(l.cantidad), 0) AS stock_total,
    COALESCE(SUM(CASE WHEN l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= ${SQL_HOY_NEGOCIO} THEN l.cantidad ELSE 0 END), 0) AS stock_vendible,
    COALESCE((
      SELECT SUM(i.cantidad) FROM pedido_cliente_items i
      JOIN pedidos_cliente pc ON pc.id = i.pedido_id
      WHERE i.producto_id = p.id AND pc.estado = 'pendiente'
    ), 0) AS stock_reservado
  FROM productos p
  LEFT JOIN lotes l ON l.producto_id = p.id AND l.eliminado_en IS NULL
  LEFT JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN unidades_medida u ON u.id = p.unidad_medida_id
`;

export async function listarProductos({ rol, buscar, codigoBarras }) {
  const condiciones = ['p.eliminado_en IS NULL'];
  const params = [];

  if (codigoBarras) {
    condiciones.push('p.codigo_barras = ?');
    params.push(codigoBarras);
  } else if (buscar) {
    condiciones.push('(p.nombre ILIKE ? OR p.codigo_barras ILIKE ?)');
    params.push(`%${buscar}%`, `%${buscar}%`);
  }

  const sql = `${SELECT_PRODUCTOS_CON_STOCK} WHERE ${condiciones.join(' AND ')} GROUP BY p.id, c.id, u.id ORDER BY LOWER(p.nombre)`;
  const productos = await db.prepare(sql).all(...params);

  return productos.map((p) => ocultarCosto(conAlerta(p), rol));
}

export async function obtenerProducto(id, { rol }) {
  const producto = await db
    .prepare(`${SELECT_PRODUCTOS_CON_STOCK} WHERE p.id = ? AND p.eliminado_en IS NULL GROUP BY p.id, c.id, u.id`)
    .get(id);
  if (!producto) throw new ApiError(404, 'Producto no encontrado');

  // Orden FEFO: primero los lotes con fecha de vencimiento (el que vence
  // antes, primero); los que no tienen fecha (no perecederos) van al final,
  // ordenados entre si por fecha_ingreso (FIFO). "(fecha_vencimiento IS NULL)"
  // es false/true -- ordenar ASC deja primero a los que SI tienen fecha.
  const lotes = await db
    .prepare(
      `SELECT *, (fecha_vencimiento IS NOT NULL AND fecha_vencimiento < ${SQL_HOY_NEGOCIO}) AS vencido
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

export async function crearProducto(datos, { rol }) {
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
    // Un valor no numérico (ej. "abc") ya no se ignora en silencio: cae en
    // validarEntero y responde 400. Solo vacío/0 significa "sin lote todavía".
    const cantidadCargada = datos.lote_inicial.cantidad;
    const sinLote = cantidadCargada == null || cantidadCargada === '' || Number(cantidadCargada) === 0;
    if (!sinLote) {
      loteInicial = {
        cantidad: validarEntero(datos.lote_inicial.cantidad, 'lote_inicial.cantidad', { minimo: 1 }),
        fecha_ingreso:
          datos.lote_inicial.fecha_ingreso != null
            ? validarFecha(datos.lote_inicial.fecha_ingreso, 'lote_inicial.fecha_ingreso')
            : hoyNegocio(),
        fecha_vencimiento:
          datos.lote_inicial.fecha_vencimiento != null
            ? validarFecha(datos.lote_inicial.fecha_vencimiento, 'lote_inicial.fecha_vencimiento')
            : null,
      };
    }
  }

  // Todo en una transacción: si algo falla, el producto no queda huérfano
  // creado sin querer (ni sin su lote inicial).
  const productoId = await db.transaction(async () => {
    await verificarProveedorActivo(proveedorId);
    await verificarCodigoBarrasLibre(codigoBarras);
    await obtenerCategoriaActiva(categoriaId);
    await obtenerUnidadMedidaActiva(unidadMedidaId);

    const producto = await db
      .prepare(
        `INSERT INTO productos
           (nombre, codigo_barras, precio_costo, precio_venta, categoria_id, unidad_medida_id, proveedor_id, stock_minimo, dias_aviso_vencimiento)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`
      )
      .get(nombre, codigoBarras, precioCosto, precioVenta, categoriaId, unidadMedidaId, proveedorId, stockMinimo, diasAviso);

    if (loteInicial) {
      await db
        .prepare(`INSERT INTO lotes (producto_id, cantidad, fecha_ingreso, fecha_vencimiento) VALUES (?, ?, ?, ?)`)
        .run(producto.id, loteInicial.cantidad, loteInicial.fecha_ingreso, loteInicial.fecha_vencimiento);
    }
    return producto.id;
  });

  return obtenerProducto(productoId, { rol });
}

export async function editarProducto(id, datos, { rol }) {
  // "Precios (costo/venta) -- Editar" es exclusivo del Admin (distinto de
  // "Stock -- Editar: alta, lotes, ajustes", que incluye tambien al Encargado).
  const tocaPrecios = CAMPOS_PRECIO.some((c) => datos[c] !== undefined);

  await db.transaction(async () => {
    await obtenerProductoActivo(id);

    if (tocaPrecios && rol !== 'admin') {
      throw new ApiError(403, 'Solo el Admin puede editar precios (costo/venta)');
    }

    const actualizaciones = {};

    if (datos.nombre !== undefined) actualizaciones.nombre = validarString(datos.nombre, 'nombre');
    if (datos.categoria_id !== undefined) {
      actualizaciones.categoria_id = datos.categoria_id === null ? null : validarEntero(datos.categoria_id, 'categoria_id');
      await obtenerCategoriaActiva(actualizaciones.categoria_id);
    }
    if (datos.unidad_medida_id !== undefined) {
      actualizaciones.unidad_medida_id = validarEntero(datos.unidad_medida_id, 'unidad_medida_id');
      await obtenerUnidadMedidaActiva(actualizaciones.unidad_medida_id);
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
      await verificarProveedorActivo(actualizaciones.proveedor_id);
    }
    if (datos.codigo_barras !== undefined) {
      actualizaciones.codigo_barras = validarString(datos.codigo_barras, 'codigo_barras', { requerido: false });
      await verificarCodigoBarrasLibre(actualizaciones.codigo_barras, id);
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

    await db
      .prepare(`UPDATE productos SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...valores, id);
  });

  return obtenerProducto(id, { rol });
}

export async function eliminarProducto(id) {
  await obtenerProductoActivo(id);
  await db.prepare('UPDATE productos SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

export async function crearLote(productoId, datos) {
  const cantidad = validarEntero(datos.cantidad, 'cantidad', { minimo: 1 });
  const fechaIngreso =
    datos.fecha_ingreso !== undefined && datos.fecha_ingreso !== null
      ? validarFecha(datos.fecha_ingreso, 'fecha_ingreso')
      : hoyNegocio();
  const fechaVencimiento = datos.fecha_vencimiento != null ? validarFecha(datos.fecha_vencimiento, 'fecha_vencimiento') : null;

  return db.transaction(async () => {
    await obtenerProductoActivo(productoId);
    return db
      .prepare(
        `INSERT INTO lotes (producto_id, cantidad, fecha_ingreso, fecha_vencimiento) VALUES (?, ?, ?, ?) RETURNING *`
      )
      .get(productoId, cantidad, fechaIngreso, fechaVencimiento);
  });
}

export async function editarLote(productoId, loteId, datos) {
  return db.transaction(async () => {
    await obtenerProductoActivo(productoId);
    await obtenerLoteActivo(productoId, loteId);

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

    return db
      .prepare(`UPDATE lotes SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`)
      .get(...valores, loteId);
  });
}

export async function eliminarLote(productoId, loteId) {
  await obtenerProductoActivo(productoId);
  await obtenerLoteActivo(productoId, loteId);
  await db.prepare('UPDATE lotes SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(loteId);
}
