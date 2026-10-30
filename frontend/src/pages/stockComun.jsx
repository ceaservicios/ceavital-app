import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { fechaHoyISO } from '../utils/format.js';
import {
  cantidadEnPacks,
  describirStockLargo,
  esFraccionable,
  formatearCantidad,
  parsearCantidad,
  partesPacks,
  plural,
  simboloMedida,
  tienePack,
} from '../utils/presentacion.js';

// Piezas compartidas por la lista de Stock, el alta y la ficha del producto, y la carga de
// mercadería de Proveedores (2026-10-28: la lista a todo el ancho y editar en una página aparte).

export const PUEDE_EDITAR_STOCK = new Set(['admin', 'encargado']);

// Precios, medida y formas de venta van aparte, en FormasDeVenta (2026-10-11).
export const PRODUCTO_VACIO = {
  nombre: '',
  categoria_id: '',
  codigo_barras: '',
  proveedor_id: '',
  stock_minimo: '',
  dias_aviso_vencimiento: '',
};

// Lote inicial en el alta (2026-09-15). en_packs arranca en true: si el producto tiene caja, la
// mercadería se compra por caja (2026-10-11, "cargué 5 y entraron 5 unidades").
export const LOTE_INICIAL_VACIO = () => ({ cantidad: '', en_packs: true, fecha_ingreso: fechaHoyISO(), fecha_vencimiento: '' });
export const LOTE_NUEVO_VACIO = () => ({ cantidad: '', en_packs: false, fecha_ingreso: fechaHoyISO(), fecha_vencimiento: '' });

// Cantidad de un ingreso de mercadería en la medida chica (unidades, gramos o ml): en packs,
// cantidad entera × lo que trae; suelto, lo que se tipeó ("8,5" kg). null si no es válida.
export function cantidadIngreso(texto, enPacks, producto) {
  if (enPacks && tienePack(producto)) {
    const packs = parsearCantidad(texto, 'unidad');
    return packs ? packs * producto.pack_unidades : null;
  }
  return parsearCantidad(texto, producto.medida);
}

// Lo que se manda de un ingreso: en packs, la cantidad de packs (entera); suelto, en la
// medida chica. null si lo tipeado no es válido.
export function cantidadParaApi(texto, enPacks, producto) {
  if (enPacks && tienePack(producto)) return parsearCantidad(texto, 'unidad');
  return parsearCantidad(texto, producto.medida);
}

// Stock mínimo: vacío = 0; en kg/litro con decimales.
export function minimoParaApi(texto, medida) {
  if (String(texto ?? '').trim() === '' || Number(String(texto).replace(',', '.')) === 0) return 0;
  return parsearCantidad(texto, medida);
}

// Cuenta del ingreso a la vista (2026-10-11): "5 cajas = 60 unidades · el stock queda en
// 64 unidades (5 cajas + 4)" / "8,5 kg · el stock queda en 12 kg".
export function CuentaIngreso({ cantidad, enPacks, producto, stockActual = 0, textoFinal = 'el stock queda en' }) {
  const { stockEnPacks } = useAuth();
  const base = cantidadIngreso(cantidad, enPacks, producto);
  if (!base) return null;
  const porPack = enPacks && tienePack(producto);
  const packs = porPack ? base / producto.pack_unidades : 0;
  return (
    <span className="stock-cuenta">
      {porPack && `${packs} ${plural(producto.pack_nombre, packs)} = `}
      <strong>{formatearCantidad(base, producto.medida)}</strong>
      {textoFinal && ` · ${textoFinal} ${describirStockLargo(stockActual + base, producto, stockEnPacks)}`}
    </span>
  );
}

// Selector del ingreso de mercadería (2026-10-11): suelto (unidades / kg / litros) o en
// packs (el servidor guarda cantidad × lo que trae). Si no se vende suelto, igual se puede
// ingresar suelto (ej. una caja abierta).
export function SelectorEnPacks({ enPacks, onChange, packNombre, medida }) {
  return (
    <div className="stock-en-packs" role="group" aria-label="Cargar en">
      <button type="button" className={!enPacks ? 'activo' : ''} onClick={() => onChange(false)}>
        {esFraccionable(medida) ? simboloMedida(medida) : 'Unidades'}
      </button>
      <button type="button" className={enPacks ? 'activo' : ''} onClick={() => onChange(true)}>
        {packNombre || 'Packs'}
      </button>
    </div>
  );
}

