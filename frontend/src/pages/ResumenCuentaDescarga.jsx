import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { fechaHoyISO } from '../utils/format.js';

// Descarga del resumen de cuenta corriente en PDF: todo el historial o un
// rango de fechas (desde / hasta, cualquiera de los dos es opcional). `ruta` es
// el endpoint del resumen: el de la ficha (/clientes-empresa/:id/resumen) o el
// del portal del cliente (/portal/resumen). `onSesionVencida` (solo el portal): un 401 ahí
// vuelve al ingreso del portal; en el negocio el 401 ya lo maneja AuthContext (api/client.js).
export default function ResumenCuentaDescarga({ ruta, onSesionVencida }) {
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
        setError('Indicá al menos una fecha (desde o hasta).');
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
      const { blob, nombre } = await api.descargar(`${ruta}${consulta ? `?${consulta}` : ''}`);
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      if (onSesionVencida && err instanceof ApiError && err.status === 401) return onSesionVencida();
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
        PDF con los datos del cliente, los cargos, pagos y ajustes del período, el saldo de cada movimiento y el saldo final.
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
          {descargando ? 'Generando PDF…' : 'Descargar PDF'}
        </button>
      </div>
    </form>
  );
}
