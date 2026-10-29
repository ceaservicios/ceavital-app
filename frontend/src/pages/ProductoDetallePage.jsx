import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearFecha } from '../utils/format.js';
import {
  cargadoConEnvase,
  describirStock,
  describirStockLargo,
  envaseEnNombre,
  esFraccionable,
  etiquetaPack,
  simboloMedida,
  textoDeCantidad,
  tienePack,
} from '../utils/presentacion.js';
import PasarAPack from '../components/PasarAPack.jsx';
import FormasDeVenta, { faltaEnFormas, FORMAS_VACIAS, formasDesdeProducto, formasParaApi } from '../components/FormasDeVenta.jsx';
import {
  AvisoEnvase,
  cantidadParaApi,
  CuentaIngreso,
  LOTE_NUEVO_VACIO,
  minimoParaApi,
  PUEDE_EDITAR_STOCK,
  SelectorEnPacks,
  useCatalogosStock,
} from './stockComun.jsx';
import { textoComprobante } from './proveedoresComun.jsx';
import './ClientesEmpresaPage.css';
import './StockPage.css';

function aEdicion(p) {
  return {
    nombre: p.nombre,
    categoria_id: p.categoria_id ?? '',
    codigo_barras: p.codigo_barras ?? '',
    proveedor_id: p.proveedor_id ?? '',
    stock_minimo: textoDeCantidad(p.stock_minimo, p.medida),
    dias_aviso_vencimiento: p.dias_aviso_vencimiento ?? '',
  };
}

