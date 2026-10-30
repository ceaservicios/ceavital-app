import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import { MigaFicha } from '../components/Topbar.jsx';
import { ConIcono } from '../components/ConAvatar.jsx';
import Pestanas from '../components/Pestanas.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { COLOR, colorDe, ICONO_ESTADO, ICONO_MEDIO_PAGO } from '../utils/colores.js';
import { formatearFecha, formatearFechaHora, formatearMonto } from '../utils/format.js';
import { sufijoPrecio, vendeSuelto } from '../utils/presentacion.js';
import { CeldaStock, IconoLapiz } from './stockComun.jsx';
import { IconoDesplegar } from './pedidosComun.jsx';
import {
  aFormularioProveedor,
  aPayloadProveedor,
  CamposPago,
  CamposProveedor,
  detallePago,
  EstadoCompra,
  estadoCompra,
  estadoDeuda,
  etiquetaMedioProveedor,
  ItemsCompra,
  PAGO_VACIO,
  pagoParaApi,
  textoComprobante,
  textoCorreccion,
} from './proveedoresComun.jsx';
import './ClientesEmpresaPage.css';
import './Pedidos.css';
import './StockPage.css';
import './ProveedoresPage.css';

const ETIQUETA_PEDIDO = { realizado: 'Realizado', pendiente: 'Pendiente', recibido: 'Recibido', cancelado: 'Cancelado' };

