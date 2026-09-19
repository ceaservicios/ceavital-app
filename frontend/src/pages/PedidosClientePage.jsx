import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearFechaHora, formatearMonto } from '../utils/format.js';
import { EstadoPedido, ItemsPedido } from './pedidosComun.jsx';
import './ClientesEmpresaPage.css';
import './Pedidos.css';

const FILTROS = [
  { clave: 'pendiente', texto: 'Pendientes' },
  { clave: 'aprobado', texto: 'Aprobados' },
  { clave: 'rechazado', texto: 'Rechazados' },
  { clave: 'cancelado', texto: 'Cancelados' },
  { clave: 'todos', texto: 'Todos' },
];

// Pedidos que los clientes-empresa arman desde su portal. Acá el negocio
// (Admin + Encargado) los aprueba o los rechaza. Aprobar genera una venta a
// cuenta corriente: descuenta el stock y le carga la deuda al cliente.
export default function PedidosClientePage() {
  const [pedidos, setPedidos] = useState([]);
  const [filtro, setFiltro] = useState('pendiente');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);

  const [abierto, setAbierto] = useState(null); // id del pedido desplegado
  const [detalle, setDetalle] = useState(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [accion, setAccion] = useState(null); // 'aprobar' | 'rechazar' (paso de confirmación)
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Un doble click sincrónico dispara dos requests antes de que React llegue a
  // deshabilitar el botón; aprobar dos veces movería stock y saldo.
  const enviandoRef = useRef(false);
  const abiertoRef = useRef(null); // el pedido desplegado ahora (para descartar respuestas viejas)

  const cargar = useCallback(async () => {
    try {
      const data = await api.get('/pedidos-cliente');
      setPedidos(data.pedidos);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los pedidos.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const kpis = useMemo(() => {
    const pendientes = pedidos.filter((p) => p.estado === 'pendiente');
    return {
      pendientes: pendientes.length,
      montoPendiente: pendientes.reduce((acc, p) => acc + p.total, 0),
      total: pedidos.length,
    };
  }, [pedidos]);

  const conteo = (clave) => (clave === 'todos' ? pedidos.length : pedidos.filter((p) => p.estado === clave).length);
  const visibles = filtro === 'todos' ? pedidos : pedidos.filter((p) => p.estado === filtro);

  function cerrarDetalle() {
    abiertoRef.current = null;
    setAbierto(null);
    setDetalle(null);
    setAccion(null);
    setMotivo('');
  }

  async function abrir(id) {
    if (abierto === id) {
      cerrarDetalle();
      return;
    }
    abiertoRef.current = id;
    setAbierto(id);
    setDetalle(null);
    setAccion(null);
    setMotivo('');
    setError(null);
    setExito(null);
    setCargandoDetalle(true);
    try {
      const cargado = await api.get(`/pedidos-cliente/${id}`);
      // Si mientras tanto se abrió otro pedido, esta respuesta ya no corresponde: descartarla
      // (si no, quedaba el detalle de A bajo la fila B y "Sí, aprobar" actuaba sobre B).
      if (abiertoRef.current === id) setDetalle(cargado);
    } catch (err) {
      if (abiertoRef.current === id) setError(err instanceof ApiError ? err.message : 'No se pudo cargar el pedido.');
    } finally {
      if (abiertoRef.current === id) setCargandoDetalle(false);
    }
  }

  async function resolver(tipo) {
    if (enviandoRef.current) return;
    if (tipo === 'rechazar' && !motivo.trim()) {
      setExito(null);
      setError('Escribí el motivo del rechazo: lo ve el cliente.');
      return;
    }
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    setExito(null);
    const id = abierto;
    try {
      if (tipo === 'aprobar') {
        const r = await api.post(`/pedidos-cliente/${id}/aprobar`);
        setExito(`Pedido #${id} aprobado. Se generó la venta #${r.venta.id} a cuenta corriente por ${formatearMonto(r.venta.total)}.`);
      } else {
        await api.post(`/pedidos-cliente/${id}/rechazar`, { motivo: motivo.trim() });
        setExito(`Pedido #${id} rechazado. La reserva de stock quedó liberada.`);
      }
      cerrarDetalle();
    } catch (err) {
      // Un 409 suele ser stock que ya no alcanza o un pedido que otro resolvió: se
      // muestra el motivo y se recarga para que la lista quede al día.
      setError(err instanceof ApiError ? err.message : 'No se pudo completar la acción.');
      setAccion(null);
    } finally {
      await cargar();
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <div className="cliente-page pedidos-page">
      <div className="cliente-kpis">
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Pedidos pendientes</span>
          <span className="cliente-kpi-value">{kpis.pendientes}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Monto pendiente</span>
          <span className="cliente-kpi-value">{formatearMonto(kpis.montoPendiente)}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Pedidos en total</span>
          <span className="cliente-kpi-value">{kpis.total}</span>
        </div>
      </div>

      <div className="cliente-tabs" role="tablist">
        {FILTROS.map((f) => (
          <button
            key={f.clave}
            type="button"
            role="tab"
            aria-selected={filtro === f.clave}
            className={`cliente-tab${filtro === f.clave ? ' cliente-tab-activa' : ''}`}
            onClick={() => {
              setFiltro(f.clave);
              cerrarDetalle();
            }}
          >
            {f.texto} ({conteo(f.clave)})
          </button>
        ))}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <div className="card cliente-card">
        {cargando ? (
          <div className="cliente-vacio">Cargando…</div>
        ) : visibles.length === 0 ? (
          <div className="cliente-vacio">
            {pedidos.length === 0
              ? 'Todavía no hay pedidos. Aparecen acá cuando un cliente arma uno desde su portal.'
              : 'No hay pedidos en este estado.'}
          </div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th className="num">Líneas</th>
                  <th className="num">Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => (
                  <Fragment key={p.id}>
                    <tr className={abierto === p.id ? 'pedido-fila-abierta' : undefined} onClick={() => abrir(p.id)}>
                      <td>#{p.id}</td>
                      <td>{formatearFechaHora(p.creado_en)}</td>
                      <td className="cliente-td-nombre">{p.cliente_razon_social}</td>
                      <td className="num">{p.cantidad_lineas}</td>
                      <td className="num">{formatearMonto(p.total)}</td>
                      <td>
                        <EstadoPedido estado={p.estado} />
                      </td>
                    </tr>
                    {abierto === p.id && (
                      <tr className="pedido-fila-detalle sin-click">
                        <td colSpan={6}>
                          {cargandoDetalle || !detalle ? (
                            <div className="cliente-vacio">Cargando…</div>
                          ) : (
                            <div className="pedido-detalle">
                              <div className="pedido-detalle-meta">
                                <span>
                                  Cliente: <strong>{detalle.cliente_razon_social}</strong>
                                </span>
                                {detalle.venta_id && (
                                  <span>
                                    Venta: <strong>#{detalle.venta_id}</strong>
                                    {detalle.venta_estado === 'anulada' && ' (anulada)'}
                                  </span>
                                )}
                                {detalle.resuelto_por_nombre && (
                                  <span>
                                    Resuelto por: <strong>{detalle.resuelto_por_nombre}</strong> · {formatearFechaHora(detalle.resuelto_en)}
                                  </span>
                                )}
                              </div>

                              {detalle.observaciones && (
                                <div className="pedido-motivo">
                                  <strong>Nota del cliente:</strong> {detalle.observaciones}
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

                              {detalle.estado === 'pendiente' && !accion && (
                                <div className="pedido-acciones">
                                  <button type="button" className="btn btn-primary" onClick={() => setAccion('aprobar')}>
                                    Aprobar pedido
                                  </button>
                                  <button type="button" className="btn" onClick={() => setAccion('rechazar')}>
                                    Rechazar
                                  </button>
                                </div>
                              )}

                              {accion === 'aprobar' && (
                                <div className="pedido-confirmar">
                                  <span>
                                    Al aprobar se descuenta el stock y se le carga <strong>{formatearMonto(detalle.total)}</strong> a la
                                    cuenta corriente de <strong>{detalle.cliente_razon_social}</strong> (si después hay que deshacerlo,
                                    se anula la venta desde Caja).
                                  </span>
                                  <div className="pedido-confirmar-botones">
                                    <button type="button" className="btn btn-primary" disabled={enviando} onClick={() => resolver('aprobar')}>
                                      {enviando ? 'Aprobando…' : 'Sí, aprobar'}
                                    </button>
                                    <button type="button" className="btn" disabled={enviando} onClick={() => setAccion(null)}>
                                      Volver
                                    </button>
                                  </div>
                                </div>
                              )}

                              {accion === 'rechazar' && (
                                <div className="pedido-confirmar">
                                  <label htmlFor="motivo-rechazo">Motivo del rechazo (lo ve el cliente)</label>
                                  <textarea
                                    id="motivo-rechazo"
                                    maxLength={500}
                                    value={motivo}
                                    onChange={(e) => setMotivo(e.target.value)}
                                    placeholder="Ej.: no tenemos ese producto hasta la semana próxima…"
                                  />
                                  <div className="pedido-confirmar-botones">
                                    <button type="button" className="btn btn-primary" disabled={enviando} onClick={() => resolver('rechazar')}>
                                      {enviando ? 'Rechazando…' : 'Confirmar rechazo'}
                                    </button>
                                    <button type="button" className="btn" disabled={enviando} onClick={() => setAccion(null)}>
                                      Volver
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
