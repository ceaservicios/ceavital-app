import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearFecha, formatearMonto } from '../utils/format.js';
import './CierreCajaPage.css';

const PUEDE_CERRAR = new Set(['admin', 'encargado']);

const MEDIOS = [
  { campo: 'total_efectivo_esperado', label: 'Efectivo', icono: 'cash' },
  { campo: 'total_tarjeta', label: 'Tarjeta (débito / crédito)', icono: 'tarjeta' },
  { campo: 'total_transferencia_qr', label: 'Transferencia / QR', icono: 'qr' },
  { campo: 'total_mercado_pago', label: 'Mercado Pago', icono: 'mp' },
  { campo: 'total_fiado', label: 'Fiado', icono: 'fiado' },
  { campo: 'total_cta_cte', label: 'Cuenta Corriente (clientes-empresa)', icono: 'ctacte' },
];

const ICONOS = {
  cash: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3A4642" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  tarjeta: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3A4642" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  ),
  qr: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3A4642" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  mp: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3A4642" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1" />
      <path d="M21 12a1.5 1.5 0 0 1 0 3h-3a3 3 0 0 1 0-6h3a1.5 1.5 0 0 1 0 3z" />
    </svg>
  ),
  fiado: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3A4642" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  ctacte: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3A4642" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  ),
};

