import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearMonto, fechaHoyISO } from '../utils/format.js';
import './CajaPage.css';

const MEDIOS_PAGO = [
  {
    valor: 'efectivo',
    label: 'Efectivo',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    valor: 'tarjeta',
    label: 'Tarjeta',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </svg>
    ),
  },
  {
    valor: 'transferencia_qr',
    label: 'Transferencia / QR',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    valor: 'mercado_pago',
    label: 'Mercado Pago',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1" />
        <path d="M21 12a1.5 1.5 0 0 1 0 3h-3a3 3 0 0 1 0-6h3a1.5 1.5 0 0 1 0 3z" />
      </svg>
    ),
  },
  {
    valor: 'fiado',
    label: 'Fiado',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
    ),
  },
  {
    // B2B Fase 1: venta a la cuenta corriente de un Cliente-Empresa real
    // (con ledger) -- distinta de 'fiado', que sigue siendo el fiado
    // informal sin cliente asociado.
    valor: 'cta_cte',
    label: 'Cuenta Corriente',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </svg>
    ),
  },
];

const PUEDE_ANULAR = new Set(['admin', 'encargado']);
// Gastos y pagos a proveedores (corrección 2026-09-15, decisiones confirmadas
// 2026-09-18): Crear -- los 3 roles. Eliminar (corregir un gasto mal
// cargado) -- Admin+Encargado, mismo criterio que anular una venta.
const PUEDE_ELIMINAR_GASTO = new Set(['admin', 'encargado']);