// Aviso de un producto viejo cargado con un envase como unidad ("Caja x 12"): el sistema
// cuenta, cobra y descuenta cada caja como 1 (2026-10-11).
export function AvisoEnvase({ unidad, envase, children }) {
  return (
    <div className="stock-aviso-envase" role="alert">
      <span>
        <strong>Este producto está registrado con «{unidad}» como unidad.</strong> El stock, el cobro y los descuentos
        cuentan cada {envase.nombre.toLowerCase()} como 1. Al convertirlo a unidad + {envase.nombre.toLowerCase()}, el stock
        y las ventas anteriores se actualizan automáticamente.
      </span>
      {children}
    </div>
  );
}

// Producto "de mentira" con la medida y el pack del formulario del alta, para las cuentas.
export function productoDelFormulario(formas) {
  const cantidad = parsearCantidad(formas.pack.cantidad, formas.medida);
  return formas.pack.activo && cantidad
    ? { medida: formas.medida, pack_nombre: formas.pack.nombre.trim() || 'Pack', pack_unidades: cantidad }
    : { medida: formas.medida };
}

// Columna Stock con el stock en packs (Configuración, 2026-10-28): "12 packs" y "+ 3" no se
// cortan por dentro, y abajo va el total en su medida.
function StockEnPacks({ producto }) {
  const partes = partesPacks(producto.stock_total, producto);
  if (!partes) return <span className="stock-nowrap">{cantidadEnPacks(producto.stock_total, producto)}</span>;
  return (
    <>
      <span className="stock-nowrap">{partes.packs}</span>
      {partes.resto && (
        <>
          {' '}
          <span className="stock-nowrap">+ {partes.resto}</span>
        </>
      )}
      <span className="stock-fila-packs">{formatearCantidad(producto.stock_total, producto.medida)}</span>
    </>
  );
}

/** El stock de un producto como se ve en las tablas: en unidades (y los packs abajo) o en packs. */
export function CeldaStock({ producto }) {
  const { stockEnPacks } = useAuth();
  if (stockEnPacks && tienePack(producto)) return <StockEnPacks producto={producto} />;
  const packs = partesPacks(producto.stock_total, producto);
  return (
    <>
      {formatearCantidad(producto.stock_total, producto.medida, { corta: true })}
      {packs && (
        <span className="stock-fila-packs">
          {packs.packs}
          {packs.resto && ` + ${packs.resto}`}
        </span>
      )}
    </>
  );
}

// Proveedores y categorías para los selectores del producto: solo Admin y Encargado (el Cajero no
// tiene acceso a Proveedores ni edita productos).
export function useCatalogosStock(puedeEditar) {
  const [proveedores, setProveedores] = useState([]);
  const [categorias, setCategorias] = useState([]);
  useEffect(() => {
    if (!puedeEditar) return;
    api
      .get('/proveedores')
      .then((data) => setProveedores(data.proveedores))
      .catch(() => setProveedores([]));
    api
      .get('/categorias')
      .then((data) => setCategorias(data.items))
      .catch(() => setCategorias([]));
  }, [puedeEditar]);
  return { proveedores, categorias };
}

// Listas largas (Stock y Proveedores, clase `lista-entera`): al bajar la página, la barra de
// búsqueda queda fija arriba y los títulos de la tabla se pegan debajo de ella. Como su alto cambia
// (filtros, "N de M productos", renglones que bajan en pantallas angostas), se mide y se deja en
// `--alto-barra` de la tarjeta.
export function useBarraFija() {
  const ref = useRef(null);
  useEffect(() => {
    const barra = ref.current;
    if (!barra) return undefined;
    const observador = new ResizeObserver(() => barra.parentElement.style.setProperty('--alto-barra', `${barra.offsetHeight}px`));
    observador.observe(barra);
    return () => observador.disconnect();
  }, []);
  return ref;
}

export function IconoLapiz() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function IconoVer() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
