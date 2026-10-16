import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { cuandoFueElCierre, fechaHoyISO, formatearFecha, formatearFechaHora, formatearMonto } from '../utils/format.js';
import { ItemsPedido } from './pedidosComun.jsx';
import './ClientesEmpresaPage.css';
import './Pedidos.css';
import './VentasDiariasPage.css';

// Ventas diarias (pedido del usuario, 2026-10-16): el detalle del día a día que Caja no tenía.
// Las ventas de un período con filtros, los totales y los gastos y pagos a proveedores (que
// salieron de Caja), más el fondo y el efectivo que tendría que haber en la caja en el turno
// abierto (2026-10-16). La entran los 3 roles y ven cualquier fecha (decisión del usuario).
// Solo consulta: anular o cambiar el medio de pago sigue siendo del último ticket, en Caja.

const MEDIOS = [
  { valor: 'efectivo', label: 'Efectivo' },
  { valor: 'tarjeta', label: 'Tarjeta' },
  { valor: 'transferencia_qr', label: 'Transferencia / QR' },
  { valor: 'mercado_pago', label: 'Mercado Pago' },
  { valor: 'fiado', label: 'Pago pendiente' },
  { valor: 'cta_cte', label: 'Cuenta Corriente' },
];
const etiquetaMedio = (valor) => MEDIOS.find((m) => m.valor === valor)?.label ?? valor;

const ESTADOS = [
  { valor: 'registrada', label: 'Cobradas' },
  { valor: 'anulada', label: 'Anuladas' },
  { valor: 'todas', label: 'Todas' },
];

const PUEDE_ELIMINAR_GASTO = new Set(['admin', 'encargado']);

