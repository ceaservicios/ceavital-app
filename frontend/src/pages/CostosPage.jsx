import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import { ConIcono } from '../components/ConAvatar.jsx';
import { colorDe } from '../utils/colores.js';
import { formatearMonto } from '../utils/format.js';
import { etiquetaPack, factorMedida, sufijoPrecio, tienePack, vendeSuelto } from '../utils/presentacion.js';
import './ClientesEmpresaPage.css';
import './CostosPage.css';

// Costo y venta de referencia de un producto (2026-10-11): suelto, por unidad/kg/litro; si se
// vende solo por caja, los de la caja (así se compra y se vende). `base`: cuánto stock es eso.
function valores(p) {
  if (!vendeSuelto(p) && tienePack(p) && p.costo_pack != null) {
    return { costo: p.costo_pack, venta: p.precio_pack, base: p.pack_unidades, etiqueta: `por ${p.pack_nombre.toLowerCase()}` };
  }
  return { costo: p.precio_costo, venta: p.precio_venta, base: factorMedida(p.medida), etiqueta: sufijoPrecio(p.medida) };
}

const porcentaje = (n) => `${n.toFixed(1).replace('.', ',')} %`;

// Rediseño 2026-10-29: tabla real con las cifras alineadas a la derecha; el margen % es un número
// y solo el margen bajo (menos de 10 %) lleva una píldora de aviso (Dorado).
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
    return <div className="cliente-vacio">Cargando…</div>;
  }

  const unidad = (etiqueta) => etiqueta && <span className="costos-unidad">{etiqueta.startsWith('/') ? etiqueta : ` ${etiqueta}`}</span>;

  return (
    <div className="cliente-page costos-page">
      <Hero
        etiqueta="Ganancia proyectada del stock"
        valor={formatearMonto(kpis.gananciaProyectada)}
        sub="Lo que se ganaría vendiendo todo el stock a los precios de hoy."
        minis={[
          { etiqueta: 'Margen promedio', valor: porcentaje(kpis.margenPromedio), icono: 'tendencia', tono: 'verde' },
          { etiqueta: 'Costo del inventario', valor: formatearMonto(kpis.costoTotal), icono: 'billetera', tono: 'azul' },
        ]}
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card cliente-card costos-card">
        <div className="cliente-toolbar">
          <input
            type="text"
            className="cliente-buscar costos-buscar"
            placeholder="Buscar producto…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        {filas.length === 0 ? (
          <div className="cliente-vacio">
            {busqueda.trim() ? 'Ningún producto coincide con la búsqueda.' : 'Todavía no hay productos con costo registrado.'}
          </div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla costos-tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Costo</th>
                  <th className="num">Precio de venta</th>
                  <th className="num">Margen</th>
                  <th className="num">Margen %</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((p) => (
                  <tr key={p.id} className="sin-click">
                    <td className="costos-td-producto">
                      <ConIcono icono="paquete" color={colorDe(p.id)}>
                        <div className="cliente-td-nombre">{p.nombre}</div>
                        {/* Venta por pack (2026-10-11): el costo es por unidad, el del pack es costo × unidades. */}
                        {tienePack(p) && vendeSuelto(p) && (
                          <div className="cliente-td-sub">
                            {etiquetaPack(p.pack_nombre, p.pack_unidades, p.medida)}: {formatearMonto(p.precio_pack)} · Margen{' '}
                            {formatearMonto(p.precio_pack - Math.round((p.precio_costo * p.pack_unidades) / factorMedida(p.medida)))}
                          </div>
                        )}
                        {!vendeSuelto(p) && tienePack(p) && (
                          <div className="cliente-td-sub">Se vende solo por {etiquetaPack(p.pack_nombre, p.pack_unidades, p.medida).toLowerCase()}</div>
                        )}
                      </ConIcono>
                    </td>
                    <td className="num costos-td-costo" data-label="Costo">
                      {formatearMonto(p.v.costo)}
                      {unidad(p.v.etiqueta)}
                    </td>
                    <td className="num costos-td-venta" data-label="Precio de venta">
                      {formatearMonto(p.v.venta)}
                      {unidad(p.v.etiqueta)}
                    </td>
                    <td className="num costos-td-margen" data-label="Margen">
                      {formatearMonto(p.margen)}
                    </td>
                    <td className="num costos-td-pct">
                      {p.margenPorc < 10 ? (
                        <span className="costos-badge-bajo">{porcentaje(p.margenPorc)} · Margen bajo</span>
                      ) : (
                        porcentaje(p.margenPorc)
                      )}
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