// Ficha del proveedor (2026-10-28; rediseño 2026-10-29): sus compras (cada una se despliega como
// un comprobante: productos, total, pagos y acciones), si se le pagó todo, una parte o nada, y
// cada pago con su medio. Los pedidos de antes (ya no se cargan) quedan como historial.
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

  // "Pagar" en Saldos pendientes (2026-10-29) llega con la compra elegida: se abre la pestaña Pagos
  // con esa compra y su saldo, una sola vez.
  const pagarCompra = location.state?.pagarCompra;
  const pagoPreparadoRef = useRef(false);
  useEffect(() => {
    if (!pagarCompra || pagoPreparadoRef.current || !detalle) return;
    pagoPreparadoRef.current = true;
    const compra = comprasConDeuda.find((c) => c.id === pagarCompra);
    if (!compra) return;
    setPago({ compra_id: String(compra.id), ...PAGO_VACIO(compra.total - compra.pagado) });
    setTab('pagos');
  }, [pagarCompra, detalle, comprasConDeuda]);

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

  // "Registrar pago" en una compra (o arriba): pestaña Pagos con esa compra y su saldo.
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
        setExito(tipo === 'compra' ? 'Compra anulada. Los productos se retiraron del stock.' : 'Pago anulado.');
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
        navigate('/proveedores', { replace: true, state: { exito: `Proveedor "${detalle.nombre}" eliminado.` } });
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
        <MigaFicha />
        {error && <div className="alert alert-danger">{error}</div>}
      </div>
    );
  }

  const deuda = estadoDeuda(detalle.saldo);
  const tabs = [
    { clave: 'compras', texto: 'Compras', n: detalle.compras.length, icono: 'carrito', color: COLOR.naranja },
    { clave: 'pagos', texto: 'Pagos', n: detalle.pagos.length, icono: 'billete', color: COLOR.teal },
    { clave: 'productos', texto: 'Productos', n: detalle.productos.length, icono: 'paquete', color: COLOR.cian },
    { clave: 'datos', texto: 'Datos', icono: 'ficha', color: COLOR.azul },
    ...(detalle.pedidos_anteriores.length ? [{ clave: 'pedidos', texto: 'Pedidos anteriores', icono: 'calendario', color: COLOR.gris }] : []),
  ];
  const confirmandoEste = (tipo, objetoId) => confirmando?.tipo === tipo && confirmando.id === objetoId;
  const contacto = [detalle.telefono, detalle.email, detalle.condicion_pago && `Condición de pago: ${detalle.condicion_pago}`].filter(Boolean);

  return (
    <div className="cliente-page proveedor-perfil">
      {/* El panel va primero, en el mismo lugar que en las demás pantallas; el nombre, debajo. */}
      <Hero
        etiqueta="Saldo pendiente"
        valor={formatearMonto(detalle.saldo)}
        sub={deuda.texto}
        minis={[
          { etiqueta: 'Total comprado', valor: formatearMonto(detalle.total_comprado), icono: 'carrito', tono: 'azul' },
          { etiqueta: 'Total pagado', valor: formatearMonto(detalle.total_pagado), icono: 'check', tono: 'verde' },
          {
            etiqueta: 'Última compra',
            valor: detalle.ultima_compra ? formatearFecha(detalle.ultima_compra) : '—',
            icono: 'calendario',
            tono: 'blanco',
          },
        ]}
      />

      <MigaFicha />
      <div className="ficha-cabecera">
        <div className="ficha-titulo">
          <h1 className="cliente-h1">{detalle.nombre}</h1>
          <span className={`cliente-badge cliente-badge-${deuda.clave}`}>{deuda.texto}</span>
        </div>
        <div className="cliente-subtitulo">{contacto.join(' · ') || 'Sin datos de contacto'}</div>
        <div className="ficha-acciones">
          <button type="button" className="btn" disabled={comprasConDeuda.length === 0} onClick={() => prepararPago()}>
            Registrar pago
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/proveedores/cargar?proveedor=${id}`)}>
            Ingresar mercadería
          </button>
        </div>
      </div>

      <Pestanas items={tabs} activa={tab} onCambiar={setTab} etiqueta="Secciones del proveedor" />

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      {tab === 'compras' && (
        <div className="card cliente-card">
          <span className="cliente-seccion-titulo">Compras</span>
          {detalle.compras.length === 0 ? (
            <div className="cliente-vacio">Sin compras registradas.</div>
          ) : (
            <div className="cliente-tabla-wrap">
              <table className="cliente-tabla">
                <thead>
                  <tr>
                    <th className="tabla-oculto-celu">Fecha</th>
                    <th>Comprobante</th>
                    <th className="num tabla-oculto-celu">Productos</th>
                    <th className="num">Total</th>
                    <th className="num tabla-oculto-celu">Pagado</th>
                    <th className="tabla-oculto-celu">Estado</th>
                    <th className="fila-desplegar" aria-label="Ver detalle" />
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
                          <td className="tabla-oculto-celu">{formatearFecha(c.fecha)}</td>
                          <td>
                            <ConIcono {...ICONO_ESTADO[estadoCompra(c).clave]}>
                              <div className="cliente-td-nombre">
                                {textoComprobante(c)}
                                {c.cargada_a_mano && <span className="tag tag-mano compra-tag">Cargada a mano</span>}
                                {c.correcciones.length > 0 && <span className="tag tag-corregido compra-tag">Corregida</span>}
                              </div>
                              <div className="cliente-td-sub tabla-solo-celu">
                                {formatearFecha(c.fecha)}
                                {!c.cargada_a_mano && ` · ${c.items.length} ${c.items.length === 1 ? 'producto' : 'productos'}`}
                              </div>
                            </ConIcono>
                          </td>
                          <td className="num tabla-oculto-celu">{c.cargada_a_mano ? '—' : c.items.length}</td>
                          <td className="num compra-celda-total">
                            {formatearMonto(c.total)}
                            <div className="tabla-solo-celu">
                              <EstadoCompra compra={c} />
                            </div>
                          </td>
                          <td className="num tabla-oculto-celu">{formatearMonto(c.pagado)}</td>
                          <td className="tabla-oculto-celu">
                            <EstadoCompra compra={c} />
                          </td>
                          <td className="fila-desplegar">
                            <IconoDesplegar />
                          </td>
                        </tr>
                        {abierta === c.id && (
                          <tr className="pedido-fila-detalle sin-click">
                            <td colSpan={7}>
                              <div className="pedido-detalle">
                                <div className="pedido-detalle-cabecera">
                                  <div className="pedido-detalle-meta">
                                    <span>
                                      Registrada por <strong>{c.usuario_nombre}</strong> · {formatearFechaHora(c.creado_en)}
                                    </span>
                                    {!c.anulada && c.total > c.pagado && (
                                      <span>
                                        El pago vence el <strong>{formatearFecha(c.vence)}</strong>
                                      </span>
                                    )}
                                    {c.anulada && (
                                      <span>
                                        Anulada por <strong>{c.anulada_por_nombre}</strong> · {formatearFechaHora(c.anulada_en)}
                                      </span>
                                    )}
                                  </div>
                                  {!c.anulada && (
                                    <div className="pedido-acciones">
                                      {c.total > c.pagado && (
                                        <button type="button" className="btn btn-primary" onClick={() => prepararPago(c)}>
                                          Registrar pago
                                        </button>
                                      )}
                                      {!confirmandoEste('compra', c.id) && (
                                        <button type="button" className="btn btn-peligro" onClick={() => setConfirmando({ tipo: 'compra', id: c.id })}>
                                          {c.cargada_a_mano ? 'Anular deuda' : 'Anular compra'}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {!c.anulada && confirmandoEste('compra', c.id) && (
                                  <div className="pedido-confirmar">
                                    {c.cargada_a_mano ? (
                                      <span>
                                        <strong>¿Anular esta deuda?</strong> Deja de figurar en lo que se le debe al proveedor. Solo es
                                        posible si no tiene pagos.
                                      </span>
                                    ) : (
                                      <span>
                                        <strong>¿Anular esta compra?</strong> Se retira del stock lo que ingresó con ella. Solo es posible si
                                        la compra no tiene pagos y no se vendió ninguno de sus productos.
                                      </span>
                                    )}
                                    <div className="pedido-confirmar-botones">
                                      <button type="button" className="btn" onClick={() => setConfirmando(null)}>
                                        Cancelar
                                      </button>
                                      <button type="button" className="btn btn-peligro" disabled={guardando} onClick={() => anular('compra', c.id)}>
                                        {c.cargada_a_mano ? 'Anular deuda' : 'Anular compra'}
                                      </button>
                                    </div>
                                  </div>
                                )}

                                <ItemsCompra items={c.items} total={c.total} pagado={c.anulada ? null : c.pagado} nota={c.nota} />

                                {c.correcciones.length > 0 && (
                                  <div className="compra-pagos">
                                    <span className="compra-subtitulo">Correcciones</span>
                                    {c.correcciones.map((x) => (
                                      <div key={x.id} className="compra-correccion">
                                        <span className="compra-correccion-cambio">{textoCorreccion(x)}</span>
                                        <span className="compra-correccion-meta">
                                          {formatearFechaHora(x.creado_en)} · {x.usuario_nombre} · {x.motivo}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {pagosDeLaCompra.length > 0 && (
                                  <div className="compra-pagos">
                                    <span className="compra-subtitulo">Pagos de la compra</span>
                                    {pagosDeLaCompra.map((p) => (
                                      <div key={p.id} className={`compra-pago${p.anulado ? ' compra-pago-anulado' : ''}`}>
                                        <span className="compra-pago-fecha">{formatearFecha(p.fecha)}</span>
                                        <span className="compra-pago-medio">{etiquetaMedioProveedor(p.medio)}</span>
                                        <span className="compra-pago-detalle">{p.anulado ? 'Anulado' : detallePago(p) || '—'}</span>
                                        <span className="compra-pago-monto">{formatearMonto(p.monto)}</span>
                                      </div>
                                    ))}
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
                <label>Compra</label>
                <select className="pago-compra-select" required value={pago.compra_id} onChange={(e) => elegirCompraDelPago(e.target.value)}>
                  <option value="">Seleccioná una compra…</option>
                  {comprasConDeuda.map((c) => (
                    <option key={c.id} value={c.id}>
                      {textoComprobante(c)} · {formatearFecha(c.fecha)} · saldo {formatearMonto(c.total - c.pagado)}
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
              <span className="cliente-seccion-titulo">Registrar pago</span>
              <div className="cliente-vacio">Sin saldo pendiente: todas las compras están pagadas.</div>
            </div>
          )}

          <div className="card cliente-card">
            <span className="cliente-seccion-titulo">Pagos registrados</span>
            {detalle.pagos.length === 0 ? (
              <div className="cliente-vacio">Todavía no hay pagos registrados.</div>
            ) : (
              <div className="cliente-tabla-wrap">
                <table className="cliente-tabla">
                  <thead>
                    <tr>
                      <th className="tabla-oculto-celu">Fecha</th>
                      <th>Compra</th>
                      <th className="tabla-oculto-celu">Medio de pago</th>
                      <th className="tabla-oculto-celu">Detalle</th>
                      <th className="tabla-oculto-celu">Registrado por</th>
                      <th className="num">Monto</th>
                      <th className="accion" aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.pagos.map((p) => {
                      const compra = textoComprobante({ comprobante_tipo: p.compra_comprobante_tipo, comprobante_numero: p.compra_comprobante_numero });
                      const info = p.anulado ? `Anulado por ${p.anulado_por_nombre}` : detallePago(p);
                      return (
                        <Fragment key={p.id}>
                          <tr className={`sin-click${p.anulado ? ' compra-fila-anulada' : ''}${confirmandoEste('pago', p.id) ? ' pedido-fila-abierta' : ''}`}>
                            <td className="tabla-oculto-celu">{formatearFecha(p.fecha)}</td>
                            <td>
                              <ConIcono {...(p.anulado ? ICONO_ESTADO.anulada : ICONO_MEDIO_PAGO[p.medio] ?? ICONO_ESTADO.anulada)}>
                                {compra}
                                <div className="cliente-td-sub tabla-solo-celu">
                                  {formatearFecha(p.fecha)} · {etiquetaMedioProveedor(p.medio)}
                                  {info && ` · ${info}`}
                                </div>
                              </ConIcono>
                            </td>
                            <td className="tabla-oculto-celu">{etiquetaMedioProveedor(p.medio)}</td>
                            <td className="cliente-td-sub tabla-oculto-celu">{info || <span className="dato-vacio">—</span>}</td>
                            <td className="tabla-oculto-celu">{p.usuario_nombre}</td>
                            <td className="num cliente-mov-monto">{formatearMonto(p.monto)}</td>
                            <td className="accion">
                              {!p.anulado && !confirmandoEste('pago', p.id) && (
                                <button type="button" className="cliente-link" onClick={() => setConfirmando({ tipo: 'pago', id: p.id })}>
                                  Anular
                                </button>
                              )}
                            </td>
                          </tr>
                          {!p.anulado && confirmandoEste('pago', p.id) && (
                            <tr className="sin-click pago-fila-confirmar">
                              <td colSpan={7}>
                                <div className="pedido-confirmar">
                                  <span>
                                    <strong>¿Anular este pago de {formatearMonto(p.monto)}?</strong> El monto vuelve a sumarse al saldo
                                    pendiente de la compra.
                                  </span>
                                  <div className="pedido-confirmar-botones">
                                    <button type="button" className="btn" onClick={() => setConfirmando(null)}>
                                      Cancelar
                                    </button>
                                    <button type="button" className="btn btn-peligro" disabled={guardando} onClick={() => anular('pago', p.id)}>
                                      Anular pago
                                    </button>
                                  </div>
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
        </>
      )}

      {tab === 'productos' && (
        <div className="card cliente-card tarjeta-angosta">
          <span className="cliente-seccion-titulo">Productos del proveedor</span>
          {detalle.productos.length === 0 ? (
            <div className="cliente-vacio">Sin productos asociados. El proveedor de cada producto se define en su ficha de Stock.</div>
          ) : (
            <div className="cliente-tabla-wrap">
              <table className="cliente-tabla prov-productos-tabla">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Stock</th>
                    <th className="num">Precio de venta</th>
                    <th className="accion" aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {detalle.productos.map((p) => (
                    <tr key={p.id} onClick={() => navigate(`/stock/${p.id}`)}>
                      <td className="cliente-td-nombre">
                        <ConIcono icono="paquete" color={colorDe(p.id)}>
                          {p.nombre}
                        </ConIcono>
                      </td>
                      <td className="num stock-td-stock">
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
        <form className="card cliente-card form-angosto" onSubmit={guardarDatos}>
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
                  <span>
                    <strong>¿Eliminar «{detalle.nombre}»?</strong> Deja de figurar en la lista de proveedores; su historial de compras y
                    pagos se conserva.
                  </span>
                  <div className="cliente-acciones">
                    <button type="button" className="btn" onClick={() => setConfirmando(null)}>
                      Cancelar
                    </button>
                    <button type="button" className="btn btn-peligro" disabled={guardando} onClick={eliminarProveedor}>
                      Eliminar proveedor
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
          <span className="cliente-hint">Pedidos registrados con el sistema anterior. Las compras nuevas se registran con «Ingresar mercadería».</span>
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
