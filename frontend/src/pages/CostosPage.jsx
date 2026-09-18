import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearMonto } from '../utils/format.js';
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
        const margen = p.precio_venta - p.precio_costo;
        const margenPorc = p.precio_venta > 0 ? (margen / p.precio_venta) * 100 : 0;
        return { ...p, margen, margenPorc };
      })
      .filter((p) => p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()))
      .sort((a, b) => b.margenPorc - a.margenPorc);
  }, [productos, busqueda]);

  const kpis = useMemo(() => {
    const conCosto = productos.filter((p) => typeof p.precio_costo === 'number');
    const costoTotal = conCosto.reduce((acc, p) => acc + p.precio_costo * p.stock_total, 0);
    const gananciaProyectada = conCosto.reduce((acc, p) => acc + (p.precio_venta - p.precio_costo) * p.stock_total, 0);
    const margenPromedio =
      conCosto.length === 0
        ? 0
        : conCosto.reduce((acc, p) => acc + ((p.precio_venta - p.precio_costo) / p.precio_venta) * 100, 0) / conCosto.length;
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
              </span>
              <span style={{ flex: 1, textAlign: 'right' }} className="costos-fila-muted">
                {formatearMonto(p.precio_costo)}
              </span>
              <span style={{ flex: 1, textAlign: 'right' }}>{formatearMonto(p.precio_venta)}</span>
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
