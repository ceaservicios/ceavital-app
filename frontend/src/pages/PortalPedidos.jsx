import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearFechaHora, formatearMonto } from '../utils/format.js';
import { EstadoPedido, ItemsPedido } from './pedidosComun.jsx';
import './ClientesEmpresaPage.css';
import './Pedidos.css';

// Los pedidos del cliente y en qué estado están. Mientras uno está pendiente
// el cliente puede cancelarlo (eso libera el stock que tenía reservado).
export default function PortalPedidos({ onSesionVencida, avisoInicial }) {
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(avisoInicial ?? null);
  const [abierto, setAbierto] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const cancelandoRef = useRef(false);

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

  async function abrir(id) {
    setConfirmando(false);
    if (abierto === id) {
      setAbierto(null);
      setDetalle(null);
      return;
    }
    setAbierto(id);
    setDetalle(null);
    try {
      setDetalle(await api.get(`/portal/pedidos/${id}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSesionVencida();
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar el pedido.');
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
      setExito(`Cancelaste el pedido #${id}.`);
      setAbierto(null);
      setDetalle(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSesionVencida();
      // Puede que el negocio lo haya resuelto justo antes: se recarga para mostrarlo.
      setError(err instanceof ApiError ? err.message : 'No se pudo cancelar el pedido.');
    } finally {
      setConfirmando(false);
      await cargar();
      cancelandoRef.current = false;
      setCancelando(false);
    }
  }

  return (
    <div className="pedido-comprar">
      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      {cargando ? (
        <div className="cliente-vacio">Cargando…</div>
      ) : pedidos.length === 0 ? (
        <div className="card cliente-card">
          <div className="cliente-vacio">Todavía no hiciste ningún pedido. Armá el primero desde la pestaña Comprar.</div>
        </div>
      ) : (
        <ul className="pedido-lista">
          {pedidos.map((p) => (
            <li className="card pedido-tarjeta" key={p.id}>
              <button type="button" className="pedido-tarjeta-cabecera" aria-expanded={abierto === p.id} onClick={() => abrir(p.id)}>
                <span className="pedido-tarjeta-titulo">Pedido #{p.id}</span>
                <EstadoPedido estado={p.estado} />
                <span className="pedido-tarjeta-fecha">{formatearFechaHora(p.creado_en)}</span>
                <span className="pedido-tarjeta-total">{formatearMonto(p.total)}</span>
              </button>

              {abierto === p.id &&
                (!detalle ? (
                  <div className="cliente-vacio">Cargando…</div>
                ) : (
                  <div className="pedido-detalle">
                    {detalle.estado === 'pendiente' && (
                      <div className="pedido-motivo">Estamos revisando tu pedido. Cuando el negocio lo apruebe se suma a tu cuenta corriente.</div>
                    )}
                    {detalle.estado === 'aprobado' && (
                      <div className="pedido-motivo">Pedido aprobado: ya figura como compra en tu cuenta corriente.</div>
                    )}
                    {detalle.observaciones && (
                      <div className="pedido-motivo">
                        <strong>Tu nota:</strong> {detalle.observaciones}
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
                        <span>¿Cancelar el pedido #{p.id}? Se libera el stock que tenía reservado.</span>
                        <div className="pedido-confirmar-botones">
                          <button type="button" className="btn btn-primary" disabled={cancelando} onClick={() => cancelar(p.id)}>
                            {cancelando ? 'Cancelando…' : 'Sí, cancelar'}
                          </button>
                          <button type="button" className="btn" disabled={cancelando} onClick={() => setConfirmando(false)}>
                            Volver
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
