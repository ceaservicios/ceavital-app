import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import { ConIcono, IconoFila } from '../components/ConAvatar.jsx';
import Pestanas from '../components/Pestanas.jsx';
import { COLOR } from '../utils/colores.js';
import { useAuth } from '../context/AuthContext.jsx';
import AvisoEmergente from '../components/AvisoEmergente.jsx';
import { iniciales } from '../constants/roles.js';
import { formatearFechaHora, formatearMonto } from '../utils/format.js';
import { estadoSaldo } from './clientesEmpresaComun.jsx';
import PortalComprar from './PortalComprar.jsx';
import PortalPedidos from './PortalPedidos.jsx';
import ResumenCuentaDescarga from './ResumenCuentaDescarga.jsx';
import './ClientesEmpresaPage.css';
import './PortalPage.css';

const TABS = [
  { clave: 'comprar', texto: 'Comprar', icono: 'carrito', color: COLOR.verde },
  { clave: 'pedidos', texto: 'Mis pedidos', icono: 'ticket', color: COLOR.azul },
  { clave: 'cuenta', texto: 'Cuenta corriente', icono: 'billetera', color: COLOR.violeta },
];

const ETIQUETA_TIPO = { CARGO: 'Compra', PAGO: 'Pago', AJUSTE: 'Ajuste' };
const ICONO_TIPO = {
  CARGO: { icono: 'carrito', color: COLOR.azul },
  PAGO: { icono: 'billete', color: COLOR.verde },
  AJUSTE: { icono: 'menos', color: COLOR.gris },
};

// Plan sin el módulo de portal: la API del portal da 404 ("No encontrado"), así que en vez de
// mostrar eso se manda al ingreso, que ya explica "Portal no disponible". Si el plan cambia
// con el portal abierto, AuthContext vuelve a pedir los módulos y se sale solo.
export default function PortalPage() {
  const { cargandoSesion, moduloActivo } = useAuth();
  if (cargandoSesion) return null;
  if (!moduloActivo('portal')) return <Navigate to="/portal/login" replace />;
  return <PortalContenido />;
}

