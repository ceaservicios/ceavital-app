import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearMonto, fechaHoyISO } from '../utils/format.js';
import { describirStockLargo, esFraccionable, factorMedida, plural, porMedida, simboloMedida, tienePack } from '../utils/presentacion.js';
import { cantidadParaApi, CuentaIngreso, SelectorEnPacks } from './stockComun.jsx';
import { CamposPago, COMPROBANTES, PAGO_VACIO, pagoParaApi } from './proveedoresComun.jsx';
import './ClientesEmpresaPage.css';
import './StockPage.css';
import './ProveedoresPage.css';

// Costo con que arranca una línea: el que ya tiene el producto (el Encargado no lo recibe).
function costoSugerido(producto, enPacks) {
  const costo = enPacks ? producto.costo_pack : producto.precio_costo;
  return costo != null ? String(costo) : '';
}

function nuevaLinea(producto, enPacks = tienePack(producto)) {
  return { clave: `${producto.id}-${Date.now()}-${Math.random()}`, producto, en_packs: enPacks, cantidad: '', costo: costoSugerido(producto, enPacks), vencimiento: '' };
}

// Subtotal de una línea: packs × costo del pack; suelto, cantidad × costo (÷1000 en kg/litro). null si falta algo.
function subtotalLinea(l) {
  const enPacks = l.en_packs && tienePack(l.producto);
  const cantidad = cantidadParaApi(l.cantidad, enPacks, l.producto);
  const costo = Number(l.costo);
  if (!cantidad || String(l.costo).trim() === '' || !Number.isInteger(costo) || costo < 0) return null;
  return enPacks ? cantidad * costo : Math.round((cantidad * costo) / factorMedida(l.producto.medida));
}

