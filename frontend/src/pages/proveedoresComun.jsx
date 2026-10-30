import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearFecha, formatearMonto, fechaHoyISO } from '../utils/format.js';
import { describirCantidadLinea, sufijoPrecio } from '../utils/presentacion.js';

// Piezas compartidas por la lista de proveedores, el alta, la ficha y el ingreso de mercadería
// (pedido del usuario, 2026-10-28: registrar las compras a un proveedor y que se sumen al stock,
// y en su ficha ver qué se le compró, qué se le pagó y cómo).

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

// Todos los campos del proveedor, iguales en el alta y en la pestaña Datos (dos columnas).
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
      <div className="field cliente-campo-full">
        <label>Condición de pago</label>
        <input placeholder="Ej.: cuenta corriente a 30 días" value={form.condicion_pago} onChange={set('condicion_pago')} />
      </div>
    </div>
  );
}

export const COMPROBANTES = [
  { valor: 'remito', texto: 'Remito' },
  { valor: 'factura', texto: 'Factura' },
];

// Una deuda cargada a mano puede no tener comprobante (2026-10-29).
export const COMPROBANTES_DEUDA = [...COMPROBANTES, { valor: 'sin', texto: 'Sin comprobante' }];

/** "Factura 0001-00004567", "Remito sin número", "Sin comprobante". */
export function textoComprobante(c) {
  if (c.comprobante_tipo === 'sin') return 'Sin comprobante';
  const tipo = COMPROBANTES.find((x) => x.valor === c.comprobante_tipo)?.texto ?? 'Comprobante';
  return c.comprobante_numero ? `${tipo} ${c.comprobante_numero}` : `${tipo} sin número`;
}

