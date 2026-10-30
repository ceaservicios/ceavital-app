import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Icono from '../components/Icono.jsx';
import { COLOR } from '../utils/colores.js';
import { fechaHoyISO } from '../utils/format.js';
import { COMPROBANTES_DEUDA } from './proveedoresComun.jsx';
import { CamposCuenta, CUENTA_VACIA, cuentaParaApi } from './saldosComun.jsx';
import './SaldosPage.css';

// Cargar deuda (pedido del usuario, 2026-10-29: "poder cargar sea uno u otro"): el único alta de
// Saldos pendientes. Arriba se elige qué se carga y abajo va su formulario: un impuesto o servicio
// (con vencimiento y repetición) o una deuda con un proveedor sin cargar mercadería (un saldo de
// antes, una boleta que no se carga producto por producto; no toca el stock). Página propia, como
// "Nuevo proveedor" (nada de paneles al costado).

const QUE = [
  { valor: 'cuenta', titulo: 'Impuesto o servicio', sub: 'Alquiler, luz, impuestos, internet… Se puede repetir sola.', icono: 'banco', color: COLOR.violeta },
  { valor: 'proveedor', titulo: 'Deuda con un proveedor', sub: 'Una factura o un saldo de antes, sin cargar mercadería.', icono: 'camion', color: COLOR.naranja },
];

const DEUDA_VACIA = () => ({ proveedor_id: '', tipo: 'factura', numero: '', fecha: fechaHoyISO(), vence: '', monto: '', nota: '' });

// Lo que se manda para una deuda con un proveedor, o el error a mostrar.
function deudaParaApi(form) {
  const monto = Number(form.monto);
  if (!form.proveedor_id) return { error: 'Elegí el proveedor.' };
  if (!Number.isInteger(monto) || monto < 1) return { error: 'El monto tiene que ser un número entero mayor a cero.' };
  if (form.vence && form.vence < form.fecha) return { error: 'El vencimiento no puede ser anterior a la fecha de la boleta.' };
  return {
    payload: {
      comprobante_tipo: form.tipo,
      comprobante_numero: form.tipo === 'sin' ? null : form.numero.trim() || null,
      fecha: form.fecha,
      vence: form.vence || null,
      monto,
      nota: form.nota.trim() || null,
    },
  };
}

