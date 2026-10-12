import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearMonto } from '../utils/format.js';
import {
  esFraccionable,
  etiquetaPack,
  formatearCantidad,
  parsearCantidad,
  plural,
  precioLinea,
  simboloMedida,
  subtotalLinea,
  sufijoPrecio,
  textoDeCantidad,
  tienePack,
  tienePrecioCantidad,
  unidadesDeLinea,
  vendeSuelto,
} from '../utils/presentacion.js';
import './ClientesEmpresaPage.css';
import './Pedidos.css';

// Catálogo del portal: el cliente ve los productos con su precio y lo que hay
// disponible (ya descontado lo que otros pedidos pendientes tienen reservado),
// arma su pedido y lo envía. El negocio lo aprueba o lo rechaza.
// Venta por pack y precio por cantidad (2026-10-11): igual que en Caja, un producto con
// pack se pide por unidad, por pack o las dos cosas; el stock se cuenta en unidades.
// Formas de venta y medida (2026-10-11): solo se ofrecen las formas en que se vende el
// producto (suelto y/o pack); por kg o litro, el suelto se pide con decimales ("2,5" kg).
// Las cantidades se guardan en la medida chica (unidades o gramos/ml), como en la API.

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

// Cantidad con decimales para kg o litro: se tipea "2,5" y se guarda en gramos/ml.
function CampoPeso({ nombre, medida, texto, deshabilitado, onCambiar }) {
  return (
    <div className="pedido-peso">
      <input
        type="text"
        inputMode="decimal"
        placeholder="0"
        aria-label={`Cantidad de ${nombre} en ${simboloMedida(medida)}`}
        disabled={deshabilitado}
        value={texto}
        onChange={(e) => onCambiar(e.target.value)}
      />
      <span>{simboloMedida(medida)}</span>
    </div>
  );
}

