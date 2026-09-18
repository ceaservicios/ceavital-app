import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

const ESTADOS_PEDIDO = ['realizado', 'pendiente', 'recibido', 'cancelado'];

function validarString(valor, campo, { requerido = true } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ApiError(400, `${campo} es requerido`);
    return null;
  }
  if (typeof valor !== 'string') throw new ApiError(400, `${campo} tiene que ser texto`);
  return valor.trim();
}

function validarEntero(valor, campo, { minimo = null } = {}) {
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

function validarEstado(valor) {
  if (!ESTADOS_PEDIDO.includes(valor)) {
    throw new ApiError(400, `estado tiene que ser uno de: ${ESTADOS_PEDIDO.join(', ')}`);
  }
  return valor;
}

function obtenerProveedorActivo(id) {
  const proveedor = db.prepare('SELECT * FROM proveedores WHERE id = ? AND eliminado_en IS NULL').get(id);
  if (!proveedor) throw new ApiError(404, 'Proveedor no encontrado');
  return proveedor;
}

// "Productos que provee" (Docs/Instructivo-Funcional.md > Proveedores): el
// vinculo real es productos.proveedor_id, definido desde Stock. No se incluye
// precio_costo -- este endpoint es Admin+Encargado, y Encargado nunca ve
// costos (misma regla que stock.service.js.ocultarCosto).
function productosDelProveedor(proveedorId) {
  return db
    .prepare(
      `SELECT id, nombre, codigo_barras, precio_venta
       FROM productos WHERE proveedor_id = ? AND eliminado_en IS NULL ORDER BY nombre`
    )
    .all(proveedorId);
}

export function listarProveedores({ buscar } = {}) {
  if (buscar) {
    return db
      .prepare('SELECT * FROM proveedores WHERE eliminado_en IS NULL AND nombre LIKE ? ORDER BY nombre')
      .all(`%${buscar}%`);
  }
  return db.prepare('SELECT * FROM proveedores WHERE eliminado_en IS NULL ORDER BY nombre').all();
}

export function obtenerProveedor(id) {
  const proveedor = obtenerProveedorActivo(id);
  return { ...proveedor, productos: productosDelProveedor(id) };
}

export function crearProveedor(datos) {
  const nombre = validarString(datos.nombre, 'nombre');
  const telefono = validarString(datos.telefono, 'telefono', { requerido: false });
  const email = validarString(datos.email, 'email', { requerido: false });
  const condicionPago = validarString(datos.condicion_pago, 'condicion_pago', { requerido: false });

  const resultado = db
    .prepare('INSERT INTO proveedores (nombre, telefono, email, condicion_pago) VALUES (?, ?, ?, ?)')
    .run(nombre, telefono, email, condicionPago);

  return obtenerProveedor(resultado.lastInsertRowid);
}

export function editarProveedor(id, datos) {
  obtenerProveedorActivo(id);

  const actualizaciones = {};
  if (datos.nombre !== undefined) actualizaciones.nombre = validarString(datos.nombre, 'nombre');
  if (datos.telefono !== undefined) {
    actualizaciones.telefono = validarString(datos.telefono, 'telefono', { requerido: false });
  }
  if (datos.email !== undefined) {
    actualizaciones.email = validarString(datos.email, 'email', { requerido: false });
  }
  if (datos.condicion_pago !== undefined) {
    actualizaciones.condicion_pago = validarString(datos.condicion_pago, 'condicion_pago', { requerido: false });
  }

  const claves = Object.keys(actualizaciones);
  if (claves.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');

  const set = claves.map((c) => `${c} = ?`).join(', ');
  const valores = claves.map((c) => actualizaciones[c]);

  db.prepare(`UPDATE proveedores SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(...valores, id);

  return obtenerProveedor(id);
}

export function eliminarProveedor(id) {
  obtenerProveedorActivo(id);
  db.prepare('UPDATE proveedores SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

// -- Pedidos a proveedor --

function obtenerPedidoActivo(proveedorId, pedidoId) {
  const pedido = db
    .prepare('SELECT * FROM pedidos_proveedor WHERE id = ? AND proveedor_id = ? AND eliminado_en IS NULL')
    .get(pedidoId, proveedorId);
  if (!pedido) throw new ApiError(404, 'Pedido no encontrado');
  return pedido;
}

function obtenerPedidoConItems(pedidoId) {
  const pedido = db.prepare('SELECT * FROM pedidos_proveedor WHERE id = ?').get(pedidoId);
  const items = db
    .prepare(
      `SELECT pi.*, p.nombre AS producto_nombre
       FROM pedido_items pi JOIN productos p ON p.id = pi.producto_id
       WHERE pi.pedido_id = ?`
    )
    .all(pedidoId);
  return { ...pedido, items };
}

function validarItemsPedido(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'items es requerido y tiene que tener al menos un producto');
  }
  return items.map((item, i) => ({
    producto_id: validarEntero(item?.producto_id, `items[${i}].producto_id`, { minimo: 1 }),
    cantidad: validarEntero(item?.cantidad, `items[${i}].cantidad`, { minimo: 1 }),
  }));
}

export function listarPedidos(proveedorId) {
  obtenerProveedorActivo(proveedorId);
  return db
    .prepare(
      'SELECT * FROM pedidos_proveedor WHERE proveedor_id = ? AND eliminado_en IS NULL ORDER BY fecha DESC, id DESC'
    )
    .all(proveedorId);
}

export function obtenerPedido(proveedorId, pedidoId) {
  obtenerPedidoActivo(proveedorId, pedidoId);
  return obtenerPedidoConItems(pedidoId);
}

// "Recepción: marcar un pedido como recibido es un registro administrativo --
// NO genera automáticamente un lote nuevo en Stock" (Docs/Instructivo-Funcional.md).
// Por eso crear/editar un pedido acá nunca toca productos/lotes.
export function crearPedido(proveedorId, datos, { usuarioId }) {
  obtenerProveedorActivo(proveedorId);

  const items = validarItemsPedido(datos.items);
  const fecha = datos.fecha != null ? validarFecha(datos.fecha, 'fecha') : new Date().toISOString().slice(0, 10);
  const estado = datos.estado != null ? validarEstado(datos.estado) : 'realizado';

  for (const { producto_id } of items) {
    const producto = db.prepare('SELECT id FROM productos WHERE id = ? AND eliminado_en IS NULL').get(producto_id);
    if (!producto) throw new ApiError(400, `El producto ${producto_id} no existe o está eliminado`);
  }

  db.exec('BEGIN');
  try {
    const resultado = db
      .prepare('INSERT INTO pedidos_proveedor (proveedor_id, usuario_id, estado, fecha) VALUES (?, ?, ?, ?)')
      .run(proveedorId, usuarioId, estado, fecha);
    const pedidoId = resultado.lastInsertRowid;

    for (const { producto_id, cantidad } of items) {
      db.prepare('INSERT INTO pedido_items (pedido_id, producto_id, cantidad) VALUES (?, ?, ?)').run(
        pedidoId,
        producto_id,
        cantidad
      );
    }

    db.exec('COMMIT');
    return obtenerPedidoConItems(pedidoId);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Alcance acotado a estado/fecha (lo único que el instructivo describe como
// editable de un pedido ya creado) -- no reabre productos/cantidades, eso
// requiere cancelar y crear un pedido nuevo.
export function editarPedido(proveedorId, pedidoId, datos) {
  obtenerPedidoActivo(proveedorId, pedidoId);

  const actualizaciones = {};
  if (datos.estado !== undefined) actualizaciones.estado = validarEstado(datos.estado);
  if (datos.fecha !== undefined) actualizaciones.fecha = validarFecha(datos.fecha, 'fecha');

  const claves = Object.keys(actualizaciones);
  if (claves.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');

  const set = claves.map((c) => `${c} = ?`).join(', ');
  const valores = claves.map((c) => actualizaciones[c]);

  db.prepare(`UPDATE pedidos_proveedor SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(
    ...valores,
    pedidoId
  );

  return obtenerPedidoConItems(pedidoId);
}

// Soft delete = corrección de un pedido mal cargado (dato erróneo), distinto
// de estado='cancelado' (acción de negocio real: el pedido no se concretó).
// Mismo criterio que lotes.eliminado_en (Docs/Modelo-de-Datos.md > lotes).
export function eliminarPedido(proveedorId, pedidoId) {
  obtenerPedidoActivo(proveedorId, pedidoId);
  db.prepare('UPDATE pedidos_proveedor SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(pedidoId);
}