// 'AAAA-MM-DD' corrido N días (al mediodía UTC, así un cambio de hora no lo mueve de día).
function sumarDias(dia, n) {
  const fecha = new Date(`${dia}T12:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + n);
  return fecha.toISOString().slice(0, 10);
}

function rangosRapidos(hoy) {
  return [
    { clave: 'hoy', texto: 'Hoy', desde: hoy, hasta: hoy },
    { clave: 'ayer', texto: 'Ayer', desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) },
    { clave: '7dias', texto: 'Últimos 7 días', desde: sumarDias(hoy, -6), hasta: hoy },
    { clave: 'mes', texto: 'Este mes', desde: `${hoy.slice(0, 8)}01`, hasta: hoy },
  ];
}

const textoPeriodo = (desde, hasta) => (desde === hasta ? formatearFecha(desde) : `${formatearFecha(desde)} al ${formatearFecha(hasta)}`);

// Las líneas de una venta se guardan una por lote (FEFO): se juntan las del mismo producto,
// forma de venta y precio para mostrarlas como se cobraron.
function juntarLineas(items) {
  const lineas = new Map();
  for (const i of items) {
    const clave = [i.producto_id, i.pack_nombre ?? '', i.pack_unidades ?? '', i.precio_unitario, i.precio_cantidad_desde ?? ''].join('|');
    const previa = lineas.get(clave);
    if (previa) {
      previa.cantidad += i.cantidad;
      previa.subtotal += i.subtotal;
    } else {
      lineas.set(clave, { ...i });
    }
  }
  return [...lineas.values()].map((l) => (l.pack_nombre ? { ...l, cantidad_presentacion: Math.round(l.cantidad / l.pack_unidades) } : l));
}

export default function VentasDiariasPage() {
  const { usuario, moduloActivo } = useAuth();
  const conClientes = moduloActivo('clientes_empresa');
  const puedeEliminarGasto = PUEDE_ELIMINAR_GASTO.has(usuario?.rol);
  const conProveedores = usuario?.rol === 'admin' || usuario?.rol === 'encargado';

  const hoy = fechaHoyISO();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [medio, setMedio] = useState('');
  const [vendedor, setVendedor] = useState('');
  const [cliente, setCliente] = useState('');
  const [estado, setEstado] = useState('registrada');
  const [pestana, setPestana] = useState('ventas');

  const [datos, setDatos] = useState(null); // { ventas, totales, vendedores, hay_mas }
  const [gastos, setGastos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [proveedores, setProveedores] = useState([]);

  const [abierta, setAbierta] = useState(null); // id de la venta desplegada
  const [detalle, setDetalle] = useState(null);
  const abiertaRef = useRef(null);

  const [mostrarFormGasto, setMostrarFormGasto] = useState(false);
  const [nuevoGasto, setNuevoGasto] = useState({ concepto: '', monto: '', proveedor_id: '' });
  const [registrandoGasto, setRegistrandoGasto] = useState(false);
  const [confirmandoBaja, setConfirmandoBaja] = useState(null); // id del gasto a eliminar
  // Guardias sincrónicas: un doble click en el mismo tick anotaba el gasto (o la baja) dos veces.
  const registrandoGastoRef = useRef(false);
  const eliminandoGastoRef = useRef(false);
  const pedidoRef = useRef(0); // para descartar respuestas de filtros viejos

  const cargar = useCallback(async () => {
    const pedido = ++pedidoRef.current;
    setCargando(true);
    setError(null);
    const q = new URLSearchParams({ desde, hasta, estado });
    if (medio) q.set('medio_pago', medio);
    if (vendedor) q.set('usuario_id', vendedor);
    if (cliente) q.set('cliente_empresa_id', cliente);
    try {
      const [ventasData, gastosData] = await Promise.all([
        api.get(`/ventas?${q}`),
        api.get(`/caja/gastos?${new URLSearchParams({ desde, hasta })}`),
      ]);
      if (pedido !== pedidoRef.current) return;
      setDatos(ventasData);
      setGastos(gastosData.gastos);
    } catch (err) {
      if (pedido === pedidoRef.current) setError(err instanceof ApiError ? err.message : 'No se pudieron cargar las ventas.');
    } finally {
      if (pedido === pedidoRef.current) setCargando(false);
    }
  }, [desde, hasta, medio, vendedor, cliente, estado]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Al cambiar los filtros se cierra la venta abierta (puede no estar en la lista nueva).
  useEffect(() => {
    abiertaRef.current = null;
    setAbierta(null);
    setDetalle(null);
  }, [desde, hasta, medio, vendedor, cliente, estado]);

  // El detalle que se abre cerca del borde de abajo queda a la vista sin scrollear a mano.
  useEffect(() => {
    if (detalle) document.querySelector('.vd-page .pedido-fila-detalle')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [detalle]);

  useEffect(() => {
    if (!conClientes) return;
    api
      .get('/clientes-empresa')
      .then((data) => setClientes(data.clientes))
      .catch(() => setClientes([]));
  }, [conClientes]);

  // El Cajero no tiene acceso a Proveedores: el gasto lo anota sin proveedor (como en Caja).
  useEffect(() => {
    if (!conProveedores) return;
    api
      .get('/proveedores')
      .then((data) => setProveedores(data.proveedores))
      .catch(() => setProveedores([]));
  }, [conProveedores]);

  function cambiarDesde(valor) {
    if (!valor) return;
    setDesde(valor);
    if (valor > hasta) setHasta(valor);
  }
  function cambiarHasta(valor) {
    if (!valor) return;
    setHasta(valor);
    if (valor < desde) setDesde(valor);
  }

  async function abrirVenta(id) {
    if (abierta === id) {
      abiertaRef.current = null;
      setAbierta(null);
      setDetalle(null);
      return;
    }
    abiertaRef.current = id;
    setAbierta(id);
    setDetalle(null);
    try {
      const venta = await api.get(`/ventas/${id}`);
      if (abiertaRef.current === id) setDetalle({ ...venta, lineas: juntarLineas(venta.items) });
    } catch (err) {
      if (abiertaRef.current === id) setDetalle({ error: err instanceof ApiError ? err.message : 'No se pudo cargar la venta.' });
    }
  }

  async function registrarGasto(e) {
    e.preventDefault();
    if (registrandoGastoRef.current) return;
    registrandoGastoRef.current = true;
    setRegistrandoGasto(true);
    setError(null);
    setExito(null);
    try {
      await api.post('/caja/gastos', {
        concepto: nuevoGasto.concepto,
        monto: Number(nuevoGasto.monto),
        proveedor_id: nuevoGasto.proveedor_id === '' ? null : Number(nuevoGasto.proveedor_id),
      });
      setNuevoGasto({ concepto: '', monto: '', proveedor_id: '' });
      setMostrarFormGasto(false);
      setExito(
        hoy >= desde && hoy <= hasta
          ? 'Gasto anotado.'
          : `Gasto anotado con fecha de hoy (${formatearFecha(hoy)}). No aparece en la lista porque estás mirando otras fechas.`
      );
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anotar el gasto.');
    } finally {
      registrandoGastoRef.current = false;
      setRegistrandoGasto(false);
    }
  }

  async function eliminarGasto(id) {
    if (eliminandoGastoRef.current) return;
    eliminandoGastoRef.current = true;
    setError(null);
    setExito(null);
    try {
      await api.delete(`/caja/gastos/${id}`);
      setConfirmandoBaja(null);
      setExito('Gasto eliminado.');
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo eliminar el gasto.');
    } finally {
      eliminandoGastoRef.current = false;
    }
  }

  const totales = datos?.totales;
  const tickets = totales?.tickets ?? 0;
  const totalGastos = gastos.reduce((acc, g) => acc + g.monto, 0);
  const ventas = datos?.ventas ?? [];
  // Plata del cajón (Fondo y Efectivo en caja): la del turno abierto, calculada por el servidor
  // igual que Cierre de Caja y sin los filtros de ventas. Solo cuando se mira hoy: el cierre es
  // por turno y cada cierre retira la plata.
  const esHoy = desde === hoy && hasta === hoy;
  const caja = datos?.caja;
  const mediosConVentas = MEDIOS.filter((m) => totales?.por_medio?.[m.valor]?.total > 0);
  const mediosDelFiltro = MEDIOS.filter((m) => m.valor !== 'cta_cte' || conClientes);
  const columnas = 6 + (conClientes ? 1 : 0) + (estado === 'registrada' ? 0 : 1);
  const rapido = rangosRapidos(hoy).find((r) => r.desde === desde && r.hasta === hasta)?.clave;

  return (
    <div className="cliente-page vd-page">
      <div className="card vd-filtros">
        <div className="vd-rapidos" role="group" aria-label="Período">
          {rangosRapidos(hoy).map((r) => (
            <button
              key={r.clave}
              type="button"
              className={`vd-rapido${rapido === r.clave ? ' vd-rapido-activo' : ''}`}
              aria-pressed={rapido === r.clave}
              onClick={() => {
                setDesde(r.desde);
                setHasta(r.hasta);
              }}
            >
              {r.texto}
            </button>
          ))}
        </div>
        <div className="vd-campos">
          <label className="vd-campo">
            <span>Desde</span>
            <input type="date" value={desde} max={hoy} onChange={(e) => cambiarDesde(e.target.value)} />
          </label>
          <label className="vd-campo">
            <span>Hasta</span>
            <input type="date" value={hasta} max={hoy} onChange={(e) => cambiarHasta(e.target.value)} />
          </label>
          {pestana === 'ventas' && (
            <>
              <label className="vd-campo">
                <span>Medio de pago</span>
                <select value={medio} onChange={(e) => setMedio(e.target.value)}>
                  <option value="">Todos</option>
                  {mediosDelFiltro.map((m) => (
                    <option key={m.valor} value={m.valor}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="vd-campo">
                <span>Cobró</span>
                <select value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
                  <option value="">Todos</option>
                  {(datos?.vendedores ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                    </option>
                  ))}
                </select>
              </label>
              {conClientes && (
                <label className="vd-campo">
                  <span>Cliente (cuenta corriente)</span>
                  <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
                    <option value="">Todos</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.razon_social}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="vd-campo">
                <span>Estado</span>
                <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                  {ESTADOS.map((s) => (
                    <option key={s.valor} value={s.valor}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      </div>

      <div className="cliente-kpis vd-kpis">
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Fondo</span>
          <span className="cliente-kpi-value">{esHoy ? formatearMonto(caja?.fondo ?? 0) : '—'}</span>
          <span className="vd-kpi-nota">
            {!esHoy ? 'Solo para hoy' : caja?.fondo_desde ? `Dejado en el cierre ${cuandoFueElCierre(caja.fondo_desde)}` : 'Sin cierres anteriores'}
          </span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Ventas</span>
          <span className="cliente-kpi-value">{formatearMonto(totales?.total ?? 0)}</span>
          <span className="vd-kpi-nota">{textoPeriodo(desde, hasta)}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Tickets</span>
          <span className="cliente-kpi-value">{tickets}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Ticket promedio</span>
          <span className="cliente-kpi-value">{formatearMonto(tickets > 0 ? Math.round(totales.total / tickets) : 0)}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Gastos y pagos</span>
          <span className="cliente-kpi-value" style={{ color: totalGastos > 0 ? 'var(--color-danger)' : undefined }}>
            {formatearMonto(totalGastos)}
          </span>
        </div>
        <div className="card cliente-kpi vd-kpi-caja">
          <span className="cliente-kpi-label">Efectivo en caja</span>
          <span className="cliente-kpi-value">{esHoy ? formatearMonto(caja?.efectivo_en_caja ?? 0) : '—'}</span>
          <span className="vd-kpi-nota">{esHoy ? 'Turno abierto: fondo + ventas en efectivo − gastos' : 'Solo para hoy'}</span>
        </div>
      </div>

      {(mediosConVentas.length > 0 || totales?.anuladas > 0) && (
        <div className="vd-medios">
          {mediosConVentas.map((m) => (
            <span key={m.valor} className="vd-medio">
              {m.label} <strong>{formatearMonto(totales.por_medio[m.valor].total)}</strong>
            </span>
          ))}
          {totales?.anuladas > 0 && (
            <span className="vd-medio vd-medio-anuladas">
              {totales.anuladas === 1 ? '1 venta anulada' : `${totales.anuladas} ventas anuladas`} (no suman)
            </span>
          )}
        </div>
      )}

      <div className="cliente-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={pestana === 'ventas'}
          className={`cliente-tab${pestana === 'ventas' ? ' cliente-tab-activa' : ''}`}
          onClick={() => setPestana('ventas')}
        >
          Ventas ({ventas.length}
          {datos?.hay_mas ? '+' : ''})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pestana === 'gastos'}
          className={`cliente-tab${pestana === 'gastos' ? ' cliente-tab-activa' : ''}`}
          onClick={() => setPestana('gastos')}
        >
          Gastos y pagos a proveedores ({gastos.length})
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      {pestana === 'ventas' ? (
        <div className="card cliente-card">
          {datos?.hay_mas && (
            <div className="alert alert-aviso">
              Se muestran las 1.000 ventas más recientes. Los totales de arriba son de todas. Acotá las fechas para ver el resto.
            </div>
          )}
          {cargando && !datos ? (
            <div className="cliente-vacio">Cargando…</div>
          ) : ventas.length === 0 ? (
            <div className="cliente-vacio">No hay ventas con estos filtros.</div>
          ) : (
            <div className="cliente-tabla-wrap">
              <table className="cliente-tabla vd-tabla">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Fecha y hora</th>
                    <th className="vd-opcional">Cobró</th>
                    <th>Medio de pago</th>
                    {conClientes && <th>Cliente</th>}
                    <th className="num vd-opcional">Productos</th>
                    <th className="num">Total</th>
                    {estado !== 'registrada' && <th>Estado</th>}
                  </tr>
                </thead>
                <tbody>
                  {ventas.map((v) => (
                    <Fragment key={v.id}>
                      <tr
                        className={`${abierta === v.id ? 'pedido-fila-abierta' : ''}${v.estado === 'anulada' ? ' vd-fila-anulada' : ''}`}
                        onClick={() => abrirVenta(v.id)}
                      >
                        <td>#{v.id}</td>
                        <td>{formatearFechaHora(v.creado_en)}</td>
                        <td className="vd-opcional">{v.usuario_nombre}</td>
                        <td>{etiquetaMedio(v.medio_pago)}</td>
                        {conClientes && <td className="cliente-td-nombre">{v.cliente_razon_social ?? '—'}</td>}
                        <td className="num vd-opcional">{v.cantidad_productos}</td>
                        <td className="num vd-total">{formatearMonto(v.total)}</td>
                        {estado !== 'registrada' && (
                          <td>{v.estado === 'anulada' ? <span className="pedido-estado pedido-estado-cancelado">Anulada</span> : <span className="pedido-estado pedido-estado-aprobado">Cobrada</span>}</td>
                        )}
                      </tr>
                      {abierta === v.id && (
                        <tr className="pedido-fila-detalle sin-click">
                          <td colSpan={columnas}>
                            {!detalle ? (
                              <div className="cliente-vacio">Cargando…</div>
                            ) : detalle.error ? (
                              <div className="alert alert-danger">{detalle.error}</div>
                            ) : (
                              <div className="pedido-detalle">
                                <div className="pedido-detalle-meta">
                                  <span>
                                    Cobró: <strong>{v.usuario_nombre}</strong>
                                  </span>
                                  <span>
                                    Medio de pago: <strong>{etiquetaMedio(v.medio_pago)}</strong>
                                  </span>
                                  {v.cliente_razon_social && (
                                    <span>
                                      Cliente: <strong>{v.cliente_razon_social}</strong>
                                    </span>
                                  )}
                                  {v.estado === 'anulada' && (
                                    <span>
                                      Anulada por <strong>{v.anulada_por_nombre ?? '—'}</strong> · {formatearFechaHora(v.anulada_en)}
                                    </span>
                                  )}
                                </div>
                                <div className="cliente-tabla-wrap">
                                  <ItemsPedido items={detalle.lineas} total={detalle.total} />
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
      ) : (
        <div className="card cliente-card">
          <div className="cliente-seccion-cabecera">
            <span className="cliente-seccion-titulo">Gastos y pagos a proveedores · {textoPeriodo(desde, hasta)}</span>
            {!mostrarFormGasto && (
              <button type="button" className="btn" onClick={() => setMostrarFormGasto(true)}>
                + Anotar gasto
              </button>
            )}
          </div>

          {mostrarFormGasto && (
            <form className="vd-gasto-form" onSubmit={registrarGasto}>
              <input
                required
                maxLength={200}
                placeholder="Concepto (ej. flete, limpieza…)"
                aria-label="Concepto"
                value={nuevoGasto.concepto}
                onChange={(e) => setNuevoGasto({ ...nuevoGasto, concepto: e.target.value })}
              />
              <input
                required
                type="number"
                min="1"
                placeholder="Monto"
                aria-label="Monto"
                value={nuevoGasto.monto}
                onChange={(e) => setNuevoGasto({ ...nuevoGasto, monto: e.target.value })}
              />
              {proveedores.length > 0 && (
                <select
                  aria-label="Proveedor"
                  value={nuevoGasto.proveedor_id}
                  onChange={(e) => setNuevoGasto({ ...nuevoGasto, proveedor_id: e.target.value })}
                >
                  <option value="">Sin proveedor asociado</option>
                  {proveedores.map((p) => (
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
              <span className="vd-gasto-nota">Se anota con la fecha y hora de ahora, siempre en efectivo (sale de la caja).</span>
            </form>
          )}

          {cargando && !datos ? (
            <div className="cliente-vacio">Cargando…</div>
          ) : gastos.length === 0 ? (
            <div className="cliente-vacio">No hay gastos en estas fechas.</div>
          ) : (
            <div className="cliente-tabla-wrap">
              <table className="cliente-tabla vd-tabla">
                <thead>
                  <tr>
                    <th>Fecha y hora</th>
                    <th>Concepto</th>
                    <th className="vd-opcional">Proveedor</th>
                    <th className="vd-opcional">Anotó</th>
                    <th className="num">Monto</th>
                    {puedeEliminarGasto && <th aria-label="Acciones" />}
                  </tr>
                </thead>
                <tbody>
                  {gastos.map((g) => (
                    <tr key={g.id} className="sin-click">
                      <td>{formatearFechaHora(g.creado_en)}</td>
                      <td className="cliente-td-nombre">{g.concepto}</td>
                      <td className="vd-opcional">{g.proveedor_nombre ?? '—'}</td>
                      <td className="vd-opcional">{g.usuario_nombre}</td>
                      <td className="num vd-gasto-monto">{formatearMonto(g.monto)}</td>
                      {puedeEliminarGasto && (
                        <td className="vd-gasto-acciones">
                          {confirmandoBaja === g.id ? (
                            <span className="vd-confirmar">
                              ¿Eliminar?
                              <button type="button" className="vd-link vd-link-peligro" onClick={() => eliminarGasto(g.id)}>
                                Sí
                              </button>
                              <button type="button" className="vd-link" onClick={() => setConfirmandoBaja(null)}>
                                No
                              </button>
                            </span>
                          ) : (
                            <button type="button" className="vd-eliminar" title="Eliminar gasto" onClick={() => setConfirmandoBaja(g.id)}>
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18" />
                                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              </svg>
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total</td>
                    <td className="vd-opcional" />
                    <td className="vd-opcional" />
                    <td className="num vd-gasto-monto">{formatearMonto(totalGastos)}</td>
                    {puedeEliminarGasto && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
