import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import ConAvatar from '../components/ConAvatar.jsx';
import { formatearMonto } from '../utils/format.js';
import './ClientesEmpresaPage.css';
import './ProveedoresPage.css';

// Listado de Clientes-Empresa. Alta y ficha viven en páginas propias
// (ClienteEmpresaNuevoPage / ClienteEmpresaDetallePage): antes eran un panel
// lateral de 360px que quedaba apretado y desprolijo (pedido del usuario
// 2026-09-18: "una página en limpio donde se carguen y visualicen todos los
// campos"). Rediseño 2026-10-29: el saldo es una cifra limpia (píldora solo si
// es a favor) y en celular cada cliente va en dos renglones.
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
    <div className="cliente-page clientes-lista">
      <Hero
        etiqueta="Total a cobrar"
        valor={formatearMonto(kpis.totalACobrar)}
        sub="Lo que deben los clientes en cuenta corriente."
        minis={[
          { etiqueta: 'Clientes activos', valor: kpis.activos, icono: 'usuarios', tono: 'blanco' },
          { etiqueta: 'Con saldo pendiente', valor: kpis.conSaldo, icono: 'reloj', tono: 'amarillo' },
        ]}
      />

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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Agregar cliente
          </button>
        </div>

        {cargando ? (
          <div className="cliente-vacio">Cargando…</div>
        ) : clientesFiltrados.length === 0 ? (
          <div className="cliente-vacio">
            {clientes.length === 0 ? 'Todavía no hay clientes registrados.' : 'Sin resultados para esa búsqueda.'}
          </div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla">
              <thead>
                <tr>
                  <th>Razón social</th>
                  <th className="tabla-oculto-celu">Contacto</th>
                  <th className="tabla-oculto-celu">Condición de pago</th>
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {clientesFiltrados.map((c) => (
                  <tr key={c.id} onClick={() => navigate(`/clientes-empresa/${c.id}`)}>
                    <td>
                      <ConAvatar id={c.id} nombre={c.razon_social}>
                        <div className="cliente-td-nombre">{c.razon_social}</div>
                        {c.cuit && <div className="cliente-td-sub">CUIT {c.cuit}</div>}
                      </ConAvatar>
                    </td>
                    <td className="tabla-oculto-celu">
                      <div>{c.contacto_nombre || <span className="dato-vacio">—</span>}</div>
                      {c.telefono && <div className="cliente-td-sub">{c.telefono}</div>}
                    </td>
                    <td className="tabla-oculto-celu">{c.condicion_pago || <span className="dato-vacio">—</span>}</td>
                    <td className="num">
                      {c.saldo < 0 && <span className="cliente-badge cliente-badge-favor lista-saldo-pildora">A favor</span>}
                      <span className={`lista-saldo${c.saldo === 0 ? ' lista-saldo-cero' : ''}${c.saldo < 0 ? ' lista-saldo-favor' : ''}`}>
                        {formatearMonto(c.saldo)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
