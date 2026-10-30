import { formatearMonto } from '../utils/format.js';
import { describirCantidadLinea, formatearCantidad, plural, sufijoPrecio } from '../utils/presentacion.js';

export const ETIQUETA_ESTADO = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  cancelado: 'Cancelado',
};

export function EstadoPedido({ estado }) {
  return <span className={`pedido-estado pedido-estado-${estado}`}>{ETIQUETA_ESTADO[estado] ?? estado}</span>;
}

// Flecha de las filas que se despliegan (pedidos, compras): apunta abajo y gira al abrir.
export function IconoDesplegar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// Tabla de líneas de un pedido, igual para el negocio y para el cliente. Con la venta por
// pack (2026-10-11), la cantidad se muestra como se pidió ("2 Pack x 24") y el precio es el
// de esa presentación.
export function ItemsPedido({ items, total }) {
  return (
    <table className="pedido-items">
      <thead>
        <tr>
          <th>Producto</th>
          <th className="num">Cantidad</th>
          <th className="num">Precio</th>
          <th className="num">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i, idx) => (
          <tr key={i.id ?? idx}>
            <td>
              {i.producto_nombre}
              {i.precio_cantidad_desde && (
                <span className="pedido-cantidad-pack">
                  Precio por cantidad (desde{' '}
                  {i.pack_nombre
                    ? `${i.precio_cantidad_desde} ${plural(i.pack_nombre, i.precio_cantidad_desde)}`
                    : formatearCantidad(i.precio_cantidad_desde, i.medida, { corta: true })}
                  )
                </span>
              )}
            </td>
            <td className="num">{describirCantidadLinea(i)}</td>
            <td className="num">
              {formatearMonto(i.precio_unitario)}
              {!i.pack_nombre && sufijoPrecio(i.medida)}
            </td>
            <td className="num">{formatearMonto(i.subtotal)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3}>Total</td>
          <td className="num">{formatearMonto(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
