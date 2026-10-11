import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearMonto } from '../utils/format.js';
import { etiquetaPack, precioLinea, tienePack, tienePrecioCantidad, unidadesDeLinea } from '../utils/presentacion.js';
import './ClientesEmpresaPage.css';
import './Pedidos.css';

// Catálogo del portal: el cliente ve los productos con su precio y lo que hay
// disponible (ya descontado lo que otros pedidos pendientes tienen reservado),
// arma su pedido y lo envía. El negocio lo aprueba o lo rechaza.
// Venta por pack y precio por cantidad (2026-10-11): igual que en Caja, un producto con
// pack se pide por unidad, por pack o las dos cosas; el stock se cuenta en unidades.

const clave = (productoId, presentacion) => `${productoId}:${presentacion}`;

function Stepper({ nombre, valor, maximo, deshabilitado, onFijar }) {
  return (
    <div className="pedido-stepper">
      <button type="button" aria-label={`Quitar uno de ${nombre}`} disabled={deshabilitado || valor === 0} onClick={() => onFijar(valor - 1)}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={maximo}
        aria-label={`Cantidad de ${nombre}`}
        disabled={deshabilitado}
        value={valor === 0 ? '' : valor}
        placeholder="0"
        onChange={(e) => onFijar(e.target.value)}
      />
      <button type="button" aria-label={`Agregar uno de ${nombre}`} disabled={deshabilitado || valor >= maximo} onClick={() => onFijar(valor + 1)}>
        +
      </button>
    </div>
  );
}

export default function PortalComprar({ onSesionVencida, onPedidoEnviado }) {
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [cantidades, setCantidades] = useState({}); // "producto_id:presentacion" -> cantidad
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  const cargar = useCallback(async () => {
    try {
      const data = await api.get('/portal/catalogo');
      setProductos(data.productos);
      // Si el stock bajó (o el producto dejó de tener pack) mientras el cliente armaba el
      // pedido, se ajusta: primero las unidades sueltas, después los packs que entren.
      setCantidades((prev) => {
        const nuevo = {};
        for (const p of data.productos) {
          const unidades = Math.min(prev[clave(p.id, 'unidad')] ?? 0, p.stock_disponible);
          if (unidades > 0) nuevo[clave(p.id, 'unidad')] = unidades;
          if (tienePack(p)) {
            const packs = Math.min(prev[clave(p.id, 'pack')] ?? 0, Math.floor((p.stock_disponible - unidades) / p.pack_unidades));
            if (packs > 0) nuevo[clave(p.id, 'pack')] = packs;
          }
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

  const cantidadDe = (p, presentacion) => cantidades[clave(p.id, presentacion)] ?? 0;

  // Lo que queda para una presentación: el disponible menos las unidades de la otra.
  function maximoDe(p, presentacion) {
    const otra = presentacion === 'pack' ? 'unidad' : 'pack';
    const libres = p.stock_disponible - unidadesDeLinea(p, cantidadDe(p, otra), otra);
    return presentacion === 'pack' ? Math.floor(libres / p.pack_unidades) : libres;
  }

  const lineas = productos.flatMap((p) =>
    ['unidad', 'pack']
      .filter((presentacion) => cantidadDe(p, presentacion) > 0)
      .map((presentacion) => ({ producto: p, presentacion, cantidad: cantidadDe(p, presentacion) }))
  );
  const total = lineas.reduce((acc, l) => acc + precioLinea(l.producto, l.cantidad, l.presentacion).precio * l.cantidad, 0);
  const unidades = lineas.reduce((acc, l) => acc + unidadesDeLinea(l.producto, l.cantidad, l.presentacion), 0);
  const cantidadProductos = new Set(lineas.map((l) => l.producto.id)).size;

  function fijar(producto, presentacion, valor) {
    const n = Math.floor(Number(valor));
    const q = Number.isFinite(n) ? Math.max(0, Math.min(n, maximoDe(producto, presentacion))) : 0;
    setCantidades((prev) => {
      const nuevo = { ...prev };
      if (q > 0) nuevo[clave(producto.id, presentacion)] = q;
      else delete nuevo[clave(producto.id, presentacion)];
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
        items: lineas.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad, presentacion: l.presentacion })),
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
              const stock = sinStock ? <span className="pedido-sin-stock">Sin stock</span> : `${p.stock_disponible} disponibles`;
              const meta = [p.categoria, p.unidad_medida].filter(Boolean).join(' · ');
              const precioCantidad = tienePrecioCantidad(p) && (
                <span className="pedido-prod-promo">
                  Desde {p.precio_cantidad_desde}: {formatearMonto(p.precio_cantidad)} c/u
                </span>
              );
              const precioUnidad = precioLinea(p, cantidadDe(p, 'unidad'), 'unidad').precio;

              if (!tienePack(p)) {
                return (
                  <li className="pedido-prod" key={p.id}>
                    <div className="pedido-prod-info">
                      <span className="pedido-prod-nombre">{p.nombre}</span>
                      {meta && <span className="pedido-prod-meta">{meta}</span>}
                      {precioCantidad}
                    </div>
                    <span className="pedido-prod-precio">{formatearMonto(precioUnidad)}</span>
                    <span className="pedido-prod-stock">{stock}</span>
                    <Stepper
                      nombre={p.nombre}
                      valor={cantidadDe(p, 'unidad')}
                      maximo={maximoDe(p, 'unidad')}
                      deshabilitado={sinStock}
                      onFijar={(v) => fijar(p, 'unidad', v)}
                    />
                  </li>
                );
              }

              return (
                <li className="pedido-prod pedido-prod-pack" key={p.id}>
                  <div className="pedido-prod-info">
                    <span className="pedido-prod-nombre">{p.nombre}</span>
                    {meta && <span className="pedido-prod-meta">{meta}</span>}
                    <span className="pedido-prod-meta">{stock}</span>
                  </div>
                  <div className="pedido-opciones">
                    <div className="pedido-opcion">
                      <span className="pedido-opcion-nombre">
                        Por {(p.unidad_medida || 'unidad').toLowerCase()}
                        {precioCantidad}
                      </span>
                      <span className="pedido-prod-precio">{formatearMonto(precioUnidad)}</span>
                      <Stepper
                        nombre={`${p.nombre} por unidad`}
                        valor={cantidadDe(p, 'unidad')}
                        maximo={maximoDe(p, 'unidad')}
                        deshabilitado={sinStock}
                        onFijar={(v) => fijar(p, 'unidad', v)}
                      />
                    </div>
                    <div className="pedido-opcion">
                      <span className="pedido-opcion-nombre">{etiquetaPack(p.pack_nombre, p.pack_unidades)}</span>
                      <span className="pedido-prod-precio">{formatearMonto(p.precio_pack)}</span>
                      <Stepper
                        nombre={`${p.nombre} por ${p.pack_nombre}`}
                        valor={cantidadDe(p, 'pack')}
                        maximo={maximoDe(p, 'pack')}
                        deshabilitado={p.stock_disponible < p.pack_unidades}
                        onFijar={(v) => fijar(p, 'pack', v)}
                      />
                    </div>
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
              : `${cantidadProductos} ${cantidadProductos === 1 ? 'producto' : 'productos'} · ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`}
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
