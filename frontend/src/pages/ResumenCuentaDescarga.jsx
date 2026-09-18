import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { fechaHoyISO } from '../utils/format.js';

// Descarga del resumen de cuenta corriente en PDF: todo el historial o un
// rango de fechas (desde / hasta, cualquiera de los dos es opcional).
export default function ResumenCuentaDescarga({ clienteId }) {
  const [modo, setModo] = useState('todo'); // 'todo' | 'rango'
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState(null);
  // Guardia sincrónica contra doble click (mismo criterio que el resto de las pantallas).
  const guardaRef = useRef(false);

  async function descargar(e) {
    e.preventDefault();
    if (guardaRef.current) return;
    setError(null);

    const params = new URLSearchParams();
    if (modo === 'rango') {
      if (!desde && !hasta) {
        setError('Elegí al menos una fecha (desde o hasta).');
        return;
      }
      if (desde && hasta && desde > hasta) {
        setError('La fecha "desde" no puede ser posterior a "hasta".');
        return;
      }
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);
    }

    guardaRef.current = true;
    setDescargando(true);
    try {
      const consulta = params.toString();
      const { blob, nombre } = await api.descargar(`/clientes-empresa/${clienteId}/resumen${consulta ? `?${consulta}` : ''}`);
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo descargar el resumen.');
    } finally {
      guardaRef.current = false;
      setDescargando(false);
    }
  }

  return (
    <form className="card cliente-card" onSubmit={descargar}>
      <span className="cliente-seccion-titulo">Resumen de cuenta</span>
      <div className="cliente-hint">
        Descargá un PDF con los datos del cliente, los cargos, pagos y ajustes, el saldo corrido y el saldo final.
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="cliente-radios" role="radiogroup" aria-label="Período del resumen">
        <label className="cliente-radio">
          <input type="radio" name="periodo-resumen" checked={modo === 'todo'} onChange={() => setModo('todo')} />
          <span>Todo el historial</span>
        </label>
        <label className="cliente-radio">
          <input type="radio" name="periodo-resumen" checked={modo === 'rango'} onChange={() => setModo('rango')} />
          <span>Entre fechas</span>
        </label>
      </div>

      {modo === 'rango' && (
        <div className="cliente-campos">
          <div className="field">
            <label htmlFor="resumen-desde">Desde</label>
            <input id="resumen-desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="resumen-hasta">Hasta</label>
            <input id="resumen-hasta" type="date" value={hasta} min={desde || undefined} max={fechaHoyISO()} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>
      )}

      <div className="cliente-acciones">
        <button type="submit" className="btn btn-primary" disabled={descargando}>
          {descargando ? 'Generando PDF…' : 'Descargar resumen (PDF)'}
        </button>
      </div>
    </form>
  );
}
