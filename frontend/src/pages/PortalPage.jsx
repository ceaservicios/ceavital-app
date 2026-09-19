import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { formatearFechaHora, formatearMonto } from '../utils/format.js';
import { estadoSaldo } from './clientesEmpresaComun.jsx';
import PortalComprar from './PortalComprar.jsx';
import PortalPedidos from './PortalPedidos.jsx';
import ResumenCuentaDescarga from './ResumenCuentaDescarga.jsx';
import './ClientesEmpresaPage.css';
import './PortalPage.css';

const TABS = [
  { clave: 'comprar', texto: 'Comprar' },
  { clave: 'pedidos', texto: 'Mis pedidos' },
  { clave: 'cuenta', texto: 'Cuenta corriente' },
];

const ETIQUETA_TIPO = { CARGO: 'Compra', PAGO: 'Pago', AJUSTE: 'Ajuste' };

// Lo que ve el cliente-empresa al entrar: puede comprar (armar un pedido que el
// negocio aprueba), seguir sus pedidos y ver el saldo y los movimientos de SU
// cuenta con la descarga de su resumen.
export default function PortalPage() {
  const navigate = useNavigate();
  const [cuenta, setCuenta] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState('comprar');
  const [avisoPedido, setAvisoPedido] = useState(null);
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

  useEffect(() => {
    cargarCuenta();
  }, [cargarCuenta]);

  function cambiarTab(clave) {
    setTab(clave);
    if (clave !== 'pedidos') setAvisoPedido(null);
    // Un pedido aprobado cambia el saldo: se vuelve a pedir la cuenta al abrir esa pestaña.
    if (clave === 'cuenta') cargarCuenta();
  }

  function pedidoEnviado(pedido) {
    setAvisoPedido(`Enviaste el pedido #${pedido.id} por ${formatearMonto(pedido.total)}. El negocio lo va a revisar.`);
    setTab('pedidos');
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

  return (
    <div className="portal-page">
      <header className="portal-header">
        <div className="portal-marca">
          <img src="/logo-icon.png" alt="" className="portal-logo" />
          <span className="portal-marca-titulo">CEAVital</span>
        </div>
        <div className="portal-usuario">
          {cuenta && <span className="portal-razon" title={cuenta.cliente.razon_social}>{cuenta.cliente.razon_social}</span>}
          <button type="button" className="btn" onClick={salir}>
            Salir
          </button>
        </div>
      </header>

      <main className="portal-contenido">
        <div className="cliente-tabs portal-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.clave}
              type="button"
              role="tab"
              aria-selected={tab === t.clave}
              className={`cliente-tab${tab === t.clave ? ' cliente-tab-activa' : ''}`}
              onClick={() => cambiarTab(t.clave)}
            >
              {t.texto}
            </button>
          ))}
        </div>

        {tab === 'comprar' && <PortalComprar onSesionVencida={volverAlIngreso} onPedidoEnviado={pedidoEnviado} />}
        {tab === 'pedidos' && <PortalPedidos onSesionVencida={volverAlIngreso} avisoInicial={avisoPedido} />}

        {tab === 'cuenta' && cargando && <div className="cliente-vacio">Cargando…</div>}
        {tab === 'cuenta' && error && <div className="alert alert-danger">{error}</div>}

        {tab === 'cuenta' && cuenta && (
          <>
            <div className="portal-titulo">
              <h1 className="cliente-h1">Tu cuenta corriente</h1>
              <span className={`cliente-badge cliente-badge-${estado.clave}`}>{estado.texto}</span>
            </div>

            <div className="cliente-kpis">
              <div className="card cliente-kpi">
                <span className="cliente-kpi-label">Saldo actual</span>
                <span className={`cliente-kpi-value cliente-saldo-${estado.clave}`}>{formatearMonto(cuenta.saldo)}</span>
              </div>
              <div className="card cliente-kpi">
                <span className="cliente-kpi-label">Total comprado</span>
                <span className="cliente-kpi-value">{formatearMonto(cuenta.total_comprado)}</span>
              </div>
              <div className="card cliente-kpi">
                <span className="cliente-kpi-label">Total pagado</span>
                <span className="cliente-kpi-value">{formatearMonto(cuenta.total_pagado)}</span>
              </div>
            </div>

            <ResumenCuentaDescarga ruta="/portal/resumen" />

            <div className="card cliente-card">
              <span className="cliente-seccion-titulo">Movimientos ({cuenta.movimientos.length})</span>
              {cuenta.movimientos.length === 0 ? (
                <div className="cliente-vacio">Todavía no hay movimientos en tu cuenta.</div>
              ) : (
                <div className="cliente-tabla-wrap">
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
                          <td>{formatearFechaHora(m.creado_en)}</td>
                          <td>
                            <span className={`cliente-tipo cliente-tipo-${m.tipo}`}>{ETIQUETA_TIPO[m.tipo]}</span>
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
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
