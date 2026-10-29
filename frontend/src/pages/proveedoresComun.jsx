import { formatearFecha, formatearMonto, fechaHoyISO } from '../utils/format.js';
import { describirCantidadLinea, sufijoPrecio } from '../utils/presentacion.js';

// Piezas compartidas por la lista de proveedores, el alta, el perfil y la carga de mercadería
// (pedido del usuario, 2026-10-28: cargar lo que trajo el proveedor y que se sume al stock, y en
// su perfil ver qué se le compró, qué se le pagó y cómo).

export const PROVEEDOR_VACIO = { nombre: '', telefono: '', email: '', condicion_pago: '' };

export function aFormularioProveedor(p) {
  return { nombre: p.nombre, telefono: p.telefono ?? '', email: p.email ?? '', condicion_pago: p.condicion_pago ?? '' };
}

export function aPayloadProveedor(form) {
  return {
    nombre: form.nombre,
    telefono: form.telefono || null,
    email: form.email || null,
    condicion_pago: form.condicion_pago || null,
  };
}

// Todos los campos del proveedor, iguales en el alta y en la pestaña Datos.
export function CamposProveedor({ form, setForm }) {
  const set = (campo) => (e) => setForm({ ...form, [campo]: e.target.value });
  return (
    <div className="cliente-campos">
      <div className="field cliente-campo-full">
        <label>Nombre o razón social *</label>
        <input required value={form.nombre} onChange={set('nombre')} />
      </div>
      <div className="field">
        <label>Teléfono</label>
        <input value={form.telefono} onChange={set('telefono')} />
      </div>
      <div className="field">
        <label>Email</label>
        <input type="email" value={form.email} onChange={set('email')} />
      </div>
      <div className="field">
        <label>Condición de pago</label>
        <input placeholder="Ej: Cta. cte. 30 días" value={form.condicion_pago} onChange={set('condicion_pago')} />
      </div>
    </div>
  );
}

export const COMPROBANTES = [
  { valor: 'remito', texto: 'Remito' },
  { valor: 'factura', texto: 'Factura' },
];

/** "Factura 0001-00004567", "Remito sin número". */
export function textoComprobante(c) {
  const tipo = COMPROBANTES.find((x) => x.valor === c.comprobante_tipo)?.texto ?? 'Comprobante';
  return c.comprobante_numero ? `${tipo} ${c.comprobante_numero}` : `${tipo} sin número`;
}

export const MEDIOS_PAGO_PROVEEDOR = [
  { valor: 'efectivo', texto: 'Efectivo' },
  { valor: 'mercado_pago', texto: 'Mercado Pago' },
  { valor: 'cheque', texto: 'Cheque' },
];

export function etiquetaMedioProveedor(valor) {
  return MEDIOS_PAGO_PROVEEDOR.find((m) => m.valor === valor)?.texto ?? valor;
}

/** Lo que acompaña al medio: "N° 12345678 · Banco Nación · se cobra el 15/11/2026", "salió de la caja". */
export function detallePago(p) {
  const partes = [];
  if (p.medio === 'cheque') {
    if (p.cheque_numero) partes.push(`N° ${p.cheque_numero}`);
    if (p.cheque_banco) partes.push(p.cheque_banco);
    if (p.cheque_fecha_cobro) partes.push(`se cobra el ${formatearFecha(p.cheque_fecha_cobro)}`);
  }
  if (p.medio === 'efectivo') partes.push(p.sale_de_caja ? 'salió de la caja' : 'no salió de la caja');
  if (p.detalle) partes.push(p.detalle);
  return partes.join(' · ');
}

// Estado de pago de una compra: lo pagado (pagos no anulados) contra el total.
export function estadoCompra(c) {
  if (c.anulada) return { clave: 'anulada', texto: 'Anulada' };
  if (c.pagado >= c.total) return { clave: 'pagada', texto: 'Pagada' };
  if (c.pagado > 0) return { clave: 'parcial', texto: 'Pago parcial' };
  return { clave: 'impaga', texto: 'Sin pagar' };
}

export function EstadoCompra({ compra }) {
  const e = estadoCompra(compra);
  return <span className={`compra-estado compra-estado-${e.clave}`}>{e.texto}</span>;
}

// Saldo con un proveedor: positivo = le debés.
export function estadoDeuda(saldo) {
  return saldo > 0 ? { clave: 'debe', texto: 'Le debés' } : { clave: 'aldia', texto: 'Al día' };
}

