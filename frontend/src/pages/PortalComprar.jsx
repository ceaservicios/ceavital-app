import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearMonto } from '../utils/format.js';
import './ClientesEmpresaPage.css';
import './Pedidos.css';

// Catálogo del portal: el cliente ve los productos con su precio y lo que hay
// disponible (ya descontado lo que otros pedidos pendientes tienen reservado),
// arma su pedido y lo envía. El negocio lo aprueba o lo rechaza.
export default function PortalComprar({ onSesionVencida, onPedidoEnviado }) {
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [cantidades, setCantidades] = useState({}); // producto_id -> cantidad
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  const cargar = useCallback(async () => {
    try {
      const data = await api.get('/portal/catalogo');
      setProductos(data.productos);
      // Si el stock bajó mientras el cliente armaba el pedido, se ajusta la cantidad.
      setCantidades((prev) => {
        const nuevo = {};
        for (const p of data.productos) {
          const q = Math.min(prev[p.id] ?? 0, p.stock_disponible);
          if (q > 0) nuevo[p.id] = q;
        }
        return nuevo;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSesionVencida();
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar el catálogo.');
    } finally {
      setCargando(false);
    }
  }, [onSesionVencida]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return productos;
    return productos.filter((p) => [p.nombre, p.categoria].some((v) => v && v.toLowerCase().includes(texto)));
  }, [productos, busqueda]);

  const lineas = productos.filter((p) => cantidades[p.id] > 0);
  const total = lineas.reduce((acc, p) => acc + cantidades[p.id] * p.precio_venta, 0);
  const unidades = lineas.reduce((acc, p) => acc + cantidades[p.id], 0);

  function fijar(producto, valor) {
    const n = Math.floor(Number(valor));
    const q = Number.isFinite(n) ? Math.max(0, Math.min(n, producto.stock_disponible)) : 0;
    setCantidades((prev) => {
      const nuevo = { ...prev };
      if (q > 0) nuevo[producto.id] = q;
      else delete nuevo[producto.id];
      return nuevo;
    });
  }

  async function enviar() {
    if (enviandoRef.current || lineas.length === 0) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    try {
      const pedido = await api.post('/portal/pedidos', {
        items: lineas.map((p) => ({ producto_id: p.id, cantidad: cantidades[p.id] })),
        observaciones: observaciones.trim() || undefined,
      });
      setCantidades({});
      setObservaciones('');
      onPedidoEnviado(pedido);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSesionVencida();
      setError(err instanceof ApiError ? err.message : 'No se pudo enviar el pedido.');
      // Casi siempre es stock que cambió: se recarga para mostrar lo que hay hoy.
      await cargar();
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <div className="pedido-comprar">
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card cliente-card">
        <input
          className="cliente-buscar"
          type="text"
          placeholder="Buscar producto o categoría…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />

        {cargando ? (
          <div className="cliente-vacio">Cargando…</div>
        ) : visibles.length === 0 ? (
          <div className="cliente-vacio">
            {productos.length === 0 ? 'Todavía no hay productos para pedir.' : 'Sin resultados.'}
          </div>
        ) : (
          <ul className="pedido-catalogo">
            {visibles.map((p) => {
              const sinStock = p.stock_disponible <= 0;
              const q = cantidades[p.id] ?? 0;
              return (
                <li className="pedido-prod" key={p.id}>
                  <div className="pedido-prod-info">
                    <span className="pedido-prod-nombre">{p.nombre}</span>
                    {(p.categoria || p.unidad_medida) && (
                      <span className="pedido-prod-meta">{[p.categoria, p.unidad_medida].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                  <span className="pedido-prod-precio">{formatearMonto(p.precio_venta)}</span>
                  <span className="pedido-prod-stock">
                    {sinStock ? <span className="pedido-sin-stock">Sin stock</span> : `${p.stock_disponible} disponibles`}
                  </span>
                  <div className="pedido-stepper">
                    <button type="button" aria-label={`Quitar uno de ${p.nombre}`} disabled={sinStock || q === 0} onClick={() => fijar(p, q - 1)}>
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={p.stock_disponible}
                      aria-label={`Cantidad de ${p.nombre}`}
                      disabled={sinStock}
                      value={q === 0 ? '' : q}
                      placeholder="0"
                      onChange={(e) => fijar(p, e.target.value)}
                    />
                    <button type="button" aria-label={`Agregar uno de ${p.nombre}`} disabled={sinStock || q >= p.stock_disponible} onClick={() => fijar(p, q + 1)}>
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="pedido-resumen">
        <div className="pedido-resumen-total">
          <span>
            {lineas.length === 0
              ? 'Tu pedido está vacío'
              : `${lineas.length} ${lineas.length === 1 ? 'producto' : 'productos'} · ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`}
          </span>
          <span>{formatearMonto(total)}</span>
        </div>
        <input
          type="text"
          maxLength={500}
          placeholder="Nota para el negocio (opcional)…"
          aria-label="Nota para el negocio"
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
        />
        <button type="button" className="btn btn-primary" disabled={enviando || lineas.length === 0} onClick={enviar}>
          {enviando ? 'Enviando…' : 'Enviar pedido'}
        </button>
      </div>
    </div>
  );
}