// Cargar la mercadería que trajo un proveedor (pedido del usuario, 2026-10-28): proveedor, fecha,
// remito o factura y lo que trajo. Al guardar, cada línea entra al stock como un lote y la compra
// queda en el perfil del proveedor con lo que se le debe; si ya se le pagó algo, se anota acá.
export default function CargarMercaderiaPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { stockEnPacks } = useAuth();
  const desdeProveedor = searchParams.get('proveedor');

  const [proveedores, setProveedores] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cabecera, setCabecera] = useState({ proveedor_id: desdeProveedor ?? '', fecha: fechaHoyISO(), comprobante_tipo: 'remito', comprobante_numero: '' });
  const [lineas, setLineas] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [pagoAhora, setPagoAhora] = useState(false);
  const [pago, setPago] = useState(PAGO_VACIO());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const guardaRef = useRef(false); // contra el doble click: duplicaría el stock y la deuda
  const buscadorRef = useRef(null);

  useEffect(() => {
    Promise.all([api.get('/proveedores'), api.get('/productos')])
      .then(([p, pr]) => {
        setProveedores(p.proveedores);
        setProductos(pr.productos);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los proveedores y productos.'));
  }, []);

  const proveedorId = cabecera.proveedor_id === '' ? null : Number(cabecera.proveedor_id);

  // Primero los productos de ese proveedor; se busca por nombre o por código (también el del pack).
  const resultados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return [];
    return productos
      .filter(
        (p) =>
          p.nombre.toLowerCase().includes(texto) ||
          (p.codigo_barras ?? '').toLowerCase() === texto ||
          (p.codigo_barras_pack ?? '').toLowerCase() === texto
      )
      .sort((a, b) => Number(b.proveedor_id === proveedorId) - Number(a.proveedor_id === proveedorId) || a.nombre.localeCompare(b.nombre))
      .slice(0, 8);
  }, [busqueda, productos, proveedorId]);

  const total = lineas.reduce((acc, l) => acc + (subtotalLinea(l) ?? 0), 0);

  function agregar(producto, enPacks) {
    setLineas((prev) => [...prev, nuevaLinea(producto, enPacks)]);
    setBusqueda('');
    buscadorRef.current?.focus();
  }

  // Enter (o el lector de códigos): el código del pack agrega en packs, el de la unidad suelto.
  function alEnter(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const texto = busqueda.trim().toLowerCase();
    const porPack = productos.find((p) => (p.codigo_barras_pack ?? '').toLowerCase() === texto);
    const porUnidad = productos.find((p) => (p.codigo_barras ?? '').toLowerCase() === texto);
    if (porPack) agregar(porPack, true);
    else if (porUnidad) agregar(porUnidad, false);
    else if (resultados.length === 1) agregar(resultados[0]);
  }

  function cambiar(clave, cambios) {
    setLineas((prev) => prev.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)));
  }

  function cambiarPresentacion(l, enPacks) {
    cambiar(l.clave, { en_packs: enPacks, costo: costoSugerido(l.producto, enPacks) });
  }

  async function guardar(e) {
    e.preventDefault();
    if (guardaRef.current) return;
    const falta =
      !proveedorId
        ? 'Elegí el proveedor.'
        : lineas.length === 0
          ? 'Agregá al menos un producto.'
          : lineas.find((l) => subtotalLinea(l) === null)
            ? `Revisá la cantidad y el costo de «${lineas.find((l) => subtotalLinea(l) === null).producto.nombre}».`
            : null;
    if (falta) return setError(falta);
    const pagoApi = pagoAhora ? pagoParaApi(pago) : { payload: null };
    if (pagoApi.error) return setError(pagoApi.error);
    if (pagoApi.payload && pagoApi.payload.monto > total) return setError('Lo que le pagaste no puede superar el total de la compra.');

    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      await api.post(`/proveedores/${proveedorId}/compras`, {
        fecha: cabecera.fecha,
        comprobante_tipo: cabecera.comprobante_tipo,
        comprobante_numero: cabecera.comprobante_numero.trim() || null,
        items: lineas.map((l) => {
          const enPacks = l.en_packs && tienePack(l.producto);
          return {
            producto_id: l.producto.id,
            en_packs: enPacks,
            cantidad: cantidadParaApi(l.cantidad, enPacks, l.producto),
            costo: Number(l.costo),
            fecha_vencimiento: l.vencimiento || null,
          };
        }),
        pago: pagoApi.payload,
      });
      navigate(`/proveedores/${proveedorId}`, {
        replace: true,
        state: { exito: `Mercadería cargada: ${lineas.length} ${plural('producto', lineas.length)} ${lineas.length === 1 ? 'sumado' : 'sumados'} al stock.` },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la mercadería.');
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  const volverA = desdeProveedor ? `/proveedores/${desdeProveedor}` : '/proveedores';

  return (
    <div className="cliente-page carga-pagina">
      <div className="cliente-encabezado">
        <Link to={volverA} className="cliente-volver">
          ← Volver
        </Link>
        <h1 className="cliente-h1">Cargar mercadería</h1>
        <div className="cliente-subtitulo">Lo que trajo el proveedor. Al guardar se suma al stock y queda en su cuenta.</div>
      </div>

      <form className="producto-form" onSubmit={guardar}>
        <div className="card cliente-card">
          <span className="cliente-seccion-titulo">Proveedor y comprobante</span>
          <div className="cliente-campos">
            <div className="field">
              <label>Proveedor *</label>
              <select required value={cabecera.proveedor_id} onChange={(e) => setCabecera({ ...cabecera, proveedor_id: e.target.value })}>
                <option value="">Elegí el proveedor…</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Fecha</label>
              <input required type="date" value={cabecera.fecha} onChange={(e) => setCabecera({ ...cabecera, fecha: e.target.value })} />
            </div>
            <div className="field">
              <label>Comprobante</label>
              <div className="stock-en-packs" role="group" aria-label="Tipo de comprobante">
                {COMPROBANTES.map((c) => (
                  <button
                    key={c.valor}
                    type="button"
                    className={cabecera.comprobante_tipo === c.valor ? 'activo' : ''}
                    onClick={() => setCabecera({ ...cabecera, comprobante_tipo: c.valor })}
                  >
                    {c.texto}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>N° de {cabecera.comprobante_tipo === 'factura' ? 'factura' : 'remito'}</label>
              <input
                placeholder="Ej: 0001-00004567"
                value={cabecera.comprobante_numero}
                onChange={(e) => setCabecera({ ...cabecera, comprobante_numero: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="card cliente-card">
          <span className="cliente-seccion-titulo">Lo que trajo</span>
          <div className="carga-buscador">
            <input
              ref={buscadorRef}
              className="cliente-buscar"
              type="text"
              placeholder="Buscá un producto por nombre o pasá el lector de códigos…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={alEnter}
            />
            {busqueda.trim() && (
              <div className="carga-resultados">
                {resultados.length === 0 ? (
                  <div className="carga-resultado-vacio">Sin resultados. Si es un producto nuevo, primero crealo en Stock.</div>
                ) : (
                  resultados.map((p) => (
                    <button key={p.id} type="button" className="carga-resultado" onClick={() => agregar(p)}>
                      <span>
                        <strong>{p.nombre}</strong>
                        {p.proveedor_id === proveedorId && proveedorId && <span className="carga-de-proveedor">de este proveedor</span>}
                      </span>
                      <span className="cliente-td-sub">Stock: {describirStockLargo(p.stock_total, p, stockEnPacks)}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {lineas.length === 0 ? (
            <div className="cliente-vacio">Todavía no agregaste productos.</div>
          ) : (
            <div className="carga-lineas">
              <div className="carga-linea carga-linea-cabecera" aria-hidden="true">
                <span>Producto</span>
                <span>Cantidad</span>
                <span>Vence</span>
                <span>Costo</span>
                <span className="num">Subtotal</span>
                <span />
              </div>
              {lineas.map((l) => {
                const enPacks = l.en_packs && tienePack(l.producto);
                const subtotal = subtotalLinea(l);
                return (
                  <div key={l.clave} className="carga-linea">
                    <div className="carga-producto">
                      <strong>{l.producto.nombre}</strong>
                      <span className="cliente-td-sub">Stock actual: {describirStockLargo(l.producto.stock_total, l.producto, stockEnPacks)}</span>
                    </div>
                    <div className="field carga-campo">
                      <span className="carga-etiqueta">Cantidad</span>
                      {tienePack(l.producto) && (
                        <SelectorEnPacks enPacks={l.en_packs} packNombre={l.producto.pack_nombre} medida={l.producto.medida} onChange={(v) => cambiarPresentacion(l, v)} />
                      )}
                      <input
                        type="text"
                        inputMode={esFraccionable(l.producto.medida) && !enPacks ? 'decimal' : 'numeric'}
                        placeholder={enPacks ? plural(l.producto.pack_nombre, 2) : simboloMedida(l.producto.medida)}
                        value={l.cantidad}
                        aria-label={`Cantidad de ${l.producto.nombre}`}
                        onChange={(e) => cambiar(l.clave, { cantidad: e.target.value })}
                      />
                      <CuentaIngreso cantidad={l.cantidad} enPacks={l.en_packs} producto={l.producto} stockActual={l.producto.stock_total} />
                    </div>
                    <div className="field carga-campo">
                      <span className="carga-etiqueta">Vence (opcional)</span>
                      <input type="date" value={l.vencimiento} aria-label={`Vencimiento de ${l.producto.nombre}`} onChange={(e) => cambiar(l.clave, { vencimiento: e.target.value })} />
                    </div>
                    <div className="field carga-campo">
                      <span className="carga-etiqueta">Costo</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="$"
                        value={l.costo}
                        aria-label={`Costo de ${l.producto.nombre}`}
                        onChange={(e) => cambiar(l.clave, { costo: e.target.value })}
                      />
                      <span className="stock-hint">{enPacks ? `por ${l.producto.pack_nombre.toLowerCase()}` : porMedida(l.producto.medida)}</span>
                    </div>
                    <div className="carga-subtotal num">
                      <span className="carga-etiqueta">Subtotal</span>
                      {subtotal === null ? '—' : formatearMonto(subtotal)}
                    </div>
                    <button
                      type="button"
                      className="boton-icono boton-icono-peligro carga-quitar"
                      title="Quitar"
                      aria-label={`Quitar ${l.producto.nombre}`}
                      onClick={() => setLineas((prev) => prev.filter((x) => x.clave !== l.clave))}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <div className="carga-total">
                <span>Total de la compra</span>
                <strong>{formatearMonto(total)}</strong>
              </div>
            </div>
          )}
        </div>

        <div className="card cliente-card">
          <span className="cliente-seccion-titulo">¿Le pagaste algo ahora?</span>
          <div className="cliente-radios">
            <label className="cliente-radio">
              <input type="radio" checked={!pagoAhora} onChange={() => setPagoAhora(false)} />
              No, queda a pagar
            </label>
            <label className="cliente-radio">
              <input
                type="radio"
                checked={pagoAhora}
                onChange={() => {
                  setPagoAhora(true);
                  setPago({ ...pago, monto: pago.monto || (total ? String(total) : '') });
                }}
              />
              Sí, le pagué
            </label>
          </div>
          {pagoAhora && <CamposPago pago={pago} setPago={setPago} />}
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        <div className="cliente-acciones">
          <button type="button" className="btn" onClick={() => navigate(volverA)}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Cargando…' : 'Cargar y sumar al stock'}
          </button>
        </div>
      </form>
    </div>
  );
}
