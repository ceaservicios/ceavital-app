import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Icono from '../components/Icono.jsx';
import { fechaHoyISO, formatearFecha } from '../utils/format.js';
import { FRECUENCIAS, textoCadaCuanto } from './FijosPage.jsx';
import { TIPOS_CUENTA } from './saldosComun.jsx';
import './SaldosPage.css';
import './FijosPage.css';

// Alta y edición de un fijo, en página propia como "Cargar deuda". El monto es opcional: si cambia
// todos los meses, se escribe al pagar.

const VACIO = () => ({ tipo: '', concepto: '', monto: '', variable: false, frecuencia: 'mensual', desde: fechaHoyISO(), nota: '' });

const aFormulario = (f) => ({
  tipo: f.tipo,
  concepto: f.concepto,
  monto: f.monto == null ? '' : String(f.monto),
  variable: f.monto == null,
  frecuencia: f.frecuencia,
  desde: f.proximo ?? f.desde,
  nota: f.nota ?? '',
});

export default function FijoFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [fijo, setFijo] = useState(null);
  const [form, setForm] = useState(id ? null : VACIO());
  const [guardando, setGuardando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState(null);
  const guardaRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    api
      .get(`/fijos/${id}`)
      .then((data) => {
        setFijo(data);
        setForm(aFormulario(data));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar el fijo.'));
  }, [id]);

  async function conGuardia(accion, mensajeError) {
    if (guardaRef.current) return;
    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      await accion();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : mensajeError);
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  function guardar(e) {
    e.preventDefault();
    if (!form.tipo) return setError('Elegí el tipo.');
    const monto = form.variable ? null : Number(form.monto);
    if (monto !== null && (!Number.isInteger(monto) || monto < 1)) return setError('El monto debe ser un número entero mayor que cero.');
    const payload = { tipo: form.tipo, concepto: form.concepto.trim(), monto, frecuencia: form.frecuencia, desde: form.desde, nota: form.nota.trim() || null };
    return conGuardia(async () => {
      if (fijo) await api.patch(`/fijos/${fijo.id}`, payload);
      else await api.post('/fijos', payload);
      navigate('/fijos', { replace: true, state: { exito: fijo ? `Cambios guardados en ${payload.concepto}.` : `${payload.concepto} quedó cargado. Sus vencimientos aparecen en Saldos pendientes.` } });
    }, 'No se pudo guardar el fijo.');
  }

  function pausar() {
    return conGuardia(async () => {
      await api.post(`/fijos/${fijo.id}/${fijo.activo ? 'pausar' : 'activar'}`, {});
      navigate('/fijos', { replace: true, state: { exito: fijo.activo ? `${fijo.concepto} quedó en pausa: no genera más vencimientos.` : `${fijo.concepto} volvió a generar vencimientos.` } });
    }, 'No se pudo cambiar el fijo.');
  }

  function eliminar() {
    return conGuardia(async () => {
      await api.delete(`/fijos/${fijo.id}`);
      navigate('/fijos', { replace: true, state: { exito: `${fijo.concepto} se eliminó. Lo que ya estaba en Saldos pendientes sigue ahí.` } });
    }, 'No se pudo eliminar el fijo.');
  }

  if (!form) return <div className="cpagar-page">{error ? <div className="alert alert-danger">{error}</div> : <div className="cliente-vacio">Cargando…</div>}</div>;

  const set = (campo) => (e) => setForm({ ...form, [campo]: e.target.value });
  const cambiaCalendario = fijo && (form.desde !== fijo.proximo || form.frecuencia !== fijo.frecuencia);

  return (
    <div className="cpagar-page">
      <h1 className="cliente-h1">{fijo ? fijo.concepto : 'Nuevo fijo'}</h1>
      <form className="card cpagar-tarjeta" onSubmit={guardar}>
        <div className="cpagar-cabecera">
          <span className="cpagar-cabecera-icono">
            <Icono nombre="repetir" />
          </span>
          <div>
            <strong>Lo que se paga siempre</strong>
            <span>Cada vencimiento aparece solo en Saldos pendientes.</span>
          </div>
        </div>
        <div className="cpagar-cuerpo">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="cpagar-campos">
            <div className="field">
              <span className="cpagar-label">Tipo</span>
              <div className="cpagar-tipos" role="group" aria-label="Tipo">
                {TIPOS_CUENTA.map((t) => (
                  <button
                    key={t.valor}
                    type="button"
                    className={`cpagar-tipo${form.tipo === t.valor ? ' activo' : ''}`}
                    style={{ '--c': t.color }}
                    aria-pressed={form.tipo === t.valor}
                    onClick={() => setForm({ ...form, tipo: t.valor })}
                  >
                    <span className="cpagar-tipo-icono">
                      <Icono nombre={t.icono} tam={16} />
                    </span>
                    {t.texto}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="fijo-concepto">Nombre</label>
              <input id="fijo-concepto" required maxLength={200} placeholder="Ej.: Alquiler del salón" value={form.concepto} onChange={set('concepto')} />
            </div>
            <div className="cpagar-fila">
              <div className="field">
                <label htmlFor="fijo-monto">Monto</label>
                <input
                  id="fijo-monto"
                  type="number"
                  min="1"
                  step="1"
                  required={!form.variable}
                  disabled={form.variable}
                  placeholder={form.variable ? 'Se escribe al pagar' : '0'}
                  value={form.variable ? '' : form.monto}
                  onChange={set('monto')}
                />
              </div>
              <div className="field">
                <label htmlFor="fijo-desde">{fijo ? 'Próximo vencimiento' : 'Primer vencimiento'}</label>
                <input id="fijo-desde" type="date" required value={form.desde} onChange={set('desde')} />
              </div>
              <div className="field">
                <label htmlFor="fijo-nota">Nota (opcional)</label>
                <input id="fijo-nota" maxLength={200} placeholder="Ej.: contrato hasta 2027" value={form.nota} onChange={set('nota')} />
              </div>
            </div>
            <label className="fijo-check">
              <input type="checkbox" checked={form.variable} onChange={(e) => setForm({ ...form, variable: e.target.checked })} />
              <span>
                <strong>El monto cambia cada vez</strong>
                <span>Para la luz o el gas: aparece como «Según factura» y escribís el monto al pagar.</span>
              </span>
            </label>
            <div className="field">
              <span className="cpagar-label">Cada cuánto</span>
              <div className="cpagar-repite fijo-frecuencias" role="group" aria-label="Cada cuánto">
                {FRECUENCIAS.map((r) => (
                  <button key={r.valor} type="button" className={form.frecuencia === r.valor ? 'activo' : ''} aria-pressed={form.frecuencia === r.valor} onClick={() => setForm({ ...form, frecuencia: r.valor })}>
                    {r.texto}
                  </button>
                ))}
              </div>
            </div>
            {form.desde && (
              <div className="cpagar-aviso">
                <Icono nombre="calendario" tam={16} />
                <span>
                  {textoCadaCuanto(form)}. Arranca el <strong>{formatearFecha(form.desde)}</strong> y cada vencimiento aparece en Saldos pendientes 30 días antes, aunque el anterior siga sin pagar.
                  {cambiaCalendario && ' Lo que esté sin pagar y por vencer se acomoda a las fechas nuevas.'}
                </span>
              </div>
            )}
          </div>
          <div className="cpagar-acciones">
            {fijo &&
              (confirmando ? (
                <span className="cpagar-confirmar">
                  ¿Eliminar el fijo?
                  <button type="button" className="btn" onClick={() => setConfirmando(false)}>
                    Cancelar
                  </button>
                  <button type="button" className="btn btn-peligro" disabled={guardando} onClick={eliminar}>
                    Eliminar
                  </button>
                </span>
              ) : (
                <>
                  <button type="button" className="btn btn-peligro" onClick={() => setConfirmando(true)}>
                    Eliminar
                  </button>
                  <button type="button" className="btn" disabled={guardando} onClick={pausar}>
                    {fijo.activo ? 'Pausar' : 'Volver a activar'}
                  </button>
                </>
              ))}
            <button type="button" className="btn" onClick={() => navigate('/fijos')}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando…' : fijo ? 'Guardar cambios' : 'Guardar fijo'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