// Ficha de un producto en su propia página (2026-10-28, antes un panel al costado de la lista):
// datos y precios, lotes con su origen (de qué proveedor y remito vinieron) e ingreso de stock
// a mano. El Cajero la ve sin poder cambiar nada.
export default function ProductoDetallePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { usuario, stockEnPacks } = useAuth();
  const esAdmin = usuario?.rol === 'admin';
  const puedeEditar = PUEDE_EDITAR_STOCK.has(usuario?.rol);
  const { proveedores, categorias } = useCatalogosStock(puedeEditar);

  const [detalle, setDetalle] = useState(null); // producto completo con lotes
  const [edicion, setEdicion] = useState(null);
  const [formas, setFormas] = useState(FORMAS_VACIAS);
  const [nuevoLote, setNuevoLote] = useState(LOTE_NUEVO_VACIO);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [pasandoAPack, setPasandoAPack] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(location.state?.exito ?? null);
  // Guardia sincrónica compartida por guardar, agregar lote, eliminar lote y eliminar producto:
  // `disabled={guardando}` no alcanza contra dos clicks en el mismo tick.
  const guardaRef = useRef(false);

  const cargar = useCallback(async () => {
    try {
      const data = await api.get(`/productos/${id}`);
      setDetalle(data);
      setEdicion(aEdicion(data));
      setFormas(formasDesdeProducto(data));
      setNuevoLote({ ...LOTE_NUEVO_VACIO(), en_packs: tienePack(data) });
      return data;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar el producto.');
      return null;
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function conGuardia(accion, mensajeError) {
    if (guardaRef.current) return;
    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    setExito(null);
    try {
      await accion();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : mensajeError);
    } finally {
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  function guardar(e) {
    e.preventDefault();
    // Un producto viejo contado en cajas ("Caja x 12" como unidad) no se cambia a mano: para eso
    // está "Pasar a unidad + caja", que convierte el stock y las ventas anteriores (2026-10-11).
    const envase = cargadoConEnvase(detalle) && envaseEnNombre(detalle.unidad_medida);
    const cambiaForma = formas.pack.activo || formas.medida !== detalle.medida;
    const medida = esAdmin ? formas.medida : detalle.medida;
    const stockMinimo = minimoParaApi(edicion.stock_minimo, medida);
    const falta =
      envase && cambiaForma
        ? `Este producto está contado en «${detalle.unidad_medida}». Para pasarlo a unidad + ${envase.nombre.toLowerCase()} usá el botón «Pasar a unidad + ${envase.nombre.toLowerCase()}».`
        : stockMinimo === null
          ? 'El stock mínimo no es un número válido.'
          : esAdmin && faltaEnFormas(formas);
    if (falta) {
      setError(falta);
      return;
    }
    return conGuardia(async () => {
      const payload = {
        nombre: edicion.nombre,
        categoria_id: edicion.categoria_id === '' ? null : Number(edicion.categoria_id),
        codigo_barras: edicion.codigo_barras || null,
        proveedor_id: edicion.proveedor_id === '' ? null : Number(edicion.proveedor_id),
        stock_minimo: stockMinimo,
        dias_aviso_vencimiento: edicion.dias_aviso_vencimiento === '' ? null : Number(edicion.dias_aviso_vencimiento),
      };
      // Precios, medida y formas de venta solo los manda el Admin: el backend rechaza el PATCH
      // entero con 403 apenas ve esas claves, aunque el valor no haya cambiado.
      if (esAdmin) Object.assign(payload, formasParaApi(formas));
      await api.patch(`/productos/${id}`, payload);
      await cargar();
      setExito('Cambios guardados.');
    }, 'No se pudieron guardar los cambios.');
  }

  function agregarLote(e) {
    e.preventDefault();
    const enPacks = tienePack(detalle) && nuevoLote.en_packs;
    const cantidad = cantidadParaApi(nuevoLote.cantidad, enPacks, detalle);
    if (!cantidad) {
      setError(`La cantidad no es válida${enPacks ? ' (en packs va un número entero)' : ''}.`);
      return;
    }
    return conGuardia(async () => {
      await api.post(`/productos/${id}/lotes`, {
        cantidad,
        en_packs: enPacks,
        fecha_ingreso: nuevoLote.fecha_ingreso,
        fecha_vencimiento: nuevoLote.fecha_vencimiento || null,
      });
      await cargar();
      setExito('Stock ingresado.');
    }, 'No se pudo registrar el ingreso.');
  }

  function eliminarLote(loteId) {
    return conGuardia(async () => {
      await api.delete(`/productos/${id}/lotes/${loteId}`);
      await cargar();
    }, 'No se pudo eliminar el lote.');
  }

  function eliminarProducto() {
    return conGuardia(async () => {
      try {
        await api.delete(`/productos/${id}`);
        navigate('/stock', { replace: true, state: { exito: `"${detalle.nombre}" se eliminó.` } });
      } catch (err) {
        setConfirmandoEliminar(false);
        throw err;
      }
    }, 'No se pudo eliminar el producto.');
  }

  if (cargando) return <div className="cliente-vacio">Cargando…</div>;
  if (!detalle) {
    return (
      <div className="cliente-page">
        <Link to="/stock" className="cliente-volver">
          ← Volver a stock
        </Link>
        {error && <div className="alert alert-danger">{error}</div>}
      </div>
    );
  }

  const nombreProveedor = proveedores.find((p) => p.id === detalle.proveedor_id)?.nombre;
  const enPacks = tienePack(detalle) && nuevoLote.en_packs;
  const set = (campo) => (e) => setEdicion({ ...edicion, [campo]: e.target.value });

  return (
    <div className="cliente-page producto-pagina">
      <div className="cliente-encabezado">
        <Link to="/stock" className="cliente-volver">
          ← Volver a stock
        </Link>
        <div className="cliente-titulo-fila">
          <h1 className="cliente-h1">{detalle.nombre}</h1>
          <span className={`cliente-badge ${detalle.alerta_stock_bajo ? 'producto-badge-bajo' : 'cliente-badge-aldia'}`}>
            Stock: {describirStockLargo(detalle.stock_total, detalle, stockEnPacks)}
          </span>
        </div>
        <div className="cliente-subtitulo">
          {[detalle.categoria, nombreProveedor, detalle.codigo_barras && `Código ${detalle.codigo_barras}`].filter(Boolean).join(' · ') ||
            'Sin categoría ni proveedor'}
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <form className="producto-form" onSubmit={guardar}>
        <div className="producto-columnas">
          <div className="card cliente-card producto-columna">
            <span className="cliente-seccion-titulo">Datos del producto</span>
            <div className="cliente-campos">
              <div className="field cliente-campo-full">
                <label>Nombre</label>
                <input required disabled={!puedeEditar} value={edicion.nombre} onChange={set('nombre')} />
              </div>
              <div className="field">
                <label>Categoría</label>
                {puedeEditar ? (
                  <select value={edicion.categoria_id} onChange={set('categoria_id')}>
                    <option value="">Sin categoría</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="stock-campo-oculto">{detalle.categoria || '—'}</div>
                )}
              </div>
              <div className="field">
                <label>Código de barras</label>
                <input disabled={!puedeEditar} value={edicion.codigo_barras} onChange={set('codigo_barras')} />
              </div>
              <div className="field">
                <label>Proveedor</label>
                {puedeEditar ? (
                  <select value={edicion.proveedor_id} onChange={set('proveedor_id')}>
                    <option value="">Sin proveedor</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="stock-campo-oculto">{nombreProveedor ?? (detalle.proveedor_id ? '—' : 'Sin proveedor')}</div>
                )}
              </div>
              <div className="field">
                <label>
                  Stock mínimo <span className="stock-label-unidad">en {simboloMedida(esAdmin ? formas.medida : detalle.medida)}</span>
                </label>
                <input
                  type="text"
                  inputMode={esFraccionable(esAdmin ? formas.medida : detalle.medida) ? 'decimal' : 'numeric'}
                  disabled={!puedeEditar}
                  value={edicion.stock_minimo}
                  onChange={set('stock_minimo')}
                />
              </div>
              <div className="field">
                <label>Días de aviso de vencimiento</label>
                <input type="number" min="0" disabled={!puedeEditar} value={edicion.dias_aviso_vencimiento} onChange={set('dias_aviso_vencimiento')} />
              </div>
            </div>
          </div>

          <div className="card cliente-card producto-columna">
            <span className="cliente-seccion-titulo">Cómo se mide y cómo se vende</span>
            {cargadoConEnvase(detalle) && !pasandoAPack && (
              <AvisoEnvase unidad={detalle.unidad_medida} envase={envaseEnNombre(detalle.unidad_medida)}>
                {esAdmin ? (
                  <button type="button" className="btn btn-primary" onClick={() => setPasandoAPack(true)}>
                    Pasar a unidad + {envaseEnNombre(detalle.unidad_medida).nombre.toLowerCase()}
                  </button>
                ) : (
                  <span className="stock-hint">Pedile al Administrador que lo pase a unidad + caja.</span>
                )}
              </AvisoEnvase>
            )}
            {pasandoAPack && (
              <PasarAPack
                producto={detalle}
                onCancelar={() => setPasandoAPack(false)}
                onHecho={async (actualizado) => {
                  setPasandoAPack(false);
                  await cargar();
                  setExito(`Listo: el stock quedó en ${describirStockLargo(actualizado.stock_total, actualizado, stockEnPacks)}.`);
                }}
              />
            )}
            {!cargadoConEnvase(detalle) && (
              <FormasDeVenta
                valor={formas}
                onChange={setFormas}
                editablePrecios={esAdmin}
                verCosto={esAdmin}
                medidaBloqueada={detalle.lotes.length > 0 ? 'Ya tiene stock cargado: la forma de medir no se cambia.' : null}
              />
            )}
          </div>
        </div>

        {puedeEditar && (
          <div className="cliente-acciones">
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        )}
      </form>

      <div className="card cliente-card">
        <span className="cliente-seccion-titulo">Lotes ({detalle.lotes.length})</span>
        {detalle.lotes.length === 0 ? (
          <div className="cliente-vacio">Sin lotes cargados.</div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla">
              <thead>
                <tr>
                  <th>Cantidad</th>
                  <th>Ingresó</th>
                  <th>Vence</th>
                  {puedeEditar && <th>De dónde vino</th>}
                  {puedeEditar && <th className="accion" aria-label="Acciones" />}
                </tr>
              </thead>
              <tbody>
                {detalle.lotes.map((lote) => (
                  <tr key={lote.id} className="sin-click">
                    <td className="cliente-td-nombre">{describirStock(lote.cantidad, detalle, stockEnPacks)}</td>
                    <td>{formatearFecha(lote.fecha_ingreso)}</td>
                    <td>
                      {lote.fecha_vencimiento ? formatearFecha(lote.fecha_vencimiento) : '—'}
                      {lote.vencido && <span className="stock-badge-vencido producto-badge-vencido">Vencido</span>}
                    </td>
                    {/* De qué proveedor y remito vino: el Cajero no tiene acceso a Proveedores. */}
                    {puedeEditar && (
                      <td>
                        {lote.compra ? (
                          <Link to={`/proveedores/${lote.compra.proveedor_id}`}>
                            {lote.compra.proveedor_nombre} · {textoComprobante(lote.compra)}
                          </Link>
                        ) : (
                          <span className="cliente-td-sub">Ingreso a mano</span>
                        )}
                      </td>
                    )}
                    {puedeEditar && (
                      <td className="accion">
                        <button
                          type="button"
                          className="boton-icono boton-icono-peligro"
                          title="Eliminar lote"
                          aria-label="Eliminar lote"
                          disabled={guardando}
                          onClick={() => eliminarLote(lote.id)}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 6h18" />
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {puedeEditar && (
        <form className="card cliente-card" onSubmit={agregarLote}>
          <span className="cliente-seccion-titulo">Ingresar stock a mano</span>
          <span className="cliente-hint">
            Para un ajuste o mercadería sin proveedor. La que trae un proveedor cargala desde Proveedores → Cargar mercadería, así queda en su cuenta.
          </span>
          {tienePack(detalle) && (
            <SelectorEnPacks
              enPacks={nuevoLote.en_packs}
              packNombre={detalle.pack_nombre}
              medida={detalle.medida}
              onChange={(v) => setNuevoLote({ ...nuevoLote, en_packs: v })}
            />
          )}
          <div className="cliente-campos">
            <div className="field">
              <label>
                {enPacks
                  ? `Cantidad (en ${etiquetaPack(detalle.pack_nombre, detalle.pack_unidades, detalle.medida)})`
                  : `Cantidad (en ${simboloMedida(detalle.medida)})`}
              </label>
              <input
                required
                type="text"
                inputMode={esFraccionable(detalle.medida) && !enPacks ? 'decimal' : 'numeric'}
                value={nuevoLote.cantidad}
                onChange={(e) => setNuevoLote({ ...nuevoLote, cantidad: e.target.value })}
              />
              <CuentaIngreso cantidad={nuevoLote.cantidad} enPacks={nuevoLote.en_packs} producto={detalle} stockActual={detalle.stock_total} />
            </div>
            <div className="field">
              <label>Fecha de ingreso</label>
              <input
                required
                type="date"
                value={nuevoLote.fecha_ingreso}
                onChange={(e) => setNuevoLote({ ...nuevoLote, fecha_ingreso: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Vencimiento (opcional)</label>
              <input
                type="date"
                value={nuevoLote.fecha_vencimiento}
                onChange={(e) => setNuevoLote({ ...nuevoLote, fecha_vencimiento: e.target.value })}
              />
            </div>
          </div>
          <div className="cliente-acciones">
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              Ingresar stock
            </button>
          </div>
        </form>
      )}

      {esAdmin && (
        <div className="card cliente-card">
          <div className="cliente-eliminar producto-eliminar">
            {!confirmandoEliminar ? (
              <button type="button" className="cliente-eliminar-link" onClick={() => setConfirmandoEliminar(true)}>
                Eliminar producto
              </button>
            ) : (
              <div className="cliente-eliminar-confirm">
                <span>¿Eliminar "{detalle.nombre}"? No se puede deshacer desde la interfaz.</span>
                <div className="cliente-acciones">
                  <button type="button" className="btn" onClick={() => setConfirmandoEliminar(false)}>
                    Cancelar
                  </button>
                  <button type="button" className="btn btn-peligro" disabled={guardando} onClick={eliminarProducto}>
                    Sí, eliminar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
