import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import { MigaFicha } from '../components/Topbar.jsx';
import { ConIcono } from '../components/ConAvatar.jsx';
import Pestanas from '../components/Pestanas.jsx';
import { COLOR } from '../utils/colores.js';
import { useAuth } from '../context/AuthContext.jsx';
import { diaDeUtc, formatearFecha, formatearFechaHora, formatearMonto } from '../utils/format.js';
import { CamposCliente, aFormulario, aPayload, estadoSaldo, useCondicionesPago } from './clientesEmpresaComun.jsx';
import ClienteAccesoPortal from './ClienteAccesoPortal.jsx';
import ResumenCuentaDescarga from './ResumenCuentaDescarga.jsx';
import './ClientesEmpresaPage.css';
import './ProveedoresPage.css';

const ETIQUETA_TIPO = { CARGO: 'Cargo', PAGO: 'Pago', AJUSTE: 'Ajuste' };
const ICONO_TIPO = {
  CARGO: { icono: 'carrito', color: COLOR.azul },
  PAGO: { icono: 'billete', color: COLOR.verde },
  AJUSTE: { icono: 'menos', color: COLOR.gris },
};
const TABS = [
  { clave: 'resumen', texto: 'Resumen', icono: 'grilla', color: COLOR.verde },
  { clave: 'datos', texto: 'Datos', icono: 'ficha', color: COLOR.azul },
  { clave: 'compras', texto: 'Compras', icono: 'carrito', color: COLOR.naranja },
  { clave: 'pagos', texto: 'Pagos', icono: 'billete', color: COLOR.teal },
  { clave: 'cuenta', texto: 'Cuenta corriente', icono: 'ticket', color: COLOR.violeta },
  { clave: 'acceso', texto: 'Acceso al portal', icono: 'candado', color: COLOR.rosa },
];

