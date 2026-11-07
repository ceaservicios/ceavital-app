import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import Icono from '../components/Icono.jsx';
import { ConIcono } from '../components/ConAvatar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { COLOR } from '../utils/colores.js';
import { fechaHoyISO, formatearFecha, formatearFechaHora, formatearMonto } from '../utils/format.js';
import './ClientesEmpresaPage.css';
import './Pedidos.css';
import './ProveedoresPage.css';
import './VentasDiariasPage.css';
import './CajaGeneralPage.css';

// Caja general (2026-11-06, maqueta aprobada por el usuario): lo que se retira de la caja en cada
// cierre y todavía no se usó. Entra solo con cada cierre y sale con los pagos y gastos que se hacen
// con esa plata. El detalle de las reglas, en caja-general.service.js.

const TIPOS = {
  cierre: { icono: 'caja', color: COLOR.verde },
  inicial: { icono: 'cofre', color: COLOR.teal },
  ingreso: { icono: 'mas', color: COLOR.teal },
  banco: { icono: 'banco', color: COLOR.azul },
  dueno: { icono: 'usuarios', color: COLOR.rosa },
  pago: { icono: 'camion', color: COLOR.naranja },
  saldo: { icono: 'ticket', color: COLOR.violeta },
  gasto: { icono: 'billetera', color: COLOR.violeta },
};

const FILTROS = [
  { clave: 'todos', texto: 'Todos' },
  { clave: 'entro', texto: 'Entró' },
  { clave: 'salio', texto: 'Salió' },
];

const TIPOS_FILTRO = [
  { valor: '', texto: 'Todos los movimientos' },
  { valor: 'cierre', texto: 'Retiros de cierres' },
  { valor: 'pago', texto: 'Pagos a proveedores' },
  { valor: 'saldo', texto: 'Saldos pendientes' },
  { valor: 'gasto', texto: 'Gastos' },
  { valor: 'banco', texto: 'Depósitos en el banco' },
  { valor: 'dueno', texto: 'Retiros del dueño' },
  { valor: 'ingreso', texto: 'Entró plata' },
  { valor: 'inicial', texto: 'Saldo inicial' },
];

