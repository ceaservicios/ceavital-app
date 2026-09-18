import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearFecha, formatearMonto, fechaHoyISO } from '../utils/format.js';
import './StockPage.css';

const PUEDE_EDITAR = new Set(['admin', 'encargado']);

const PRODUCTO_VACIO = {
  nombre: '',
  categoria_id: '',
  codigo_barras: '',
  unidad_medida_id: '',
  precio_costo: '',
  precio_venta: '',
  proveedor_id: '',
  stock_minimo: '0',
  dias_aviso_vencimiento: '',
};

// Lote inicial directo en el alta de producto (corrección 2026-09-15): antes
// había que crear el producto y recién ahí, en un segundo paso separado
// ("Ingreso de Nuevo Lote" -- pensado para reponer stock de un producto YA
// existente), cargar el primer lote. Cantidad vacía = producto creado sin
// stock todavía, sigue siendo válido.
const LOTE_INICIAL_VACIO = { cantidad: '', fecha_ingreso: '', fecha_vencimiento: '' };

export default function StockPage() {
  const { usuario } = useAuth();
  const rol = usuario?.rol;
  const esAdmin = rol === 'admin';
  const puedeEditar = PUEDE_EDITAR.has(rol);

  const [productos, setProductos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [unidadesMedida, setUnidadesMedida] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [panel, setPanel] = useState('ninguno'); // 'ninguno' | 'detalle' | 'nuevo-producto'
  const [detalle, setDetalle] = useState(null); // producto completo con lotes
  const [edicion, setEdicion] = useState(null); // copia editable del detalle
  const [nuevoProducto, setNuevoProducto] = useState(PRODUCTO_VACIO);
  const [loteInicial, setLoteInicial] = useState(LOTE_INICIAL_VACIO);
  const [nuevoLote, setNuevoLote] = useState({ cantidad: '', fecha_ingreso: fechaHoyISO(), fecha_vencimiento: '' });
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [panelError, setPanelError] = useState(null);
  const [panelExito, setPanelExito] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Guardia real contra doble-click en "Sí, eliminar" (hallazgo Baja #3,
  // verificador-funcional 2026-09-10) -- ref mutado sincrónicamente, no
  // depende de que React ya haya re-renderizado con `guardando=true`.
  const eliminandoRef = useRef(false);

  const mapaProveedores = useMemo(() => new Map(proveedores.map((p) => [p.id, p.nombre])), [proveedores]);

  async function cargarProductos() {
    setCargando(true);
    setError(null);
    try {
      const data = await api.get('/productos');
      setProductos(data.productos);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar el stock.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarProductos();
    if (puedeEditar) {
      api
        .get('/proveedores')
        .then((data) => setProveedores(data.proveedores))
        .catch(() => setProveedores([]));
      api
        .get('/categorias')
        .then((data) => setCategorias(data.items))
        .catch(() => setCategorias([]));
      api
        .get('/unidades-medida')
        .then((data) => setUnidadesMedida(data.items))
        .catch(() => setUnidadesMedida([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link desde Vencimientos ("Ver lote" -> /stock?producto=ID): abre el
  // detalle de ese producto directo, sin que el usuario tenga que buscarlo.
  useEffect(() => {
    const productoId = searchParams.get('producto');
    if (productoId) {
      abrirDetalle(Number(productoId));
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const productosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return productos;
    return productos.filter(
      (p) => p.nombre.toLowerCase().includes(texto) || (p.codigo_barras ?? '').includes(texto)
    );
  }, [productos, busqueda]);

  const kpis = useMemo(() => {
    const activos = productos.length;
    const bajoMinimo = productos.filter((p) => p.alerta_stock_bajo).length;
    const valorInventario = productos.reduce((acc, p) => acc + p.precio_venta * p.stock_total, 0);
    return { activos, bajoMinimo, valorInventario };
  }, [productos]);

  async function abrirDetalle(id) {
    setPanel('detalle');
    setPanelError(null);
    setPanelExito(null);
    setConfirmandoEliminar(false);
    setDetalle(null);
    try {
      const data = await api.get(`/productos/${id}`);
      setDetalle(data);
      setEdicion({
        nombre: data.nombre,
        categoria_id: data.categoria_id ?? '',
        codigo_barras: data.codigo_barras ?? '',
        unidad_medida_id: data.unidad_medida_id ?? '',
        precio_costo: data.precio_costo ?? '',
        precio_venta: data.precio_venta,
        proveedor_id: data.proveedor_id ?? '',
        stock_minimo: data.stock_minimo,
        dias_aviso_vencimiento: data.dias_aviso_vencimiento ?? '',
      });
      setNuevoLote({ cantidad: '', fecha_ingreso: fechaHoyISO(), fecha_vencimiento: '' });
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo cargar el producto.');
    }
  }

  function abrirNuevoProducto() {
    setPanel('nuevo-producto');
    setNuevoProducto(PRODUCTO_VACIO);
    setLoteInicial({ ...LOTE_INICIAL_VACIO, fecha_ingreso: fechaHoyISO() });
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

  async function guardarProducto() {
    setGuardando(true);
    setPanelError(null);
    try {
      const payload = {
        nombre: edicion.nombre,
        categoria_id: edicion.categoria_id === '' ? null : Number(edicion.categoria_id),
        codigo_barras: edicion.codigo_barras || null,
        unidad_medida_id: Number(edicion.unidad_medida_id),
        proveedor_id: edicion.proveedor_id === '' ? null : Number(edicion.proveedor_id),
        stock_minimo: Number(edicion.stock_minimo),
        dias_aviso_vencimiento: edicion.dias_aviso_vencimiento === '' ? null : Number(edicion.dias_aviso_vencimiento),
      };
      // Nunca mandar precio_costo/precio_venta si no es Admin -- el backend
      // (stock.service.editarProducto) rechaza el PATCH entero con 403 apenas
      // detecta esas claves en el body, aunque el valor no haya cambiado.
      if (esAdmin) {
        payload.precio_costo = Number(edicion.precio_costo);
        payload.precio_venta = Number(edicion.precio_venta);
      }

      const actualizado = await api.patch(`/productos/${detalle.id}`, payload);
      setDetalle(actualizado);
      setPanelExito('Cambios guardados.');
      cargarProductos();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudieron guardar los cambios.');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarProducto() {
    if (eliminandoRef.current) return;
    eliminandoRef.current = true;
    setGuardando(true);
    setPanelError(null);
    try {
      await api.delete(`/productos/${detalle.id}`);
      cerrarPanel();
      cargarProductos();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo eliminar el producto.');
      setConfirmandoEliminar(false);
    } finally {
      setGuardando(false);
      eliminandoRef.current = false;
    }
  }

  async function crearProducto(e) {
    e.preventDefault();
    setGuardando(true);
    setPanelError(null);
    try {
      const payload = {
        nombre: nuevoProducto.nombre,
        categoria_id: nuevoProducto.categoria_id === '' ? null : Number(nuevoProducto.categoria_id),
        codigo_barras: nuevoProducto.codigo_barras || null,
        unidad_medida_id: Number(nuevoProducto.unidad_medida_id),
        precio_costo: Number(nuevoProducto.precio_costo),
        precio_venta: Number(nuevoProducto.precio_venta),
        proveedor_id: nuevoProducto.proveedor_id === '' ? null : Number(nuevoProducto.proveedor_id),
        stock_minimo: Number(nuevoProducto.stock_minimo || 0),
        dias_aviso_vencimiento:
          nuevoProducto.dias_aviso_vencimiento === '' ? null : Number(nuevoProducto.dias_aviso_vencimiento),
      };
      if (loteInicial.cantidad) {
        payload.lote_inicial = {
          cantidad: Number(loteInicial.cantidad),
          fecha_ingreso: loteInicial.fecha_ingreso || fechaHoyISO(),
          fecha_vencimiento: loteInicial.fecha_vencimiento || null,
        };
      }
      const creado = await api.post('/productos', payload);
      await cargarProductos();
      abrirDetalle(creado.id);
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo crear el producto.');
    } finally {
      setGuardando(false);
    }
  }

  async function agregarLote(e) {
    e.preventDefault();
    setGuardando(true);
    setPanelError(null);
    try {
      await api.post(`/productos/${detalle.id}/lotes`, {
        cantidad: Number(nuevoLote.cantidad),
        fecha_ingreso: nuevoLote.fecha_ingreso,
        fecha_vencimiento: nuevoLote.fecha_vencimiento || null,
      });
      setNuevoLote({ cantidad: '', fecha_ingreso: fechaHoyISO(), fecha_vencimiento: '' });
      setPanelExito('Lote registrado.');
      abrirDetalle(detalle.id);
      cargarProductos();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo registrar el lote.');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarLote(loteId) {
    setPanelError(null);
    try {
      await api.delete(`/productos/${detalle.id}/lotes/${loteId}`);
      abrirDetalle(detalle.id);
      cargarProductos();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo eliminar el lote.');
    }
  }

  return (
    <div className="stock-page">
      <div className="stock-kpis">
        <div className="card stock-kpi">
          <span className="stock-kpi-label">Productos activos</span>
          <span className="stock-kpi-value">{kpis.activos}</span>
        </div>
        <div className="card stock-kpi">
          <span className="stock-kpi-label">Con stock bajo el mínimo</span>
          <span className="stock-kpi-value" style={{ color: kpis.bajoMinimo > 0 ? 'var(--color-danger)' : undefined }}>
            {kpis.bajoMinimo}
          </span>
        </div>
        <div className="card stock-kpi">
          <span className="stock-kpi-label">Valor de inventario (precio de venta)</span>
          <span className="stock-kpi-value">{formatearMonto(kpis.valorInventario)}</span>
        </div>
      </div>

      <div className="stock-body">
        <div className="card stock-lista">
          <div className="stock-lista-header">
            <div className="stock-search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7672" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="Buscar por nombre o código de barras…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
            {puedeEditar && (
              <button type="button" className="btn btn-primary stock-nuevo-btn" onClick={abrirNuevoProducto}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Nuevo Producto
              </button>
            )}
          </div>

          {error && <div className="alert alert-danger">{error}</div>}

          <div className="stock-tabla">
            <div className="stock-tabla-head">
              <span style={{ flex: 2.2 }}>Producto</span>
              <span style={{ flex: 1.2 }}>Categoría</span>
              <span style={{ flex: 1, textAlign: 'center' }}>Stock</span>
              <span style={{ flex: 1, textAlign: 'right', paddingRight: 20 }}>Precio</span>
              <span style={{ flex: 1.4 }}>Proveedor</span>
            </div>
            <div className="stock-tabla-body">
              {cargando && <div className="stock-tabla-vacio">Cargando…</div>}
              {!cargando && productosFiltrados.length === 0 && (
                <div className="stock-tabla-vacio">
                  {productos.length === 0 ? 'Todavía no hay productos cargados.' : 'Sin resultados para esa búsqueda.'}
                </div>
              )}
              {productosFiltrados.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`stock-fila${detalle?.id === p.id ? ' stock-fila-activa' : ''}`}
                  onClick={() => abrirDetalle(p.id)}
                >
                  <span style={{ flex: 2.2 }} className="stock-fila-nombre">
                    {p.nombre}
                  </span>
                  <span style={{ flex: 1.2 }} className="stock-fila-muted">
                    {p.categoria || '—'}
                  </span>
                  <span
                    style={{ flex: 1, textAlign: 'center', fontWeight: 700 }}
                    className={p.alerta_stock_bajo ? 'stock-valor-alerta' : ''}
                  >
                    {p.stock_total}
                  </span>
                  <span style={{ flex: 1, textAlign: 'right', paddingRight: 20 }}>{formatearMonto(p.precio_venta)}</span>
                  <span style={{ flex: 1.4 }} className="stock-fila-muted">
                    {p.proveedor_id ? mapaProveedores.get(p.proveedor_id) ?? '—' : '—'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card stock-panel">
          {panel === 'ninguno' && (
            <div className="stock-panel-vacio">Seleccioná un producto para ver el detalle o agregar un lote.</div>
          )}

          {panel === 'nuevo-producto' && (
            <form className="stock-form" onSubmit={crearProducto}>
              <div className="stock-panel-titulo">
                <span>Nuevo Producto</span>
                <button type="button" className="stock-panel-cerrar" onClick={cerrarPanel}>
                  ✕
                </button>
              </div>

              {panelError && <div className="alert alert-danger">{panelError}</div>}

              <div className="field">
                <label>Nombre</label>
                <input
                  required
                  value={nuevoProducto.nombre}
                  onChange={(e) => setNuevoProducto({ ...nuevoProducto, nombre: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Categoría</label>
                <select
                  value={nuevoProducto.categoria_id}
                  onChange={(e) => setNuevoProducto({ ...nuevoProducto, categoria_id: e.target.value })}
                >
                  <option value="">Sin categoría</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
                {categorias.length === 0 && (
                  <span className="stock-hint">Todavía no hay categorías cargadas -- se crean en Configuración.</span>
                )}
              </div>
              <div className="field">
                <label>Código de barras</label>
                <input
                  value={nuevoProducto.codigo_barras}
                  onChange={(e) => setNuevoProducto({ ...nuevoProducto, codigo_barras: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Unidad de medida</label>
                <select
                  required
                  value={nuevoProducto.unidad_medida_id}
                  onChange={(e) => setNuevoProducto({ ...nuevoProducto, unidad_medida_id: e.target.value })}
                >
                  <option value="" disabled>
                    Elegí una unidad…
                  </option>
                  {unidadesMedida.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                    </option>
                  ))}
                </select>
                {unidadesMedida.length === 0 && (
                  <span className="stock-hint">Todavía no hay unidades de medida cargadas -- se crean en Configuración.</span>
                )}
              </div>
              <div className="stock-form-grid2">
                <div className="field">
                  <label>Precio costo</label>
                  <input
                    required
                    type="number"
                    min="0"
                    value={nuevoProducto.precio_costo}
                    onChange={(e) => setNuevoProducto({ ...nuevoProducto, precio_costo: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Precio venta</label>
                  <input
                    required
                    type="number"
                    min="0"
                    value={nuevoProducto.precio_venta}
                    onChange={(e) => setNuevoProducto({ ...nuevoProducto, precio_venta: e.target.value })}
                  />
                </div>
              </div>
              <div className="field">
                <label>Proveedor</label>
                <select
                  value={nuevoProducto.proveedor_id}
                  onChange={(e) => setNuevoProducto({ ...nuevoProducto, proveedor_id: e.target.value })}
                >
                  <option value="">Sin proveedor</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="stock-form-grid2">
                <div className="field">
                  <label>Stock mínimo</label>
                  <input
                    type="number"
                    min="0"
                    value={nuevoProducto.stock_minimo}
                    onChange={(e) => setNuevoProducto({ ...nuevoProducto, stock_minimo: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Días de aviso</label>
                  <input
                    type="number"
                    min="0"
                    value={nuevoProducto.dias_aviso_vencimiento}
                    onChange={(e) => setNuevoProducto({ ...nuevoProducto, dias_aviso_vencimiento: e.target.value })}
                  />
                </div>
              </div>

              <div className="stock-lote-inicial">
                <span className="stock-section-label">Lote inicial (opcional)</span>
                <div className="field">
                  <label>Cantidad</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Dejar vacío si todavía no hay stock"
                    value={loteInicial.cantidad}
                    onChange={(e) => setLoteInicial({ ...loteInicial, cantidad: e.target.value })}
                  />
                </div>
                {Number(loteInicial.cantidad) > 0 && (
                  <div className="stock-form-grid2">
                    <div className="field">
                      <label>Fecha de ingreso</label>
                      <input
                        type="date"
                        value={loteInicial.fecha_ingreso}
                        onChange={(e) => setLoteInicial({ ...loteInicial, fecha_ingreso: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Vencimiento (opcional)</label>
                      <input
                        type="date"
                        value={loteInicial.fecha_vencimiento}
                        onChange={(e) => setLoteInicial({ ...loteInicial, fecha_vencimiento: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="stock-form-acciones">
                <button type="submit" className="btn btn-primary" disabled={guardando} style={{ width: '100%' }}>
                  {guardando ? 'Creando…' : 'Crear Producto'}
                </button>
                <button type="button" className="btn" onClick={cerrarPanel} style={{ width: '100%' }}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {panel === 'detalle' && detalle && edicion && (
            <div className="stock-detalle">
              <div className="stock-panel-titulo">
                <span>{detalle.nombre}</span>
                <button type="button" className="stock-panel-cerrar" onClick={cerrarPanel}>
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
                <label>Nombre</label>
                <input
                  disabled={!puedeEditar}
                  value={edicion.nombre}
                  onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
                />
              </div>
              <div className="stock-form-grid2">
                <div className="field">
                  <label>Categoría</label>
                  {puedeEditar ? (
                    <select
                      value={edicion.categoria_id}
                      onChange={(e) => setEdicion({ ...edicion, categoria_id: e.target.value })}
                    >
                      <option value="">Sin categoría</option>
                      {categorias.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="stock-campo-oculto">{detalle.categoria || '—'}</div>
                  )}
                </div>
                <div className="field">
                  <label>Código de barras</label>
                  <input
                    disabled={!puedeEditar}
                    value={edicion.codigo_barras}
                    onChange={(e) => setEdicion({ ...edicion, codigo_barras: e.target.value })}
                  />
                </div>
              </div>
              {puedeEditar && (
                <div className="field">
                  <label>Unidad de medida</label>
                  <select
                    value={edicion.unidad_medida_id}
                    onChange={(e) => setEdicion({ ...edicion, unidad_medida_id: e.target.value })}
                  >
                    <option value="" disabled>
                      Elegí una unidad…
                    </option>
                    {unidadesMedida.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!puedeEditar && (
                <div className="field">
                  <label>Unidad de medida</label>
                  <div className="stock-campo-oculto">{detalle.unidad_medida || '—'}</div>
                </div>
              )}
              <div className="stock-form-grid2">
                {esAdmin ? (
                  <div className="field">
                    <label>Precio costo</label>
                    <input
                      type="number"
                      min="0"
                      value={edicion.precio_costo}
                      onChange={(e) => setEdicion({ ...edicion, precio_costo: e.target.value })}
                    />
                  </div>
                ) : (
                  <div className="field">
                    <label>Precio costo</label>
                    <div className="stock-campo-oculto">No disponible para tu rol</div>
                  </div>
                )}
                <div className="field">
                  <label>Precio venta</label>
                  <input
                    type="number"
                    min="0"
                    disabled={!esAdmin}
                    value={edicion.precio_venta}
                    onChange={(e) => setEdicion({ ...edicion, precio_venta: e.target.value })}
                  />
                  {!esAdmin && puedeEditar && (
                    <span className="stock-hint">Solo el Admin puede editar precios ya cargados.</span>
                  )}
                </div>
              </div>
              <div className="field">
                <label>Proveedor</label>
                {puedeEditar ? (
                  <select
                    value={edicion.proveedor_id}
                    onChange={(e) => setEdicion({ ...edicion, proveedor_id: e.target.value })}
                  >
                    <option value="">Sin proveedor</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="stock-campo-oculto">
                    {detalle.proveedor_id ? mapaProveedores.get(detalle.proveedor_id) ?? '—' : 'Sin proveedor'}
                  </div>
                )}
              </div>
              <div className="stock-form-grid2">
                <div className="field">
                  <label>Stock mínimo</label>
                  <input
                    type="number"
                    min="0"
                    disabled={!puedeEditar}
                    value={edicion.stock_minimo}
                    onChange={(e) => setEdicion({ ...edicion, stock_minimo: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Días de aviso</label>
                  <input
                    type="number"
                    min="0"
                    disabled={!puedeEditar}
                    value={edicion.dias_aviso_vencimiento}
                    onChange={(e) => setEdicion({ ...edicion, dias_aviso_vencimiento: e.target.value })}
                  />
                </div>
              </div>

              {puedeEditar && (
                <button type="button" className="btn btn-primary" disabled={guardando} onClick={guardarProducto}>
                  {guardando ? 'Guardando…' : 'Guardar cambios'}
                </button>
              )}

              <div className="stock-lotes">
                <span className="stock-section-label">Lotes ({detalle.lotes.length})</span>
                {detalle.lotes.length === 0 && <div className="stock-lotes-vacio">Sin lotes cargados.</div>}
                {detalle.lotes.map((lote) => (
                  <div className="stock-lote-row" key={lote.id}>
                    <span className="stock-lote-cantidad">{lote.cantidad}</span>
                    <span className="stock-lote-fechas">
                      Ingresó {formatearFecha(lote.fecha_ingreso)}
                      {lote.fecha_vencimiento && ` · Vence ${formatearFecha(lote.fecha_vencimiento)}`}
                    </span>
                    {lote.vencido && <span className="stock-badge-vencido">Vencido</span>}
                    {puedeEditar && (
                      <button type="button" className="stock-lote-eliminar" onClick={() => eliminarLote(lote.id)} title="Eliminar lote">
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

              {puedeEditar && (
                <form className="stock-nuevo-lote" onSubmit={agregarLote}>
                  <span className="stock-section-label">Ingreso de Nuevo Lote</span>
                  <div className="field">
                    <label>Cantidad que ingresa</label>
                    <input
                      required
                      type="number"
                      min="1"
                      value={nuevoLote.cantidad}
                      onChange={(e) => setNuevoLote({ ...nuevoLote, cantidad: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Fecha de ingreso</label>
                    <input
                      required
                      type="date"
                      value={nuevoLote.fecha_ingreso}
                      onChange={(e) => setNuevoLote({ ...nuevoLote, fecha_ingreso: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Vencimiento (opcional)</label>
                    <input
                      type="date"
                      value={nuevoLote.fecha_vencimiento}
                      onChange={(e) => setNuevoLote({ ...nuevoLote, fecha_vencimiento: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={guardando} style={{ width: '100%' }}>
                    Registrar Lote
                  </button>
                </form>
              )}

              {esAdmin && (
                <div className="stock-eliminar">
                  {!confirmandoEliminar ? (
                    <button type="button" className="stock-eliminar-link" onClick={() => setConfirmandoEliminar(true)}>
                      Eliminar producto
                    </button>
                  ) : (
                    <div className="stock-eliminar-confirm">
                      <span>¿Eliminar "{detalle.nombre}"? No se puede deshacer desde la interfaz.</span>
                      <div>
                        <button type="button" className="btn" onClick={() => setConfirmandoEliminar(false)}>
                          Cancelar
                        </button>
                        <button type="button" className="btn" style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }} disabled={guardando} onClick={eliminarProducto}>
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
