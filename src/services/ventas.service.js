import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

const MEDIOS_PAGO = ['efectivo', 'tarjeta', 'transferencia_qr', 'mercado_pago', 'fiado'];

function validarMedioPago(valor) {
  if (!MEDIOS_PAGO.includes(valor)) {
    throw new ApiError(400, `medio_pago tiene que ser uno de: ${MEDIOS_PAGO.join(', ')}`);
  }
  return valor;
}

function validarEntero(valor, campo, { minimo = null } = {}) {
  const n = Number(valor);
  if (!Number.isInteger(n)) throw new ApiError(400, `${campo} tiene que ser un número entero`);
  if (minimo !== null && n < minimo) throw new ApiError(400, `${campo} no puede ser menor a ${minimo}`);
  return n;
}

function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'items es requerido y tiene que tener al menos un producto');
  }
  return items.map((item, i) => ({
    producto_id: validarEntero(item?.producto_id, `items[${i}].producto_id`, { minimo: 1 }),
    cantidad: validarEntero(item?.cantidad, `items[${i}].cantidad`, { minimo: 1 }),
  }));
}

function obtenerProductoActivo(productoId) {
  const producto = db
    .prepare('SELECT id, nombre, precio_venta FROM productos WHERE id = ? AND eliminado_en IS NULL')
    .get(productoId);
  if (!producto) throw new ApiError(404, `Producto ${productoId} no encontrado`);
  return producto;
}

// Mismo criterio FEFO que Stock (stock.service.js): el lote que vence antes
// primero, los sin vencimiento al final ordenados por fecha_ingreso (FIFO).
// Excluye lotes vencidos -- un lote vencido no es "stock_vendible", no se
// puede descontar de ahí en una venta nueva.
function lotesVendiblesFefo(productoId) {
  return db
    .prepare(
      `SELECT id, cantidad FROM lotes
       WHERE producto_id = ? AND eliminado_en IS NULL AND cantidad > 0
         AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= date('now'))
       ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC, fecha_ingreso ASC`
    )
    .all(productoId);
}

function obtenerVentaConItems(ventaId) {
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(ventaId);
  if (!venta) throw new ApiError(404, 'Venta no encontrada');

  const items = db
    .prepare(
      `SELECT vi.*, p.nombre AS producto_nombre
       FROM venta_items vi
       JOIN productos p ON p.id = vi.producto_id
       WHERE vi.venta_id = ?`
    )
    .all(ventaId);

  return { ...venta, items };
}

export function listarVentas({ fecha } = {}) {
  if (fecha) {
    return db
      .prepare(`SELECT * FROM ventas WHERE date(creado_en) = ? ORDER BY creado_en DESC`)
      .all(fecha);
  }
  return db.prepare('SELECT * FROM ventas ORDER BY creado_en DESC').all();
}

export function obtenerVenta(id) {
  return obtenerVentaConItems(id);
}

// Carrito multi-producto: se registra una sola venta con todos los items al
// cierre (Docs/Instructivo-Funcional.md > Caja > "Armado de venta"). Un mismo
// producto puede necesitar tomarse de mas de un lote (venta_items.lote_id es
// por-lote, no por-producto) -- se reparte en orden FEFO hasta cubrir la
// cantidad pedida.
export function registrarVenta({ medio_pago, items }, { usuarioId }) {
  const medioPago = validarMedioPago(medio_pago);
  const itemsValidados = validarItems(items);

  db.exec('BEGIN');
  try {
    const ventaResult = db
      .prepare('INSERT INTO ventas (usuario_id, medio_pago, total) VALUES (?, ?, 0)')
      .run(usuarioId, medioPago);
    const ventaId = ventaResult.lastInsertRowid;

    let total = 0;

    for (const { producto_id, cantidad } of itemsValidados) {
      const producto = obtenerProductoActivo(producto_id);
      let restante = cantidad;

      for (const lote of lotesVendiblesFefo(producto_id)) {
        if (restante <= 0) break;
        const tomar = Math.min(lote.cantidad, restante);

        db.prepare(
          'UPDATE lotes SET cantidad = cantidad - ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(tomar, lote.id);

        const subtotal = tomar * producto.precio_venta;
        db.prepare(
          `INSERT INTO venta_items (venta_id, producto_id, lote_id, cantidad, precio_unitario, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(ventaId, producto_id, lote.id, tomar, producto.precio_venta, subtotal);

        total += subtotal;
        restante -= tomar;
      }

      if (restante > 0) {
        throw new ApiError(409, `Stock insuficiente para "${producto.nombre}" (faltan ${restante} unidad/es)`);
      }
    }

    db.prepare('UPDATE ventas SET total = ? WHERE id = ?').run(total, ventaId);
    db.exec('COMMIT');
    return obtenerVentaConItems(ventaId);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// "Ventas -- Editar" (Admin+Encargado, matriz de permisos): alcance acotado a
// corregir el medio de pago de una venta ya registrada (confirmado con el
// usuario) -- nunca productos/cantidades/stock, eso es exclusivo de anular.
export function editarMedioPago(id, { medio_pago }) {
  const medioPago = validarMedioPago(medio_pago);

  const venta = db.prepare('SELECT id, estado FROM ventas WHERE id = ?').get(id);
  if (!venta) throw new ApiError(404, 'Venta no encontrada');
  if (venta.estado === 'anulada') throw new ApiError(409, 'No se puede editar una venta anulada');

  db.prepare('UPDATE ventas SET medio_pago = ? WHERE id = ?').run(medioPago, id);
  return obtenerVentaConItems(id);
}

export function anularVenta(id, { usuarioId }) {
  const venta = db.prepare('SELECT id, estado FROM ventas WHERE id = ?').get(id);
  if (!venta) throw new ApiError(404, 'Venta no encontrada');
  if (venta.estado === 'anulada') throw new ApiError(409, 'La venta ya está anulada');

  db.exec('BEGIN');
  try {
    const items = db.prepare('SELECT lote_id, cantidad FROM venta_items WHERE venta_id = ?').all(id);

    // Reingresa al lote original tal cual, aunque ese lote haya sido dado de
    // baja (soft delete) despues de la venta -- prioriza la trazabilidad real
    // ("de que lote salio") sobre que el stock vuelva a estar vendible
    // automaticamente. Si el lote esta eliminado, la reposicion vendible
    // queda a cargo de un ajuste manual del Admin en Stock.
    for (const item of items) {
      db.prepare(
        'UPDATE lotes SET cantidad = cantidad + ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(item.cantidad, item.lote_id);
    }

    db.prepare(
      `UPDATE ventas SET estado = 'anulada', anulada_por = ?, anulada_en = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(usuarioId, id);

    db.exec('COMMIT');
    return obtenerVentaConItems(id);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
