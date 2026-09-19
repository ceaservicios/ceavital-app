import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { existeClienteActivo } from './clientes-empresa.service.js';
import { stockDisponible } from './reservas.service.js';
import { obtenerVentaConItems, registrarVentaEnTransaccion } from './ventas.service.js';

// Pedidos de clientes-empresa (B2B Fase 2). Los arma el cliente desde su
// portal; el negocio (Admin + Encargado) los aprueba o rechaza.
//   pendiente -> aprobado   (genera una venta 'cta_cte': descuenta lotes FEFO
//                            y carga la deuda en la cuenta corriente)
//   pendiente -> rechazado  (el negocio, con motivo; libera la reserva)
//   pendiente -> cancelado  (el propio cliente; libera la reserva)
// Mientras está pendiente, el pedido reserva stock (ver reservas.service.js).

const MAX_ITEMS = 100;
const MAX_CANTIDAD = 100000;
// Tope para que un cliente no pueda apartar todo el stock con pedidos que
// nunca se resuelven: el pedido pendiente reserva unidades reales.
const MAX_PENDIENTES_POR_CLIENTE = 10;
const MAX_TEXTO = 500;

function textoOpcional(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string') throw new ApiError(400, `${campo} tiene que ser texto`);
  const limpio = valor.trim();
  if (limpio.length > MAX_TEXTO) throw new ApiError(400, `${campo} no puede superar ${MAX_TEXTO} caracteres`);
  return limpio || null;
}

// Junta las líneas repetidas de un mismo producto en una sola, así la validación
// de stock compara contra la cantidad total pedida de ese producto.
function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'El pedido tiene que tener al menos un producto');
  }
  if (items.length > MAX_ITEMS) throw new ApiError(400, `Un pedido no puede tener más de ${MAX_ITEMS} líneas`);

  const porProducto = new Map();
  items.forEach((item, i) => {
    const productoId = Number(item?.producto_id);
    const cantidad = Number(item?.cantidad);
    if (!Number.isInteger(productoId) || productoId <= 0) throw new ApiError(400, `items[${i}].producto_id inválido`);
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      throw new ApiError(400, `items[${i}].cantidad tiene que ser un número entero mayor a 0`);
    }
    porProducto.set(productoId, (porProducto.get(productoId) ?? 0) + cantidad);
  });

  for (const cantidad of porProducto.values()) {
    if (cantidad > MAX_CANTIDAD) throw new ApiError(400, `La cantidad de un producto no puede superar ${MAX_CANTIDAD}`);
  }
  return [...porProducto.entries()].map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
}

function itemsDe(pedidoId) {
  return db
    .prepare(
      `SELECT i.id, i.producto_id, p.nombre AS producto_nombre, i.cantidad, i.precio_unitario, i.subtotal
       FROM pedido_cliente_items i
       JOIN productos p ON p.id = i.producto_id
       WHERE i.pedido_id = ?
       ORDER BY i.id`
    )
    .all(pedidoId);
}

const SELECT_PEDIDO = `
  SELECT pc.id, pc.cliente_empresa_id, ce.razon_social AS cliente_razon_social, pc.estado, pc.total,
         pc.observaciones, pc.motivo_rechazo, pc.venta_id, v.estado AS venta_estado,
         pc.resuelto_por, u.nombre AS resuelto_por_nombre, pc.resuelto_en, pc.creado_en,
         (SELECT COUNT(*) FROM pedido_cliente_items i WHERE i.pedido_id = pc.id) AS cantidad_lineas
  FROM pedidos_cliente pc
  JOIN clientes_empresa ce ON ce.id = pc.cliente_empresa_id
  LEFT JOIN ventas v ON v.id = pc.venta_id
  LEFT JOIN usuarios u ON u.id = pc.resuelto_por
`;

