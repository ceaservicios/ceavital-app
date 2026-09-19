import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { existeClienteActivo, registrarAjustePorAnulacion, registrarCargoPorVenta } from './clientes-empresa.service.js';
import { stockDisponible } from './reservas.service.js';
import { sqlDiaNegocio, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
import { mediosPagoPermitidos } from './modulos.service.js';

// 'cta_cte' (B2B Fase 1) es distinto de 'fiado' -- 'fiado' sigue siendo la
// venta fiada informal, sin cliente ni ledger (decisión confirmada con el
// usuario). 'cta_cte' SIEMPRE requiere un cliente_empresa_id real, ver
// validarClienteEmpresa más abajo.
// 'cta_cte' solo se acepta si el plan incluye el módulo de clientes-empresa
// (ver modulos.service.mediosPagoPermitidos).
async function validarMedioPago(valor) {
  const permitidos = await mediosPagoPermitidos();
  if (!permitidos.includes(valor)) {
    throw new ApiError(400, `medio_pago tiene que ser uno de: ${permitidos.join(', ')}`);
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

async function obtenerProductoActivo(productoId) {
  const producto = await db
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
         AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= ${SQL_HOY_NEGOCIO})
       ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC, fecha_ingreso ASC`
    )
    .all(productoId);
}

async function obtenerVentaConItems(ventaId) {
  const venta = await db.prepare('SELECT * FROM ventas WHERE id = ?').get(ventaId);
  if (!venta) throw new ApiError(404, 'Venta no encontrada');

  const items = await db
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
      .prepare(`SELECT * FROM ventas WHERE ${sqlDiaNegocio('creado_en')} = ?::date ORDER BY creado_en DESC`)
      .all(fecha);
  }
  return db.prepare('SELECT * FROM ventas ORDER BY creado_en DESC').all();
}

export function obtenerVenta(id) {
  return obtenerVentaConItems(id);
}

// 'cta_cte' SIEMPRE necesita un cliente-empresa real y activo -- a diferencia
// de 'fiado', que nunca lo pidió (decisión confirmada con el usuario, B2B
// Fase 1: son 2 conceptos separados, no el mismo campo formalizado).
async function validarClienteEmpresa(medioPago, clienteEmpresaId) {
  if (medioPago !== 'cta_cte') return null;
  const id = Number(clienteEmpresaId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, 'cliente_empresa_id es requerido cuando medio_pago es "cta_cte"');
  }
  if (!(await existeClienteActivo(id))) throw new ApiError(404, `Cliente-empresa ${id} no encontrado`);
  return id;
}

// Carrito multi-producto: se registra una sola venta con todos los items al
// cierre (Docs/Instructivo-Funcional.md > Caja > "Armado de venta"). Un mismo
// producto puede necesitar tomarse de mas de un lote (venta_items.lote_id es
// por-lote, no por-producto) -- se reparte en orden FEFO hasta cubrir la
// cantidad pedida.
//
// Solo se puede vender el stock DISPONIBLE: lo vendible menos lo reservado por
// pedidos de clientes-empresa pendientes (B2B Fase 2). Al aprobar un pedido se
// llama a registrarVentaEnTransaccion con su pedidoId (su propia reserva no
// cuenta contra sí misma) y los precios que quedaron congelados al pedir.
//
// registrarVentaEnTransaccion tiene que correr DENTRO de un db.transaction()
// de quien la llama (registrarVenta, o la aprobación de un pedido, que además
// de la venta tiene que actualizar el pedido en la misma transacción).
export async function registrarVentaEnTransaccion(
  { medio_pago, items, cliente_empresa_id },
  { usuarioId, pedidoId = null, preciosCongelados = null }
) {
  const medioPago = await validarMedioPago(medio_pago);
  const clienteEmpresaId = await validarClienteEmpresa(medioPago, cliente_empresa_id);
  const itemsValidados = validarItems(items);

  const ventaResult = await db
    .prepare('INSERT INTO ventas (usuario_id, medio_pago, cliente_empresa_id, total) VALUES (?, ?, ?, 0) RETURNING id')
    .run(usuarioId, medioPago, clienteEmpresaId);
  const ventaId = ventaResult.lastInsertRowid;

  let total = 0;

  for (const { producto_id, cantidad } of itemsValidados) {
    const producto = await obtenerProductoActivo(producto_id);
    const precio = preciosCongelados?.get(producto_id) ?? producto.precio_venta;

    const disponible = await stockDisponible(producto_id, { excluirPedidoId: pedidoId });
    if (cantidad > disponible) {
      throw new ApiError(409, `Stock insuficiente para "${producto.nombre}" (faltan ${cantidad - disponible} unidad/es)`);
    }

    let restante = cantidad;

    for (const lote of await lotesVendiblesFefo(producto_id)) {
      if (restante <= 0) break;
      const tomar = Math.min(lote.cantidad, restante);

      await db
        .prepare('UPDATE lotes SET cantidad = cantidad - ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
        .run(tomar, lote.id);

      const subtotal = tomar * precio;
      await db
        .prepare(
          `INSERT INTO venta_items (venta_id, producto_id, lote_id, cantidad, precio_unitario, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(ventaId, producto_id, lote.id, tomar, precio, subtotal);

      total += subtotal;
      restante -= tomar;
    }

    if (restante > 0) {
      throw new ApiError(409, `Stock insuficiente para "${producto.nombre}" (faltan ${restante} unidad/es)`);
    }
  }

  await db.prepare('UPDATE ventas SET total = ? WHERE id = ?').run(total, ventaId);

  // CARGO automático en la cuenta corriente del cliente (B2B Fase 1,
  // decisión confirmada con el usuario) -- misma transacción que el resto
  // de la venta: si algo de arriba falla (stock insuficiente), el ROLLBACK
  // se lleva también este insert, nunca queda un cargo sin venta real.
  if (clienteEmpresaId) {
    await registrarCargoPorVenta(clienteEmpresaId, { monto: total, ventaId, usuarioId });
  }

  return ventaId;
}

export async function registrarVenta(datos, { usuarioId }) {
  const ventaId = await db.transaction(() => registrarVentaEnTransaccion(datos, { usuarioId }));
  return obtenerVentaConItems(ventaId);
}

export { obtenerVentaConItems };

// "Ventas -- Editar" (Admin+Encargado, matriz de permisos): alcance acotado a
// corregir el medio de pago de una venta ya registrada (confirmado con el
// usuario) -- nunca productos/cantidades/stock, eso es exclusivo de anular.
// No admite entrar ni salir de 'cta_cte' -- ese cambio movería el cargo real
// en la cuenta corriente de un cliente a otro (o lo crearía/borraría), y este
// endpoint nunca tocó nada del ledger. Para corregir un medio_pago='cta_cte'
// mal cargado, anular la venta (revierte el cargo con un AJUSTE) y volver a
// registrarla bien.
export async function editarMedioPago(id, { medio_pago }) {
  const medioPago = await validarMedioPago(medio_pago);

  await db.transaction(async () => {
    const venta = await db.prepare('SELECT id, estado, medio_pago FROM ventas WHERE id = ?').get(id);
    if (!venta) throw new ApiError(404, 'Venta no encontrada');
    if (venta.estado === 'anulada') throw new ApiError(409, 'No se puede editar una venta anulada');
    if (venta.medio_pago === 'cta_cte' || medioPago === 'cta_cte') {
      throw new ApiError(409, 'No se puede editar el medio de pago hacia o desde "cta_cte" -- anulá la venta y volvé a registrarla');
    }

    await db.prepare('UPDATE ventas SET medio_pago = ? WHERE id = ?').run(medioPago, id);
  });

  return obtenerVentaConItems(id);
}

export async function anularVenta(id, { usuarioId }) {
  await db.transaction(async () => {
    const venta = await db
      .prepare('SELECT id, estado, medio_pago, cliente_empresa_id, total FROM ventas WHERE id = ?')
      .get(id);
    if (!venta) throw new ApiError(404, 'Venta no encontrada');
    if (venta.estado === 'anulada') throw new ApiError(409, 'La venta ya está anulada');

    const items = await db.prepare('SELECT lote_id, cantidad FROM venta_items WHERE venta_id = ?').all(id);

    // Reingresa al lote original tal cual, aunque ese lote haya sido dado de
    // baja (soft delete) despues de la venta -- prioriza la trazabilidad real
    // ("de que lote salio") sobre que el stock vuelva a estar vendible
    // automaticamente. Si el lote esta eliminado, la reposicion vendible
    // queda a cargo de un ajuste manual del Admin en Stock.
    for (const item of items) {
      await db
        .prepare('UPDATE lotes SET cantidad = cantidad + ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
        .run(item.cantidad, item.lote_id);
    }

    await db
      .prepare(`UPDATE ventas SET estado = 'anulada', anulada_por = ?, anulada_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(usuarioId, id);

    // Reversión automática del cargo en la cuenta corriente (B2B Fase 1,
    // decisión confirmada con el usuario) -- un AJUSTE nuevo que compensa el
    // CARGO original, nunca se edita/borra el movimiento original (ledger
    // insert-only).
    if (venta.medio_pago === 'cta_cte' && venta.cliente_empresa_id) {
      await registrarAjustePorAnulacion(venta.cliente_empresa_id, {
        monto: -venta.total,
        ventaId: id,
        usuarioId,
      });
    }
  });

  return obtenerVentaConItems(id);
}
