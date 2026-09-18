import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearFecha, formatearMonto, fechaHoyISO } from '../utils/format.js';
import './ProveedoresPage.css';

const ESTADOS_PEDIDO = ['realizado', 'pendiente', 'recibido', 'cancelado'];
const ETIQUETA_ESTADO = {
  realizado: 'Realizado',
  pendiente: 'Pendiente',
  recibido: 'Recibido',
  cancelado: 'Cancelado',
};

const PROVEEDOR_VACIO = { nombre: '', telefono: '', email: '', condicion_pago: '' };

export default function ProveedoresPage() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';

  const [proveedores, setProveedores] = useState([]);
  const [productos, setProductos] = useState([]);
  const [pedidosPorProveedor, setPedidosPorProveedor] = useState({}); // { [proveedorId]: pedido[] }
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [panel, setPanel] = useState('ninguno'); // 'ninguno' | 'nuevo-proveedor' | 'detalle'
  const [detalle, setDetalle] = useState(null);
  const [edicion, setEdicion] = useState(null);
  const [nuevoProveedor, setNuevoProveedor] = useState(PROVEEDOR_VACIO);
  const [nuevoPedido, setNuevoPedido] = useState({ fecha: fechaHoyISO(), estado: 'realizado', items: [{ producto_id: '', cantidad: '' }] });
  const [confirmandoEliminarProveedor, setConfirmandoEliminarProveedor] = useState(false);
  const [confirmandoEliminarPedido, setConfirmandoEliminarPedido] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [panelError, setPanelError] = useState(null);
  const [panelExito, setPanelExito] = useState(null);
  // Guardia real contra doble-click en "Sí, eliminar" (hallazgo Baja #3,
  // verificador-funcional 2026-09-10) -- ref mutado sincrónicamente, no
  // depende de que React ya haya re-renderizado con `guardando=true`.
  const eliminandoRef = useRef(false);

  const mapaProductos = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);

  async function cargarTodo() {
    setCargando(true);
    setError(null);
    try {
      const [dataProveedores, dataProductos] = await Promise.all([api.get('/proveedores'), api.get('/productos')]);
      setProveedores(dataProveedores.proveedores);
      setProductos(dataProductos.productos);

      const entradas = await Promise.all(
        dataProveedores.proveedores.map(async (p) => {
          const { pedidos } = await api.get(`/proveedores/${p.id}/pedidos`);
          return [p.id, pedidos];
        })
      );
      setPedidosPorProveedor(Object.fromEntries(entradas));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los proveedores.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarTodo();
  }, []);

  const proveedoresFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return proveedores;
    return proveedores.filter((p) => p.nombre.toLowerCase().includes(texto));
  }, [proveedores, busqueda]);

  const todosPedidos = useMemo(() => {
    const mapaNombres = new Map(proveedores.map((p) => [p.id, p.nombre]));
    return Object.entries(pedidosPorProveedor)
      .flatMap(([proveedorId, pedidos]) =>
        pedidos.map((p) => ({ ...p, proveedor_nombre: mapaNombres.get(Number(proveedorId)) }))
      )
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
      .slice(0, 15);
  }, [pedidosPorProveedor, proveedores]);

  const kpis = useMemo(() => {
    const todos = Object.values(pedidosPorProveedor).flat();
    const hoy = fechaHoyISO();
    const mesActual = hoy.slice(0, 7);
    return {
      proveedoresActivos: proveedores.length,
      pendientes: todos.filter((p) => p.estado === 'pendiente').length,
      recibidosEsteMes: todos.filter((p) => p.estado === 'recibido' && p.fecha.slice(0, 7) === mesActual).length,
    };
  }, [proveedores, pedidosPorProveedor]);

  function productosDe(proveedorId) {
    return productos.filter((p) => p.proveedor_id === proveedorId);
  }

  async function abrirDetalle(proveedor) {
    setPanel('detalle');
    setPanelError(null);
    setPanelExito(null);
    setConfirmandoEliminarProveedor(false);
    setDetalle(proveedor);
    setEdicion({
      nombre: proveedor.nombre,
      telefono: proveedor.telefono ?? '',
      email: proveedor.email ?? '',
      condicion_pago: proveedor.condicion_pago ?? '',
    });
    setNuevoPedido({ fecha: fechaHoyISO(), estado: 'realizado', items: [{ producto_id: '', cantidad: '' }] });
  }

  function abrirNuevoProveedor() {
    setPanel('nuevo-proveedor');
    setNuevoProveedor(PROVEEDOR_VACIO);
    setPanelError(null);
    setPanelExito(null);
  }

  function cerrarPanel() {
    setPanel('ninguno');
    setDetalle(null);
    setEdicion(null);
    setPanelError(null);
    setPanelExito(null);
  }

  async function crearProveedor(e) {
    e.preventDefault();
    setGuardando(true);
    setPanelError(null);
    try {
      await api.post('/proveedores', {
        nombre: nuevoProveedor.nombre,
        telefono: nuevoProveedor.telefono || null,
        email: nuevoProveedor.email || null,
        condicion_pago: nuevoProveedor.condicion_pago || null,
      });
      await cargarTodo();
      cerrarPanel();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo crear el proveedor.');
    } finally {
      setGuardando(false);
    }
  }

  async function guardarProveedor() {
    setGuardando(true);
    setPanelError(null);
    try {
      const actualizado = await api.patch(`/proveedores/${detalle.id}`, {
        nombre: edicion.nombre,
        telefono: edicion.telefono || null,
        email: edicion.email || null,
        condicion_pago: edicion.condicion_pago || null,
      });
      setDetalle(actualizado);
      setPanelExito('Cambios guardados.');
      cargarTodo();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudieron guardar los cambios.');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarProveedor() {
    if (eliminandoRef.current) return;
    eliminandoRef.current = true;
    setGuardando(true);
    setPanelError(null);
    try {
      await api.delete(`/proveedores/${detalle.id}`);
      cerrarPanel();
      cargarTodo();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo eliminar el proveedor.');
      setConfirmandoEliminarProveedor(false);
    } finally {
      setGuardando(false);
      eliminandoRef.current = false;
    }
  }

  function actualizarItemPedido(i, campo, valor) {
    setNuevoPedido((prev) => ({
      ...prev,
      items: prev.items.map((item, idx) => (idx === i ? { ...item, [campo]: valor } : item)),
    }));
  }

  function agregarFilaItem() {
    setNuevoPedido((prev) => ({ ...prev, items: [...prev.items, { producto_id: '', cantidad: '' }] }));
  }

  function quitarFilaItem(i) {
    setNuevoPedido((prev) => ({ ...prev, items: prev.items.filter((_, idx) => idx !== i) }));
  }

  async function crearPedido(e) {
    e.preventDefault();
    setGuardando(true);
    setPanelError(null);
    try {
      const items = nuevoPedido.items
        .filter((it) => it.producto_id !== '')
        .map((it) => ({ producto_id: Number(it.producto_id), cantidad: Number(it.cantidad) }));
      if (items.length === 0) throw new ApiError('Agregá al menos un producto.', 400);

      await api.post(`/proveedores/${detalle.id}/pedidos`, { fecha: nuevoPedido.fecha, estado: nuevoPedido.estado, items });
      setNuevoPedido({ fecha: fechaHoyISO(), estado: 'realizado', items: [{ producto_id: '', cantidad: '' }] });
      setPanelExito('Pedido registrado.');
      cargarTodo();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo registrar el pedido.');
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstadoPedido(pedido, estado) {
    setPanelError(null);
    try {
      await api.patch(`/proveedores/${detalle.id}/pedidos/${pedido.id}`, { estado });
      cargarTodo();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo actualizar el pedido.');
    }
  }

  async function eliminarPedido(pedido) {
    setPanelError(null);
    try {
      await api.delete(`/proveedores/${detalle.id}/pedidos/${pedido.id}`);
      setConfirmandoEliminarPedido(null);
      cargarTodo();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo eliminar el pedido.');
    }
  }

  const pedidosDelDetalle = detalle ? pedidosPorProveedor[detalle.id] ?? [] : [];
  const productosDelDetalle = detalle ? productosDe(detalle.id) : [];

  return (
    <div className="proveedores-page">
      <div className="proveedores-kpis">
        <div className="card proveedores-kpi">
          <span className="proveedores-kpi-label">Proveedores activos</span>
          <span className="proveedores-kpi-value">{kpis.proveedoresActivos}</span>
        </div>
        <div className="card proveedores-kpi">
          <span className="proveedores-kpi-label">Pedidos pendientes</span>
          <span className="proveedores-kpi-value">{kpis.pendientes}</span>
        </div>
        <div className="card proveedores-kpi">
          <span className="proveedores-kpi-label">Recibidos este mes</span>
          <span className="proveedores-kpi-value">{kpis.recibidosEsteMes}</span>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="proveedores-body">
        <div className="proveedores-listas">
          <div className="card proveedores-card">
            <span className="proveedores-card-titulo">Pedidos recientes</span>
            {cargando ? (
              <div className="proveedores-vacio">Cargando…</div>
            ) : todosPedidos.length === 0 ? (
              <div className="proveedores-vacio">Todavía no hay pedidos cargados.</div>
            ) : (
              <div className="proveedores-tabla">
                <div className="proveedores-tabla-head">
                  <span style={{ flex: 1.4 }}>Proveedor</span>
                  <span style={{ flex: 0.8 }}>Fecha</span>
                  <span style={{ flex: 0.7, textAlign: 'center' }}>Ítems</span>
                  <span style={{ flex: 0.9 }}>Estado</span>
                </div>
                {todosPedidos.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className="proveedores-fila"
                    onClick={() => {
                      const prov = proveedores.find((x) => x.id === p.proveedor_id);
                      if (prov) abrirDetalle(prov);
                    }}
                  >
                    <span style={{ flex: 1.4 }} className="proveedores-fila-nombre">
                      {p.proveedor_nombre}
                    </span>
                    <span style={{ flex: 0.8 }}>{formatearFecha(p.fecha)}</span>
                    <span style={{ flex: 0.7, textAlign: 'center', fontWeight: 700 }}>—</span>
                    <span style={{ flex: 0.9 }}>
                      <span className={`proveedores-badge proveedores-badge-${p.estado}`}>{ETIQUETA_ESTADO[p.estado]}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card proveedores-card">
            <div className="proveedores-card-header">
              <span className="proveedores-card-titulo">Proveedores</span>
              <div className="proveedores-search">
                <input
                  type="text"
                  placeholder="Buscar proveedor…"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
              </div>
              <button type="button" className="btn btn-primary" onClick={abrirNuevoProveedor}>
                + Nuevo Proveedor
              </button>
            </div>
            {cargando ? (
              <div className="proveedores-vacio">Cargando…</div>
            ) : proveedoresFiltrados.length === 0 ? (
              <div className="proveedores-vacio">
                {proveedores.length === 0 ? 'Todavía no hay proveedores cargados.' : 'Sin resultados.'}
              </div>
            ) : (
              <div className="proveedores-tabla">
                <div className="proveedores-tabla-head">
                  <span style={{ flex: 1.3 }}>Nombre</span>
                  <span style={{ flex: 1.6 }}>Contacto</span>
                  <span style={{ flex: 1 }}>Cond. de pago</span>
                  <span style={{ flex: 0.8, textAlign: 'center' }}>Productos</span>
                </div>
                {proveedoresFiltrados.map((p) => (
                  <button type="button" key={p.id} className="proveedores-fila" onClick={() => abrirDetalle(p)}>
                    <span style={{ flex: 1.3 }} className="proveedores-fila-nombre">
                      {p.nombre}
                    </span>
                    <span style={{ flex: 1.6 }} className="proveedores-fila-muted">
                      {p.telefono || p.email ? (
                        <>
                          {p.telefono && <div>{p.telefono}</div>}
                          {p.email && (
                            <div className="celda-ellipsis" title={p.email}>
                              {p.email}
                            </div>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </span>
                    <span style={{ flex: 1 }} className="proveedores-fila-muted">
                      {p.condicion_pago || '—'}
                    </span>
                    <span style={{ flex: 0.8, textAlign: 'center', fontWeight: 700 }}>{productosDe(p.id).length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card proveedores-panel">
          {panel === 'ninguno' && (
            <div className="proveedores-panel-vacio">Seleccioná un proveedor para ver el detalle o cargar un pedido.</div>
          )}

          {panel === 'nuevo-proveedor' && (
            <form className="proveedores-form" onSubmit={crearProveedor}>
              <div className="proveedores-panel-titulo">
                <span>Nuevo Proveedor</span>
                <button type="button" className="proveedores-panel-cerrar" onClick={cerrarPanel}>
                  ✕
                </button>
              </div>
              {panelError && <div className="alert alert-danger">{panelError}</div>}
              <div className="field">
                <label>Nombre / Razón social</label>
                <input required value={nuevoProveedor.nombre} onChange={(e) => setNuevoProveedor({ ...nuevoProveedor, nombre: e.target.value })} />
              </div>
              <div className="field">
                <label>Teléfono</label>
                <input value={nuevoProveedor.telefono} onChange={(e) => setNuevoProveedor({ ...nuevoProveedor, telefono: e.target.value })} />
              </div>
              <div className="field">
                <label>Email</label>
                <input type="email" value={nuevoProveedor.email} onChange={(e) => setNuevoProveedor({ ...nuevoProveedor, email: e.target.value })} />
              </div>
              <div className="field">
                <label>Condición de pago</label>
                <input placeholder="Ej: Cta. cte. 30 días" value={nuevoProveedor.condicion_pago} onChange={(e) => setNuevoProveedor({ ...nuevoProveedor, condicion_pago: e.target.value })} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={guardando} style={{ width: '100%' }}>
                {guardando ? 'Creando…' : 'Crear Proveedor'}
              </button>
            </form>
          )}

          {panel === 'detalle' && detalle && edicion && (
            <div className="proveedores-detalle">
              <div className="proveedores-panel-titulo">
                <span>{detalle.nombre}</span>
                <button type="button" className="proveedores-panel-cerrar" onClick={cerrarPanel}>
                  ✕
                </button>
              </div>

              {panelError && <div className="alert alert-danger">{panelError}</div>}
              {panelExito && (
                <div className="alert" style={{ background: 'rgba(14,75,56,0.08)', color: '#0e4b38', border: '1px solid rgba(14,75,56,0.25)' }}>
                  {panelExito}
                </div>
              )}

              <div className="field">
                <label>Nombre / Razón social</label>
                <input value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} />
              </div>
              <div className="proveedores-form-grid2">
                <div className="field">
                  <label>Teléfono</label>
                  <input value={edicion.telefono} onChange={(e) => setEdicion({ ...edicion, telefono: e.target.value })} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" value={edicion.email} onChange={(e) => setEdicion({ ...edicion, email: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Condición de pago</label>
                <input value={edicion.condicion_pago} onChange={(e) => setEdicion({ ...edicion, condicion_pago: e.target.value })} />
              </div>
              <button type="button" className="btn btn-primary" disabled={guardando} onClick={guardarProveedor}>
                Guardar cambios
              </button>

              <div className="proveedores-seccion">
                <span className="proveedores-section-label">Productos que provee ({productosDelDetalle.length})</span>
                {productosDelDetalle.length === 0 ? (
                  <div className="proveedores-hint">Sin productos vinculados — se asignan desde Stock al crear/editar un producto.</div>
                ) : (
                  productosDelDetalle.map((p) => (
                    <div className="proveedores-producto-row" key={p.id}>
                      <span>{p.nombre}</span>
                      <span>{formatearMonto(p.precio_venta)}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="proveedores-seccion">
                <span className="proveedores-section-label">Pedidos ({pedidosDelDetalle.length})</span>
                {pedidosDelDetalle.length === 0 && <div className="proveedores-hint">Sin pedidos cargados.</div>}
                {pedidosDelDetalle.map((pedido) => (
                  <div className="proveedores-pedido-row" key={pedido.id}>
                    <span className="proveedores-pedido-fecha">{formatearFecha(pedido.fecha)}</span>
                    <select value={pedido.estado} onChange={(e) => cambiarEstadoPedido(pedido, e.target.value)}>
                      {ESTADOS_PEDIDO.map((estado) => (
                        <option key={estado} value={estado}>
                          {ETIQUETA_ESTADO[estado]}
                        </option>
                      ))}
                    </select>
                    {confirmandoEliminarPedido === pedido.id ? (
                      <div className="proveedores-pedido-confirm">
                        <button type="button" className="btn" onClick={() => setConfirmandoEliminarPedido(null)}>
                          No
                        </button>
                        <button type="button" className="btn" onClick={() => eliminarPedido(pedido)}>
                          Sí
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="proveedores-pedido-eliminar" onClick={() => setConfirmandoEliminarPedido(pedido.id)} title="Eliminar pedido">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <form className="proveedores-nuevo-pedido" onSubmit={crearPedido}>
                <span className="proveedores-section-label">Nuevo Pedido</span>
                {productosDelDetalle.length === 0 ? (
                  <div className="proveedores-hint">Este proveedor no tiene productos vinculados en Stock todavía.</div>
                ) : (
                  <>
                    {nuevoPedido.items.map((item, i) => (
                      <div className="proveedores-item-row" key={i}>
                        <select value={item.producto_id} onChange={(e) => actualizarItemPedido(i, 'producto_id', e.target.value)}>
                          <option value="">Producto…</option>
                          {productosDelDetalle.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nombre}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          placeholder="Cant."
                          value={item.cantidad}
                          onChange={(e) => actualizarItemPedido(i, 'cantidad', e.target.value)}
                        />
                        {nuevoPedido.items.length > 1 && (
                          <button type="button" className="proveedores-item-quitar" onClick={() => quitarFilaItem(i)}>
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" className="proveedores-item-agregar" onClick={agregarFilaItem}>
                      + Agregar producto
                    </button>
                    <div className="proveedores-form-grid2">
                      <div className="field">
                        <label>Fecha</label>
                        <input type="date" value={nuevoPedido.fecha} onChange={(e) => setNuevoPedido({ ...nuevoPedido, fecha: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>Estado inicial</label>
                        <select value={nuevoPedido.estado} onChange={(e) => setNuevoPedido({ ...nuevoPedido, estado: e.target.value })}>
                          {ESTADOS_PEDIDO.map((estado) => (
                            <option key={estado} value={estado}>
                              {ETIQUETA_ESTADO[estado]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={guardando} style={{ width: '100%' }}>
                      Registrar Pedido
                    </button>
                  </>
                )}
              </form>

              {esAdmin && (
                <div className="proveedores-eliminar">
                  {!confirmandoEliminarProveedor ? (
                    <button type="button" className="proveedores-eliminar-link" onClick={() => setConfirmandoEliminarProveedor(true)}>
                      Eliminar proveedor
                    </button>
                  ) : (
                    <div className="proveedores-eliminar-confirm">
                      <span>¿Eliminar "{detalle.nombre}"?</span>
                      <div>
                        <button type="button" className="btn" onClick={() => setConfirmandoEliminarProveedor(false)}>
                          Cancelar
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
                          disabled={guardando}
                          onClick={eliminarProveedor}
                        >
                          Sí, eliminar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