// Lo que ve el cliente-empresa al entrar: puede comprar (armar un pedido que el
// negocio aprueba), seguir sus pedidos y ver el saldo y los movimientos de SU
// cuenta con la descarga de su resumen.
function PortalContenido() {
  const navigate = useNavigate();
  const location = useLocation();
  // Viene del ingreso: este usuario ya estaba abierto en 2 equipos y se cerró el más viejo.
  const [avisoIngreso, setAvisoIngreso] = useState(location.state?.aviso ?? null);
  const [cuenta, setCuenta] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState('comprar');
  const [avisoPedido, setAvisoPedido] = useState(null);
  const [negocio, setNegocio] = useState(null); // nombre y contacto para el pie
  const saliendoRef = useRef(false);

  const volverAlIngreso = useCallback(() => navigate('/portal/login', { replace: true }), [navigate]);

  const cargarCuenta = useCallback(() => {
    return api
      .get('/portal/cuenta')
      .then((data) => {
        setCuenta(data);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return volverAlIngreso();
        setError(err instanceof ApiError ? err.message : 'No se pudo cargar tu cuenta.');
      })
      .finally(() => setCargando(false));
  }, [volverAlIngreso]);

  // Pedidos del cliente, para "Pedidos pendientes" del panel verde. Si fallan, la cifra queda en "—".
  const [pedidos, setPedidos] = useState(null);
  const cargarPedidos = useCallback(() => {
    return api
      .get('/portal/pedidos')
      .then((data) => setPedidos(data.pedidos))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) volverAlIngreso();
      });
  }, [volverAlIngreso]);

  useEffect(() => {
    cargarCuenta();
    cargarPedidos();
  }, [cargarCuenta, cargarPedidos]);

  // Si no se pueden leer, el pie sale sin los datos (no es motivo para cortar el portal).
  useEffect(() => {
    api
      .get('/portal/negocio')
      .then(setNegocio)
      .catch(() => {});
  }, []);

  // Si entró un tercer equipo con este usuario, esta sesión se cerró: al volver a la pestaña se
  // revisa, y si ya no sirve va al ingreso, que muestra el cartel. No se revisa sin que el
  // cliente vuelva: cada consulta cuenta como uso y la sesión nunca vencería por inactividad.
  useEffect(() => {
    const revisar = () => {
      if (document.visibilityState !== 'visible') return;
      api.get('/portal/negocio').catch((err) => {
        if (err instanceof ApiError && err.status === 401) volverAlIngreso();
      });
    };
    document.addEventListener('visibilitychange', revisar);
    return () => document.removeEventListener('visibilitychange', revisar);
  }, [volverAlIngreso]);

  function cerrarAvisoIngreso() {
    setAvisoIngreso(null);
    // Que no vuelva a salir al recargar la página.
    navigate(location.pathname, { replace: true, state: null });
  }

  function cambiarTab(clave) {
    setTab(clave);
    if (clave !== 'pedidos') setAvisoPedido(null);
    // El negocio pudo aprobar o rechazar un pedido mientras tanto: el panel verde se vuelve a pedir.
    cargarCuenta();
    cargarPedidos();
  }

  function pedidoEnviado(pedido) {
    setAvisoPedido(`Pedido #${pedido.id} enviado por ${formatearMonto(pedido.total)}. Queda pendiente de aprobación del negocio.`);
    setTab('pedidos');
    cargarPedidos();
  }

  async function salir() {
    if (saliendoRef.current) return;
    saliendoRef.current = true;
    try {
      await api.post('/portal/logout');
    } catch {
      // Si la sesión ya venció igual se sale: el objetivo es volver al ingreso.
    }
    volverAlIngreso();
  }

  const estado = cuenta ? estadoSaldo(cuenta.saldo) : null;
  const pendientes = pedidos?.filter((p) => p.estado === 'pendiente') ?? [];
  const montoPendiente = pendientes.reduce((acc, p) => acc + p.total, 0);

  // Rediseño 2026-10-29: encabezado verde con la marca del negocio, el cliente y Salir, alineado
  // con el contenido (1080px). Como en las pantallas del sistema con pestañas, el panel verde va
  // arriba de las pestañas y es el mismo en las tres.
  return (
    <div className="portal-page">
      <header className="portal-header">
        <div className="portal-header-inner">
          <div className="portal-marca">
            <img src="/logo-negocio.png" alt={negocio?.nombre ?? 'Logo del negocio'} className="portal-logo-negocio" />
            <span className="portal-marca-separador" aria-hidden="true" />
            <h1 className="portal-marca-texto">Portal de clientes</h1>
          </div>
          <div className="portal-usuario">
            {cuenta && (
              <div className="portal-cliente" title={cuenta.cliente.razon_social}>
                <span className="portal-avatar" aria-hidden="true">
                  {iniciales(cuenta.cliente.razon_social)}
                </span>
                <span className="portal-razon">{cuenta.cliente.razon_social}</span>
              </div>
            )}
            <button type="button" className="btn portal-salir" onClick={salir}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="portal-contenido">
        {cuenta && (
          <Hero
            etiqueta="Saldo de tu cuenta"
            valor={formatearMonto(cuenta.saldo)}
            sub={estado.texto}
            minis={[
              {
                etiqueta: 'Pedidos pendientes',
                valor: pedidos ? pendientes.length : '—',
                sub: pendientes.length > 0 ? `${formatearMonto(montoPendiente)} en revisión` : 'Ninguno en revisión',
                icono: 'reloj',
                tono: 'amarillo',
              },
              { etiqueta: 'Total comprado', valor: formatearMonto(cuenta.total_comprado), icono: 'carrito', tono: 'azul' },
              { etiqueta: 'Total pagado', valor: formatearMonto(cuenta.total_pagado), icono: 'check', tono: 'verde' },
            ]}
          />
        )}

        <Pestanas items={TABS} activa={tab} onCambiar={cambiarTab} etiqueta="Secciones del portal" className="portal-tabs" />

        {tab === 'comprar' && <PortalComprar onSesionVencida={volverAlIngreso} onPedidoEnviado={pedidoEnviado} />}
        {tab === 'pedidos' && <PortalPedidos onSesionVencida={volverAlIngreso} avisoInicial={avisoPedido} onCambio={cargarPedidos} />}

        {tab === 'cuenta' && cargando && <div className="cliente-vacio">Cargando…</div>}
        {tab === 'cuenta' && error && <div className="alert alert-danger">{error}</div>}

        {tab === 'cuenta' && cuenta && (
          <>
            <ResumenCuentaDescarga ruta="/portal/resumen" onSesionVencida={volverAlIngreso} />

            <div className="card cliente-card">
              <div className="cliente-seccion-cabecera">
                <span className="cliente-seccion-titulo">Movimientos</span>
                {cuenta.movimientos.length > 0 && (
                  <span className="portal-contador">
                    {cuenta.movimientos.length} {cuenta.movimientos.length === 1 ? 'movimiento' : 'movimientos'}
                  </span>
                )}
              </div>
              {cuenta.movimientos.length === 0 ? (
                <div className="cliente-vacio">Sin movimientos registrados.</div>
              ) : (
                <div className="cliente-tabla-wrap portal-movs-tabla">
                  <table className="cliente-tabla cliente-tabla-movs">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Detalle</th>
                        <th className="num">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cuenta.movimientos.map((m) => (
                        <tr key={m.id} className="sin-click">
                          <td className="portal-td-fecha">{formatearFechaHora(m.creado_en)}</td>
                          <td>
                            <ConIcono {...ICONO_TIPO[m.tipo]}>
                              <span className="cliente-td-nombre">{ETIQUETA_TIPO[m.tipo]}</span>
                            </ConIcono>
                          </td>
                          <td>{m.descripcion || (m.venta_id ? `Venta #${m.venta_id}` : '—')}</td>
                          <td className="num cliente-mov-monto">
                            {m.monto > 0 ? '+' : ''}
                            {formatearMonto(m.monto)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {cuenta.movimientos.length > 0 && (
                // Celular: en vez de la tabla (el monto quedaba fuera de pantalla), una lista
                // con detalle y monto arriba, y tipo y fecha abajo. El CSS muestra una u otra.
                <ul className="portal-movs">
                  {cuenta.movimientos.map((m) => (
                    <li key={m.id} className="portal-mov">
                      <IconoFila {...ICONO_TIPO[m.tipo]} />
                      <div className="portal-mov-texto">
                        <div className="portal-mov-fila">
                          <span className="portal-mov-detalle">{m.descripcion || (m.venta_id ? `Venta #${m.venta_id}` : '—')}</span>
                          <span className="cliente-mov-monto">
                            {m.monto > 0 ? '+' : ''}
                            {formatearMonto(m.monto)}
                          </span>
                        </div>
                        <div className="portal-mov-meta">
                          <span className={`cliente-tipo cliente-tipo-${m.tipo}`}>{ETIQUETA_TIPO[m.tipo]}</span>
                          <span>{formatearFechaHora(m.creado_en)}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </main>

      <footer className="portal-pie">
        <div className="portal-pie-inner">
          {negocio && (
            <div className="portal-pie-negocio">
              <strong>{negocio.nombre}</strong>
              {negocio.telefono && <span>Tel. {negocio.telefono}</span>}
              {negocio.email && <a href={`mailto:${negocio.email}`}>{negocio.email}</a>}
              {negocio.direccion && <span>{negocio.direccion}</span>}
              {negocio.instagram && (
                <a href={`https://www.instagram.com/${negocio.instagram}/`} target="_blank" rel="noopener noreferrer">
                  Instagram @{negocio.instagram}
                </a>
              )}
            </div>
          )}
          <div className="portal-pie-cea">Con CEAVital, un producto de CEA Servicios</div>
        </div>
      </footer>

      {avisoIngreso && (
        <AvisoEmergente titulo="Se cerró otra sesión" onCerrar={cerrarAvisoIngreso}>
          {avisoIngreso}
        </AvisoEmergente>
      )}
    </div>
  );
}