// Líneas de una compra como se cargaron ("5 Pack x 6"), con el costo de esa presentación.
export function ItemsCompra({ items, total }) {
  return (
    <table className="pedido-items">
      <thead>
        <tr>
          <th>Producto</th>
          <th className="num">Cantidad</th>
          <th>Vence</th>
          <th className="num">Costo</th>
          <th className="num">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i, idx) => (
          <tr key={i.id ?? idx}>
            <td>{i.producto_nombre}</td>
            <td className="num">{describirCantidadLinea(i)}</td>
            <td>{i.fecha_vencimiento ? formatearFecha(i.fecha_vencimiento) : '—'}</td>
            <td className="num">
              {formatearMonto(i.costo_unitario)}
              {!i.pack_nombre && sufijoPrecio(i.medida)}
            </td>
            <td className="num">{formatearMonto(i.subtotal)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4}>Total</td>
          <td className="num">{formatearMonto(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

// Un pago a un proveedor. En efectivo se elige en cada pago si la plata sale de la caja
// (decisión del usuario, 2026-10-28): si sale, se descuenta del efectivo del turno y aparece en
// Ventas diarias → Gastos y pagos a proveedores.
export const PAGO_VACIO = (monto = '') => ({
  monto: monto === '' ? '' : String(monto),
  fecha: fechaHoyISO(),
  medio: 'efectivo',
  sale_de_caja: true,
  cheque_numero: '',
  cheque_banco: '',
  cheque_fecha_cobro: '',
  detalle: '',
});

/** { error } o { payload } listo para la API. */
export function pagoParaApi(pago) {
  const monto = Number(pago.monto);
  if (!Number.isInteger(monto) || monto < 1) return { error: 'El monto del pago tiene que ser un número entero mayor a cero.' };
  return {
    payload: {
      monto,
      fecha: pago.fecha,
      medio: pago.medio,
      sale_de_caja: pago.medio === 'efectivo' && pago.sale_de_caja,
      cheque_numero: pago.medio === 'cheque' ? pago.cheque_numero.trim() || null : null,
      cheque_banco: pago.medio === 'cheque' ? pago.cheque_banco.trim() || null : null,
      cheque_fecha_cobro: pago.medio === 'cheque' ? pago.cheque_fecha_cobro || null : null,
      detalle: pago.detalle.trim() || null,
    },
  };
}

export function CamposPago({ pago, setPago }) {
  const set = (campo) => (e) => setPago({ ...pago, [campo]: e.target.value });
  return (
    <>
      <div className="cliente-campos">
        <div className="field">
          <label>Monto</label>
          <input required type="number" min="1" step="1" placeholder="0" value={pago.monto} onChange={set('monto')} />
        </div>
        <div className="field">
          <label>Fecha del pago</label>
          <input required type="date" value={pago.fecha} onChange={set('fecha')} />
        </div>
      </div>
      <div className="field">
        <label>Cómo le pagaste</label>
        <div className="stock-en-packs pago-medios" role="group" aria-label="Medio de pago">
          {MEDIOS_PAGO_PROVEEDOR.map((m) => (
            <button key={m.valor} type="button" className={pago.medio === m.valor ? 'activo' : ''} onClick={() => setPago({ ...pago, medio: m.valor })}>
              {m.texto}
            </button>
          ))}
        </div>
      </div>
      {pago.medio === 'efectivo' && (
        <label className="pago-check">
          <input type="checkbox" checked={pago.sale_de_caja} onChange={(e) => setPago({ ...pago, sale_de_caja: e.target.checked })} />
          <span>
            <strong>Sale de la caja</strong>
            <span className="cliente-hint"> — se descuenta del efectivo del turno y aparece en Ventas diarias → Gastos y pagos a proveedores.</span>
          </span>
        </label>
      )}
      {pago.medio === 'cheque' && (
        <div className="cliente-campos">
          <div className="field">
            <label>N° de cheque</label>
            <input value={pago.cheque_numero} onChange={set('cheque_numero')} />
          </div>
          <div className="field">
            <label>Banco</label>
            <input value={pago.cheque_banco} onChange={set('cheque_banco')} />
          </div>
          <div className="field">
            <label>Fecha de cobro</label>
            <input type="date" value={pago.cheque_fecha_cobro} onChange={set('cheque_fecha_cobro')} />
          </div>
        </div>
      )}
      <div className="field">
        <label>Detalle (opcional)</label>
        <input placeholder="Ej: le pagó Juan" value={pago.detalle} onChange={set('detalle')} />
      </div>
    </>
  );
}
