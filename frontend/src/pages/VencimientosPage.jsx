import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearFecha } from '../utils/format.js';
import './VencimientosPage.css';

const PUEDE_RETIRAR = new Set(['admin', 'encargado']);

function etiquetaDias(n, sufijoSingular, sufijoPlural) {
  if (n === 1) return `1 ${sufijoSingular}`;
  return `${n} ${sufijoPlural}`;
}

export default function VencimientosPage() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const puedeRetirar = PUEDE_RETIRAR.has(usuario?.rol);

  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [confirmandoLoteId, setConfirmandoLoteId] = useState(null);
  const [retirando, setRetirando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const data = await api.get('/vencimientos');
      setDatos(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los vencimientos.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function retirarLote(loteVencido) {
    setRetirando(true);
    try {
      await api.delete(`/productos/${loteVencido.producto_id}/lotes/${loteVencido.lote_id}`);
      setConfirmandoLoteId(null);
      cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo retirar el lote.');
      setConfirmandoLoteId(null);
    } finally {
      setRetirando(false);
    }
  }

  if (cargando) {
    return <div className="card vencimientos-vacio">Cargando…</div>;
  }

  if (error && !datos) {
    return <div className="alert alert-danger">{error}</div>;
  }

  const vencidos = datos?.vencidos ?? [];
  const porVencer = datos?.por_vencer ?? [];
  const unidadesEnRiesgo =
    vencidos.reduce((acc, l) => acc + l.cantidad, 0) + porVencer.reduce((acc, l) => acc + l.cantidad, 0);

  return (
    <div className="vencimientos-page">
      <div className="vencimientos-kpis">
        <div className="card vencimientos-kpi vencimientos-kpi-vencido">
          <span className="vencimientos-kpi-label">Lotes vencidos</span>
          <span className="vencimientos-kpi-value">{vencidos.length}</span>
        </div>
        <div className="card vencimientos-kpi vencimientos-kpi-aviso">
          <span className="vencimientos-kpi-label">Por vencer</span>
          <span className="vencimientos-kpi-value">{porVencer.length}</span>
        </div>
        <div className="card vencimientos-kpi">
          <span className="vencimientos-kpi-label">Unidades en riesgo</span>
          <span className="vencimientos-kpi-value">{unidadesEnRiesgo}</span>
        </div>
      </div>

      {vencidos.length > 0 && (
        <div className="vencimientos-banner">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B0333E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.3 3.9L2.5 17a1.5 1.5 0 0 0 1.3 2.2h16.4a1.5 1.5 0 0 0 1.3-2.2L13.7 3.9a1.5 1.5 0 0 0-2.6 0z" />
          </svg>
          <span>
            Hay {etiquetaDias(vencidos.length, 'lote vencido', 'lotes vencidos')} todavía en el depósito — retiralos
            del stock vendible cuanto antes.
          </span>
        </div>
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card vencimientos-tabla">
        {vencidos.length === 0 && porVencer.length === 0 ? (
          <div className="vencimientos-vacio">No hay lotes vencidos ni por vencer.</div>
        ) : (
          <div className="vencimientos-tabla-scroll">
            <div className="vencimientos-tabla-head">
              <span style={{ flex: 2 }}>Producto</span>
              <span style={{ flex: 1 }}>Lote</span>
              <span style={{ flex: 1, textAlign: 'center' }}>Cantidad</span>
              <span style={{ flex: 1.2 }}>Fecha de vencimiento</span>
              <span style={{ flex: 1 }}>Estado</span>
              <span style={{ width: 104, flexShrink: 0 }} />
            </div>

            {vencidos.map((lote) => (
              <div className="vencimientos-fila" key={`v-${lote.lote_id}`}>
                <span style={{ flex: 2 }} className="vencimientos-fila-nombre">
                  {lote.producto_nombre}
                </span>
                <span style={{ flex: 1 }} className="vencimientos-fila-muted">
                  Lote #{lote.lote_id}
                </span>
                <span style={{ flex: 1, textAlign: 'center', fontWeight: 700 }}>{lote.cantidad}</span>
                <span style={{ flex: 1.2 }}>{formatearFecha(lote.fecha_vencimiento)}</span>
                <span style={{ flex: 1 }}>
                  <span className="vencimientos-badge vencimientos-badge-vencido">
                    Vencido hace {etiquetaDias(lote.dias_vencido, 'día', 'días')}
                  </span>
                </span>
                <span style={{ width: 104, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                  {puedeRetirar &&
                    (confirmandoLoteId === lote.lote_id ? (
                      <div className="vencimientos-confirm">
                        <button type="button" className="btn" onClick={() => setConfirmandoLoteId(null)}>
                          No
                        </button>
                        <button type="button" className="btn" disabled={retirando} onClick={() => retirarLote(lote)}>
                          Sí
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn vencimientos-btn-retirar" onClick={() => setConfirmandoLoteId(lote.lote_id)}>
                        Retirar
                      </button>
                    ))}
                </span>
              </div>
            ))}

            {porVencer.map((lote) => (
              <div className="vencimientos-fila" key={`p-${lote.lote_id}`}>
                <span style={{ flex: 2 }} className="vencimientos-fila-nombre">
                  {lote.producto_nombre}
                </span>
                <span style={{ flex: 1 }} className="vencimientos-fila-muted">
                  Lote #{lote.lote_id}
                </span>
                <span style={{ flex: 1, textAlign: 'center', fontWeight: 700 }}>{lote.cantidad}</span>
                <span style={{ flex: 1.2 }}>{formatearFecha(lote.fecha_vencimiento)}</span>
                <span style={{ flex: 1 }}>
                  <span className="vencimientos-badge vencimientos-badge-aviso">
                    {lote.dias_restantes === 0 ? 'Vence hoy' : `Vence en ${etiquetaDias(lote.dias_restantes, 'día', 'días')}`}
                  </span>
                </span>
                <span style={{ width: 104, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn vencimientos-btn-ver"
                    onClick={() => navigate(`/stock?producto=${lote.producto_id}`)}
                  >
                    Ver lote
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