async function pedidoConItems(id, { clienteId = null } = {}) {
  const pedido = await db.prepare(`${SELECT_PEDIDO} WHERE pc.id = ?`).get(id);
  // Un cliente que pide un pedido ajeno recibe el mismo 404 que uno inexistente.
  if (!pedido || (clienteId !== null && pedido.cliente_empresa_id !== clienteId)) {
    throw new ApiError(404, 'Pedido no encontrado');
  }
  return { ...pedido, items: await itemsDe(id) };
}

// -- Lado del negocio (Admin + Encargado) --

const ESTADOS = ['pendiente', 'aprobado', 'rechazado', 'cancelado'];

export function listarPedidos({ estado } = {}) {
  if (estado !== undefined && !ESTADOS.includes(estado)) {
    throw new ApiError(400, `estado tiene que ser uno de: ${ESTADOS.join(', ')}`);
  }
  return estado
    ? db.prepare(`${SELECT_PEDIDO} WHERE pc.estado = ? ORDER BY pc.id DESC`).all(estado)
    : db.prepare(`${SELECT_PEDIDO} ORDER BY pc.id DESC`).all();
}

export function obtenerPedido(id) {
  return pedidoConItems(id);
}

export async function aprobarPedido(id, { usuarioId }) {
  const ventaId = await db.transaction(async () => {
    const pedido = await db.prepare('SELECT id, estado, cliente_empresa_id FROM pedidos_cliente WHERE id = ?').get(id);
    if (!pedido) throw new ApiError(404, 'Pedido no encontrado');
    if (pedido.estado !== 'pendiente') throw new ApiError(409, `El pedido ya está ${pedido.estado}`);
    if (!(await existeClienteActivo(pedido.cliente_empresa_id))) {
      throw new ApiError(409, 'El cliente fue dado de baja: no se puede aprobar el pedido');
    }

    const items = await itemsDe(id);
    const idVenta = await registrarVentaEnTransaccion(
      {
        medio_pago: 'cta_cte',
        cliente_empresa_id: pedido.cliente_empresa_id,
        items: items.map(({ producto_id, cantidad }) => ({ producto_id, cantidad })),
      },
      {
        usuarioId,
        pedidoId: id,
        // El cliente paga el precio que vio al pedir, aunque haya cambiado desde entonces.
        preciosCongelados: new Map(items.map((i) => [i.producto_id, i.precio_unitario])),
      }
    );

    await db
      .prepare(
        `UPDATE pedidos_cliente
         SET estado = 'aprobado', venta_id = ?, resuelto_por = ?, resuelto_en = CURRENT_TIMESTAMP,
             actualizado_en = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(idVenta, usuarioId, id);

    return idVenta;
  });

  return { pedido: await pedidoConItems(id), venta: await obtenerVentaConItems(ventaId) };
}

export async function rechazarPedido(id, { motivo }, { usuarioId }) {
  const motivoLimpio = textoOpcional(motivo, 'motivo');
  if (!motivoLimpio) throw new ApiError(400, 'El motivo del rechazo es requerido (lo ve el cliente)');

  await db.transaction(async () => {
    const pedido = await db.prepare('SELECT id, estado FROM pedidos_cliente WHERE id = ?').get(id);
    if (!pedido) throw new ApiError(404, 'Pedido no encontrado');
    if (pedido.estado !== 'pendiente') throw new ApiError(409, `El pedido ya está ${pedido.estado}`);

    await db
      .prepare(
        `UPDATE pedidos_cliente
         SET estado = 'rechazado', motivo_rechazo = ?, resuelto_por = ?, resuelto_en = CURRENT_TIMESTAMP,
             actualizado_en = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(motivoLimpio, usuarioId, id);
  });

  return pedidoConItems(id);
}

// -- Lado del cliente (portal). Todo se resuelve contra el cliente de la
// sesión, nunca contra un id que venga del pedido.

export async function crearPedidoDelCliente(clienteId, { items, observaciones }) {
  const lineas = validarItems(items);
  const obs = textoOpcional(observaciones, 'observaciones');

  const pedidoId = await db.transaction(async () => {
    // Sin esto, un cliente podría apartar todo el stock con pedidos sin resolver.
    const { pendientes } = await db
      .prepare(`SELECT COUNT(*) AS pendientes FROM pedidos_cliente WHERE cliente_empresa_id = ? AND estado = 'pendiente'`)
      .get(clienteId);
    if (pendientes >= MAX_PENDIENTES_POR_CLIENTE) {
      throw new ApiError(
        409,
        `Ya tenés ${MAX_PENDIENTES_POR_CLIENTE} pedidos pendientes. Esperá a que el negocio los resuelva o cancelá alguno.`
      );
    }

    let total = 0;
    const armadas = [];
    for (const { producto_id, cantidad } of lineas) {
      const producto = await db
        .prepare('SELECT id, nombre, precio_venta FROM productos WHERE id = ? AND eliminado_en IS NULL')
        .get(producto_id);
      if (!producto) throw new ApiError(404, `El producto ${producto_id} ya no está disponible`);

      const disponible = await stockDisponible(producto_id);
      if (cantidad > disponible) {
        throw new ApiError(409, `No hay stock suficiente de "${producto.nombre}" (disponible: ${disponible})`);
      }

      const subtotal = cantidad * producto.precio_venta;
      total += subtotal;
      armadas.push({ producto_id, cantidad, precio_unitario: producto.precio_venta, subtotal });
    }

    const { lastInsertRowid } = await db
      .prepare('INSERT INTO pedidos_cliente (cliente_empresa_id, total, observaciones) VALUES (?, ?, ?) RETURNING id')
      .run(clienteId, total, obs);

    const insertarItem = db.prepare(
      `INSERT INTO pedido_cliente_items (pedido_id, producto_id, cantidad, precio_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const l of armadas) {
      await insertarItem.run(lastInsertRowid, l.producto_id, l.cantidad, l.precio_unitario, l.subtotal);
    }

    return lastInsertRowid;
  });

  return pedidoDelCliente(clienteId, pedidoId);
}

// Lo que ve el cliente de un pedido: sin datos internos (quién lo resolvió, id de venta).
function soloParaElCliente(pedido) {
  return {
    id: pedido.id,
    estado: pedido.estado,
    total: pedido.total,
    observaciones: pedido.observaciones,
    motivo_rechazo: pedido.motivo_rechazo,
    cantidad_lineas: pedido.cantidad_lineas,
    creado_en: pedido.creado_en,
    resuelto_en: pedido.resuelto_en,
    ...(pedido.items && {
      items: pedido.items.map(({ producto_nombre, cantidad, precio_unitario, subtotal }) => ({
        producto_nombre,
        cantidad,
        precio_unitario,
        subtotal,
      })),
    }),
  };
}

export async function listarPedidosDelCliente(clienteId) {
  const filas = await db.prepare(`${SELECT_PEDIDO} WHERE pc.cliente_empresa_id = ? ORDER BY pc.id DESC`).all(clienteId);
  return filas.map(soloParaElCliente);
}

export async function pedidoDelCliente(clienteId, id) {
  return soloParaElCliente(await pedidoConItems(id, { clienteId }));
}

export async function cancelarPedidoDelCliente(clienteId, id) {
  await db.transaction(async () => {
    const pedido = await db.prepare('SELECT id, estado, cliente_empresa_id FROM pedidos_cliente WHERE id = ?').get(id);
    if (!pedido || pedido.cliente_empresa_id !== clienteId) throw new ApiError(404, 'Pedido no encontrado');
    if (pedido.estado !== 'pendiente') throw new ApiError(409, `El pedido ya está ${pedido.estado}: no se puede cancelar`);

    await db
      .prepare(
        `UPDATE pedidos_cliente
         SET estado = 'cancelado', resuelto_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(id);
  });

  return pedidoDelCliente(clienteId, id);
}