/** Qué cambió en una corrección: "Factura A-1 → Factura A-2 · 20/10/2026 → 18/10/2026 · vence 19/11/2026 → 30/11/2026 · $528.000 → $541.200". */
export function textoCorreccion(x) {
  const antes = textoComprobante({ comprobante_tipo: x.antes_tipo, comprobante_numero: x.antes_numero });
  const despues = textoComprobante({ comprobante_tipo: x.despues_tipo, comprobante_numero: x.despues_numero });
  return [
    antes !== despues && `${antes} → ${despues}`,
    x.antes_fecha !== x.despues_fecha && `${formatearFecha(x.antes_fecha)} → ${formatearFecha(x.despues_fecha)}`,
    // Las correcciones de antes de la migración 031 no guardaban el vencimiento.
    x.antes_vence && x.antes_vence !== x.despues_vence && `vence ${formatearFecha(x.antes_vence)} → ${formatearFecha(x.despues_vence)}`,
    x.antes_total !== x.despues_total && `${formatearMonto(x.antes_total)} → ${formatearMonto(x.despues_total)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

// Corregir una boleta como dicen la factura o el remito (Saldos pendientes, pedido del
// usuario, 2026-10-29): comprobante, número, fecha, vencimiento y total, con el motivo. Muestra cómo va a quedar
// antes de guardar. No toca el stock ni los costos; el total no puede quedar por debajo de lo pagado.
export function CorregirBoleta({ compra, onCancelar, onGuardada }) {
  const [form, setForm] = useState({
    tipo: compra.comprobante_tipo,
    numero: compra.comprobante_numero ?? '',
    fecha: compra.fecha,
    vence: compra.vence,
    total: String(compra.total),
    motivo: '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardaRef = useRef(false);
  const set = (campo) => (e) => setForm({ ...form, [campo]: e.target.value });
  const tipos = compra.cargada_a_mano ? COMPROBANTES_DEUDA : COMPROBANTES;
  const total = Number(form.total);
  const totalValido = form.total !== '' && Number.isInteger(total) && total >= 0;
  const debajoDeLoPagado = totalValido && total < compra.pagado;
  const venceAntes = Boolean(form.fecha && form.vence && form.vence < form.fecha);
  const numero = form.tipo === 'sin' ? null : form.numero.trim() || null;

  async function guardar(e) {
    e.preventDefault();
    if (guardaRef.current) return;
    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      await api.post(`/proveedores/${compra.proveedor_id}/compras/${compra.id}/correccion`, {
        comprobante_tipo: form.tipo,
        comprobante_numero: numero,
        fecha: form.fecha,
        vence: form.vence || null,
        total,
        motivo: form.motivo.trim(),
      });
      onGuardada();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo corregir la boleta.');
    } finally {
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <form className="saldos-correccion" onSubmit={guardar}>
      <div className="saldos-correccion-cab">
        <strong>Corregir esta boleta</strong>
        <span>
          Comprobante, número, fecha, vencimiento y total, como dicen la factura o el remito. Hoy el total figura {formatearMonto(compra.total)}
          {compra.cargada_a_mano ? '' : ': lo que suma la mercadería que se cargó'}. El stock y los costos no cambian.
        </span>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className={`saldos-correccion-campos${tipos.length > 2 ? ' con-sin' : ''}`}>
        <div className="field">
          <span className="cpagar-label">Comprobante</span>
          <div className="cpagar-repite saldos-correccion-tipos" role="group" aria-label="Comprobante" style={{ gridTemplateColumns: `repeat(${tipos.length}, minmax(0, 1fr))` }}>
            {tipos.map((t) => (
              <button key={t.valor} type="button" className={form.tipo === t.valor ? 'activo' : ''} aria-pressed={form.tipo === t.valor} onClick={() => setForm({ ...form, tipo: t.valor })}>
                {t.texto}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor={`correccion-numero-${compra.id}`}>Número</label>
          <input
            id={`correccion-numero-${compra.id}`}
            maxLength={50}
            disabled={form.tipo === 'sin'}
            placeholder={form.tipo === 'sin' ? 'Sin número' : 'Ej.: A-0004-00018233'}
            value={form.tipo === 'sin' ? '' : form.numero}
            onChange={set('numero')}
          />
        </div>
        <div className="field">
          <label htmlFor={`correccion-fecha-${compra.id}`}>Fecha</label>
          <input id={`correccion-fecha-${compra.id}`} type="date" required value={form.fecha} onChange={set('fecha')} />
        </div>
        <div className="field">
          <label htmlFor={`correccion-vence-${compra.id}`}>Vence el</label>
          <input id={`correccion-vence-${compra.id}`} type="date" required min={form.fecha} value={form.vence} onChange={set('vence')} />
        </div>
        <div className="field">
          <label htmlFor={`correccion-total-${compra.id}`}>Total</label>
          <input id={`correccion-total-${compra.id}`} type="number" min="0" step="1" required value={form.total} onChange={set('total')} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`correccion-motivo-${compra.id}`}>Motivo</label>
        <input id={`correccion-motivo-${compra.id}`} required maxLength={200} placeholder="Ej.: la factura trae flete e IVA" value={form.motivo} onChange={set('motivo')} />
      </div>
      {totalValido && !debajoDeLoPagado && !venceAntes && (
        <div className="saldos-correccion-cuenta">
          Va a quedar: {textoComprobante({ comprobante_tipo: form.tipo, comprobante_numero: numero })}
          {form.fecha && (
            <>
              {' '}
              del <strong>{formatearFecha(form.fecha)}</strong>
            </>
          )}
          {form.vence && (
            <>
              {' '}
              · vence el <strong>{formatearFecha(form.vence)}</strong>
            </>
          )}{' '}
          · pagado {formatearMonto(compra.pagado)} de <strong>{formatearMonto(total)}</strong> · falta pagar{' '}
          <strong>{formatearMonto(total - compra.pagado)}</strong>.
        </div>
      )}
      {debajoDeLoPagado && (
        <div className="alert alert-danger">El total no puede quedar por debajo de lo ya pagado ({formatearMonto(compra.pagado)}).</div>
      )}
      {venceAntes && <div className="alert alert-danger">El vencimiento no puede ser anterior a la fecha de la boleta.</div>}
      <div className="saldos-correccion-acciones">
        <button type="button" className="btn" onClick={onCancelar}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={guardando || debajoDeLoPagado || venceAntes}>
          {guardando ? 'Guardando…' : 'Guardar corrección'}
        </button>
      </div>
    </form>
  );
}

export const MEDIOS_PAGO_PROVEEDOR = [
  { valor: 'efectivo', texto: 'Efectivo' },
  { valor: 'mercado_pago', texto: 'Mercado Pago' },
  { valor: 'cheque', texto: 'Cheque' },
];

export function etiquetaMedioProveedor(valor) {
  return MEDIOS_PAGO_PROVEEDOR.find((m) => m.valor === valor)?.texto ?? valor;
}

/** Lo que acompaña al medio: "N° 12345678 · Banco Nación · cobro 15/11/2026", "con efectivo de la caja". */
export function detallePago(p) {
  const partes = [];
  if (p.medio === 'cheque') {
    if (p.cheque_numero) partes.push(`N° ${p.cheque_numero}`);
    if (p.cheque_banco) partes.push(p.cheque_banco);
    if (p.cheque_fecha_cobro) partes.push(`cobro ${formatearFecha(p.cheque_fecha_cobro)}`);
  }
  if (p.medio === 'efectivo') partes.push(p.sale_de_caja ? 'con efectivo de la caja' : 'fuera de la caja');
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

// Saldo con un proveedor: positivo = saldo pendiente de pago.
export function estadoDeuda(saldo) {
  return saldo > 0 ? { clave: 'debe', texto: 'Pendiente' } : { clave: 'aldia', texto: 'Al día' };
}

// Detalle de una compra como un comprobante: los productos tal como se cargaron ("5 Caja x 6",
// con el costo de esa presentación) y abajo, a la derecha, el total, lo pagado y el saldo.
// En celular cada producto va en dos renglones (nombre y subtotal; cantidad, costo y vencimiento).
// Una deuda cargada a mano no tiene líneas: se dice eso y su nota. Si la boleta se corrigió, el
// total ya no es la suma de las líneas y se muestra también lo que sumó la mercadería.
export function ItemsCompra({ items, total, pagado = null, nota = null }) {
  const conPagos = pagado != null && pagado > 0;
  const mercaderia = items.reduce((a, i) => a + i.subtotal, 0);
  if (items.length === 0) {
    return (
      <div className="compra-comprobante">
        <p className="compra-a-mano">Deuda cargada a mano, sin mercadería{nota ? `: ${nota}` : '.'}</p>
        <TotalesCompra total={total} pagado={pagado} conPagos={conPagos} />
      </div>
    );
  }
  return (
    <div className="compra-comprobante">
      <table className="pedido-items compra-items">
        <thead>
          <tr>
            <th>Producto</th>
            <th className="num tabla-oculto-celu">Cantidad</th>
            <th className="tabla-oculto-celu">Vencimiento</th>
            <th className="num tabla-oculto-celu">Costo</th>
            <th className="num">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, idx) => {
            const cantidad = describirCantidadLinea(i);
            const costo = `${formatearMonto(i.costo_unitario)}${i.pack_nombre ? '' : sufijoPrecio(i.medida)}`;
            const vence = i.fecha_vencimiento ? formatearFecha(i.fecha_vencimiento) : null;
            return (
              <tr key={i.id ?? idx}>
                <td>
                  {i.producto_nombre}
                  <div className="cliente-td-sub tabla-solo-celu">
                    {cantidad} · {costo}
                    {vence && ` · vence ${vence}`}
                  </div>
                </td>
                <td className="num tabla-oculto-celu">{cantidad}</td>
                <td className="tabla-oculto-celu">{vence ?? <span className="dato-vacio">—</span>}</td>
                <td className="num tabla-oculto-celu">{costo}</td>
                <td className="num">{formatearMonto(i.subtotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <TotalesCompra total={total} pagado={pagado} conPagos={conPagos} mercaderia={mercaderia !== total ? mercaderia : null} />
    </div>
  );
}

function TotalesCompra({ total, pagado, conPagos, mercaderia = null }) {
  return (
    <dl className="compra-totales">
      {mercaderia != null && (
        <div>
          <dt>Mercadería cargada</dt>
          <dd>{formatearMonto(mercaderia)}</dd>
        </div>
      )}
      <div className={conPagos ? undefined : 'compra-total-final'}>
        <dt>{mercaderia != null ? 'Total corregido' : 'Total'}</dt>
        <dd>{formatearMonto(total)}</dd>
      </div>
      {conPagos && (
        <>
          <div>
            <dt>Pagado</dt>
            <dd>{formatearMonto(pagado)}</dd>
          </div>
          <div className="compra-total-final">
            <dt>Saldo pendiente</dt>
            <dd>{formatearMonto(Math.max(total - pagado, 0))}</dd>
          </div>
        </>
      )}
    </dl>
  );
}

// Un pago a un proveedor. En efectivo se elige en cada pago si la plata sale de la caja
// (decisión del usuario, 2026-10-28): si sale, se descuenta del efectivo del turno y aparece en
// Ventas → Gastos y pagos a proveedores.
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
  if (!Number.isInteger(monto) || monto < 1) return { error: 'El monto del pago debe ser un número entero mayor que cero.' };
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

// Campos del pago en una grilla que siempre cierra: monto, fecha y medio en una fila; los datos
// del cheque (o la casilla de la caja) en la siguiente; el detalle a todo el ancho. Saldos pendientes
// lo usa con sus propios medios y su texto de la caja (2026-10-29).
const AYUDA_CAJA_PROVEEDOR = 'Se descuenta del efectivo del turno y figura en Ventas, en gastos y pagos a proveedores.';
export function CamposPago({ pago, setPago, medios = MEDIOS_PAGO_PROVEEDOR, ayudaCaja = AYUDA_CAJA_PROVEEDOR }) {
  const set = (campo) => (e) => setPago({ ...pago, [campo]: e.target.value });
  return (
    <div className="pago-campos">
      <div className="field pago-campo">
        <label>Monto</label>
        <input required type="number" min="1" step="1" placeholder="0" value={pago.monto} onChange={set('monto')} />
      </div>
      <div className="field pago-campo">
        <label>Fecha del pago</label>
        <input required type="date" value={pago.fecha} onChange={set('fecha')} />
      </div>
      <div className="field pago-campo pago-campo-medio">
        <label>Medio de pago</label>
        <div className="prov-seg" role="group" aria-label="Medio de pago">
          {medios.map((m) => (
            <button
              key={m.valor}
              type="button"
              className={pago.medio === m.valor ? 'activo' : ''}
              aria-pressed={pago.medio === m.valor}
              onClick={() => setPago({ ...pago, medio: m.valor })}
            >
              {m.texto}
            </button>
          ))}
        </div>
      </div>
      {pago.medio === 'efectivo' && (
        <label className="pago-check pago-campo-full">
          <input type="checkbox" checked={pago.sale_de_caja} onChange={(e) => setPago({ ...pago, sale_de_caja: e.target.checked })} />
          <span>
            <strong>Pagado con efectivo de la caja</strong>
            <span className="pago-check-ayuda">{ayudaCaja}</span>
          </span>
        </label>
      )}
      {pago.medio === 'cheque' && (
        <>
          <div className="field pago-campo pago-campo-cheque">
            <label>N° de cheque</label>
            <input value={pago.cheque_numero} onChange={set('cheque_numero')} />
          </div>
          <div className="field pago-campo pago-campo-cheque">
            <label>Banco</label>
            <input value={pago.cheque_banco} onChange={set('cheque_banco')} />
          </div>
          <div className="field pago-campo pago-campo-cheque">
            <label>Fecha de cobro</label>
            <input type="date" value={pago.cheque_fecha_cobro} onChange={set('cheque_fecha_cobro')} />
          </div>
        </>
      )}
      <div className="field pago-campo-full">
        <label>Detalle (opcional)</label>
        <input placeholder="Ej.: entregado por Juan Pérez" value={pago.detalle} onChange={set('detalle')} />
      </div>
    </div>
  );
}
