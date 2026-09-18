import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearFechaHora, formatearMonto } from '../utils/format.js';
import './ClientesEmpresaPage.css';

const CLIENTE_VACIO = {
  razon_social: '',
  cuit: '',
  contacto_nombre: '',
  telefono: '',
  email: '',
  direccion: '',
  condicion_pago_id: '',
};

const ETIQUETA_TIPO = { CARGO: 'Cargo', PAGO: 'Pago', AJUSTE: 'Ajuste' };

function aFormulario(cliente) {
  return {
    razon_social: cliente.razon_social,
    cuit: cliente.cuit ?? '',
    contacto_nombre: cliente.contacto_nombre ?? '',
    telefono: cliente.telefono ?? '',
    email: cliente.email ?? '',
    direccion: cliente.direccion ?? '',
    condicion_pago_id: cliente.condicion_pago_id != null ? String(cliente.condicion_pago_id) : '',
  };
}

const idONull = (valor) => (valor === '' ? null : Number(valor));

// La condición de pago se elige de un catálogo que el Admin gestiona en
// Configuración (pedido del usuario 2026-09-18). Si la condición del cliente
// se dio de baja después, se sigue mostrando (marcada) en vez de dejar el
// select en blanco y perderla sin querer al guardar.
function SelectCondicionPago({ value, onChange, condiciones, nombreActual }) {
  const idActual = idONull(value);
  const dadaDeBaja = idActual !== null && !condiciones.some((c) => c.id === idActual);
  return (
    <>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Sin condición de pago</option>
        {dadaDeBaja && (
          <option value={value}>{nombreActual ? `${nombreActual} (ya no disponible)` : `#${idActual} (ya no disponible)`}</option>
        )}
        {condiciones.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
      {condiciones.length === 0 && (
        <span className="clientes-hint">Todavía no hay opciones. El Administrador las carga en Configuración → Condiciones de pago.</span>
      )}
    </>
  );
}

// Convención de signo (Docs/Modelo-de-Datos.md): saldo positivo = el cliente
// le debe al negocio, negativo = tiene saldo a favor.
function estadoSaldo(saldo) {
  if (saldo > 0) return { clave: 'debe', texto: 'Debe' };
  if (saldo < 0) return { clave: 'favor', texto: 'A favor' };
  return { clave: 'aldia', texto: 'Al día' };
}

export default function ClientesEmpresaPage() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';

  const [clientes, setClientes] = useState([]);
  const [condiciones, setCondiciones] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [panel, setPanel] = useState('ninguno'); // 'ninguno' | 'nuevo' | 'detalle'
  const [detalle, setDetalle] = useState(null); // { ...cliente, saldo, movimientos }
  const [edicion, setEdicion] = useState(null);
  const [nuevoCliente, setNuevoCliente] = useState(CLIENTE_VACIO);
  const [pago, setPago] = useState({ monto: '', descripcion: '' });
  const [ajuste, setAjuste] = useState({ monto: '', descripcion: '' });
  const [mostrarAjuste, setMostrarAjuste] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [panelError, setPanelError] = useState(null);
  const [panelExito, setPanelExito] = useState(null);

  // Guardia real contra doble-click/doble-submit (mismo criterio que el resto
  // de las pantallas, hallazgo de verificador-funcional 2026-09-10): un ref
  // mutado de forma sincrónica -- `guardando` solo no alcanza porque React
  // puede no haber re-renderizado el `disabled` entre 2 eventos del mismo
  // tick. Acá pesa más que en otras pantallas: un pago duplicado altera el
  // saldo real de un cliente.
  const guardaRef = useRef(false);

  async function cargarClientes() {
    setCargando(true);
    setError(null);
    try {
      const data = await api.get('/clientes-empresa');
      setClientes(data.clientes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los clientes.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarClientes();
    api
      .get('/condiciones-pago')
      .then((data) => setCondiciones(data.items))
      .catch(() => setCondiciones([]));
  }, []);

  const clientesFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return clientes;
    return clientes.filter((c) =>
      [c.razon_social, c.cuit, c.contacto_nombre].some((v) => v && v.toLowerCase().includes(texto))
    );
  }, [clientes, busqueda]);

  const kpis = useMemo(
    () => ({
      activos: clientes.length,
      conSaldo: clientes.filter((c) => c.saldo > 0).length,
      totalACobrar: clientes.reduce((acc, c) => acc + Math.max(c.saldo, 0), 0),
    }),
    [clientes]
  );

  async function conGuardia(accion, mensajeError) {
    if (guardaRef.current) return;
    guardaRef.current = true;
    setGuardando(true);
    setPanelError(null);
    setPanelExito(null);
    try {
      await accion();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : mensajeError);
    } finally {
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  async function abrirDetalle(cliente) {
    setPanel('detalle');
    setPanelError(null);
    setPanelExito(null);
    setConfirmandoEliminar(false);
    setMostrarAjuste(false);
    setPago({ monto: '', descripcion: '' });
    setAjuste({ monto: '', descripcion: '' });
    setDetalle({ ...cliente, movimientos: [] });
    setEdicion(aFormulario(cliente));
    try {
      const completo = await api.get(`/clientes-empresa/${cliente.id}`);
      setDetalle(completo);
      setEdicion(aFormulario(completo));
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo cargar el detalle del cliente.');
    }
  }

  function abrirNuevo() {
    setPanel('nuevo');
    setNuevoCliente(CLIENTE_VACIO);
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

  function crearCliente(e) {
    e.preventDefault();
    return conGuardia(async () => {
      const creado = await api.post('/clientes-empresa', {
        razon_social: nuevoCliente.razon_social,
        cuit: nuevoCliente.cuit || null,
        contacto_nombre: nuevoCliente.contacto_nombre || null,
        telefono: nuevoCliente.telefono || null,
        email: nuevoCliente.email || null,
        direccion: nuevoCliente.direccion || null,
        condicion_pago_id: idONull(nuevoCliente.condicion_pago_id),
      });
      await cargarClientes();
      setPanel('detalle');
      setDetalle(creado);
      setEdicion(aFormulario(creado));
      setPanelExito('Cliente creado.');
    }, 'No se pudo crear el cliente.');
  }

  function guardarCliente() {
    return conGuardia(async () => {
      const actualizado = await api.patch(`/clientes-empresa/${detalle.id}`, {
        razon_social: edicion.razon_social,
        cuit: edicion.cuit || null,
        contacto_nombre: edicion.contacto_nombre || null,
        telefono: edicion.telefono || null,
        email: edicion.email || null,
        direccion: edicion.direccion || null,
        condicion_pago_id: idONull(edicion.condicion_pago_id),
      });
      setDetalle(actualizado);
      setEdicion(aFormulario(actualizado));
      setPanelExito('Cambios guardados.');
      cargarClientes();
    }, 'No se pudieron guardar los cambios.');
  }

  function registrarPago(e) {
    e.preventDefault();
    return conGuardia(async () => {
      const resultado = await api.post(`/clientes-empresa/${detalle.id}/pagos`, {
        monto: Number(pago.monto),
        descripcion: pago.descripcion || null,
      });
      setDetalle((prev) => ({ ...prev, saldo: resultado.saldo, movimientos: resultado.movimientos }));
      setPago({ monto: '', descripcion: '' });
      setPanelExito('Pago registrado.');
      cargarClientes();
    }, 'No se pudo registrar el pago.');
  }

  function registrarAjuste(e) {
    e.preventDefault();
    return conGuardia(async () => {
      const resultado = await api.post(`/clientes-empresa/${detalle.id}/ajustes`, {
        monto: Number(ajuste.monto),
        descripcion: ajuste.descripcion,
      });
      setDetalle((prev) => ({ ...prev, saldo: resultado.saldo, movimientos: resultado.movimientos }));
      setAjuste({ monto: '', descripcion: '' });
      setMostrarAjuste(false);
      setPanelExito('Ajuste registrado.');
      cargarClientes();
    }, 'No se pudo registrar el ajuste.');
  }

  function eliminarCliente() {
    return conGuardia(async () => {
      try {
        await api.delete(`/clientes-empresa/${detalle.id}`);
        cerrarPanel();
        cargarClientes();
      } catch (err) {
        setConfirmandoEliminar(false);
        throw err;
      }
    }, 'No se pudo eliminar el cliente.');
  }

  const estado = detalle ? estadoSaldo(detalle.saldo ?? 0) : null;

  return (
    <div className="clientes-page">
      <div className="clientes-kpis">
        <div className="card clientes-kpi">
          <span className="clientes-kpi-label">Clientes activos</span>
          <span className="clientes-kpi-value">{kpis.activos}</span>
        </div>
        <div className="card clientes-kpi">
          <span className="clientes-kpi-label">Clientes con saldo pendiente</span>
          <span className="clientes-kpi-value">{kpis.conSaldo}</span>
        </div>
        <div className="card clientes-kpi">
          <span className="clientes-kpi-label">Total a cobrar</span>
          <span className="clientes-kpi-value">{formatearMonto(kpis.totalACobrar)}</span>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="clientes-body">
        <div className="card clientes-lista">
          <div className="clientes-lista-header">
            <span className="clientes-titulo">Clientes-Empresa</span>
            <div className="clientes-search">
              <input
                type="text"
                placeholder="Buscar por razón social, CUIT o contacto…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={abrirNuevo}>
              + Nuevo Cliente
            </button>
          </div>

          {cargando ? (
            <div className="clientes-vacio">Cargando…</div>
          ) : clientesFiltrados.length === 0 ? (
            <div className="clientes-vacio">
              {clientes.length === 0 ? 'Todavía no hay clientes-empresa cargados.' : 'Sin resultados.'}
            </div>
          ) : (
            <div className="clientes-tabla">
              <div className="clientes-tabla-head">
                <span style={{ flex: 1.5 }}>Razón social</span>
                <span style={{ flex: 1.3 }}>Contacto</span>
                <span style={{ flex: 1 }}>Condición de pago</span>
                <span style={{ flex: 0.9, textAlign: 'right' }}>Saldo</span>
              </div>
              {clientesFiltrados.map((c) => {
                const est = estadoSaldo(c.saldo);
                return (
                  <button
                    type="button"
                    key={c.id}
                    className={`clientes-fila${detalle?.id === c.id && panel === 'detalle' ? ' clientes-fila-activa' : ''}`}
                    onClick={() => abrirDetalle(c)}
                  >
                    <span style={{ flex: 1.5 }} className="clientes-fila-nombre">
                      {c.razon_social}
                      {c.cuit && <span className="clientes-fila-cuit">{c.cuit}</span>}
                    </span>
                    <span style={{ flex: 1.3 }} className="clientes-fila-muted">
                      {[c.contacto_nombre, c.telefono].filter(Boolean).join(' · ') || '—'}
                    </span>
                    <span style={{ flex: 1 }} className="clientes-fila-muted">
                      {c.condicion_pago || '—'}
                    </span>
                    <span style={{ flex: 0.9, textAlign: 'right' }}>
                      <span className={`clientes-saldo clientes-saldo-${est.clave}`}>{formatearMonto(c.saldo)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="card clientes-panel">
          {panel === 'ninguno' && (
            <div className="clientes-panel-vacio">
              Seleccioná un cliente para ver su cuenta corriente, registrar un pago o editar sus datos.
            </div>
          )}

          {panel === 'nuevo' && (
            <form className="clientes-form" onSubmit={crearCliente}>
              <div className="clientes-panel-titulo">
                <span>Nuevo Cliente-Empresa</span>
                <button type="button" className="clientes-panel-cerrar" onClick={cerrarPanel}>
                  ✕
                </button>
              </div>
              {panelError && <div className="alert alert-danger">{panelError}</div>}
              <div className="field">
                <label>Razón social</label>
                <input required value={nuevoCliente.razon_social} onChange={(e) => setNuevoCliente({ ...nuevoCliente, razon_social: e.target.value })} />
              </div>
              <div className="clientes-grid2">
                <div className="field">
                  <label>CUIT</label>
                  <input placeholder="30-12345678-9" value={nuevoCliente.cuit} onChange={(e) => setNuevoCliente({ ...nuevoCliente, cuit: e.target.value })} />
                </div>
                <div className="field">
                  <label>Persona de contacto</label>
                  <input value={nuevoCliente.contacto_nombre} onChange={(e) => setNuevoCliente({ ...nuevoCliente, contacto_nombre: e.target.value })} />
                </div>
              </div>
              <div className="clientes-grid2">
                <div className="field">
                  <label>Teléfono</label>
                  <input value={nuevoCliente.telefono} onChange={(e) => setNuevoCliente({ ...nuevoCliente, telefono: e.target.value })} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" value={nuevoCliente.email} onChange={(e) => setNuevoCliente({ ...nuevoCliente, email: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Dirección</label>
                <input value={nuevoCliente.direccion} onChange={(e) => setNuevoCliente({ ...nuevoCliente, direccion: e.target.value })} />
              </div>
              <div className="field">
                <label>Condición de pago</label>
                <SelectCondicionPago
                  value={nuevoCliente.condicion_pago_id}
                  onChange={(v) => setNuevoCliente({ ...nuevoCliente, condicion_pago_id: v })}
                  condiciones={condiciones}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={guardando} style={{ width: '100%' }}>
                {guardando ? 'Creando…' : 'Crear Cliente'}
              </button>
            </form>
          )}

          {panel === 'detalle' && detalle && edicion && (
            <div className="clientes-detalle">
              <div className="clientes-panel-titulo">
                <span>{detalle.razon_social}</span>
                <button type="button" className="clientes-panel-cerrar" onClick={cerrarPanel}>
                  ✕
                </button>
              </div>

              {panelError && <div className="alert alert-danger">{panelError}</div>}
              {panelExito && (
                <div className="alert" style={{ background: 'rgba(14,75,56,0.08)', color: '#0e4b38', border: '1px solid rgba(14,75,56,0.25)' }}>
                  {panelExito}
                </div>
              )}

              <div className="clientes-saldo-card">
                <span className="clientes-saldo-label">Saldo de cuenta corriente</span>
                <span className={`clientes-saldo-valor clientes-saldo-${estado.clave}`}>{formatearMonto(detalle.saldo)}</span>
                <span className={`clientes-badge clientes-badge-${estado.clave}`}>{estado.texto}</span>
              </div>

              <form className="clientes-seccion" onSubmit={registrarPago}>
                <span className="clientes-section-label">Registrar pago</span>
                <div className="clientes-grid2">
                  <div className="field">
                    <label>Monto recibido</label>
                    <input required type="number" min="1" step="1" placeholder="0" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Detalle (opcional)</label>
                    <input placeholder="Ej: Transferencia" value={pago.descripcion} onChange={(e) => setPago({ ...pago, descripcion: e.target.value })} />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" disabled={guardando}>
                  Registrar Pago
                </button>
              </form>

              <div className="clientes-seccion">
                <div className="clientes-seccion-header">
                  <span className="clientes-section-label">Movimientos ({detalle.movimientos.length})</span>
                  <button type="button" className="clientes-link" onClick={() => setMostrarAjuste((v) => !v)}>
                    {mostrarAjuste ? 'Cancelar ajuste' : 'Cargar ajuste manual'}
                  </button>
                </div>

                {mostrarAjuste && (
                  <form className="clientes-ajuste" onSubmit={registrarAjuste}>
                    <div className="clientes-hint">
                      Solo para corregir un error de carga. Un monto positivo suma deuda; uno negativo la reduce. Los movimientos existentes nunca se editan ni se borran.
                    </div>
                    <div className="clientes-grid2">
                      <div className="field">
                        <label>Monto (con signo)</label>
                        <input required type="number" step="1" placeholder="-500" value={ajuste.monto} onChange={(e) => setAjuste({ ...ajuste, monto: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>Motivo</label>
                        <input required value={ajuste.descripcion} onChange={(e) => setAjuste({ ...ajuste, descripcion: e.target.value })} />
                      </div>
                    </div>
                    <button type="submit" className="btn" disabled={guardando}>
                      Registrar Ajuste
                    </button>
                  </form>
                )}

                {detalle.movimientos.length === 0 ? (
                  <div className="clientes-hint">Sin movimientos todavía.</div>
                ) : (
                  <div className="clientes-movimientos">
                    {detalle.movimientos.map((m) => (
                      <div className="clientes-mov" key={m.id}>
                        <span className={`clientes-tipo clientes-tipo-${m.tipo}`}>{ETIQUETA_TIPO[m.tipo]}</span>
                        <div className="clientes-mov-info">
                          <span className="clientes-mov-desc">{m.descripcion || (m.venta_id ? `Venta #${m.venta_id}` : '—')}</span>
                          <span className="clientes-mov-meta">
                            {formatearFechaHora(m.creado_en)} · {m.usuario_nombre}
                          </span>
                        </div>
                        <span className="clientes-mov-monto">
                          {m.monto > 0 ? '+' : ''}
                          {formatearMonto(m.monto)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="clientes-seccion">
                <span className="clientes-section-label">Datos del cliente</span>
                <div className="field">
                  <label>Razón social</label>
                  <input value={edicion.razon_social} onChange={(e) => setEdicion({ ...edicion, razon_social: e.target.value })} />
                </div>
                <div className="clientes-grid2">
                  <div className="field">
                    <label>CUIT</label>
                    <input value={edicion.cuit} onChange={(e) => setEdicion({ ...edicion, cuit: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Persona de contacto</label>
                    <input value={edicion.contacto_nombre} onChange={(e) => setEdicion({ ...edicion, contacto_nombre: e.target.value })} />
                  </div>
                </div>
                <div className="clientes-grid2">
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
                  <label>Dirección</label>
                  <input value={edicion.direccion} onChange={(e) => setEdicion({ ...edicion, direccion: e.target.value })} />
                </div>
                <div className="field">
                  <label>Condición de pago</label>
                  <SelectCondicionPago
                    value={edicion.condicion_pago_id}
                    onChange={(v) => setEdicion({ ...edicion, condicion_pago_id: v })}
                    condiciones={condiciones}
                    nombreActual={detalle.condicion_pago}
                  />
                </div>
                <button type="button" className="btn btn-primary" disabled={guardando} onClick={guardarCliente}>
                  Guardar cambios
                </button>
              </div>

              {esAdmin && (
                <div className="clientes-eliminar">
                  {!confirmandoEliminar ? (
                    <button type="button" className="clientes-eliminar-link" onClick={() => setConfirmandoEliminar(true)}>
                      Eliminar cliente
                    </button>
                  ) : (
                    <div className="clientes-eliminar-confirm">
                      <span>
                        ¿Eliminar "{detalle.razon_social}"? Su historial de cuenta corriente se conserva, pero ya no se le va a poder vender a cuenta corriente.
                      </span>
                      <div>
                        <button type="button" className="btn" onClick={() => setConfirmandoEliminar(false)}>
                          Cancelar
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
                          disabled={guardando}
                          onClick={eliminarCliente}
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
