import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearMonto } from '../utils/format.js';
import { etiquetaPack, factorMedida, sufijoPrecio, tienePack, vendeSuelto } from '../utils/presentacion.js';

// Costo y venta de referencia de un producto (2026-10-11): suelto, por unidad/kg/litro; si se
// vende solo por caja, los de la caja (así se compra y se vende). `base`: cuánto stock es eso.
function valores(p) {
  if (!vendeSuelto(p) && tienePack(p) && p.costo_pack != null) {
    return { costo: p.costo_pack, venta: p.precio_pack, base: p.pack_unidades, etiqueta: `por ${p.pack_nombre.toLowerCase()}` };
  }
  return { costo: p.precio_costo, venta: p.precio_venta, base: factorMedida(p.medida), etiqueta: sufijoPrecio(p.medida) };
}
import './CostosPage.css';

export default function CostosPage() {
  const [productos, setProductos] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/productos')
      .then((data) => setProductos(data.productos))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar la información de costos.'))
      .finally(() => setCargando(false));
  }, []);

  const filas = useMemo(() => {
    return productos
      .filter((p) => typeof p.precio_costo === 'number')
      .map((p) => {
        const v = valores(p);
        const margen = v.venta - v.costo;
        const margenPorc = v.venta > 0 ? (margen / v.venta) * 100 : 0;
        return { ...p, v, margen, margenPorc };
      })
      .filter((p) => p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()))
      .sort((a, b) => b.margenPorc - a.margenPorc);
  }, [productos, busqueda]);

  const kpis = useMemo(() => {
    const conCosto = productos.filter((p) => typeof p.precio_costo === 'number');
    // El stock va en unidades, gramos o ml: se pasa a la base de cada precio.
    const costoTotal = conCosto.reduce((acc, p) => acc + Math.round((valores(p).costo * p.stock_total) / valores(p).base), 0);
    const gananciaProyectada = conCosto.reduce(
      (acc, p) => acc + Math.round(((valores(p).venta - valores(p).costo) * p.stock_total) / valores(p).base),
      0
    );
    const margenPromedio =
      conCosto.length === 0
        ? 0
        : conCosto.reduce((acc, p) => acc + (valores(p).venta > 0 ? ((valores(p).venta - valores(p).costo) / valores(p).venta) * 100 : 0), 0) /
          conCosto.length;
    return { costoTotal, gananciaProyectada, margenPromedio };
  }, [productos]);

  if (cargando) {
    return <div className="card costos-vacio">Cargando…</div>;
  }

  return (
    <div className="costos-page">
      <div className="costos-kpis">
        <div className="card costos-kpi">
          <span className="costos-kpi-label">Margen promedio</span>
          <span className="costos-kpi-value">{kpis.margenPromedio.toFixed(1).replace('.', ',')}%</span>
        </div>
        <div className="card costos-kpi">
          <span className="costos-kpi-label">Costo total de inventario</span>
          <span className="costos-kpi-value">{formatearMonto(kpis.costoTotal)}</span>
        </div>
        <div className="card costos-kpi">
          <span className="costos-kpi-label">Ganancia proyectada</span>
          <span className="costos-kpi-value">{formatearMonto(kpis.gananciaProyectada)}</span>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card costos-tabla-card">
        <input
          type="text"
          className="costos-search"
          placeholder="Buscar producto…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <div className="costos-tabla">
          <div className="costos-tabla-head">
            <span style={{ flex: 2 }}>Producto</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Precio costo</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Precio venta</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Margen</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Margen %</span>
          </div>
          {filas.length === 0 && <div className="costos-vacio">No hay productos para mostrar.</div>}
          {filas.map((p) => (
            <div className="costos-fila" key={p.id}>
              <span style={{ flex: 2 }} className="costos-fila-nombre">
                {p.nombre}
                {/* Venta por pack (2026-10-11): el costo es por unidad, el del pack es costo × unidades. */}
                {tienePack(p) && vendeSuelto(p) && (
                  <span className="costos-fila-pack">
                    {etiquetaPack(p.pack_nombre, p.pack_unidades, p.medida)}: {formatearMonto(p.precio_pack)} · margen{' '}
                    {formatearMonto(p.precio_pack - Math.round((p.precio_costo * p.pack_unidades) / factorMedida(p.medida)))}
                  </span>
                )}
                {!vendeSuelto(p) && tienePack(p) && (
                  <span className="costos-fila-pack">Solo por {etiquetaPack(p.pack_nombre, p.pack_unidades, p.medida)}</span>
                )}
              </span>
              <span style={{ flex: 1, textAlign: 'right' }} className="costos-fila-muted">
                {formatearMonto(p.v.costo)}
                {p.v.etiqueta && <span className="costos-fila-pack">{p.v.etiqueta}</span>}
              </span>
              <span style={{ flex: 1, textAlign: 'right' }}>
                {formatearMonto(p.v.venta)}
                {p.v.etiqueta && <span className="costos-fila-pack">{p.v.etiqueta}</span>}
              </span>
              <span style={{ flex: 1, textAlign: 'right', fontWeight: 700 }}>{formatearMonto(p.margen)}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>
                <span className={`costos-badge ${p.margenPorc >= 25 ? 'costos-badge-alto' : 'costos-badge-bajo'}`}>
                  {p.margenPorc.toFixed(1).replace('.', ',')}%{p.margenPorc < 10 ? ' · Margen bajo' : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
