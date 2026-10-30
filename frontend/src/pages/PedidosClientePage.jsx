import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import ConAvatar from '../components/ConAvatar.jsx';
import Pestanas from '../components/Pestanas.jsx';
import { COLOR } from '../utils/colores.js';
import { formatearFechaHora, formatearMonto } from '../utils/format.js';
import { EstadoPedido, IconoDesplegar, ItemsPedido } from './pedidosComun.jsx';
import './ClientesEmpresaPage.css';
import './Pedidos.css';
import './ProveedoresPage.css';

const FILTROS = [
  { clave: 'pendiente', texto: 'Pendientes', icono: 'reloj', color: COLOR.ambar },
  { clave: 'aprobado', texto: 'Aprobados', icono: 'check', color: COLOR.verde },
  { clave: 'rechazado', texto: 'Rechazados', icono: 'alerta', color: COLOR.rojo },
  { clave: 'cancelado', texto: 'Cancelados', icono: 'menos', color: COLOR.gris },
  { clave: 'todos', texto: 'Todos', icono: 'grilla', color: COLOR.azul },
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
      // (si no, quedaba el detalle de A bajo la fila B y "Aprobar pedido" actuaba sobre B).
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
      setError('Indicá el motivo del rechazo: el cliente lo va a ver.');
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
        setExito(`Pedido #${id} rechazado. Se liberó el stock reservado.`);
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
      <Hero
        etiqueta="Monto pendiente"
        valor={formatearMonto(kpis.montoPendiente)}
        sub="Pedidos de clientes que esperan aprobación."
        minis={[
          { etiqueta: 'Pedidos pendientes', valor: kpis.pendientes, icono: 'reloj', tono: 'amarillo' },
          { etiqueta: 'Total de pedidos', valor: kpis.total, icono: 'ticket', tono: 'azul' },
        ]}
      />

      <Pestanas
        items={FILTROS.map((f) => ({ ...f, n: conteo(f.clave) }))}
        activa={filtro}
        onCambiar={(clave) => {
          setFiltro(clave);
          cerrarDetalle();
        }}
        etiqueta="Pedidos por estado"
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <div className="card cliente-card">
        {cargando ? (
          <div className="cliente-vacio">Cargando…</div>
        ) : visibles.length === 0 ? (
          <div className="cliente-vacio">
            {pedidos.length === 0
              ? 'Todavía no hay pedidos. Aparecen acá cuando un cliente los hace desde el portal.'
              : 'No hay pedidos en este estado.'}
          </div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla">
              <thead>
                <tr>
                  <th className="tabla-oculto-celu">N°</th>
                  <th className="tabla-oculto-celu">Fecha</th>
                  <th>Cliente</th>
                  <th className="num tabla-oculto-celu">Productos</th>
                  <th className="num">Total</th>
                  <th className="tabla-oculto-celu">Estado</th>
                  <th className="fila-desplegar" aria-label="Ver detalle" />
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => (
                  <Fragment key={p.id}>
                    <tr className={abierto === p.id ? 'pedido-fila-abierta' : undefined} onClick={() => abrir(p.id)}>
                      <td className="tabla-oculto-celu">#{p.id}</td>
                      <td className="tabla-oculto-celu">{formatearFechaHora(p.creado_en)}</td>
                      <td>
                        <ConAvatar id={p.cliente_empresa_id} nombre={p.cliente_razon_social}>
                          <div className="cliente-td-nombre">{p.cliente_razon_social}</div>
                          <div className="cliente-td-sub tabla-solo-celu">
                            Pedido #{p.id} · {formatearFechaHora(p.creado_en)}
                          </div>
                        </ConAvatar>
                      </td>
                      <td className="num tabla-oculto-celu">{p.cantidad_lineas}</td>
                      <td className="num pedido-total-celda">
                        {formatearMonto(p.total)}
                        <div className="tabla-solo-celu">
                          <EstadoPedido estado={p.estado} />
                        </div>
                      </td>
                      <td className="tabla-oculto-celu">
                        <EstadoPedido estado={p.estado} />
                      </td>
                      <td className="fila-desplegar">
                        <IconoDesplegar />
                      </td>
                    </tr>
                    {abierto === p.id && (
                      <tr className="pedido-fila-detalle sin-click">
                        <td colSpan={7}>
                          {cargandoDetalle || !detalle ? (
                            <div className="cliente-vacio">Cargando…</div>
                          ) : (
                            <div className="pedido-detalle">
                              <div className="pedido-detalle-cabecera">
                                <div className="pedido-detalle-meta">
                                  <span>
                                    Pedido <strong>#{detalle.id ?? p.id}</strong> · {formatearFechaHora(p.creado_en)}
                                  </span>
                                  {detalle.venta_id && (
                                    <span>
                                      Venta <strong>#{detalle.venta_id}</strong>
                                      {detalle.venta_estado === 'anulada' && ' (anulada)'}
                                    </span>
                                  )}
                                  {detalle.resuelto_por_nombre && (
                                    <span>
                                      Resuelto por <strong>{detalle.resuelto_por_nombre}</strong> · {formatearFechaHora(detalle.resuelto_en)}
                                    </span>
                                  )}
                                </div>
                                {detalle.estado === 'pendiente' && !accion && (
                                  <div className="pedido-acciones">
                                    <button type="button" className="btn" onClick={() => setAccion('rechazar')}>
                                      Rechazar pedido
                                    </button>
                                    <button type="button" className="btn btn-primary" onClick={() => setAccion('aprobar')}>
                                      Aprobar pedido
                                    </button>
                                  </div>
                                )}
                              </div>

                              {accion === 'aprobar' && (
                                <div className="pedido-confirmar">
                                  <span>
                                    <strong>¿Aprobar el pedido?</strong> Se descuenta el stock y se cargan{' '}
                                    <strong>{formatearMonto(detalle.total)}</strong> a la cuenta corriente de{' '}
                                    <strong>{detalle.cliente_razon_social}</strong>. Para revertirlo, hay que anular la venta desde Caja.
                                  </span>
                                  <div className="pedido-confirmar-botones">
                                    <button type="button" className="btn" disabled={enviando} onClick={() => setAccion(null)}>
                                      Cancelar
                                    </button>
                                    <button type="button" className="btn btn-primary" disabled={enviando} onClick={() => resolver('aprobar')}>
                                      {enviando ? 'Aprobando…' : 'Aprobar pedido'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {accion === 'rechazar' && (
                                <div className="pedido-confirmar">
                                  <label htmlFor="motivo-rechazo">Motivo del rechazo (lo va a ver el cliente)</label>
                                  <textarea
                                    id="motivo-rechazo"
                                    maxLength={500}
                                    value={motivo}
                                    onChange={(e) => setMotivo(e.target.value)}
                                    placeholder="Ej.: sin stock de ese producto hasta la semana próxima."
                                  />
                                  <div className="pedido-confirmar-botones">
                                    <button type="button" className="btn" disabled={enviando} onClick={() => setAccion(null)}>
                                      Cancelar
                                    </button>
                                    <button type="button" className="btn btn-peligro" disabled={enviando} onClick={() => resolver('rechazar')}>
                                      {enviando ? 'Rechazando…' : 'Rechazar pedido'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {detalle.observaciones && (
                                <div className="pedido-motivo">
                                  <strong>Observaciones del cliente:</strong> {detalle.observaciones}
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
