import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearFecha, formatearFechaHora, formatearMonto } from '../utils/format.js';
import { sufijoPrecio, vendeSuelto } from '../utils/presentacion.js';
import { CeldaStock, IconoLapiz } from './stockComun.jsx';
import {
  aFormularioProveedor,
  aPayloadProveedor,
  CamposPago,
  CamposProveedor,
  detallePago,
  EstadoCompra,
  estadoDeuda,
  etiquetaMedioProveedor,
  ItemsCompra,
  PAGO_VACIO,
  pagoParaApi,
  textoComprobante,
} from './proveedoresComun.jsx';
import './ClientesEmpresaPage.css';
import './Pedidos.css';
import './StockPage.css';
import './ProveedoresPage.css';

const ETIQUETA_PEDIDO = { realizado: 'Realizado', pendiente: 'Pendiente', recibido: 'Recibido', cancelado: 'Cancelado' };

// Perfil del proveedor (2026-10-28): lo que trajo, si se le pagó todo, una parte o nada, y cada
// pago con su medio. Los pedidos de antes (ya no se cargan) quedan como historial.
export default function ProveedorDetallePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';

  const [detalle, setDetalle] = useState(null);
  const [edicion, setEdicion] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState('compras');
  const [abierta, setAbierta] = useState(null); // compra desplegada
  const [pago, setPago] = useState({ compra_id: '', ...PAGO_VACIO() });
  const [confirmando, setConfirmando] = useState(null); // { tipo: 'compra' | 'pago' | 'proveedor', id }
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(location.state?.exito ?? null);
  // Guardia sincrónica: un pago duplicado altera la deuda real con el proveedor.
  const guardaRef = useRef(false);

  const aplicar = useCallback((data) => {
    setDetalle(data);
    setEdicion(aFormularioProveedor(data));
  }, []);

  useEffect(() => {
    api
      .get(`/proveedores/${id}`)
      .then(aplicar)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar el proveedor.'))
      .finally(() => setCargando(false));
  }, [id, aplicar]);

  const comprasConDeuda = useMemo(
    () => (detalle?.compras ?? []).filter((c) => !c.anulada && c.total > c.pagado).slice().reverse(), // la más vieja primero
    [detalle]
  );

  async function conGuardia(accion, mensajeError) {
    if (guardaRef.current) return;
    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    setExito(null);
    try {
      await accion();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : mensajeError);
    } finally {
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  // "Pagar" en una compra (o "Registrar pago" arriba): pestaña Pagos con esa compra y lo que falta.
  function prepararPago(compra = comprasConDeuda[0]) {
    setPago({ compra_id: compra ? String(compra.id) : '', ...PAGO_VACIO(compra ? compra.total - compra.pagado : '') });
    setTab('pagos');
  }

  function elegirCompraDelPago(compraId) {
    const compra = comprasConDeuda.find((c) => String(c.id) === compraId);
    setPago({ ...pago, compra_id: compraId, monto: compra ? String(compra.total - compra.pagado) : pago.monto });
  }

  function registrarPago(e) {
    e.preventDefault();
    const { error: falta, payload } = pagoParaApi(pago);
    if (falta) return setError(falta);
    return conGuardia(async () => {
      aplicar(await api.post(`/proveedores/${id}/pagos`, { compra_id: Number(pago.compra_id), ...payload }));
      setPago({ compra_id: '', ...PAGO_VACIO() });
      setExito(
        payload.sale_de_caja ? 'Pago registrado. Se descontó del efectivo de la caja.' : 'Pago registrado.'
      );
    }, 'No se pudo registrar el pago.');
  }

  function anular(tipo, objetoId) {
    const ruta = tipo === 'compra' ? `compras/${objetoId}` : `pagos/${objetoId}`;
    return conGuardia(async () => {
      try {
        aplicar(await api.post(`/proveedores/${id}/${ruta}/anular`, {}));
        setExito(tipo === 'compra' ? 'Compra anulada: lo que había entrado se retiró del stock.' : 'Pago anulado.');
      } finally {
        setConfirmando(null);
      }
    }, tipo === 'compra' ? 'No se pudo anular la compra.' : 'No se pudo anular el pago.');
  }

  function guardarDatos(e) {
    e.preventDefault();
    return conGuardia(async () => {
      const actualizado = await api.patch(`/proveedores/${id}`, aPayloadProveedor(edicion));
      aplicar({ ...detalle, ...actualizado });
      setExito('Cambios guardados.');
    }, 'No se pudieron guardar los cambios.');
  }

  function eliminarProveedor() {
    return conGuardia(async () => {
      try {
        await api.delete(`/proveedores/${id}`);
        navigate('/proveedores', { replace: true, state: { exito: `"${detalle.nombre}" se eliminó.` } });
      } catch (err) {
        setConfirmando(null);
        throw err;
      }
    }, 'No se pudo eliminar el proveedor.');
  }

  if (cargando) return <div className="cliente-vacio">Cargando…</div>;
  if (!detalle) {
    return (
      <div className="cliente-page">
        <Link to="/proveedores" className="cliente-volver">
          ← Volver a proveedores
        </Link>
        {error && <div className="alert alert-danger">{error}</div>}
      </div>
    );
  }

  const deuda = estadoDeuda(detalle.saldo);
  const tabs = [
    { clave: 'compras', texto: `Mercadería (${detalle.compras.length})` },
    { clave: 'pagos', texto: `Pagos (${detalle.pagos.length})` },
    { clave: 'productos', texto: `Productos (${detalle.productos.length})` },
    { clave: 'datos', texto: 'Datos' },
    ...(detalle.pedidos_anteriores.length ? [{ clave: 'pedidos', texto: 'Pedidos anteriores' }] : []),
  ];
  const confirmandoEste = (tipo, objetoId) => confirmando?.tipo === tipo && confirmando.id === objetoId;

  return (
    <div className="cliente-page proveedor-perfil">
      <div className="cliente-encabezado">
        <Link to="/proveedores" className="cliente-volver">
          ← Volver a proveedores
        </Link>
        <div className="proveedor-titulo">
          <div className="cliente-titulo-fila">
            <h1 className="cliente-h1">{detalle.nombre}</h1>
            <span className={`cliente-badge cliente-badge-${deuda.clave}`}>
              {detalle.saldo > 0 ? `Le debés ${formatearMonto(detalle.saldo)}` : 'Al día'}
            </span>
          </div>
          <div className="proveedor-titulo-acciones">
            <button type="button" className="btn" disabled={comprasConDeuda.length === 0} onClick={() => prepararPago()}>
              Registrar pago
            </button>
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/proveedores/cargar?proveedor=${id}`)}>
              Cargar mercadería
            </button>
          </div>
        </div>
        <div className="cliente-subtitulo">
          {[detalle.telefono, detalle.email, detalle.condicion_pago].filter(Boolean).join(' · ') || 'Sin teléfono, email ni condición de pago'}
        </div>
      </div>

      <div className="cliente-kpis">
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Le debés</span>
          <span className={`cliente-kpi-value cliente-saldo-${deuda.clave}`}>{formatearMonto(detalle.saldo)}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Total comprado</span>
          <span className="cliente-kpi-value">{formatearMonto(detalle.total_comprado)}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Total pagado</span>
          <span className="cliente-kpi-value">{formatearMonto(detalle.total_pagado)}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Última compra</span>
          <span className="cliente-kpi-value cliente-kpi-texto">{detalle.ultima_compra ? formatearFecha(detalle.ultima_compra) : '—'}</span>
        </div>
      </div>

      <div className="cliente-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.clave}
            type="button"
            role="tab"
            aria-selected={tab === t.clave}
            className={`cliente-tab${tab === t.clave ? ' cliente-tab-activa' : ''}`}
            onClick={() => setTab(t.clave)}
          >
            {t.texto}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      {tab === 'compras' && (
        <div className="card cliente-card">
          <div className="cliente-seccion-cabecera">
            <span className="cliente-seccion-titulo">Mercadería que trajo</span>
            <span className="cliente-hint">Tocá una para ver qué trajo y sus pagos.</span>
          </div>
          {detalle.compras.length === 0 ? (
            <div className="cliente-vacio">Todavía no se le cargó mercadería. Usá «Cargar mercadería».</div>
          ) : (
            <div className="cliente-tabla-wrap">
              <table className="cliente-tabla">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Comprobante</th>
                    <th className="num">Productos</th>
                    <th className="num">Total</th>
                    <th className="num">Pagado</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.compras.map((c) => {
                    const pagosDeLaCompra = detalle.pagos.filter((p) => p.compra_id === c.id);
                    return (
                      <Fragment key={c.id}>
                        <tr
                          className={`${abierta === c.id ? 'pedido-fila-abierta' : ''}${c.anulada ? ' compra-fila-anulada' : ''}`}
                          onClick={() => setAbierta(abierta === c.id ? null : c.id)}
                        >
                          <td>{formatearFecha(c.fecha)}</td>
                          <td className="cliente-td-nombre">{textoComprobante(c)}</td>
                          <td className="num">{c.items.length}</td>
                          <td className="num">{formatearMonto(c.total)}</td>
                          <td className="num">{formatearMonto(c.pagado)}</td>
                          <td>
                            <EstadoCompra compra={c} />
                          </td>
                        </tr>
                        {abierta === c.id && (
                          <tr className="pedido-fila-detalle sin-click">
                            <td colSpan={6}>
                              <div className="pedido-detalle">
                                <div className="pedido-detalle-meta">
                                  <span>
                                    Cargó: <strong>{c.usuario_nombre}</strong> · {formatearFechaHora(c.creado_en)}
                                  </span>
                                  {!c.anulada && c.total > c.pagado && (
                                    <span>
                                      Falta pagar: <strong>{formatearMonto(c.total - c.pagado)}</strong>
                                    </span>
                                  )}
                                  {c.anulada && (
                                    <span>
                                      Anulada por <strong>{c.anulada_por_nombre}</strong> · {formatearFechaHora(c.anulada_en)}
                                    </span>
                                  )}
                                </div>
                                <div className="cliente-tabla-wrap">
                                  <ItemsCompra items={c.items} total={c.total} />
                                </div>
                                {pagosDeLaCompra.length > 0 && (
                                  <div className="compra-pagos">
                                    <span className="stock-section-label">Pagos de esta compra</span>
                                    {pagosDeLaCompra.map((p) => (
                                      <div key={p.id} className={`compra-pago${p.anulado ? ' compra-pago-anulado' : ''}`}>
                                        <span>{formatearFecha(p.fecha)}</span>
                                        <span>{etiquetaMedioProveedor(p.medio)}</span>
                                        <span className="cliente-td-sub">{p.anulado ? 'Anulado' : detallePago(p)}</span>
                                        <strong>{formatearMonto(p.monto)}</strong>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {!c.anulada && (
                                  <div className="pedido-acciones">
                                    {c.total > c.pagado && (
                                      <button type="button" className="btn btn-primary" onClick={() => prepararPago(c)}>
                                        Pagar
                                      </button>
                                    )}
                                    {confirmandoEste('compra', c.id) ? (
                                      <div className="pedido-confirmar">
                                        <span>
                                          ¿Anular esta compra? Se retira del stock lo que entró con ella. Solo se puede si todavía no se
                                          vendió nada de eso y no tiene pagos.
                                        </span>
                                        <div className="pedido-confirmar-botones">
                                          <button type="button" className="btn" onClick={() => setConfirmando(null)}>
                                            No
                                          </button>
                                          <button type="button" className="btn btn-peligro" disabled={guardando} onClick={() => anular('compra', c.id)}>
                                            Sí, anular
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <button type="button" className="btn btn-peligro" onClick={() => setConfirmando({ tipo: 'compra', id: c.id })}>
                                        Anular compra
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'pagos' && (
        <>
          {comprasConDeuda.length > 0 ? (
            <form className="card cliente-card" onSubmit={registrarPago}>
              <span className="cliente-seccion-titulo">Registrar pago</span>
              <div className="field">
                <label>Qué le pagás</label>
                <select required value={pago.compra_id} onChange={(e) => elegirCompraDelPago(e.target.value)}>
                  <option value="">Elegí la compra…</option>
                  {comprasConDeuda.map((c) => (
                    <option key={c.id} value={c.id}>
                      {textoComprobante(c)} · {formatearFecha(c.fecha)} · falta {formatearMonto(c.total - c.pagado)}
                    </option>
                  ))}
                </select>
              </div>
              <CamposPago pago={pago} setPago={setPago} />
              <div className="cliente-acciones">
                <button type="submit" className="btn btn-primary" disabled={guardando}>
                  Registrar pago
                </button>
              </div>
            </form>
          ) : (
            <div className="card cliente-card">
              <span className="cliente-hint">No le debés nada a este proveedor: todas sus compras están pagadas.</span>
            </div>
          )}

          <div className="card cliente-card">
            <span className="cliente-seccion-titulo">Pagos</span>
            {detalle.pagos.length === 0 ? (
              <div className="cliente-vacio">Todavía no se le registraron pagos.</div>
            ) : (
              <div className="cliente-tabla-wrap">
                <table className="cliente-tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Compra</th>
                      <th>Medio</th>
                      <th>Detalle</th>
                      <th>Registró</th>
                      <th className="num">Monto</th>
                      <th className="accion" aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.pagos.map((p) => (
                      <tr key={p.id} className={`sin-click${p.anulado ? ' compra-fila-anulada' : ''}`}>
                        <td>{formatearFecha(p.fecha)}</td>
                        <td>{textoComprobante({ comprobante_tipo: p.compra_comprobante_tipo, comprobante_numero: p.compra_comprobante_numero })}</td>
                        <td>{etiquetaMedioProveedor(p.medio)}</td>
                        <td className="cliente-td-sub">{p.anulado ? `Anulado por ${p.anulado_por_nombre}` : detallePago(p) || '—'}</td>
                        <td>{p.usuario_nombre}</td>
                        <td className="num cliente-mov-monto">{formatearMonto(p.monto)}</td>
                        <td className="accion">
                          {!p.anulado &&
                            (confirmandoEste('pago', p.id) ? (
                              <span className="pago-confirmar">
                                <button type="button" className="btn" onClick={() => setConfirmando(null)}>
                                  No
                                </button>
                                <button type="button" className="btn btn-peligro" disabled={guardando} onClick={() => anular('pago', p.id)}>
                                  Anular
                                </button>
                              </span>
                            ) : (
                              <button type="button" className="cliente-link" onClick={() => setConfirmando({ tipo: 'pago', id: p.id })}>
                                Anular
                              </button>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'productos' && (
        <div className="card cliente-card">
          <span className="cliente-seccion-titulo">Productos que provee</span>
          {detalle.productos.length === 0 ? (
            <div className="cliente-vacio">Sin productos vinculados: el proveedor de cada producto se elige en Stock.</div>
          ) : (
            <div className="cliente-tabla-wrap">
              <table className="cliente-tabla">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="centro">Stock</th>
                    <th className="num">Precio</th>
                    <th className="accion" aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {detalle.productos.map((p) => (
                    <tr key={p.id} onClick={() => navigate(`/stock/${p.id}`)}>
                      <td className="cliente-td-nombre">{p.nombre}</td>
                      <td className="centro stock-td-stock">
                        <CeldaStock producto={p} />
                      </td>
                      <td className="num">
                        {vendeSuelto(p) ? `${formatearMonto(p.precio_venta)}${sufijoPrecio(p.medida)}` : formatearMonto(p.precio_pack)}
                      </td>
                      <td className="accion">
                        <button type="button" className="boton-icono" title="Editar producto" aria-label={`Editar ${p.nombre}`}>
                          <IconoLapiz />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'datos' && (
        <form className="card cliente-card" onSubmit={guardarDatos}>
          <span className="cliente-seccion-titulo">Datos del proveedor</span>
          <CamposProveedor form={edicion} setForm={setEdicion} />
          <div className="cliente-acciones">
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              Guardar cambios
            </button>
          </div>
          {esAdmin && (
            <div className="cliente-eliminar">
              {!confirmandoEste('proveedor', detalle.id) ? (
                <button type="button" className="cliente-eliminar-link" onClick={() => setConfirmando({ tipo: 'proveedor', id: detalle.id })}>
                  Eliminar proveedor
                </button>
              ) : (
                <div className="cliente-eliminar-confirm">
                  <span>¿Eliminar "{detalle.nombre}"? Su historial de compras y pagos se conserva.</span>
                  <div className="cliente-acciones">
                    <button type="button" className="btn" onClick={() => setConfirmando(null)}>
                      Cancelar
                    </button>
                    <button type="button" className="btn btn-peligro" disabled={guardando} onClick={eliminarProveedor}>
                      Sí, eliminar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </form>
      )}

      {tab === 'pedidos' && (
        <div className="card cliente-card">
          <span className="cliente-seccion-titulo">Pedidos anteriores</span>
          <span className="cliente-hint">
            Historial de los pedidos que se cargaban antes. Ahora la mercadería se carga con «Cargar mercadería» y se suma al stock.
          </span>
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th>Productos</th>
                </tr>
              </thead>
              <tbody>
                {detalle.pedidos_anteriores.map((p) => (
                  <tr key={p.id} className="sin-click">
                    <td>{formatearFecha(p.fecha)}</td>
                    <td>{ETIQUETA_PEDIDO[p.estado] ?? p.estado}</td>
                    <td>{p.items.map((i) => `${i.producto_nombre} × ${i.cantidad}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
