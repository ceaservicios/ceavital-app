import { formatearMonto } from '../utils/format.js';

export const ETIQUETA_ESTADO = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  cancelado: 'Cancelado',
};

export function EstadoPedido({ estado }) {
  return <span className={`pedido-estado pedido-estado-${estado}`}>{ETIQUETA_ESTADO[estado] ?? estado}</span>;
}

// Tabla de líneas de un pedido, igual para el negocio y para el cliente.
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
            <td>{i.producto_nombre}</td>
            <td className="num">{i.cantidad}</td>
            <td className="num">{formatearMonto(i.precio_unitario)}</td>
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
