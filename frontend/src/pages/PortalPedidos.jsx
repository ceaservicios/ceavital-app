import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { IconoFila } from '../components/ConAvatar.jsx';
import { ICONO_PEDIDO } from '../utils/colores.js';
import { formatearFechaHora, formatearMonto } from '../utils/format.js';
import { EstadoPedido, ItemsPedido } from './pedidosComun.jsx';
import './ClientesEmpresaPage.css';
import './Pedidos.css';

// Los pedidos del cliente y en qué estado están. Mientras uno está pendiente
// el cliente puede cancelarlo (eso libera el stock que tenía reservado).
// Rediseño 2026-10-29: una sola tarjeta con un renglón por pedido (número y fecha, estado, total)
// que se despliega; estilos propios en PortalPage.css (portal-pedido*).
export default function PortalPedidos({ onSesionVencida, avisoInicial, onCambio }) {
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(avisoInicial ?? null);
  const [abierto, setAbierto] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [errorDetalle, setErrorDetalle] = useState(null); // el detalle no se pudo cargar (en vez de "Cargando…" para siempre)
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const cancelandoRef = useRef(false);
  const abiertoRef = useRef(null); // el pedido desplegado ahora (para descartar respuestas viejas), como en PedidosClientePage

  const cargar = useCallback(async () => {
    try {
      const data = await api.get('/portal/pedidos');
      setPedidos(data.pedidos);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSesionVencida();
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar tus pedidos.');
    } finally {
      setCargando(false);
    }
  }, [onSesionVencida]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function cerrarDetalle() {
    abiertoRef.current = null;
    setAbierto(null);
    setDetalle(null);
    setErrorDetalle(null);
  }

  async function abrir(id) {
    setConfirmando(false);
    if (abierto === id) {
      cerrarDetalle();
      return;
    }
    abiertoRef.current = id;
    setAbierto(id);
    setDetalle(null);
    setErrorDetalle(null);
    try {
      const cargado = await api.get(`/portal/pedidos/${id}`);
      // Si mientras tanto se abrió otro pedido, esta respuesta ya no corresponde: se descarta
      // (si no, quedaba el detalle de A bajo la tarjeta B y "Sí, cancelar" cancelaba B).
      if (abiertoRef.current === id) setDetalle(cargado);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSesionVencida();
      if (abiertoRef.current === id) setErrorDetalle(err instanceof ApiError ? err.message : 'No se pudo cargar el pedido.');
    }
  }

  async function cancelar(id) {
    if (cancelandoRef.current) return;
    cancelandoRef.current = true;
    setCancelando(true);
    setError(null);
    setExito(null);
    try {
      await api.post(`/portal/pedidos/${id}/cancelar`);
      setExito(`Pedido #${id} cancelado.`);
      cerrarDetalle();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSesionVencida();
      // Puede que el negocio lo haya resuelto justo antes: se recarga para mostrarlo.
      setError(err instanceof ApiError ? err.message : 'No se pudo cancelar el pedido.');
    } finally {
      setConfirmando(false);
      await cargar();
      onCambio?.(); // el panel verde del portal cuenta los pedidos pendientes
      cancelandoRef.current = false;
      setCancelando(false);
    }
  }

  return (
    <div className="portal-comprar">
      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      {cargando ? (
        <div className="cliente-vacio">Cargando…</div>
      ) : pedidos.length === 0 ? (
        <div className="card cliente-card">
          <div className="cliente-vacio">Todavía no hay pedidos registrados. Podés armar uno desde la pestaña Comprar.</div>
        </div>
      ) : (
        <div className="card portal-pedidos">
          <div className="portal-pedidos-head" aria-hidden="true">
            <span>Pedido</span>
            <span>Estado</span>
            <span className="num">Total</span>
            <span />
          </div>
          <ul className="portal-pedidos-lista">
            {pedidos.map((p) => (
              <li className={`portal-pedido${abierto === p.id ? ' portal-pedido-abierto' : ''}`} key={p.id}>
                <button type="button" className="portal-pedido-cabecera" aria-expanded={abierto === p.id} onClick={() => abrir(p.id)}>
                  <span className="portal-pedido-id">
                    <IconoFila {...(ICONO_PEDIDO[p.estado] ?? ICONO_PEDIDO.cancelado)} />
                    <span className="portal-pedido-id-texto">
                      <span className="portal-pedido-titulo">Pedido #{p.id}</span>
                      <span className="portal-pedido-fecha">{formatearFechaHora(p.creado_en)}</span>
                    </span>
                  </span>
                  <span className="portal-pedido-estado">
                    <EstadoPedido estado={p.estado} />
                  </span>
                  <span className="portal-pedido-total num">{formatearMonto(p.total)}</span>
                  <span className="portal-pedido-flecha" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </button>

                {abierto === p.id &&
                  (errorDetalle ? (
                    <div className="pedido-detalle">
                      <div className="alert alert-danger">{errorDetalle}</div>
                    </div>
                  ) : !detalle ? (
                    <div className="cliente-vacio">Cargando…</div>
                  ) : (
                    <div className="pedido-detalle">
                      {detalle.estado === 'pendiente' && (
                        <div className="pedido-motivo">Pedido en revisión. Una vez aprobado, se registra en tu cuenta corriente.</div>
                      )}
                      {detalle.estado === 'aprobado' && (
                        <div className="pedido-motivo">Pedido aprobado. Ya figura como compra en tu cuenta corriente.</div>
                      )}
                      {detalle.observaciones && (
                        <div className="pedido-motivo">
                          <strong>Observaciones:</strong> {detalle.observaciones}
                        </div>
                      )}
                      {detalle.motivo_rechazo && (
                        <div className="pedido-motivo">
                          <strong>Motivo del rechazo:</strong> {detalle.motivo_rechazo}
                        </div>
                      )}
                      <div className="cliente-tabla-wrap">
                        <ItemsPedido items={detalle.items} total={detalle.total} />
                      </div>

                      {detalle.estado === 'pendiente' && !confirmando && (
                        <div className="pedido-acciones">
                          <button type="button" className="btn" onClick={() => setConfirmando(true)}>
                            Cancelar pedido
                          </button>
                        </div>
                      )}
                      {confirmando && (
                        <div className="pedido-confirmar">
                          <span>¿Cancelar el pedido #{p.id}? Se libera el stock reservado para este pedido.</span>
                          <div className="pedido-confirmar-botones">
                            <button type="button" className="btn" disabled={cancelando} onClick={() => setConfirmando(false)}>
                              Volver
                            </button>
                            <button type="button" className="btn btn-peligro" disabled={cancelando} onClick={() => cancelar(p.id)}>
                              {cancelando ? 'Cancelando…' : 'Cancelar pedido'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
