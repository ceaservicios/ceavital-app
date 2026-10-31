import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import { MigaFicha } from '../components/Topbar.jsx';
import { ConIcono } from '../components/ConAvatar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { COLOR } from '../utils/colores.js';
import { formatearFecha } from '../utils/format.js';
import {
  cantidadEnPacks,
  cargadoConEnvase,
  describirPacks,
  describirStock,
  describirStockLargo,
  envaseEnNombre,
  esFraccionable,
  etiquetaPack,
  formatearCantidad,
  parsearCantidad,
  plural,
  simboloMedida,
  textoDeCantidad,
  tienePack,
} from '../utils/presentacion.js';
import PasarAPack from '../components/PasarAPack.jsx';
import FormasDeVenta, { ConUnidad, faltaEnFormas, FORMAS_VACIAS, formasDesdeProducto, formasParaApi } from '../components/FormasDeVenta.jsx';
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
// Rediseño 2026-10-29: cifras arriba; una sola hoja con datos, medida y formas de venta y el
// guardado al pie; los lotes en tabla con el ajuste manual debajo; eliminar al final.
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
  const [loteAEliminar, setLoteAEliminar] = useState(null);
  // Corregir un lote ya cargado (Administrador, 2026-10-31): cantidad, ingreso y vencimiento.
  const [loteAEditar, setLoteAEditar] = useState(null);
  const [edLote, setEdLote] = useState(null);
  const edLoteRef = useRef(null);
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
        ? `Este producto está registrado en «${detalle.unidad_medida}». Para convertirlo a unidad + ${envase.nombre.toLowerCase()} usá el botón «Pasar a unidad + ${envase.nombre.toLowerCase()}».`
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
      setError(`La cantidad no es válida${enPacks ? ': por caja o pack se ingresa un número entero' : ''}.`);
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

  function abrirEdicionLote(lote) {
    setLoteAEliminar(null);
    setLoteAEditar(lote);
    setEdLote({
      cantidad: textoDeCantidad(lote.cantidad, detalle.medida),
      fecha_ingreso: lote.fecha_ingreso,
      fecha_vencimiento: lote.fecha_vencimiento ?? '',
    });
  }

  function guardarLote(e) {
    e.preventDefault();
    const cantidad = parsearCantidad(edLote.cantidad, detalle.medida);
    if (!cantidad) {
      setError('La cantidad no es válida. Para dejar el lote en cero, eliminalo.');
      return;
    }
    return conGuardia(async () => {
      await api.patch(`/productos/${id}/lotes/${loteAEditar.id}`, {
        cantidad,
        fecha_ingreso: edLote.fecha_ingreso,
        fecha_vencimiento: edLote.fecha_vencimiento || null,
      });
      setLoteAEditar(null);
      await cargar();
      setExito('Lote corregido.');
    }, 'No se pudo corregir el lote.');
  }

  // El formulario va abajo de la tabla: con muchos lotes, que quede a la vista al abrirlo.
  useEffect(() => {
    if (loteAEditar) edLoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [loteAEditar]);

  function eliminarLote(loteId) {
    return conGuardia(async () => {
      try {
        await api.delete(`/productos/${id}/lotes/${loteId}`);
      } finally {
        setLoteAEliminar(null);
      }
      await cargar();
    }, 'No se pudo eliminar el lote.');
  }

  function eliminarProducto() {
    return conGuardia(async () => {
      try {
        await api.delete(`/productos/${id}`);
        navigate('/stock', { replace: true, state: { exito: `Producto «${detalle.nombre}» eliminado.` } });
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
        <MigaFicha />
        {error && <div className="alert alert-danger">{error}</div>}
      </div>
    );
  }

  const nombreProveedor = proveedores.find((p) => p.id === detalle.proveedor_id)?.nombre;
  const enPacks = tienePack(detalle) && nuevoLote.en_packs;
  const set = (campo) => (e) => setEdicion({ ...edicion, [campo]: e.target.value });
  const medidaVista = esAdmin ? formas.medida : detalle.medida;

  // Cifras de arriba: stock (con los packs abajo, o al revés si el stock se ve en packs),
  // mínimo y el vencimiento más cercano de sus lotes.
  const packsStock = describirPacks(detalle.stock_total, detalle);
  const verEnPacks = stockEnPacks && tienePack(detalle);
  const stockPrincipal = verEnPacks ? cantidadEnPacks(detalle.stock_total, detalle) : formatearCantidad(detalle.stock_total, detalle.medida);
  const stockSecundario = verEnPacks ? (packsStock ? formatearCantidad(detalle.stock_total, detalle.medida) : null) : packsStock;
  const proximo = detalle.lotes
    .filter((l) => l.fecha_vencimiento)
    .sort((a, b) => String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento)))[0];

  const categoriaTexto = detalle.categoria || '—';
  const proveedorTexto = nombreProveedor ?? (detalle.proveedor_id ? '—' : 'Sin proveedor');

  return (
    <div className="cliente-page producto-pagina">
      {/* El panel va primero, en el mismo lugar que en las demás pantallas; el nombre, debajo. */}
      <Hero
        etiqueta="Stock actual"
        valor={stockPrincipal}
        sub={detalle.alerta_stock_bajo ? `Por debajo del mínimo${stockSecundario ? ` · ${stockSecundario}` : ''}` : stockSecundario || null}
        minis={[
          {
            etiqueta: 'Stock mínimo',
            valor: formatearCantidad(detalle.stock_minimo ?? 0, detalle.medida),
            sub: detalle.alerta_stock_bajo ? 'Para reponer' : 'En orden',
            icono: detalle.alerta_stock_bajo ? 'alerta' : 'paquete',
            tono: detalle.alerta_stock_bajo ? 'rojo' : 'blanco',
          },
          {
            etiqueta: 'Próximo vencimiento',
            valor: proximo ? formatearFecha(proximo.fecha_vencimiento) : '—',
            sub: proximo
              ? `${proximo.vencido ? 'Vencido · ' : ''}Lote de ${describirStock(proximo.cantidad, detalle, stockEnPacks)}`
              : 'Sin lotes con vencimiento',
            icono: 'calendario',
            tono: proximo?.vencido ? 'rojo' : proximo ? 'amarillo' : 'verde',
          },
        ]}
      />

      <MigaFicha />
      <div className="cliente-encabezado">
        <h1 className="cliente-h1">{detalle.nombre}</h1>
        <div className="cliente-subtitulo">
          {[detalle.categoria, nombreProveedor, detalle.codigo_barras && `Código ${detalle.codigo_barras}`].filter(Boolean).join(' · ') ||
            'Sin categoría ni proveedor'}
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <form className="card producto-hoja" onSubmit={guardar}>
        <section className="producto-seccion">
          <h2 className="producto-seccion-titulo">Datos del producto</h2>
          <div className="producto-datos">
            <div className="field producto-campo-nombre">
              <label>Nombre</label>
              <input required disabled={!puedeEditar} value={edicion.nombre} onChange={set('nombre')} />
            </div>
            <div className="field producto-campo-codigo">
              <label>Código de barras</label>
              <input disabled={!puedeEditar} value={edicion.codigo_barras} onChange={set('codigo_barras')} />
            </div>
            <div className="field producto-campo-categoria">
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
                <div className="stock-campo-oculto">{categoriaTexto}</div>
              )}
            </div>
            <div className="field producto-campo-proveedor">
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
                <div className="stock-campo-oculto">{proveedorTexto}</div>
              )}
            </div>
            <div className="field producto-campo-minimo">
              <label>Stock mínimo</label>
              <ConUnidad sufijo={simboloMedida(medidaVista)}>
                <input
                  type="text"
                  inputMode={esFraccionable(medidaVista) ? 'decimal' : 'numeric'}
                  disabled={!puedeEditar}
                  value={edicion.stock_minimo}
                  onChange={set('stock_minimo')}
                />
              </ConUnidad>
            </div>
            <div className="field producto-campo-aviso">
              <label>Aviso de vencimiento</label>
              <ConUnidad sufijo="días antes">
                <input
                  type="number"
                  min="0"
                  placeholder="Sin aviso"
                  disabled={!puedeEditar}
                  value={edicion.dias_aviso_vencimiento}
                  onChange={set('dias_aviso_vencimiento')}
                />
              </ConUnidad>
            </div>
          </div>
        </section>

        <section className="producto-seccion">
          <h2 className="producto-seccion-titulo">Medida y formas de venta</h2>
          {cargadoConEnvase(detalle) && !pasandoAPack && (
            <AvisoEnvase unidad={detalle.unidad_medida} envase={envaseEnNombre(detalle.unidad_medida)}>
              {esAdmin ? (
                <button type="button" className="btn btn-primary" onClick={() => setPasandoAPack(true)}>
                  Pasar a unidad + {envaseEnNombre(detalle.unidad_medida).nombre.toLowerCase()}
                </button>
              ) : (
                <span className="stock-hint">Solo el Administrador puede convertirlo a unidad + caja.</span>
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
                setExito(`Producto convertido. El stock quedó en ${describirStockLargo(actualizado.stock_total, actualizado, stockEnPacks)}.`);
              }}
            />
          )}
          {!cargadoConEnvase(detalle) && (
            <FormasDeVenta
              valor={formas}
              onChange={setFormas}
              editablePrecios={esAdmin}
              verCosto={esAdmin}
              medidaBloqueada={detalle.lotes.length > 0 ? 'No se puede cambiar: el producto ya tiene lotes cargados.' : null}
            />
          )}
        </section>

        {puedeEditar && (
          <div className="producto-pie">
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        )}
      </form>

      <section className="card cliente-card producto-lotes">
        <div className="cliente-seccion-cabecera">
          <h2 className="producto-seccion-titulo">Lotes</h2>
          <span className="producto-contador">
            {detalle.lotes.length} {detalle.lotes.length === 1 ? 'lote' : 'lotes'}
          </span>
        </div>
        {detalle.lotes.length === 0 ? (
          <div className="cliente-vacio">Sin lotes registrados.</div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla producto-lotes-tabla">
              <thead>
                <tr>
                  <th>Ingreso</th>
                  <th>Vencimiento</th>
                  {puedeEditar && <th>Origen</th>}
                  <th className="num">Cantidad</th>
                  {puedeEditar && <th className="accion" aria-label="Acciones" />}
                </tr>
              </thead>
              <tbody>
                {detalle.lotes.map((lote) => (
                  <tr key={lote.id} className="sin-click">
                    <td className="producto-td-ingreso" data-label="Ingreso">
                      <ConIcono icono={lote.vencido ? 'alerta' : 'calendario'} color={lote.vencido ? COLOR.rojo : COLOR.teal}>
                        {formatearFecha(lote.fecha_ingreso)}
                      </ConIcono>
                    </td>
                    <td className="producto-td-vence" data-label="Vencimiento">
                      <span className="producto-vence">
                        {lote.fecha_vencimiento ? formatearFecha(lote.fecha_vencimiento) : <span className="stock-falta">—</span>}
                        {lote.vencido && <span className="stock-badge-vencido">Vencido</span>}
                      </span>
                    </td>
                    {/* De qué proveedor y remito vino: el Cajero no tiene acceso a Proveedores. */}
                    {puedeEditar && (
                      <td className="producto-td-origen">
                        {lote.compra ? (
                          <>
                            <Link className="producto-origen" to={`/proveedores/${lote.compra.proveedor_id}`}>
                              {lote.compra.proveedor_nombre}
                            </Link>
                            <div className="cliente-td-sub">{textoComprobante(lote.compra)}</div>
                          </>
                        ) : (
                          <span className="producto-origen-manual">Ingreso manual</span>
                        )}
                      </td>
                    )}
                    <td className="num producto-td-cantidad" data-label="Cantidad">
                      {describirStock(lote.cantidad, detalle, stockEnPacks)}
                    </td>
                    {puedeEditar && (
                      <td className="accion">
                        {esAdmin && (
                          <button
                            type="button"
                            className={`boton-icono${loteAEditar?.id === lote.id ? ' activo' : ''}`}
                            title="Corregir lote"
                            aria-label={`Corregir el lote ingresado el ${formatearFecha(lote.fecha_ingreso)}`}
                            disabled={guardando}
                            onClick={() => (loteAEditar?.id === lote.id ? setLoteAEditar(null) : abrirEdicionLote(lote))}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                            </svg>
                          </button>
                        )}
                        <button
                          type="button"
                          className="boton-icono boton-icono-peligro"
                          title="Eliminar lote"
                          aria-label="Eliminar lote"
                          disabled={guardando}
                          onClick={() => {
                            setLoteAEditar(null);
                            setLoteAEliminar(lote);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

        {/* Corregir un lote, abajo de la tabla como la confirmación de eliminar (2026-10-31). */}
        {loteAEditar && edLote && (
          <form ref={edLoteRef} className="card producto-lote-confirm producto-lote-editar" onSubmit={guardarLote}>
            <div className="producto-seccion-cabecera">
              <h3 className="producto-subtitulo">Corregir el lote ingresado el {formatearFecha(loteAEditar.fecha_ingreso)}</h3>
              <p className="producto-seccion-ayuda">
                Hoy tiene {describirStock(loteAEditar.cantidad, detalle, stockEnPacks)}. Las ventas ya hechas
                {loteAEditar.compra ? ' y la boleta del proveedor' : ''} no cambian.
              </p>
            </div>
            <div className="producto-campos-ingreso">
              <div className="field">
                <label htmlFor="lote-editar-cantidad">Cantidad</label>
                <ConUnidad sufijo={simboloMedida(detalle.medida)}>
                  <input
                    id="lote-editar-cantidad"
                    required
                    type="text"
                    inputMode={esFraccionable(detalle.medida) ? 'decimal' : 'numeric'}
                    value={edLote.cantidad}
                    onChange={(e) => setEdLote({ ...edLote, cantidad: e.target.value })}
                  />
                </ConUnidad>
              </div>
              <div className="field">
                <label htmlFor="lote-editar-ingreso">Fecha de ingreso</label>
                <input
                  id="lote-editar-ingreso"
                  required
                  type="date"
                  value={edLote.fecha_ingreso}
                  onChange={(e) => setEdLote({ ...edLote, fecha_ingreso: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="lote-editar-vence">Vencimiento (opcional)</label>
                <input
                  id="lote-editar-vence"
                  type="date"
                  value={edLote.fecha_vencimiento}
                  onChange={(e) => setEdLote({ ...edLote, fecha_vencimiento: e.target.value })}
                />
              </div>
            </div>
            <div className="producto-ajuste-pie">
              <CuentaIngreso
                cantidad={edLote.cantidad}
                enPacks={false}
                producto={detalle}
                stockActual={detalle.stock_total - loteAEditar.cantidad}
                textoFinal="el stock del producto queda en"
              />
              <button type="button" className="btn" onClick={() => setLoteAEditar(null)}>
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  guardando ||
                  (parsearCantidad(edLote.cantidad, detalle.medida) === loteAEditar.cantidad &&
                    edLote.fecha_ingreso === loteAEditar.fecha_ingreso &&
                    edLote.fecha_vencimiento === (loteAEditar.fecha_vencimiento ?? ''))
                }
              >
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        )}

        {/* El tacho de un lote pide confirmación antes de borrar (2026-10-29). */}
        {loteAEliminar && (
          <div className="card producto-eliminar-confirm producto-lote-confirm">
            <span>
              ¿Eliminar el lote de {describirStock(loteAEliminar.cantidad, detalle, stockEnPacks)} ingresado el{' '}
              {formatearFecha(loteAEliminar.fecha_ingreso)}? Su cantidad sale del stock.
            </span>
            <div className="cliente-acciones">
              <button type="button" className="btn" onClick={() => setLoteAEliminar(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-peligro" disabled={guardando} onClick={() => eliminarLote(loteAEliminar.id)}>
                Eliminar lote
              </button>
            </div>
          </div>
        )}

        {puedeEditar && (
          <form className="producto-ajuste" onSubmit={agregarLote}>
            <div className="producto-seccion-cabecera">
              <h3 className="producto-subtitulo">Ajuste manual de stock</h3>
              <p className="producto-seccion-ayuda">
                Para ajustes o mercadería sin proveedor. Las compras se registran en Proveedores → Ingresar mercadería.
              </p>
            </div>
            <div className="producto-campos-ingreso">
              {tienePack(detalle) && (
                <div className="field producto-cargar-en">
                  <label>Cargar en</label>
                  <SelectorEnPacks
                    enPacks={nuevoLote.en_packs}
                    packNombre={etiquetaPack(detalle.pack_nombre, detalle.pack_unidades, detalle.medida)}
                    medida={detalle.medida}
                    onChange={(v) => setNuevoLote({ ...nuevoLote, en_packs: v })}
                  />
                </div>
              )}
              <div className="field">
                <label>Cantidad</label>
                <ConUnidad sufijo={enPacks ? plural(detalle.pack_nombre, 2) : simboloMedida(detalle.medida)}>
                  <input
                    required
                    type="text"
                    inputMode={esFraccionable(detalle.medida) && !enPacks ? 'decimal' : 'numeric'}
                    value={nuevoLote.cantidad}
                    onChange={(e) => setNuevoLote({ ...nuevoLote, cantidad: e.target.value })}
                  />
                </ConUnidad>
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
            <div className="producto-ajuste-pie">
              <CuentaIngreso cantidad={nuevoLote.cantidad} enPacks={nuevoLote.en_packs} producto={detalle} stockActual={detalle.stock_total} />
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                Ingresar stock
              </button>
            </div>
          </form>
        )}
      </section>

      {esAdmin && (
        <div className="producto-eliminar">
          {!confirmandoEliminar ? (
            <button type="button" className="cliente-eliminar-link" onClick={() => setConfirmandoEliminar(true)}>
              Eliminar producto
            </button>
          ) : (
            <div className="card producto-eliminar-confirm">
              <span>¿Eliminar «{detalle.nombre}»? No se puede deshacer desde el sistema.</span>
              <div className="cliente-acciones">
                <button type="button" className="btn" onClick={() => setConfirmandoEliminar(false)}>
                  Cancelar
                </button>
                <button type="button" className="btn btn-peligro" disabled={guardando} onClick={eliminarProducto}>
                  Eliminar producto
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
