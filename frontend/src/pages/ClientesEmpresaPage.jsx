import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { formatearMonto } from '../utils/format.js';
import { estadoSaldo } from './clientesEmpresaComun.jsx';
import './ClientesEmpresaPage.css';

// Listado de Clientes-Empresa. Alta y ficha viven en páginas propias
// (ClienteEmpresaNuevoPage / ClienteEmpresaDetallePage): antes eran un panel
// lateral de 360px que quedaba apretado y desprolijo (pedido del usuario
// 2026-09-18: "una página en limpio donde se carguen y visualicen todos los
// campos").
export default function ClientesEmpresaPage() {
  const navigate = useNavigate();
  const [clientes, setClientes] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/clientes-empresa')
      .then((data) => setClientes(data.clientes))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los clientes.'))
      .finally(() => setCargando(false));
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

  return (
    <div className="cliente-page">
      <div className="cliente-kpis">
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Clientes activos</span>
          <span className="cliente-kpi-value">{kpis.activos}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Con saldo pendiente</span>
          <span className="cliente-kpi-value">{kpis.conSaldo}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Total a cobrar</span>
          <span className="cliente-kpi-value">{formatearMonto(kpis.totalACobrar)}</span>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card cliente-card">
        <div className="cliente-toolbar">
          <input
            className="cliente-buscar"
            type="text"
            placeholder="Buscar por razón social, CUIT o contacto…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <button type="button" className="btn btn-primary" onClick={() => navigate('/clientes-empresa/nuevo')}>
            + Nuevo Cliente
          </button>
        </div>

        {cargando ? (
          <div className="cliente-vacio">Cargando…</div>
        ) : clientesFiltrados.length === 0 ? (
          <div className="cliente-vacio">
            {clientes.length === 0 ? 'Todavía no hay clientes-empresa cargados.' : 'Sin resultados.'}
          </div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla">
              <thead>
                <tr>
                  <th>Razón social</th>
                  <th>CUIT</th>
                  <th>Contacto</th>
                  <th>Condición de pago</th>
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {clientesFiltrados.map((c) => {
                  const est = estadoSaldo(c.saldo);
                  return (
                    <tr key={c.id} onClick={() => navigate(`/clientes-empresa/${c.id}`)}>
                      <td className="cliente-td-nombre">{c.razon_social}</td>
                      <td>{c.cuit || '—'}</td>
                      <td>
                        <div>{c.contacto_nombre || '—'}</div>
                        {c.telefono && <div className="cliente-td-sub">{c.telefono}</div>}
                      </td>
                      <td>{c.condicion_pago || '—'}</td>
                      <td className="num">
                        <span className={`cliente-saldo cliente-saldo-${est.clave}`}>{formatearMonto(c.saldo)}</span>
                        <div className="cliente-td-sub">{est.texto}</div>
                      </td>
                    </tr>
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