export default function CajaPage() {
  const { usuario } = useAuth();

  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState([]);
  const [mostrarResultados, setMostrarResultados] = useState(false);
  const [carrito, setCarrito] = useState([]);
  const [medioPago, setMedioPago] = useState('efectivo');
  const [clientesEmpresa, setClientesEmpresa] = useState([]);
  const [clienteEmpresaId, setClienteEmpresaId] = useState('');
  const [montoRecibido, setMontoRecibido] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [ventasHoy, setVentasHoy] = useState([]);
  const [confirmandoAnulacion, setConfirmandoAnulacion] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState(false);

  const [gastosHoy, setGastosHoy] = useState([]);
  const [proveedoresGasto, setProveedoresGasto] = useState([]);
  const [mostrarFormGasto, setMostrarFormGasto] = useState(false);
  const [nuevoGasto, setNuevoGasto] = useState({ concepto: '', monto: '', proveedor_id: '' });
  const [registrandoGasto, setRegistrandoGasto] = useState(false);
  const [errorGasto, setErrorGasto] = useState(null);
  const [eliminandoGastoId, setEliminandoGastoId] = useState(null);

  const searchInputRef = useRef(null);
  // Guardia real contra doble-click (mismo criterio que "Confirmar Cierre de
  // Caja", ver hallazgo Baja #3 de verificador-funcional 2026-09-10): un ref
  // mutado sincrónicamente, no solo el estado `anulando` que gatilla el
  // re-render del `disabled` -- un doble-click muy rápido puede disparar el
  // 2do click antes de que ese re-render se complete.
  const anulandoRef = useRef(false);

  const puedeAnular = PUEDE_ANULAR.has(usuario?.rol);
  const puedeEliminarGasto = PUEDE_ELIMINAR_GASTO.has(usuario?.rol);

  const cargarResumen = useCallback(async () => {
    try {
      const [resumenData, ventasData, gastosData] = await Promise.all([
        api.get('/caja/resumen'),
        api.get(`/ventas?fecha=${fechaHoyISO()}`),
        api.get(`/caja/gastos?fecha=${fechaHoyISO()}`),
      ]);
      setResumen(resumenData);
      setVentasHoy(ventasData.ventas);
      setGastosHoy(gastosData.gastos);
    } catch {
      // Los KPIs son informativos -- si fallan, no bloquean el uso de Caja.
    }
  }, []);

  useEffect(() => {
    cargarResumen();
  }, [cargarResumen]);

  // Proveedores solo para el <select> opcional "pago a proveedor" del
  // formulario de gasto -- Cajero no tiene acceso a /proveedores (ni
  // siquiera Ver, ver proveedores.routes.js), así que ese select se omite
  // para ese rol en vez de intentar un fetch que le va a devolver 403.
  useEffect(() => {
    if (usuario?.rol === 'admin' || usuario?.rol === 'encargado') {
      api
        .get('/proveedores')
        .then((data) => setProveedoresGasto(data.proveedores))
        .catch(() => setProveedoresGasto([]));
    }
  }, [usuario?.rol]);

  // Lista de clientes-empresa para el selector de "Cuenta Corriente": los 3
  // roles la necesitan para cobrar una venta a cuenta corriente (el backend
  // deja GET /clientes-empresa abierto a todos y al Cajero le devuelve solo
  // id + datos de contacto, nunca el saldo).
  useEffect(() => {
    api
      .get('/clientes-empresa')
      .then((data) => setClientesEmpresa(data.clientes))
      .catch(() => setClientesEmpresa([]));
  }, []);

  async function registrarGasto(e) {
    e.preventDefault();
    setRegistrandoGasto(true);
    setErrorGasto(null);
    try {
      await api.post('/caja/gastos', {
        concepto: nuevoGasto.concepto,
        monto: Number(nuevoGasto.monto),
        proveedor_id: nuevoGasto.proveedor_id === '' ? null : Number(nuevoGasto.proveedor_id),
      });
      setNuevoGasto({ concepto: '', monto: '', proveedor_id: '' });
      setMostrarFormGasto(false);
      cargarResumen();
    } catch (err) {
      setErrorGasto(err instanceof ApiError ? err.message : 'No se pudo registrar el gasto.');
    } finally {
      setRegistrandoGasto(false);
    }
  }

  async function eliminarGasto(id) {
    setEliminandoGastoId(id);
    try {
      await api.delete(`/caja/gastos/${id}`);
      cargarResumen();
    } catch (err) {
      setErrorGasto(err instanceof ApiError ? err.message : 'No se pudo eliminar el gasto.');
    } finally {
      setEliminandoGastoId(null);
    }
  }

  useEffect(() => {
    if (query.trim().length < 1) {
      setResultados([]);
      setErrorBusqueda(false);
      return;
    }
    const timeoutId = setTimeout(async () => {
      try {
        const data = await api.get(`/productos?q=${encodeURIComponent(query.trim())}`);
        setResultados(data.productos);
        setErrorBusqueda(false);
        setMostrarResultados(true);
      } catch {
        // Cualquier excepción acá es un problema de conexión/servidor -- una
        // búsqueda sin coincidencias NUNCA tira excepción (el backend
        // responde 200 con data.productos:[]). Antes esto se confundía con
        // "no existe" (hallazgo Baja #2, verificador-funcional 2026-09-10).
        setResultados([]);
        setErrorBusqueda(true);
        setMostrarResultados(true);
      }
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [query]);

  function agregarAlCarrito(producto) {
    setCarrito((prev) => {
      const existente = prev.find((item) => item.producto_id === producto.id);
      if (existente) {
        return prev.map((item) =>
          item.producto_id === producto.id ? { ...item, cantidad: item.cantidad + 1 } : item
        );
      }
      return [
        ...prev,
        {
          producto_id: producto.id,
          nombre: producto.nombre,
          precio_venta: producto.precio_venta,
          stock_vendible: producto.stock_vendible,
          cantidad: 1,
        },
      ];
    });
    setQuery('');
    setResultados([]);
    setMostrarResultados(false);
    searchInputRef.current?.focus();
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Enter' && resultados.length === 1) {
      e.preventDefault();
      agregarAlCarrito(resultados[0]);
    }
  }

  function cambiarCantidad(productoId, delta) {
    setCarrito((prev) =>
      prev
        .map((item) =>
          item.producto_id === productoId ? { ...item, cantidad: item.cantidad + delta } : item
        )
        .filter((item) => item.cantidad > 0)
    );
  }

  function quitarDelCarrito(productoId) {
    setCarrito((prev) => prev.filter((item) => item.producto_id !== productoId));
  }

  const total = carrito.reduce((acc, item) => acc + item.precio_venta * item.cantidad, 0);
  const recibidoNumerico = Number(montoRecibido) || 0;
  const vuelto = recibidoNumerico - total;

  async function confirmarVenta() {
    setError(null);
    setExito(null);
    setEnviando(true);
    try {
      const venta = await api.post('/ventas', {
        medio_pago: medioPago,
        ...(medioPago === 'cta_cte' ? { cliente_empresa_id: Number(clienteEmpresaId) } : {}),
        items: carrito.map((item) => ({ producto_id: item.producto_id, cantidad: item.cantidad })),
      });
      setExito(`Venta #${venta.id} registrada por ${formatearMonto(venta.total)}.`);
      setCarrito([]);
      setMontoRecibido('');
      setClienteEmpresaId('');
      cargarResumen();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar la venta. Probá de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  const ultimaVentaRegistrada = ventasHoy.find((v) => v.estado === 'registrada');

  async function anularUltimoTicket() {
    if (!ultimaVentaRegistrada || anulandoRef.current) return;
    anulandoRef.current = true;
    setAnulando(true);
    setError(null);
    try {
      await api.delete(`/ventas/${ultimaVentaRegistrada.id}`);
      setExito(`Venta #${ultimaVentaRegistrada.id} anulada.`);
      setConfirmandoAnulacion(false);
      cargarResumen();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anular la venta.');
      setConfirmandoAnulacion(false);
    } finally {
      setAnulando(false);
      anulandoRef.current = false;
    }
  }

  const ticketsEmitidos = ventasHoy.filter((v) => v.estado === 'registrada').length;
  const ticketPromedio = ticketsEmitidos > 0 ? Math.round((resumen?.total_general ?? 0) / ticketsEmitidos) : 0;

  return (
    <div className="caja-page">
      <div className="caja-kpis">
        <div className="card caja-kpi">
          <span className="caja-kpi-label">Ventas del turno</span>
          <span className="caja-kpi-value">{formatearMonto(resumen?.total_general ?? 0)}</span>
        </div>
        <div className="card caja-kpi">
          <span className="caja-kpi-label">Tickets emitidos</span>
          <span className="caja-kpi-value">{ticketsEmitidos}</span>
        </div>
        <div className="card caja-kpi">
          <span className="caja-kpi-label">Ticket promedio</span>
          <span className="caja-kpi-value">{formatearMonto(ticketPromedio)}</span>
        </div>
        <div className="card caja-kpi">
          <span className="caja-kpi-label">Gastos del turno</span>
          <span className="caja-kpi-value" style={{ color: (resumen?.total_gastos ?? 0) > 0 ? 'var(--color-danger)' : undefined }}>
            {formatearMonto(resumen?.total_gastos ?? 0)}
          </span>
        </div>
      </div>

      <div className="caja-body">
        <div className="card caja-carrito">
          <div className="caja-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7672" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Escaneá el código de barras o buscá un producto…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => setMostrarResultados(true)}
            />
            {mostrarResultados && query.trim().length > 0 && (
              <div className="caja-search-dropdown">
                {resultados.length === 0 && (
                  <div className="caja-search-empty">
                    {errorBusqueda ? 'No se pudo conectar con el servidor. Probá de nuevo en unos segundos.' : 'Sin resultados'}
                  </div>
                )}
                {resultados.map((producto) => (
                  <button
                    type="button"
                    key={producto.id}
                    className="caja-search-item"
                    onClick={() => agregarAlCarrito(producto)}
                  >
                    <span>{producto.nombre}</span>
                    <span className="caja-search-item-precio">{formatearMonto(producto.precio_venta)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="caja-cart-list">
            {carrito.length === 0 ? (
              <div className="caja-cart-empty">El carrito está vacío. Escaneá o buscá un producto para empezar.</div>
            ) : (
              <>
                <div className="caja-cart-head">
                  <span style={{ flex: 2.4 }}>Producto</span>
                  <span style={{ flex: 1.2, textAlign: 'center' }}>Cantidad</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Precio</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Subtotal</span>
                  <span style={{ width: 32 }} />
                </div>
                {carrito.map((item) => (
                  <div className="caja-cart-row" key={item.producto_id}>
                    <span style={{ flex: 2.4 }} className="caja-cart-nombre">
                      {item.nombre}
                      {item.cantidad > item.stock_vendible && (
                        <span className="caja-cart-warning">Solo hay {item.stock_vendible} en stock</span>
                      )}
                    </span>
                    <span style={{ flex: 1.2 }} className="caja-cart-cantidad">
                      <button type="button" onClick={() => cambiarCantidad(item.producto_id, -1)}>
                        –
                      </button>
                      <span>{item.cantidad}</span>
                      <button type="button" onClick={() => cambiarCantidad(item.producto_id, 1)}>
                        +
                      </button>
                    </span>
                    <span style={{ flex: 1, textAlign: 'right' }}>{formatearMonto(item.precio_venta)}</span>
                    <span style={{ flex: 1, textAlign: 'right', fontWeight: 700 }}>
                      {formatearMonto(item.precio_venta * item.cantidad)}
                    </span>
                    <span style={{ width: 32, display: 'flex', justifyContent: 'center' }}>
                      <button
                        type="button"
                        className="caja-cart-remove"
                        onClick={() => quitarDelCarrito(item.producto_id)}
                        title="Quitar"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="card caja-cobro">
          <div className="caja-medios">
            <span className="caja-section-label">Medio de cobro</span>
            <div className="caja-medios-grid">
              {MEDIOS_PAGO.map((medio) => (
                <button
                  type="button"
                  key={medio.valor}
                  className={`caja-medio-btn${medioPago === medio.valor ? ' caja-medio-btn-active' : ''}`}
                  onClick={() => setMedioPago(medio.valor)}
                >
                  {medio.icono}
                  <span>{medio.label}</span>
                </button>
              ))}
            </div>
          </div>

          {medioPago === 'efectivo' && (
            <div className="caja-cambio">
              <div className="caja-cambio-row">
                <span>Monto recibido</span>
                <input
                  type="number"
                  min="0"
                  value={montoRecibido}
                  onChange={(e) => setMontoRecibido(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="caja-cambio-row">
                <span>Vuelto</span>
                <span style={{ fontWeight: 700 }}>{formatearMonto(Math.max(vuelto, 0))}</span>
              </div>
            </div>
          )}

          {medioPago === 'cta_cte' && (
            <div className="caja-cliente">
              <label htmlFor="caja-cliente-empresa">Cliente-Empresa</label>
              {clientesEmpresa.length === 0 ? (
                <span className="caja-cliente-vacio">
                  No hay clientes-empresa cargados. Pedile a un Encargado o Administrador que cargue uno en "Clientes y Cta. Cte.".
                </span>
              ) : (
                <select
                  id="caja-cliente-empresa"
                  value={clienteEmpresaId}
                  onChange={(e) => setClienteEmpresaId(e.target.value)}
                >
                  <option value="">Elegí a quién se le vende…</option>
                  {clientesEmpresa.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.razon_social}
                      {c.cuit ? ` · ${c.cuit}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {error && <div className="alert alert-danger">{error}</div>}
          {exito && (
            <div className="alert" style={{ background: 'rgba(14,75,56,0.08)', color: '#0e4b38', border: '1px solid rgba(14,75,56,0.25)' }}>
              {exito}
            </div>
          )}

          <div className="caja-total-block">
            <div className="caja-total-row">
              <span>Total</span>
              <span className="caja-total-value">{formatearMonto(total)}</span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '15px' }}
              disabled={carrito.length === 0 || enviando || (medioPago === 'cta_cte' && !clienteEmpresaId)}
              onClick={confirmarVenta}
            >
              {enviando ? 'Registrando…' : 'Confirmar y Cobrar Venta'}
            </button>

            {puedeAnular && ultimaVentaRegistrada && (
              <div className="caja-anular">
                {!confirmandoAnulacion ? (
                  <button type="button" className="caja-anular-link" onClick={() => setConfirmandoAnulacion(true)}>
                    Anular último ticket (#{ultimaVentaRegistrada.id} · {formatearMonto(ultimaVentaRegistrada.total)})
                  </button>
                ) : (
                  <div className="caja-anular-confirm">
                    <span>¿Confirmás la anulación?</span>
                    <button type="button" className="btn" onClick={() => setConfirmandoAnulacion(false)} disabled={anulando}>
                      No
                    </button>
                    <button type="button" className="btn btn-primary" onClick={anularUltimoTicket} disabled={anulando}>
                      {anulando ? 'Anulando…' : 'Sí, anular'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card caja-gastos">
        <div className="caja-gastos-header">
          <span className="caja-section-label" style={{ marginBottom: 0 }}>
            Gastos y pagos a proveedores
          </span>
          {!mostrarFormGasto && (
            <button type="button" className="btn" onClick={() => setMostrarFormGasto(true)}>
              + Registrar gasto
            </button>
          )}
        </div>

        {errorGasto && <div className="alert alert-danger">{errorGasto}</div>}

        {mostrarFormGasto && (
          <form className="caja-gasto-form" onSubmit={registrarGasto}>
            <input
              required
              placeholder="Concepto (ej. flete, limpieza…)"
              value={nuevoGasto.concepto}
              onChange={(e) => setNuevoGasto({ ...nuevoGasto, concepto: e.target.value })}
            />
            <input
              required
              type="number"
              min="1"
              placeholder="Monto"
              value={nuevoGasto.monto}
              onChange={(e) => setNuevoGasto({ ...nuevoGasto, monto: e.target.value })}
            />
            {proveedoresGasto.length > 0 && (
              <select
                value={nuevoGasto.proveedor_id}
                onChange={(e) => setNuevoGasto({ ...nuevoGasto, proveedor_id: e.target.value })}
              >
                <option value="">Sin proveedor asociado</option>
                {proveedoresGasto.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="btn btn-primary" disabled={registrandoGasto}>
              {registrandoGasto ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="btn" onClick={() => setMostrarFormGasto(false)}>
              Cancelar
            </button>
          </form>
        )}

        <div className="caja-gastos-lista">
          {gastosHoy.length === 0 ? (
            <div className="caja-gastos-vacio">Todavía no se registró ningún gasto hoy.</div>
          ) : (
            gastosHoy.map((g) => (
              <div className="caja-gasto-row" key={g.id}>
                <span className="caja-gasto-concepto">{g.concepto}</span>
                <span className="caja-gasto-monto">{formatearMonto(g.monto)}</span>
                {puedeEliminarGasto && (
                  <button
                    type="button"
                    className="caja-gasto-eliminar"
                    disabled={eliminandoGastoId === g.id}
                    onClick={() => eliminarGasto(g.id)}
                    title="Eliminar gasto"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
