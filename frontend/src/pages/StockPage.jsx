import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearMonto } from '../utils/format.js';
import { factorMedida, sufijoPrecio, vendeSuelto } from '../utils/presentacion.js';
import { CeldaStock, IconoLapiz, IconoVer, PUEDE_EDITAR_STOCK, useCatalogosStock } from './stockComun.jsx';
import './ClientesEmpresaPage.css';
import './StockPage.css';

// Lista de productos a todo el ancho (pedido del usuario, 2026-10-28: "queda todo muy
// amontonado"). El lápiz de cada fila lleva a la ficha del producto (/stock/:id), donde se
// edita y se cargan lotes; el alta va en su propia página (/stock/nuevo).
export default function StockPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { usuario } = useAuth();
  const puedeEditar = PUEDE_EDITAR_STOCK.has(usuario?.rol);
  const { proveedores } = useCatalogosStock(puedeEditar);

  const [productos, setProductos] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const exito = location.state?.exito ?? null;

  useEffect(() => {
    api
      .get('/productos')
      .then((data) => setProductos(data.productos))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar el stock.'))
      .finally(() => setCargando(false));
  }, []);

  const mapaProveedores = useMemo(() => new Map(proveedores.map((p) => [p.id, p.nombre])), [proveedores]);

  const productosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return productos;
    return productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(texto) ||
        (p.codigo_barras ?? '').toLowerCase().includes(texto) ||
        (p.codigo_barras_pack ?? '').toLowerCase().includes(texto)
    );
  }, [productos, busqueda]);

  // El precio es por unidad, kg o litro y el stock en unidades, gramos o ml.
  const kpis = useMemo(
    () => ({
      activos: productos.length,
      bajoMinimo: productos.filter((p) => p.alerta_stock_bajo).length,
      valorInventario: productos.reduce((acc, p) => acc + Math.round((p.precio_venta * p.stock_total) / factorMedida(p.medida)), 0),
    }),
    [productos]
  );

  // Enter con un solo resultado (lector de código de barras) abre ese producto.
  function alEnter(e) {
    if (e.key === 'Enter' && productosFiltrados.length === 1) navigate(`/stock/${productosFiltrados[0].id}`);
  }

  return (
    <div className="cliente-page stock-lista-page">
      <div className="cliente-kpis">
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Productos activos</span>
          <span className="cliente-kpi-value">{kpis.activos}</span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Con stock bajo el mínimo</span>
          <span className="cliente-kpi-value" style={{ color: kpis.bajoMinimo > 0 ? 'var(--color-danger)' : undefined }}>
            {kpis.bajoMinimo}
          </span>
        </div>
        <div className="card cliente-kpi">
          <span className="cliente-kpi-label">Valor de inventario (precio de venta)</span>
          <span className="cliente-kpi-value">{formatearMonto(kpis.valorInventario)}</span>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <div className="card cliente-card">
        <div className="cliente-toolbar">
          <input
            className="cliente-buscar"
            type="text"
            placeholder="Buscar por nombre o código de barras…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={alEnter}
          />
          {puedeEditar && (
            <button type="button" className="btn btn-primary" onClick={() => navigate('/stock/nuevo')}>
              + Nuevo producto
            </button>
          )}
        </div>

        {cargando ? (
          <div className="cliente-vacio">Cargando…</div>
        ) : productosFiltrados.length === 0 ? (
          <div className="cliente-vacio">{productos.length === 0 ? 'Todavía no hay productos cargados.' : 'Sin resultados para esa búsqueda.'}</div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla stock-tabla-productos">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th className="centro">Stock</th>
                  <th className="num">Precio</th>
                  <th>Proveedor</th>
                  <th className="accion" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {productosFiltrados.map((p) => (
                  <tr key={p.id} onClick={() => navigate(`/stock/${p.id}`)}>
                    <td className="cliente-td-nombre">
                      {p.nombre}
                      {p.codigo_barras && <div className="cliente-td-sub">{p.codigo_barras}</div>}
                    </td>
                    <td>{p.categoria || '—'}</td>
                    <td className={`centro stock-td-stock${p.alerta_stock_bajo ? ' stock-valor-alerta' : ''}`}>
                      <CeldaStock producto={p} />
                    </td>
                    <td className="num">
                      {vendeSuelto(p) ? (
                        `${formatearMonto(p.precio_venta)}${sufijoPrecio(p.medida)}`
                      ) : (
                        <>
                          {formatearMonto(p.precio_pack)}
                          <span className="stock-fila-packs">por {p.pack_nombre?.toLowerCase()}</span>
                        </>
                      )}
                    </td>
                    <td>{p.proveedor_id ? mapaProveedores.get(p.proveedor_id) ?? '—' : '—'}</td>
                    <td className="accion">
                      <button
                        type="button"
                        className="boton-icono"
                        title={puedeEditar ? 'Editar' : 'Ver'}
                        aria-label={`${puedeEditar ? 'Editar' : 'Ver'} ${p.nombre}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/stock/${p.id}`);
                        }}
                      >
                        {puedeEditar ? <IconoLapiz /> : <IconoVer />}
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