function CamposDeuda({ form, setForm, proveedores }) {
  const set = (campo) => (e) => setForm({ ...form, [campo]: e.target.value });
  return (
    <div className="cpagar-campos">
      <div className="field">
        <label htmlFor="deuda-proveedor">Proveedor</label>
        <select id="deuda-proveedor" required value={form.proveedor_id} onChange={set('proveedor_id')} disabled={!proveedores}>
          <option value="">{proveedores ? 'Elegí el proveedor' : 'Cargando…'}</option>
          {proveedores?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="cpagar-label">Comprobante</span>
        <div className="cpagar-repite deuda-tipos" role="group" aria-label="Comprobante">
          {COMPROBANTES_DEUDA.map((t) => (
            <button key={t.valor} type="button" className={form.tipo === t.valor ? 'activo' : ''} aria-pressed={form.tipo === t.valor} onClick={() => setForm({ ...form, tipo: t.valor })}>
              {t.texto}
            </button>
          ))}
        </div>
      </div>
      <div className="cpagar-fila deuda-fila">
        <div className="field">
          <label htmlFor="deuda-numero">Número</label>
          <input
            id="deuda-numero"
            maxLength={50}
            disabled={form.tipo === 'sin'}
            placeholder={form.tipo === 'sin' ? 'Sin número' : 'Ej.: A-0004-00018233'}
            value={form.tipo === 'sin' ? '' : form.numero}
            onChange={set('numero')}
          />
        </div>
        <div className="field">
          <label htmlFor="deuda-fecha">Fecha de la boleta</label>
          <input id="deuda-fecha" type="date" required value={form.fecha} onChange={set('fecha')} />
        </div>
        <div className="field">
          <label htmlFor="deuda-vence">Vence el</label>
          <input id="deuda-vence" type="date" min={form.fecha} value={form.vence} onChange={set('vence')} />
        </div>
        <div className="field">
          <label htmlFor="deuda-monto">Monto que se le debe</label>
          <input id="deuda-monto" type="number" min="1" step="1" required placeholder="0" value={form.monto} onChange={set('monto')} />
        </div>
      </div>
      {!form.vence && (
        <div className="cpagar-aviso">
          <Icono nombre="calendario" tam={16} />
          <span>Sin «Vence el», vence el mismo día de la boleta.</span>
        </div>
      )}
      <div className="field">
        <label htmlFor="deuda-nota">Nota (opcional)</label>
        <input id="deuda-nota" maxLength={200} placeholder="Ej.: saldo de antes de usar el sistema" value={form.nota} onChange={set('nota')} />
      </div>
    </div>
  );
}

export default function CargarDeudaPage() {
  const navigate = useNavigate();
  const [que, setQue] = useState('cuenta');
  const [cuenta, setCuenta] = useState(CUENTA_VACIA);
  const [deuda, setDeuda] = useState(DEUDA_VACIA);
  const [proveedores, setProveedores] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  // Guardia sincrónica contra doble submit (con dos clicks se cargaba la deuda duplicada).
  const guardaRef = useRef(false);

  useEffect(() => {
    api
      .get('/proveedores')
      .then((data) => setProveedores(data.proveedores))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los proveedores.'));
  }, []);

  async function guardar(e) {
    e.preventDefault();
    const { error: falta, payload } = que === 'cuenta' ? cuentaParaApi(cuenta) : deudaParaApi(deuda);
    if (falta) return setError(falta);
    if (guardaRef.current) return;
    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      if (que === 'cuenta') {
        await api.post('/saldos/cuentas', payload);
        navigate('/saldos', { replace: true, state: { exito: `Cuenta «${payload.concepto}» cargada.` } });
      } else {
        await api.post(`/proveedores/${deuda.proveedor_id}/deudas`, payload);
        const nombre = proveedores.find((p) => String(p.id) === deuda.proveedor_id)?.nombre;
        navigate('/saldos', { replace: true, state: { exito: `Deuda con ${nombre} cargada.` } });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la deuda.');
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <div className="cpagar-page">
      <h1 className="cliente-h1">Cargar deuda</h1>
      <form className="card cpagar-tarjeta" onSubmit={guardar}>
        <div className="cpagar-cabecera">
          <span className="cpagar-cabecera-icono">
            <Icono nombre="mas" />
          </span>
          <div>
            <strong>Lo que hay que pagar</strong>
            <span>Queda en Saldos pendientes, con su vencimiento, hasta que la pagues.</span>
          </div>
        </div>
        <div className="cpagar-cuerpo">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="field">
            <span className="cpagar-label">¿Qué vas a cargar?</span>
            <div className="cargar-que" role="group" aria-label="Qué vas a cargar">
              {QUE.map((q) => (
                <button
                  key={q.valor}
                  type="button"
                  className={`cargar-op${que === q.valor ? ' activo' : ''}`}
                  style={{ '--c': q.color }}
                  aria-pressed={que === q.valor}
                  onClick={() => {
                    setQue(q.valor);
                    setError(null);
                  }}
                >
                  <span className="cargar-op-icono">
                    <Icono nombre={q.icono} />
                  </span>
                  <span className="cargar-op-texto">
                    <strong>{q.titulo}</strong>
                    <span>{q.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          {que === 'cuenta' ? <CamposCuenta form={cuenta} setForm={setCuenta} /> : <CamposDeuda form={deuda} setForm={setDeuda} proveedores={proveedores} />}
          <div className="cpagar-acciones">
            <button type="button" className="btn" onClick={() => navigate('/saldos')}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={guardando || (que === 'proveedor' && !proveedores)}>
              {guardando ? 'Guardando…' : que === 'cuenta' ? 'Guardar cuenta' : 'Guardar deuda'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