export default function CierreCajaPage() {
  const { usuario, moduloActivo } = useAuth();
  const puedeCerrar = PUEDE_CERRAR.has(usuario?.rol);

  const [resumen, setResumen] = useState(null);
  const [cierres, setCierres] = useState([]);
  const [montoContado, setMontoContado] = useState('');
  const [fondoDejado, setFondoDejado] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [exito, setExito] = useState(null);
  // Guardia real contra doble-click: un ref se muta de forma sincrónica (no
  // depende de que React ya haya re-renderizado con `enviando=true` y
  // deshabilitado el botón en el DOM) -- un doble-click muy rápido puede
  // disparar el 2do click antes de que ese re-render se complete. Ver
  // hallazgo Media (verificador-funcional 2026-09-10, "Confirmar Cierre de
  // Caja" creaba 2 registros duplicados pese a que el botón ya usaba
  // `disabled={enviando}`).
  const enviandoRef = useRef(false);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const [dataResumen, dataCierres] = await Promise.all([api.get('/caja/resumen'), api.get('/caja/cierres')]);
      setResumen(dataResumen);
      setCierres(dataCierres.cierres.slice(0, 10));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar el cierre de caja.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const esperado = resumen?.total_efectivo_esperado ?? 0;
  const contadoNumerico = montoContado === '' ? null : Number(montoContado);
  const diferencia = contadoNumerico === null ? null : contadoNumerico - esperado;

  async function confirmarCierre() {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      const cierre = await api.post('/caja/cierres', {
        total_efectivo_contado: contadoNumerico,
        fondo_dejado: fondoDejado === '' ? 0 : Number(fondoDejado),
      });
      setExito(`Cierre #${cierre.id} registrado.`);
      setMontoContado('');
      setFondoDejado('');
      cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar el cierre.');
    } finally {
      setEnviando(false);
      enviandoRef.current = false;
    }
  }

  if (cargando) {
    return <div className="card cierre-vacio">Cargando…</div>;
  }

  return (
    <div className="cierre-page">
      {error && <div className="alert alert-danger">{error}</div>}
      {exito && (
        <div className="alert" style={{ background: 'rgba(14,75,56,0.08)', color: '#0e4b38', border: '1px solid rgba(14,75,56,0.25)' }}>
          {exito}
        </div>
      )}

      <div className="cierre-body">
        <div className="card cierre-resumen">
          <span className="cierre-titulo">Ventas del turno por medio de pago</span>
          {MEDIOS.filter((medio) => medio.campo !== 'total_cta_cte' || moduloActivo('clientes_empresa') || (resumen?.total_cta_cte ?? 0) > 0).map((medio) => (
            <div className="cierre-medio-row" key={medio.campo}>
              <div className="cierre-medio-label">
                {ICONOS[medio.icono]}
                <span>{medio.label}</span>
              </div>
              <span className="cierre-medio-valor">{formatearMonto(resumen?.[medio.campo] ?? 0)}</span>
            </div>
          ))}
          <div className="cierre-total-row">
            <span>Total general</span>
            <span className="cierre-total-valor">{formatearMonto(resumen?.total_general ?? 0)}</span>
          </div>
        </div>

        <div className="card cierre-arqueo">
          <span className="cierre-titulo">Arqueo físico en efectivo</span>

          {(resumen?.fondo_heredado > 0 || resumen?.total_gastos > 0) && (
            <div className="cierre-desglose">
              {resumen.fondo_heredado > 0 && (
                <div className="cierre-desglose-row">
                  <span>+ Fondo dejado el cierre anterior</span>
                  <span>{formatearMonto(resumen.fondo_heredado)}</span>
                </div>
              )}
              {resumen.total_gastos > 0 && (
                <div className="cierre-desglose-row">
                  <span>− Gastos y pagos a proveedores de hoy</span>
                  <span>{formatearMonto(resumen.total_gastos)}</span>
                </div>
              )}
            </div>
          )}

          <div className="cierre-arqueo-row cierre-arqueo-destacado">
            <span>Total esperado en caja (efectivo)</span>
            <span>{formatearMonto(esperado)}</span>
          </div>

          {puedeCerrar ? (
            <>
              <div className="field">
                <label>Monto contado</label>
                <input
                  type="number"
                  min="0"
                  value={montoContado}
                  onChange={(e) => setMontoContado(e.target.value)}
                  placeholder="0"
                />
              </div>

              <div className="field">
                <label>Fondo a dejar (opcional)</label>
                <input
                  type="number"
                  min="0"
                  value={fondoDejado}
                  onChange={(e) => setFondoDejado(e.target.value)}
                  placeholder="0"
                />
              </div>

              {diferencia !== null && (
                <div
                  className="cierre-diferencia"
                  style={{
                    background: diferencia === 0 ? 'rgba(14,75,56,0.08)' : 'rgba(34,66,140,0.08)',
                    color: diferencia === 0 ? '#0e4b38' : '#22428c',
                  }}
                >
                  <span>{diferencia === 0 ? 'Caja exacta' : diferencia > 0 ? 'Diferencia (sobrante)' : 'Diferencia (faltante)'}</span>
                  <span>{formatearMonto(diferencia)}</span>
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 'auto', width: '100%', padding: '15px' }}
                disabled={contadoNumerico === null || enviando}
                onClick={confirmarCierre}
              >
                {enviando ? 'Registrando…' : 'Confirmar Cierre de Caja'}
              </button>
            </>
          ) : (
            <div className="cierre-hint">Solo Admin o Encargado pueden ejecutar el cierre. Vos podés ver los totales.</div>
          )}
        </div>
      </div>

      <div className="card cierre-historial">
        <span className="cierre-titulo">Cierres anteriores</span>
        {cierres.length === 0 ? (
          <div className="cierre-vacio">Todavía no se registró ningún cierre.</div>
        ) : (
          <div className="cierre-historial-tabla">
            <div className="cierre-historial-head">
              <span style={{ flex: 1 }}>Fecha</span>
              <span style={{ flex: 1, textAlign: 'right' }}>Total general</span>
              <span style={{ flex: 1, textAlign: 'right' }}>Diferencia efectivo</span>
              <span style={{ flex: 1, textAlign: 'right' }}>Fondo dejado</span>
            </div>
            {cierres.map((c) => (
              <div className="cierre-historial-row" key={c.id}>
                <span style={{ flex: 1 }}>{formatearFecha(c.fecha)}</span>
                <span style={{ flex: 1, textAlign: 'right', fontWeight: 700 }}>{formatearMonto(c.total_general)}</span>
                <span
                  style={{
                    flex: 1,
                    textAlign: 'right',
                    color: c.diferencia_efectivo === 0 ? 'inherit' : c.diferencia_efectivo < 0 ? 'var(--color-danger)' : 'var(--color-secondary)',
                  }}
                >
                  {formatearMonto(c.diferencia_efectivo)}
                </span>
                <span style={{ flex: 1, textAlign: 'right' }}>{c.fondo_dejado > 0 ? formatearMonto(c.fondo_dejado) : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