// Movimientos de la cuenta corriente. En celular: tipo, detalle (con la fecha debajo) y monto.
function TablaMovimientos({ movimientos, vacio }) {
  if (movimientos.length === 0) return <div className="cliente-vacio">{vacio}</div>;
  return (
    <div className="cliente-tabla-wrap">
      <table className="cliente-tabla cliente-tabla-movs">
        <thead>
          <tr>
            <th className="tabla-oculto-celu">Fecha</th>
            <th>Tipo</th>
            <th>Detalle</th>
            <th className="tabla-oculto-celu">Registrado por</th>
            <th className="num">Monto</th>
          </tr>
        </thead>
        <tbody>
          {movimientos.map((m) => (
            <tr key={m.id} className="sin-click">
              <td className="tabla-oculto-celu">{formatearFechaHora(m.creado_en)}</td>
              <td>
                <ConIcono icono={ICONO_TIPO[m.tipo]?.icono} color={ICONO_TIPO[m.tipo]?.color}>
                  <span className="cliente-td-nombre">{ETIQUETA_TIPO[m.tipo]}</span>
                </ConIcono>
              </td>
              <td>
                {m.descripcion || (m.venta_id ? `Venta #${m.venta_id}` : <span className="dato-vacio">—</span>)}
                <div className="cliente-td-sub tabla-solo-celu">{formatearFechaHora(m.creado_en)}</div>
              </td>
              <td className="tabla-oculto-celu">{m.usuario_nombre}</td>
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
        <MigaFicha />
        {error && <div className="alert alert-danger">{error}</div>}
      </div>
    );
  }

  const estado = estadoSaldo(detalle.saldo ?? 0);
  const subtitulo = [detalle.cuit && `CUIT ${detalle.cuit}`, detalle.condicion_pago && `Condición de pago: ${detalle.condicion_pago}`].filter(Boolean);

  return (
    <div className="cliente-page ficha-cliente">
      {/* El panel va primero y se ve en todas las pestañas, en el mismo lugar que en las demás
          pantallas; el nombre, debajo. La última compra, solo con la fecha (como en el proveedor),
          para que entre en su cuadrito. */}
      <Hero
        etiqueta="Saldo actual"
        valor={formatearMonto(detalle.saldo)}
        sub={estado.texto}
        minis={[
          { etiqueta: 'Total comprado', valor: formatearMonto(resumen.totalComprado), icono: 'carrito', tono: 'azul' },
          { etiqueta: 'Total pagado', valor: formatearMonto(resumen.totalPagado), icono: 'check', tono: 'verde' },
          {
            etiqueta: 'Última compra',
            valor: resumen.ultimaCompra ? formatearFecha(diaDeUtc(resumen.ultimaCompra)) : '—',
            icono: 'calendario',
            tono: 'blanco',
          },
        ]}
      />

      <MigaFicha />
      <div className="ficha-cabecera">
        <div className="ficha-titulo">
          <h1 className="cliente-h1">{detalle.razon_social}</h1>
          <span className={`cliente-badge cliente-badge-${estado.clave}`}>{estado.texto}</span>
        </div>
        <div className="cliente-subtitulo">{subtitulo.join(' · ') || 'Sin CUIT ni condición de pago'}</div>
      </div>

      <Pestanas items={TABS} activa={tab} onCambiar={setTab} etiqueta="Secciones del cliente" />

      <div className="cliente-scroll">
        {error && <div className="alert alert-danger">{error}</div>}
        {exito && <div className="alert alert-exito">{exito}</div>}

        {tab === 'resumen' && (
          <>
            <div className="card cliente-card">
              <span className="cliente-seccion-titulo">Datos del cliente</span>
              <dl className="cliente-datos ficha-datos-cliente">
                <div>
                  <dt>Razón social</dt>
                  <dd>{detalle.razon_social}</dd>
                </div>
                <div>
                  <dt>CUIT</dt>
                  <dd>{detalle.cuit || <span className="dato-vacio">—</span>}</dd>
                </div>
                <div>
                  <dt>Condición de pago</dt>
                  <dd>{detalle.condicion_pago || <span className="dato-vacio">—</span>}</dd>
                </div>
                <div>
                  <dt>Persona de contacto</dt>
                  <dd>{detalle.contacto_nombre || <span className="dato-vacio">—</span>}</dd>
                </div>
                <div>
                  <dt>Teléfono</dt>
                  <dd>{detalle.telefono || <span className="dato-vacio">—</span>}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{detalle.email || <span className="dato-vacio">—</span>}</dd>
                </div>
                <div className="ficha-dato-doble">
                  <dt>Dirección</dt>
                  <dd>{detalle.direccion || <span className="dato-vacio">—</span>}</dd>
                </div>
              </dl>
            </div>

            <div className="card cliente-card">
              <span className="cliente-seccion-titulo">Últimos movimientos</span>
              <TablaMovimientos movimientos={detalle.movimientos.slice(0, 5)} vacio="Sin movimientos registrados." />
            </div>
          </>
        )}

        {tab === 'datos' && (
          <form className="card cliente-card form-angosto" onSubmit={guardarCliente}>
            <span className="cliente-seccion-titulo">Datos del cliente</span>
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
                      <strong>¿Eliminar «{detalle.razon_social}»?</strong> Se conserva el historial de su cuenta corriente, pero no se le
                      podrán registrar nuevas ventas a cuenta corriente.
                    </span>
                    <div className="cliente-acciones">
                      <button type="button" className="btn" onClick={() => setConfirmandoEliminar(false)}>
                        Cancelar
                      </button>
                      <button type="button" className="btn btn-peligro" disabled={guardando} onClick={eliminarCliente}>
                        Eliminar cliente
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
            <span className="cliente-seccion-titulo">Compras a cuenta corriente ({resumen.compras.length})</span>
            <TablaMovimientos movimientos={resumen.compras} vacio="Sin compras a cuenta corriente." />
          </div>
        )}

        {tab === 'pagos' && (
          <>
            <form className="card cliente-card form-angosto" onSubmit={registrarPago}>
              <span className="cliente-seccion-titulo">Registrar pago</span>
              <div className="cliente-campos">
                <div className="field">
                  <label>Monto recibido</label>
                  <input required type="number" min="1" step="1" placeholder="0" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} />
                </div>
                <div className="field">
                  <label>Detalle (opcional)</label>
                  <input placeholder="Ej.: transferencia bancaria" value={pago.descripcion} onChange={(e) => setPago({ ...pago, descripcion: e.target.value })} />
                </div>
              </div>
              <div className="cliente-acciones">
                <button type="submit" className="btn btn-primary" disabled={guardando}>
                  Registrar pago
                </button>
              </div>
            </form>
            <div className="card cliente-card">
              <span className="cliente-seccion-titulo">Pagos registrados ({resumen.pagos.length})</span>
              <TablaMovimientos movimientos={resumen.pagos} vacio="Todavía no hay pagos registrados." />
            </div>
          </>
        )}

        {tab === 'acceso' && <ClienteAccesoPortal clienteId={id} razonSocial={detalle.razon_social} email={detalle.email} />}

        {tab === 'cuenta' && <ResumenCuentaDescarga ruta={`/clientes-empresa/${id}/resumen`} />}

        {tab === 'cuenta' && (
          <div className="card cliente-card">
            <div className="cliente-seccion-cabecera">
              <span className="cliente-seccion-titulo">Movimientos ({detalle.movimientos.length})</span>
              <button type="button" className="cliente-link" onClick={() => setMostrarAjuste((v) => !v)}>
                {mostrarAjuste ? 'Cancelar ajuste' : 'Registrar ajuste manual'}
              </button>
            </div>

            {mostrarAjuste && (
              <form className="cliente-ajuste" onSubmit={registrarAjuste}>
                <div className="cliente-hint">
                  Solo para corregir errores de carga: un monto positivo aumenta el saldo y uno negativo lo reduce. Los movimientos
                  registrados no se modifican.
                </div>
                <div className="cliente-campos">
                  <div className="field">
                    <label>Monto (con signo)</label>
                    <input required type="number" step="1" placeholder="Ej.: -500" value={ajuste.monto} onChange={(e) => setAjuste({ ...ajuste, monto: e.target.value })} />
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

            <TablaMovimientos movimientos={detalle.movimientos} vacio="Sin movimientos registrados." />
          </div>
        )}
      </div>
    </div>
  );
}
