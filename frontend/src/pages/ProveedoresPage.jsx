import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import ConAvatar from '../components/ConAvatar.jsx';
import Hero from '../components/Hero.jsx';
import { formatearFecha, formatearMonto } from '../utils/format.js';
import { IconoLapiz, useBarraFija } from './stockComun.jsx';
import './ClientesEmpresaPage.css';
import './ProveedoresPage.css';

// Lista de proveedores a todo el ancho (2026-10-28, pedido del usuario: "queda todo muy
// amontonado"). La fila y el lápiz llevan a la ficha (/proveedores/:id): compras, pagos y datos.
// "Ingresar mercadería" registra una compra y suma los productos al stock.
export default function ProveedoresPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [proveedores, setProveedores] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const barraRef = useBarraFija();
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
    <div className="cliente-page proveedores-lista lista-entera">
      <Hero
        etiqueta="Saldo a pagar"
        valor={formatearMonto(kpis.deuda)}
        sub="Lo que se les debe. El detalle por boleta está en Saldos pendientes."
        minis={[
          { etiqueta: 'Proveedores activos', valor: kpis.activos, icono: 'camion', tono: 'blanco' },
          { etiqueta: 'Compras del mes', valor: formatearMonto(kpis.compradoMes), icono: 'carrito', tono: 'azul' },
        ]}
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <div className="card cliente-card">
        <div className="cliente-toolbar proveedores-toolbar" ref={barraRef}>
          <input
            className="cliente-buscar"
            type="text"
            placeholder="Buscar proveedor por nombre, teléfono o email…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <button type="button" className="btn" onClick={() => navigate('/proveedores/nuevo')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Agregar proveedor
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/proveedores/cargar')}>
            Ingresar mercadería
          </button>
        </div>

        {cargando ? (
          <div className="cliente-vacio">Cargando…</div>
        ) : filtrados.length === 0 ? (
          <div className="cliente-vacio">{proveedores.length === 0 ? 'Todavía no hay proveedores registrados.' : 'Sin resultados para esa búsqueda.'}</div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th className="prov-opcional">Contacto</th>
                  <th className="prov-opcional">Última compra</th>
                  <th className="num">Saldo pendiente</th>
                  <th className="accion" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr key={p.id} onClick={() => navigate(`/proveedores/${p.id}`)}>
                    <td className="cliente-td-nombre">
                      <ConAvatar id={p.id} nombre={p.nombre}>
                        {p.nombre}
                        {p.condicion_pago && <div className="cliente-td-sub">{p.condicion_pago}</div>}
                      </ConAvatar>
                    </td>
                    <td className="prov-opcional">
                      <div>{p.telefono || <span className="dato-vacio">—</span>}</div>
                      {p.email && <div className="cliente-td-sub celda-ellipsis">{p.email}</div>}
                    </td>
                    <td className="prov-opcional">{p.ultima_compra ? formatearFecha(p.ultima_compra) : <span className="dato-vacio">—</span>}</td>
                    <td className="num">
                      <span className={`lista-saldo${p.saldo > 0 ? '' : ' lista-saldo-cero'}`}>{formatearMonto(p.saldo)}</span>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