function sumarDias(dia, n) {
  const fecha = new Date(`${dia}T12:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + n);
  return fecha.toISOString().slice(0, 10);
}

// Los mismos rangos que Ventas, más "Todo": desde el primer movimiento.
function rangosRapidos(hoy, primera) {
  return [
    { clave: 'hoy', texto: 'Hoy', desde: hoy, hasta: hoy },
    { clave: 'ayer', texto: 'Ayer', desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) },
    { clave: '7dias', texto: 'Últimos 7 días', desde: sumarDias(hoy, -6), hasta: hoy },
    { clave: 'mes', texto: 'Este mes', desde: `${hoy.slice(0, 8)}01`, hasta: hoy },
    { clave: 'todo', texto: 'Todo', desde: primera, hasta: hoy },
  ];
}

const textoPeriodo = (desde, hasta) => (desde === hasta ? formatearFecha(desde) : `${formatearFecha(desde)} al ${formatearFecha(hasta)}`);

export default function CajaGeneralPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';
  const [datos, setDatos] = useState(null);
  const hoy = fechaHoyISO();
  const [desde, setDesde] = useState(`${hoy.slice(0, 8)}01`);
  const [hasta, setHasta] = useState(hoy);
  const [filtro, setFiltro] = useState('todos');
  const [tipo, setTipo] = useState('');
  const [confirmando, setConfirmando] = useState(null);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(location.state?.exito ?? null);
  const guardaRef = useRef(false);
  // Si se cambia de período rápido, vale solo la última respuesta.
  const pedidoRef = useRef(0);

  const cargar = useCallback(async () => {
    const pedido = ++pedidoRef.current;
    try {
      const data = await api.get(`/caja-general?${new URLSearchParams({ desde, hasta })}`);
      if (pedido === pedidoRef.current) setDatos(data);
    } catch (err) {
      if (pedido === pedidoRef.current) setError(err instanceof ApiError ? err.message : 'No se pudo cargar Caja general.');
    }
  }, [desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

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

  async function anular(id) {
    if (guardaRef.current) return;
    guardaRef.current = true;
    setError(null);
    setExito(null);
    try {
      await api.post(`/caja-general/movimientos/${id}/anular`, {});
      setConfirmando(null);
      setExito('Movimiento anulado.');
      await cargar();
    } catch (err) {
      setConfirmando(null);
      setError(err instanceof ApiError ? err.message : 'No se pudo anular el movimiento.');
    } finally {
      guardaRef.current = false;
    }
  }

  if (!datos) {
    return <div className="cliente-page">{error ? <div className="alert alert-danger">{error}</div> : <div className="cliente-vacio">Cargando…</div>}</div>;
  }

  const rangos = rangosRapidos(hoy, datos.primera ?? hoy);
  const rapido = rangos.find((r) => r.desde === desde && r.hasta === hasta)?.clave;
  // El saldo inicial no es plata que entró: es desde dónde arranca la cuenta.
  const entro = datos.movimientos.filter((m) => m.tipo !== 'inicial').reduce((a, m) => a + m.entra, 0);
  const salio = datos.movimientos.reduce((a, m) => a + m.sale, 0);
  const filas = datos.movimientos.filter((m) => (filtro === 'todos' || (filtro === 'entro' ? m.entra > 0 : m.sale > 0)) && (!tipo || m.tipo === tipo));

  return (
    <div className="cliente-page lista-entera cg-page">
      <Hero
        etiqueta="Caja general"
        valor={formatearMonto(datos.saldo)}
        sub="Lo que se retiró en los cierres de caja y todavía no se usó."
        minis={[
          { etiqueta: 'Entró', valor: formatearMonto(entro), sub: textoPeriodo(desde, hasta), icono: 'mas', tono: 'verde' },
          { etiqueta: 'Salió', valor: formatearMonto(salio), sub: textoPeriodo(desde, hasta), icono: 'billetera', tono: 'amarillo' },
          { etiqueta: 'En la caja del turno', valor: formatearMonto(datos.caja), sub: 'Turno abierto', icono: 'caja', tono: 'azul' },
        ]}
      />

      <div className="card vd-filtros">
        <div className="vd-campo vd-campo-periodo">
          <span>Período</span>
          <div className="vd-rapidos" role="group" aria-label="Período">
            {rangos.map((r) => (
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
        </div>
        <label className="vd-campo">
          <span>Desde</span>
          <input type="date" value={desde} max={hoy} onChange={(e) => cambiarDesde(e.target.value)} />
        </label>
        <label className="vd-campo">
          <span>Hasta</span>
          <input type="date" value={hasta} max={hoy} onChange={(e) => cambiarHasta(e.target.value)} />
        </label>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <div className="card cliente-card">
        <div className="cg-barra">
          <div className="cg-filtros-lista">
            <div className="chips" role="group" aria-label="Filtrar movimientos">
              {FILTROS.map((f) => (
                <button key={f.clave} type="button" className={`chip${filtro === f.clave ? ' chip-activo' : ''}`} aria-pressed={filtro === f.clave} onClick={() => setFiltro(f.clave)}>
                  {f.texto}
                </button>
              ))}
            </div>
            <label className="vd-campo cg-tipo">
              <select aria-label="Tipo de movimiento" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {TIPOS_FILTRO.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.texto}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/caja-general/nuevo')}>
            <Icono nombre="mas" tam={16} />
            Anotar movimiento
          </button>
        </div>

        <p className="cg-nota">Entra solo con cada cierre de caja. Sale cuando un gasto o un pago se hace con Caja general.</p>

        {filas.length === 0 ? (
          <div className="cliente-vacio">
            {datos.primera ? 'No hay movimientos para estos filtros.' : 'Todavía no hay movimientos. Para arrancar, anotá el Saldo inicial: lo que hay hoy en Caja general.'}
          </div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla cg-tabla">
              <thead>
                <tr>
                  <th className="tabla-oculto-celu">Fecha</th>
                  <th>Movimiento</th>
                  <th className="num">Monto</th>
                  <th className="num tabla-oculto-celu">Queda</th>
                  {esAdmin && <th className="accion" aria-label="Acciones" />}
                </tr>
              </thead>
              <tbody>
                {filas.map((m) => {
                  const estilo = TIPOS[m.tipo] ?? TIPOS.gasto;
                  const sub = [m.detalle, m.manual ? `Anotó ${m.usuario_nombre}` : null].filter(Boolean).join(' · ');
                  return (
                    <Fragment key={m.clave}>
                      <tr className={`sin-click${confirmando === m.clave ? ' pedido-fila-abierta' : ''}`}>
                        <td className="tabla-oculto-celu">{formatearFecha(m.fecha)}</td>
                        <td>
                          <ConIcono icono={estilo.icono} color={estilo.color}>
                            <div className="cliente-td-nombre">{m.concepto}</div>
                            {sub && <div className="cliente-td-sub">{sub}</div>}
                            <div className="cliente-td-sub tabla-solo-celu">
                              {formatearFecha(m.fecha)} · queda {formatearMonto(m.saldo)}
                            </div>
                          </ConIcono>
                        </td>
                        <td className={`num cg-monto ${m.entra > 0 ? 'cg-entra' : 'cg-sale'}`}>
                          {m.entra > 0 ? `+ ${formatearMonto(m.entra)}` : `− ${formatearMonto(m.sale)}`}
                        </td>
                        <td className="num tabla-oculto-celu cg-queda">{formatearMonto(m.saldo)}</td>
                        {esAdmin && (
                          <td className="accion">
                            {m.manual && confirmando !== m.clave && (
                              <button type="button" className="cliente-link" title={`Anotado el ${formatearFechaHora(m.creado_en)}`} onClick={() => setConfirmando(m.clave)}>
                                Anular
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                      {confirmando === m.clave && (
                        <tr className="sin-click pago-fila-confirmar">
                          <td colSpan={esAdmin ? 5 : 4}>
                            <div className="pedido-confirmar">
                              <span>
                                <strong>¿Anular este movimiento de {formatearMonto(m.entra || m.sale)}?</strong> Caja general vuelve a como estaba.
                              </span>
                              <div className="pedido-confirmar-botones">
                                <button type="button" className="btn" onClick={() => setConfirmando(null)}>
                                  Cancelar
                                </button>
                                <button type="button" className="btn btn-peligro" onClick={() => anular(m.id)}>
                                  Anular movimiento
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
    </div>
  );
}
