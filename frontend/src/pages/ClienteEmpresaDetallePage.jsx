import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearFechaHora, formatearMonto } from '../utils/format.js';
import { CamposCliente, aFormulario, aPayload, estadoSaldo, useCondicionesPago } from './clientesEmpresaComun.jsx';
import ClienteAccesoPortal from './ClienteAccesoPortal.jsx';
import ResumenCuentaDescarga from './ResumenCuentaDescarga.jsx';
import './ClientesEmpresaPage.css';

const ETIQUETA_TIPO = { CARGO: 'Cargo', PAGO: 'Pago', AJUSTE: 'Ajuste' };
const TABS = [
  { clave: 'resumen', texto: 'Resumen' },
  { clave: 'datos', texto: 'Datos' },
  { clave: 'compras', texto: 'Compras' },
  { clave: 'pagos', texto: 'Pagos' },
  { clave: 'cuenta', texto: 'Cuenta corriente' },
  { clave: 'acceso', texto: 'Acceso' },
];

function TablaMovimientos({ movimientos, vacio }) {
  if (movimientos.length === 0) return <div className="cliente-vacio">{vacio}</div>;
  return (
    <div className="cliente-tabla-wrap">
      <table className="cliente-tabla cliente-tabla-movs">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Detalle</th>
            <th>Registrado por</th>
            <th className="num">Monto</th>
          </tr>
        </thead>
        <tbody>
          {movimientos.map((m) => (
            <tr key={m.id} className="sin-click">
              <td>{formatearFechaHora(m.creado_en)}</td>
              <td>
                <span className={`cliente-tipo cliente-tipo-${m.tipo}`}>{ETIQUETA_TIPO[m.tipo]}</span>
              </td>
              <td>{m.descripcion || (m.venta_id ? `Venta #${m.venta_id}` : '—')}</td>
              <td>{m.usuario_nombre}</td>
              <td className="num cliente-mov-monto">
                {m.monto > 0 ? '+' : ''}
                {formatearMonto(m.monto)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ClienteEmpresaDetallePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';
  const condiciones = useCondicionesPago();

  const [detalle, setDetalle] = useState(null); // { ...cliente, saldo, movimientos }
  const [edicion, setEdicion] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState('resumen');
  const [pago, setPago] = useState({ monto: '', descripcion: '' });
  const [ajuste, setAjuste] = useState({ monto: '', descripcion: '' });
  const [mostrarAjuste, setMostrarAjuste] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(location.state?.exito ?? null);

  // Guardia real contra doble-click/doble-submit: un pago duplicado altera el
  // saldo real de un cliente (hallazgo de verificador-funcional 2026-09-10).
  const guardaRef = useRef(false);

  useEffect(() => {
    setCargando(true);
    api
      .get(`/clientes-empresa/${id}`)
      .then((completo) => {
        setDetalle(completo);
        setEdicion(aFormulario(completo));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar el cliente.'))
      .finally(() => setCargando(false));
  }, [id]);

  const resumen = useMemo(() => {
    const movs = detalle?.movimientos ?? [];
    const compras = movs.filter((m) => m.tipo === 'CARGO');
    const pagos = movs.filter((m) => m.tipo === 'PAGO');
    return {
      compras,
      pagos,
      totalComprado: compras.reduce((acc, m) => acc + m.monto, 0),
      totalPagado: -pagos.reduce((acc, m) => acc + m.monto, 0),
      ultimaCompra: compras[0]?.creado_en ?? null, // la API ya los devuelve del más reciente al más viejo
    };
  }, [detalle]);

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

  function guardarCliente(e) {
    e.preventDefault();
    return conGuardia(async () => {
      const actualizado = await api.patch(`/clientes-empresa/${id}`, aPayload(edicion));
      setDetalle(actualizado);
      setEdicion(aFormulario(actualizado));
      setExito('Cambios guardados.');
    }, 'No se pudieron guardar los cambios.');
  }

  function registrarPago(e) {
    e.preventDefault();
    return conGuardia(async () => {
      const resultado = await api.post(`/clientes-empresa/${id}/pagos`, {
        monto: Number(pago.monto),
        descripcion: pago.descripcion || null,
      });
      setDetalle((prev) => ({ ...prev, saldo: resultado.saldo, movimientos: resultado.movimientos }));
      setPago({ monto: '', descripcion: '' });
      setExito('Pago registrado.');
    }, 'No se pudo registrar el pago.');
  }

  function registrarAjuste(e) {
    e.preventDefault();
    return conGuardia(async () => {
      const resultado = await api.post(`/clientes-empresa/${id}/ajustes`, {
        monto: Number(ajuste.monto),
        descripcion: ajuste.descripcion,
      });
      setDetalle((prev) => ({ ...prev, saldo: resultado.saldo, movimientos: resultado.movimientos }));
      setAjuste({ monto: '', descripcion: '' });
      setMostrarAjuste(false);
      setExito('Ajuste registrado.');
    }, 'No se pudo registrar el ajuste.');
  }

  function eliminarCliente() {
    return conGuardia(async () => {
      try {
        await api.delete(`/clientes-empresa/${id}`);
        navigate('/clientes-empresa', { replace: true });
      } catch (err) {
        setConfirmandoEliminar(false);
        throw err;
      }
    }, 'No se pudo eliminar el cliente.');
  }

  if (cargando) {
    return (
      <div className="cliente-page">
        <div className="cliente-vacio">Cargando…</div>
      </div>
    );
  }

  if (!detalle) {
    return (
      <div className="cliente-page">
        <Link to="/clientes-empresa" className="cliente-volver">
          ← Volver a clientes
        </Link>
        {error && <div className="alert alert-danger">{error}</div>}
      </div>
    );
  }

  const estado = estadoSaldo(detalle.saldo ?? 0);

  return (
    <div className="cliente-page">
      <div className="cliente-encabezado">
        <Link to="/clientes-empresa" className="cliente-volver">
          ← Volver a clientes
        </Link>
        <div className="cliente-titulo-fila">
          <h1 className="cliente-h1">{detalle.razon_social}</h1>
          <span className={`cliente-badge cliente-badge-${estado.clave}`}>{estado.texto}</span>
        </div>
        <div className="cliente-subtitulo">
          {[detalle.cuit && `CUIT ${detalle.cuit}`, detalle.condicion_pago].filter(Boolean).join(' · ') || 'Sin CUIT ni condición de pago cargados'}
        </div>
      </div>

      <div className="cliente-tabs" role="tablist">
        {TABS.map((t) => (
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

      <div className="cliente-scroll">
      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      {tab === 'resumen' && (
        <>
          <div className="cliente-kpis">
            <div className="card cliente-kpi">
              <span className="cliente-kpi-label">Saldo actual</span>
              <span className={`cliente-kpi-value cliente-saldo-${estado.clave}`}>{formatearMonto(detalle.saldo)}</span>
            </div>
            <div className="card cliente-kpi">
              <span className="cliente-kpi-label">Total comprado</span>
              <span className="cliente-kpi-value">{formatearMonto(resumen.totalComprado)}</span>
            </div>
            <div className="card cliente-kpi">
              <span className="cliente-kpi-label">Total pagado</span>
              <span className="cliente-kpi-value">{formatearMonto(resumen.totalPagado)}</span>
            </div>
            <div className="card cliente-kpi">
              <span className="cliente-kpi-label">Última compra</span>
              <span className="cliente-kpi-value cliente-kpi-texto">
                {resumen.ultimaCompra ? formatearFechaHora(resumen.ultimaCompra) : '—'}
              </span>
            </div>
          </div>

          <div className="card cliente-card">
            <span className="cliente-seccion-titulo">Datos del cliente</span>
            <dl className="cliente-datos">
              <div>
                <dt>Razón social</dt>
                <dd>{detalle.razon_social}</dd>
              </div>
              <div>
                <dt>CUIT</dt>
                <dd>{detalle.cuit || '—'}</dd>
              </div>
              <div>
                <dt>Condición de pago</dt>
                <dd>{detalle.condicion_pago || '—'}</dd>
              </div>
              <div>
                <dt>Persona de contacto</dt>
                <dd>{detalle.contacto_nombre || '—'}</dd>
              </div>
              <div>
                <dt>Teléfono</dt>
                <dd>{detalle.telefono || '—'}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{detalle.email || '—'}</dd>
              </div>
              <div className="cliente-dato-full">
                <dt>Dirección</dt>
                <dd>{detalle.direccion || '—'}</dd>
              </div>
            </dl>
          </div>

          <div className="card cliente-card">
            <span className="cliente-seccion-titulo">Últimos movimientos</span>
            <TablaMovimientos movimientos={detalle.movimientos.slice(0, 5)} vacio="Sin movimientos todavía." />
          </div>
        </>
      )}

      {tab === 'datos' && (
        <form className="card cliente-card" onSubmit={guardarCliente}>
          <span className="cliente-seccion-titulo">Editar datos del cliente</span>
          <CamposCliente form={edicion} setForm={setEdicion} condiciones={condiciones} nombreCondicionActual={detalle.condicion_pago} />
          <div className="cliente-acciones">
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              Guardar cambios
            </button>
          </div>

          {esAdmin && (
            <div className="cliente-eliminar">
              {!confirmandoEliminar ? (
                <button type="button" className="cliente-eliminar-link" onClick={() => setConfirmandoEliminar(true)}>
                  Eliminar cliente
                </button>
              ) : (
                <div className="cliente-eliminar-confirm">
                  <span>
                    ¿Eliminar "{detalle.razon_social}"? Su historial de cuenta corriente se conserva, pero ya no se le va a poder vender a cuenta corriente.
                  </span>
                  <div className="cliente-acciones">
                    <button type="button" className="btn" onClick={() => setConfirmandoEliminar(false)}>
                      Cancelar
                    </button>
                    <button type="button" className="btn btn-peligro" disabled={guardando} onClick={eliminarCliente}>
                      Sí, eliminar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </form>
      )}

      {tab === 'compras' && (
        <div className="card cliente-card">
          <span className="cliente-seccion-titulo">Historial de compras a cuenta corriente ({resumen.compras.length})</span>
          <TablaMovimientos movimientos={resumen.compras} vacio="Este cliente todavía no compró a cuenta corriente." />
        </div>
      )}

      {tab === 'pagos' && (
        <>
          <form className="card cliente-card" onSubmit={registrarPago}>
            <span className="cliente-seccion-titulo">Registrar pago</span>
            <div className="cliente-campos">
              <div className="field">
                <label>Monto recibido</label>
                <input required type="number" min="1" step="1" placeholder="0" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} />
              </div>
              <div className="field">
                <label>Detalle (opcional)</label>
                <input placeholder="Ej: Transferencia" value={pago.descripcion} onChange={(e) => setPago({ ...pago, descripcion: e.target.value })} />
              </div>
            </div>
            <div className="cliente-acciones">
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                Registrar pago
              </button>
            </div>
          </form>
          <div className="card cliente-card">
            <span className="cliente-seccion-titulo">Historial de pagos ({resumen.pagos.length})</span>
            <TablaMovimientos movimientos={resumen.pagos} vacio="Todavía no se registraron pagos." />
          </div>
        </>
      )}

      {tab === 'acceso' && <ClienteAccesoPortal clienteId={id} razonSocial={detalle.razon_social} email={detalle.email} />}

      {tab === 'cuenta' && <ResumenCuentaDescarga ruta={`/clientes-empresa/${id}/resumen`} />}

      {tab === 'cuenta' && (
        <div className="card cliente-card">
          <div className="cliente-seccion-cabecera">
            <span className="cliente-seccion-titulo">Todos los movimientos ({detalle.movimientos.length})</span>
            <button type="button" className="cliente-link" onClick={() => setMostrarAjuste((v) => !v)}>
              {mostrarAjuste ? 'Cancelar ajuste' : 'Cargar ajuste manual'}
            </button>
          </div>

          {mostrarAjuste && (
            <form className="cliente-ajuste" onSubmit={registrarAjuste}>
              <div className="cliente-hint">
                Solo para corregir un error de carga. Un monto positivo suma deuda; uno negativo la reduce. Los movimientos existentes nunca se editan ni se borran.
              </div>
              <div className="cliente-campos">
                <div className="field">
                  <label>Monto (con signo)</label>
                  <input required type="number" step="1" placeholder="-500" value={ajuste.monto} onChange={(e) => setAjuste({ ...ajuste, monto: e.target.value })} />
                </div>
                <div className="field">
                  <label>Motivo</label>
                  <input required value={ajuste.descripcion} onChange={(e) => setAjuste({ ...ajuste, descripcion: e.target.value })} />
                </div>
              </div>
              <div className="cliente-acciones">
                <button type="submit" className="btn" disabled={guardando}>
                  Registrar ajuste
                </button>
              </div>
            </form>
          )}

          <TablaMovimientos movimientos={detalle.movimientos} vacio="Sin movimientos todavía." />
        </div>
      )}
      </div>
    </div>
  );
}
