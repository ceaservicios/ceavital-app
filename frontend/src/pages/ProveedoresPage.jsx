import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { formatearFecha, formatearMonto } from '../utils/format.js';
import { IconoLapiz } from './stockComun.jsx';
import { estadoDeuda } from './proveedoresComun.jsx';
import './ClientesEmpresaPage.css';
import './ProveedoresPage.css';

// Lista de proveedores a todo el ancho (2026-10-28, pedido del usuario: "queda todo muy
// amontonado"). El lápiz lleva al perfil (/proveedores/:id): lo que trajo, lo que se le pagó y
// sus datos. "Cargar mercadería" suma al stock lo que trajo un proveedor.
export default function ProveedoresPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [proveedores, setProveedores] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const exito = location.state?.exito ?? null;

  useEffect(() => {
    api
      .get('/proveedores')
      .then((data) => setProveedores(data.proveedores))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los proveedores.'))
      .finally(() => setCargando(false));
  }, []);

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return proveedores;
    return proveedores.filter((p) => [p.nombre, p.telefono, p.email].some((v) => v && v.toLowerCase().includes(texto)));
  }, [proveedores, busqueda]);

  const kpis = useMemo(
    () => ({
      activos: proveedores.length,
      deuda: proveedores.reduce((acc, p) => acc + Math.max(p.saldo, 0), 0),
      compradoMes: proveedores.reduce((acc, p) => acc + p.comprado_mes, 0),
    }),
    [proveedores]
  );

  return (
    <div className="cliente-page">
      <div className="cliente-kpis">
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Proveedores activos</span>
          <span className="cliente-kpi-value">{kpis.activos}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Le debés en total</span>
          <span className="cliente-kpi-value">{formatearMonto(kpis.deuda)}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Comprado este mes</span>
          <span className="cliente-kpi-value">{formatearMonto(kpis.compradoMes)}</span>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <div className="card cliente-card">
        <div className="cliente-toolbar proveedores-toolbar">
          <input
            className="cliente-buscar"
            type="text"
            placeholder="Buscar proveedor por nombre, teléfono o email…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <button type="button" className="btn" onClick={() => navigate('/proveedores/nuevo')}>
            + Nuevo proveedor
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/proveedores/cargar')}>
            Cargar mercadería
          </button>
        </div>

        {cargando ? (
          <div className="cliente-vacio">Cargando…</div>
        ) : filtrados.length === 0 ? (
          <div className="cliente-vacio">{proveedores.length === 0 ? 'Todavía no hay proveedores cargados.' : 'Sin resultados.'}</div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th className="prov-opcional">Contacto</th>
                  <th className="prov-opcional">Última compra</th>
                  <th className="num">Le debés</th>
                  <th className="accion" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => {
                  const deuda = estadoDeuda(p.saldo);
                  return (
                    <tr key={p.id} onClick={() => navigate(`/proveedores/${p.id}`)}>
                      <td className="cliente-td-nombre">
                        {p.nombre}
                        {p.condicion_pago && <div className="cliente-td-sub">{p.condicion_pago}</div>}
                      </td>
                      <td className="prov-opcional">
                        <div>{p.telefono || '—'}</div>
                        {p.email && <div className="cliente-td-sub celda-ellipsis">{p.email}</div>}
                      </td>
                      <td className="prov-opcional">{p.ultima_compra ? formatearFecha(p.ultima_compra) : '—'}</td>
                      <td className="num">
                        <span className={`cliente-saldo cliente-saldo-${deuda.clave}`}>{formatearMonto(p.saldo)}</span>
                        <div className="cliente-td-sub">{deuda.texto}</div>
                      </td>
                      <td className="accion">
                        <button
                          type="button"
                          className="boton-icono"
                          title="Ver y editar"
                          aria-label={`Ver y editar ${p.nombre}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/proveedores/${p.id}`);
                          }}
                        >
                          <IconoLapiz />
                        </button>
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