export default function PortalComprar({ onSesionVencida, onPedidoEnviado }) {
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [cantidades, setCantidades] = useState({}); // "producto_id:presentacion" -> cantidad (medida chica, o packs)
  const [pesos, setPesos] = useState({}); // "producto_id:unidad" -> lo tipeado, en productos por kg o litro
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  const cargar = useCallback(async () => {
    try {
      const data = await api.get('/portal/catalogo');
      setProductos(data.productos);
      setPesos({});
      // Si el stock bajó (o el producto dejó de tener pack o de venderse suelto) mientras el
      // cliente armaba el pedido, se ajusta: primero lo suelto, después los packs que entren.
      setCantidades((prev) => {
        const nuevo = {};
        for (const p of data.productos) {
          const sueltas = vendeSuelto(p) ? Math.min(prev[clave(p.id, 'unidad')] ?? 0, p.stock_disponible) : 0;
          if (sueltas > 0) nuevo[clave(p.id, 'unidad')] = sueltas;
          if (tienePack(p)) {
            const packs = Math.min(prev[clave(p.id, 'pack')] ?? 0, Math.floor((p.stock_disponible - sueltas) / p.pack_unidades));
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

  // Lo que queda para una presentación: el disponible menos lo de la otra.
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
  const total = lineas.reduce((acc, l) => acc + subtotalLinea(l.producto, l.cantidad, l.presentacion), 0);
  const cantidadProductos = new Set(lineas.map((l) => l.producto.id)).size;

  function fijarCantidad(producto, presentacion, cantidad) {
    const q = Math.max(0, Math.min(cantidad, maximoDe(producto, presentacion)));
    setCantidades((prev) => {
      const nuevo = { ...prev };
      if (q > 0) nuevo[clave(producto.id, presentacion)] = q;
      else delete nuevo[clave(producto.id, presentacion)];
      return nuevo;
    });
    return q;
  }

  function fijar(producto, presentacion, valor) {
    const n = Math.floor(Number(valor));
    fijarCantidad(producto, presentacion, Number.isFinite(n) ? n : 0);
  }

  // Por kg o litro: lo tipeado se guarda tal cual; si se pasa de lo disponible, se corrige.
  function fijarPeso(producto, texto) {
    const base = parsearCantidad(texto, producto.medida) ?? 0;
    const q = fijarCantidad(producto, 'unidad', base);
    setPesos((prev) => ({ ...prev, [clave(producto.id, 'unidad')]: q < base ? textoDeCantidad(q, producto.medida) : texto }));
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
      setPesos({});
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

  // Control de una forma de venta: stepper (unidades o packs) o peso (kg/litro suelto).
  function control(p, presentacion, nombre) {
    if (presentacion === 'unidad' && esFraccionable(p.medida)) {
      const k = clave(p.id, 'unidad');
      return (
        <CampoPeso
          nombre={nombre}
          medida={p.medida}
          texto={pesos[k] ?? textoDeCantidad(cantidadDe(p, 'unidad') || '', p.medida)}
          deshabilitado={p.stock_disponible <= 0}
          onCambiar={(t) => fijarPeso(p, t)}
        />
      );
    }
    return (
      <Stepper
        nombre={nombre}
        valor={cantidadDe(p, presentacion)}
        maximo={maximoDe(p, presentacion)}
        deshabilitado={presentacion === 'pack' ? p.stock_disponible < p.pack_unidades : p.stock_disponible <= 0}
        onFijar={(v) => fijar(p, presentacion, v)}
      />
    );
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
              const stock = sinStock ? (
                <span className="pedido-sin-stock">Sin stock</span>
              ) : (
                `${formatearCantidad(p.stock_disponible, p.medida)} disponibles`
              );
              const meta = p.categoria;
              const precioCantidad = tienePrecioCantidad(p) && (
                <span className="pedido-prod-promo">
                  Desde {formatearCantidad(p.precio_cantidad_desde, p.medida, { corta: true })}:{' '}
                  {formatearMonto(p.precio_cantidad)}
                  {esFraccionable(p.medida) ? sufijoPrecio(p.medida) : ' c/u'}
                </span>
              );
              const precioSuelto = `${formatearMonto(precioLinea(p, cantidadDe(p, 'unidad'), 'unidad').precio)}${sufijoPrecio(p.medida)}`;
              // Precio por cantidad del pack (migración 020): desde N packs.
              const precioCantidadPack = tienePrecioCantidad(p, 'pack') && (
                <span className="pedido-prod-promo">
                  Desde {p.pack_cantidad_desde} {plural(p.pack_nombre, p.pack_cantidad_desde)}: {formatearMonto(p.precio_pack_cantidad)} c/u
                </span>
              );
              const precioPack = tienePack(p) ? formatearMonto(precioLinea(p, cantidadDe(p, 'pack'), 'pack').precio) : '';
              const formas = [vendeSuelto(p) && 'unidad', tienePack(p) && 'pack'].filter(Boolean);
              const etiquetaPackP = tienePack(p) ? etiquetaPack(p.pack_nombre, p.pack_unidades, p.medida) : '';

              if (formas.length === 1) {
                const pres = formas[0];
                return (
                  <li className="pedido-prod" key={p.id}>
                    <div className="pedido-prod-info">
                      <span className="pedido-prod-nombre">{p.nombre}</span>
                      {pres === 'pack' && <span className="pedido-prod-meta">{etiquetaPackP}</span>}
                      {meta && <span className="pedido-prod-meta">{meta}</span>}
                      {pres === 'unidad' ? precioCantidad : precioCantidadPack}
                    </div>
                    <span className="pedido-prod-precio">{pres === 'pack' ? precioPack : precioSuelto}</span>
                    <span className="pedido-prod-stock">{stock}</span>
                    {control(p, pres, p.nombre)}
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
                        {esFraccionable(p.medida) ? `Por ${simboloMedida(p.medida)}` : 'Por unidad'}
                        {precioCantidad}
                      </span>
                      <span className="pedido-prod-precio">{precioSuelto}</span>
                      {control(p, 'unidad', `${p.nombre} suelto`)}
                    </div>
                    <div className="pedido-opcion">
                      <span className="pedido-opcion-nombre">
                        {etiquetaPackP}
                        {precioCantidadPack}
                      </span>
                      <span className="pedido-prod-precio">{precioPack}</span>
                      {control(p, 'pack', `${p.nombre} por ${p.pack_nombre}`)}
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
              : `${cantidadProductos} ${cantidadProductos === 1 ? 'producto' : 'productos'}`}
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
