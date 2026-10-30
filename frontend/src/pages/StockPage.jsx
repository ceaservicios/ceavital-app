import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import { ConIcono } from '../components/ConAvatar.jsx';
import { colorDe } from '../utils/colores.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearMonto } from '../utils/format.js';
import { factorMedida, sufijoPrecio, vendeSuelto } from '../utils/presentacion.js';
import { CeldaStock, IconoLapiz, IconoVer, PUEDE_EDITAR_STOCK, useBarraFija, useCatalogosStock } from './stockComun.jsx';
import './ClientesEmpresaPage.css';
import './StockPage.css';

// Lista de productos a todo el ancho (pedido del usuario, 2026-10-28: "queda todo muy
// amontonado"). El lápiz de cada fila lleva a la ficha del producto (/stock/:id), donde se
// edita y se cargan lotes; el alta va en su propia página (/stock/nuevo).
// Rediseño 2026-10-29: columnas de texto a la izquierda y cifras a la derecha; en celular,
// renglones de dos líneas (StockPage.css).
export default function StockPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { usuario } = useAuth();
  const puedeEditar = PUEDE_EDITAR_STOCK.has(usuario?.rol);
  const { proveedores } = useCatalogosStock(puedeEditar);

  const [productos, setProductos] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtroProveedor, setFiltroProveedor] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [cargando, setCargando] = useState(true);
  const barraRef = useBarraFija();
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

  // Filtros por proveedor y categoría (pedido del usuario, 2026-10-29): las opciones son solo los
  // que tienen productos. El Cajero no tiene los nombres de los proveedores, así que no ve ese filtro.
  const opcionesProveedor = useMemo(
    () =>
      [...new Set(productos.map((p) => p.proveedor_id).filter((id) => mapaProveedores.has(id)))]
        .map((id) => ({ id, nombre: mapaProveedores.get(id) }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [productos, mapaProveedores]
  );
  const opcionesCategoria = useMemo(
    () =>
      [...new Map(productos.filter((p) => p.categoria_id).map((p) => [p.categoria_id, p.categoria]))]
        .map(([id, nombre]) => ({ id, nombre }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [productos]
  );

  const productosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return productos.filter(
      (p) =>
        (!filtroProveedor || String(p.proveedor_id) === filtroProveedor) &&
        (!filtroCategoria || String(p.categoria_id) === filtroCategoria) &&
        (!texto ||
          p.nombre.toLowerCase().includes(texto) ||
          (p.codigo_barras ?? '').toLowerCase().includes(texto) ||
          (p.codigo_barras_pack ?? '').toLowerCase().includes(texto))
    );
  }, [productos, busqueda, filtroProveedor, filtroCategoria]);
  const hayFiltro = Boolean(busqueda.trim() || filtroProveedor || filtroCategoria);

  function limpiarFiltros() {
    setBusqueda('');
    setFiltroProveedor('');
    setFiltroCategoria('');
  }

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

  const falta = <span className="stock-falta">—</span>;

  return (
    <div className="cliente-page stock-lista-page lista-entera">
      <Hero
        etiqueta="Inventario a precio de venta"
        valor={formatearMonto(kpis.valorInventario)}
        sub="Lo que vale la mercadería en stock, a precio de venta."
        minis={[
          { etiqueta: 'Productos activos', valor: kpis.activos, icono: 'paquete', tono: 'blanco' },
          {
            etiqueta: 'Bajo el stock mínimo',
            valor: kpis.bajoMinimo,
            sub: kpis.bajoMinimo > 0 ? 'Para reponer' : 'Todo en orden',
            icono: kpis.bajoMinimo > 0 ? 'alerta' : 'check',
            tono: kpis.bajoMinimo > 0 ? 'rojo' : 'verde',
          },
        ]}
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <div className="card cliente-card stock-lista-card">
        <div className="cliente-toolbar stock-toolbar" ref={barraRef}>
          <input
            className="cliente-buscar"
            type="text"
            placeholder="Buscar por nombre o código…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={alEnter}
          />
          {opcionesProveedor.length > 0 && (
            <select
              className={`stock-filtro${filtroProveedor ? ' stock-filtro-activo' : ''}`}
              value={filtroProveedor}
              onChange={(e) => setFiltroProveedor(e.target.value)}
              aria-label="Filtrar por proveedor"
            >
              <option value="">Todos los proveedores</option>
              {opcionesProveedor.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
          )}
          {opcionesCategoria.length > 0 && (
            <select
              className={`stock-filtro${filtroCategoria ? ' stock-filtro-activo' : ''}`}
              value={filtroCategoria}
              onChange={(e) => setFiltroCategoria(e.target.value)}
              aria-label="Filtrar por categoría"
            >
              <option value="">Todas las categorías</option>
              {opcionesCategoria.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
          )}
          {hayFiltro && (
            <button type="button" className="stock-filtro-limpiar" onClick={limpiarFiltros}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              Limpiar
            </button>
          )}
          {puedeEditar && (
            <button type="button" className="btn btn-primary" onClick={() => navigate('/stock/nuevo')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Agregar producto
            </button>
          )}
          {hayFiltro && !cargando && (
            <div className="stock-filtro-cuenta">
              {productosFiltrados.length} de {productos.length} productos
            </div>
          )}
        </div>

        {cargando ? (
          <div className="cliente-vacio">Cargando…</div>
        ) : productosFiltrados.length === 0 ? (
          <div className="cliente-vacio">
            {productos.length === 0 ? 'Todavía no hay productos registrados.' : 'Ningún producto coincide con la búsqueda y los filtros.'}
          </div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla stock-tabla-productos">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="stock-td-categoria">Categoría</th>
                  <th className="stock-td-proveedor">Proveedor</th>
                  <th className="num">Stock</th>
                  <th className="num">Precio de venta</th>
                  <th className="accion" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {productosFiltrados.map((p) => (
                  <tr key={p.id} onClick={() => navigate(`/stock/${p.id}`)}>
                    <td className="stock-td-producto">
                      <ConIcono icono="paquete" color={colorDe(p.id)}>
                        <div className="cliente-td-nombre">{p.nombre}</div>
                        {p.codigo_barras && <div className="cliente-td-sub">{p.codigo_barras}</div>}
                      </ConIcono>
                    </td>
                    <td className="stock-td-categoria">
                      {p.categoria ? (
                        <span className="tag" style={{ '--c': colorDe(p.categoria_id) }}>
                          {p.categoria}
                        </span>
                      ) : (
                        falta
                      )}
                    </td>
                    <td className="stock-td-proveedor">{p.proveedor_id ? mapaProveedores.get(p.proveedor_id) ?? falta : falta}</td>
                    <td className={`num stock-td-stock${p.alerta_stock_bajo ? ' stock-valor-alerta' : ''}`}>
                      <CeldaStock producto={p} />
                      {p.alerta_stock_bajo && <span className="stock-fila-alerta">Bajo el mínimo</span>}
                    </td>
                    <td className="num stock-td-precio">
                      {vendeSuelto(p) ? (
                        <>
                          {formatearMonto(p.precio_venta)}
                          {sufijoPrecio(p.medida) && <span className="stock-precio-sufijo">{sufijoPrecio(p.medida)}</span>}
                        </>
                      ) : (
                        <>
                          {formatearMonto(p.precio_pack)}
                          <span className="stock-fila-packs">por {p.pack_nombre?.toLowerCase()}</span>
                        </>
                      )}
                    </td>
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
