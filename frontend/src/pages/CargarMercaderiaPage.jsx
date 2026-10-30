import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { IconoFila } from '../components/ConAvatar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { colorDe } from '../utils/colores.js';
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

function IconoQuitar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

// Ingreso de mercadería (pedido del usuario, 2026-10-28; rediseño 2026-10-29 como un comprobante):
// cabecera (proveedor, fecha, tipo y número), renglones de productos en columnas, total y pago.
// Al confirmar, cada renglón entra al stock como un lote y la compra queda en la ficha del
// proveedor con su saldo; si ya se le pagó algo, se registra acá.
export default function CargarMercaderiaPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { stockEnPacks } = useAuth();
  const desdeProveedor = searchParams.get('proveedor');

  const [proveedores, setProveedores] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cabecera, setCabecera] = useState({ proveedor_id: desdeProveedor ?? '', fecha: fechaHoyISO(), vence: '', comprobante_tipo: 'remito', comprobante_numero: '' });
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

  function elegirPagoAhora() {
    setPagoAhora(true);
    setPago({ ...pago, monto: pago.monto || (total ? String(total) : '') });
  }

  async function guardar(e) {
    e.preventDefault();
    if (guardaRef.current) return;
    const falta =
      !proveedorId
        ? 'Seleccioná el proveedor.'
        : lineas.length === 0
          ? 'Agregá al menos un producto.'
          : lineas.find((l) => subtotalLinea(l) === null)
            ? `Revisá la cantidad y el costo de «${lineas.find((l) => subtotalLinea(l) === null).producto.nombre}».`
            : cabecera.vence && cabecera.vence < cabecera.fecha
              ? 'El vencimiento del pago no puede ser anterior a la fecha de la boleta.'
              : null;
    if (falta) return setError(falta);
    const pagoApi = pagoAhora ? pagoParaApi(pago) : { payload: null };
    if (pagoApi.error) return setError(pagoApi.error);
    if (pagoApi.payload && pagoApi.payload.monto > total) return setError('El pago no puede superar el total de la compra.');

    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      await api.post(`/proveedores/${proveedorId}/compras`, {
        fecha: cabecera.fecha,
        vence: cabecera.vence || null,
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
        state: { exito: `Ingreso registrado: ${lineas.length} ${plural('producto', lineas.length)} ${lineas.length === 1 ? 'sumado' : 'sumados'} al stock.` },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar el ingreso de mercadería.');
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  const volverA = desdeProveedor ? `/proveedores/${desdeProveedor}` : '/proveedores';

  return (
    <div className="cliente-page carga-pagina">
      <div className="cliente-encabezado">
        <h1 className="cliente-h1">Ingreso de mercadería</h1>
        <div className="cliente-subtitulo">Al confirmar, los productos se suman al stock y la compra queda registrada en la cuenta del proveedor.</div>
      </div>

      <form className="carga-form" onSubmit={guardar}>
        {/* La primera tarjeta lleva la cabecera verde de las altas (como Nuevo proveedor). */}
        <div className="card cliente-card cliente-form-card">
          <span className="cliente-seccion-titulo">Comprobante</span>
          <div className="carga-cabecera">
            <div className="field">
              <label>Proveedor *</label>
              <select required value={cabecera.proveedor_id} onChange={(e) => setCabecera({ ...cabecera, proveedor_id: e.target.value })}>
                <option value="">Seleccioná un proveedor…</option>
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
            {/* Cuándo hay que pagarla (Saldos pendientes, 2026-10-29). Vacío: el mismo día de la boleta. */}
            <div className="field">
              <label htmlFor="carga-vence">Vence el pago</label>
              <input
                id="carga-vence"
                type="date"
                min={cabecera.fecha}
                title="Si lo dejás vacío, vence el día de la boleta."
                value={cabecera.vence}
                onChange={(e) => setCabecera({ ...cabecera, vence: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Tipo</label>
              <div className="prov-seg" role="group" aria-label="Tipo de comprobante">
                {COMPROBANTES.map((c) => (
                  <button
                    key={c.valor}
                    type="button"
                    className={cabecera.comprobante_tipo === c.valor ? 'activo' : ''}
                    aria-pressed={cabecera.comprobante_tipo === c.valor}
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
                placeholder="Ej.: 0001-00004567"
                value={cabecera.comprobante_numero}
                onChange={(e) => setCabecera({ ...cabecera, comprobante_numero: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="card cliente-card">
          <span className="cliente-seccion-titulo">Productos recibidos</span>
          <div className="carga-buscador">
            <input
              ref={buscadorRef}
              className="cliente-buscar"
              type="text"
              placeholder="Buscá un producto por nombre o escaneá su código…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={alEnter}
            />
            {busqueda.trim() && (
              <div className="carga-resultados">
                {resultados.length === 0 ? (
                  <div className="carga-resultado-vacio">Sin resultados. Si el producto es nuevo, primero dalo de alta en Stock.</div>
                ) : (
                  resultados.map((p) => (
                    <button key={p.id} type="button" className="carga-resultado" onClick={() => agregar(p)}>
                      <span className="carga-resultado-cabeza">
                        <IconoFila icono="paquete" color={colorDe(p.id)} />
                        <span>
                          <strong>{p.nombre}</strong>
                          {p.proveedor_id === proveedorId && proveedorId && <span className="carga-de-proveedor">Del proveedor</span>}
                        </span>
                      </span>
                      <span className="cliente-td-sub">Stock: {describirStockLargo(p.stock_total, p, stockEnPacks)}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {lineas.length === 0 ? (
            <div className="cliente-vacio">Sin productos agregados.</div>
          ) : (
            <div className="carga-lineas">
              <div className="carga-linea carga-linea-cabecera" aria-hidden="true">
                <span>Producto</span>
                <span>Cantidad</span>
                <span>Vencimiento</span>
                <span>Costo</span>
                <span className="num">Subtotal</span>
                <span />
              </div>
              {lineas.map((l) => {
                const enPacks = l.en_packs && tienePack(l.producto);
                const subtotal = subtotalLinea(l);
                const unidadCosto = enPacks ? `por ${l.producto.pack_nombre.toLowerCase()}` : porMedida(l.producto.medida);
                return (
                  <div key={l.clave} className="carga-linea">
                    <div className="carga-producto">
                      <IconoFila icono="paquete" color={colorDe(l.producto.id)} />
                      <div className="carga-producto-texto">
                        <strong>{l.producto.nombre}</strong>
                        <span className="cliente-td-sub">Stock actual: {describirStockLargo(l.producto.stock_total, l.producto, stockEnPacks)}</span>
                        <CuentaIngreso
                          cantidad={l.cantidad}
                          enPacks={l.en_packs}
                          producto={l.producto}
                          stockActual={l.producto.stock_total}
                          textoFinal="stock final:"
                        />
                      </div>
                    </div>
                    <div className="field carga-campo carga-campo-cant">
                      <span className="carga-etiqueta">Cantidad</span>
                      <div className="carga-cantidad">
                        {tienePack(l.producto) ? (
                          <>
                            <input
                              type="text"
                              inputMode={esFraccionable(l.producto.medida) && !enPacks ? 'decimal' : 'numeric'}
                              placeholder="0"
                              value={l.cantidad}
                              aria-label={`Cantidad de ${l.producto.nombre}`}
                              onChange={(e) => cambiar(l.clave, { cantidad: e.target.value })}
                            />
                            <SelectorEnPacks enPacks={l.en_packs} packNombre={l.producto.pack_nombre} medida={l.producto.medida} onChange={(v) => cambiarPresentacion(l, v)} />
                          </>
                        ) : (
                          <div className={`carga-input-unidad${esFraccionable(l.producto.medida) ? ' carga-input-unidad-corta' : ''}`}>
                            <input
                              type="text"
                              inputMode={esFraccionable(l.producto.medida) ? 'decimal' : 'numeric'}
                              placeholder="0"
                              value={l.cantidad}
                              aria-label={`Cantidad de ${l.producto.nombre}`}
                              onChange={(e) => cambiar(l.clave, { cantidad: e.target.value })}
                            />
                            <span aria-hidden="true">{simboloMedida(l.producto.medida)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="field carga-campo carga-campo-vence">
                      <span className="carga-etiqueta">Vencimiento</span>
                      <input type="date" value={l.vencimiento} aria-label={`Vencimiento de ${l.producto.nombre}`} onChange={(e) => cambiar(l.clave, { vencimiento: e.target.value })} />
                    </div>
                    <div className="field carga-campo carga-campo-costo">
                      <span className="carga-etiqueta">Costo</span>
                      <div className="carga-input-unidad">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="$"
                          value={l.costo}
                          aria-label={`Costo de ${l.producto.nombre} ${unidadCosto}`}
                          onChange={(e) => cambiar(l.clave, { costo: e.target.value })}
                        />
                        <span aria-hidden="true">{unidadCosto}</span>
                      </div>
                    </div>
                    <div className="carga-subtotal num">
                      <span className="carga-etiqueta">Subtotal</span>
                      {subtotal === null ? <span className="carga-subtotal-vacio">—</span> : formatearMonto(subtotal)}
                    </div>
                    <button
                      type="button"
                      className="boton-icono boton-icono-peligro carga-quitar"
                      title="Quitar"
                      aria-label={`Quitar ${l.producto.nombre}`}
                      onClick={() => setLineas((prev) => prev.filter((x) => x.clave !== l.clave))}
                    >
                      <IconoQuitar />
                    </button>
                  </div>
                );
              })}
              <div className="carga-total">
                <span className="carga-total-rotulo">Total de la compra</span>
                <span className="carga-total-monto">{formatearMonto(total)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="card cliente-card">
          <span className="cliente-seccion-titulo">Pago</span>
          <div className="prov-seg" role="group" aria-label="Pago de la compra">
            <button type="button" className={!pagoAhora ? 'activo' : ''} aria-pressed={!pagoAhora} onClick={() => setPagoAhora(false)}>
              Queda pendiente
            </button>
            <button type="button" className={pagoAhora ? 'activo' : ''} aria-pressed={pagoAhora} onClick={elegirPagoAhora}>
              Registrar un pago ahora
            </button>
          </div>
          {pagoAhora && <CamposPago pago={pago} setPago={setPago} />}
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        <div className="carga-pie">
          <button type="button" className="btn" onClick={() => navigate(volverA)}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Registrando…' : 'Registrar ingreso'}
          </button>
        </div>
      </form>
    </div>
  );
}
