import db from '../db/connection.js';

// Stock reservado por pedidos de clientes-empresa (B2B Fase 2). Un pedido
// 'pendiente' no descuenta ningún lote, pero aparta esas unidades: Caja y el
// portal solo pueden vender/pedir lo que queda disponible. Se calcula siempre
// sumando los items de los pendientes (nunca una columna), mismo criterio que
// stock_total/stock_vendible. Módulo aparte, sin importar otros servicios,
// para que tanto ventas como pedidos lo usen sin dependencia circular.

// Mismo criterio de "vendible" que stock.service.js: lotes activos no vencidos.
export function stockVendible(productoId) {
  const fila = db
    .prepare(
      `SELECT COALESCE(SUM(cantidad), 0) AS total FROM lotes
       WHERE producto_id = ? AND eliminado_en IS NULL
         AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= date('now'))`
    )
    .get(productoId);
  return fila.total;
}

// excluirPedidoId: al aprobar un pedido, su propia reserva no cuenta contra sí mismo.
export function stockReservado(productoId, { excluirPedidoId = null } = {}) {
  const fila = db
    .prepare(
      `SELECT COALESCE(SUM(i.cantidad), 0) AS total
       FROM pedido_cliente_items i
       JOIN pedidos_cliente p ON p.id = i.pedido_id
       WHERE i.producto_id = ? AND p.estado = 'pendiente' AND p.id <> ?`
    )
    .get(productoId, excluirPedidoId ?? 0);
  return fila.total;
}

export function stockDisponible(productoId, opciones = {}) {
  return Math.max(0, stockVendible(productoId) - stockReservado(productoId, opciones));
}

// Catálogo que ve el cliente en su portal: solo lo que puede pedir. Nunca
// expone costo ni ningún dato interno del producto.
export function catalogoConDisponibilidad() {
  const productos = db
    .prepare(
      `SELECT p.id, p.nombre, p.precio_venta, c.nombre AS categoria, u.nombre AS unidad_medida,
         COALESCE(SUM(CASE WHEN l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= date('now') THEN l.cantidad ELSE 0 END), 0) AS stock_vendible
       FROM productos p
       LEFT JOIN lotes l ON l.producto_id = p.id AND l.eliminado_en IS NULL
       LEFT JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN unidades_medida u ON u.id = p.unidad_medida_id
       WHERE p.eliminado_en IS NULL
       GROUP BY p.id
       ORDER BY p.nombre`
    )
    .all();

  const reservado = new Map(
    db
      .prepare(
        `SELECT i.producto_id, SUM(i.cantidad) AS total
         FROM pedido_cliente_items i
         JOIN pedidos_cliente p ON p.id = i.pedido_id
         WHERE p.estado = 'pendiente'
         GROUP BY i.producto_id`
      )
      .all()
      .map((f) => [f.producto_id, f.total])
  );

  return productos.map(({ stock_vendible, ...producto }) => ({
    ...producto,
    stock_disponible: Math.max(0, stock_vendible - (reservado.get(producto.id) ?? 0)),
  }));
}
