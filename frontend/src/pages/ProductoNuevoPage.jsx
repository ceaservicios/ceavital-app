import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { fechaHoyISO } from '../utils/format.js';
import { esFraccionable, etiquetaPack, simboloMedida, tienePack } from '../utils/presentacion.js';
import FormasDeVenta, { faltaEnFormas, FORMAS_VACIAS, formasParaApi } from '../components/FormasDeVenta.jsx';
import {
  cantidadParaApi,
  CuentaIngreso,
  LOTE_INICIAL_VACIO,
  minimoParaApi,
  PRODUCTO_VACIO,
  PUEDE_EDITAR_STOCK,
  productoDelFormulario,
  SelectorEnPacks,
  useCatalogosStock,
} from './stockComun.jsx';
import './ClientesEmpresaPage.css';
import './StockPage.css';

// Alta de producto en una página propia, con todos los campos a la vista (2026-10-28; antes era
// un panel angosto al costado de la lista). Solo Admin y Encargado (la ruta lo controla).
export default function ProductoNuevoPage() {
  const { usuario } = useAuth();
  // El Cajero no crea productos: vuelve a la lista (el servidor tampoco lo deja).
  if (!PUEDE_EDITAR_STOCK.has(usuario?.rol)) return <Navigate to="/stock" replace />;
  return <FormularioProductoNuevo />;
}

function FormularioProductoNuevo() {
  const navigate = useNavigate();
  const { proveedores, categorias } = useCatalogosStock(true);
  const [producto, setProducto] = useState(PRODUCTO_VACIO);
  const [formas, setFormas] = useState(FORMAS_VACIAS);
  const [lote, setLote] = useState(LOTE_INICIAL_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  // Guardia sincrónica contra doble submit (con dos clicks se duplicaba el producto).
  const guardaRef = useRef(false);

  const set = (campo) => (e) => setProducto({ ...producto, [campo]: e.target.value });
  const productoForm = productoDelFormulario(formas);
  const conPack = tienePack(productoForm);
  const enPacks = conPack && lote.en_packs;

  async function crear(e) {
    e.preventDefault();
    if (guardaRef.current) return;
    const hayLote = String(lote.cantidad).trim() !== '';
    const cantidadLote = hayLote ? cantidadParaApi(lote.cantidad, enPacks, productoForm) : null;
    const stockMinimo = minimoParaApi(producto.stock_minimo, formas.medida);
    // Un precio en blanco no se manda (Number('') es 0 y quedaba guardado como $0).
    const falta =
      faltaEnFormas(formas) ??
      (stockMinimo === null
        ? 'El stock mínimo no es un número válido.'
        : hayLote && !cantidadLote
          ? `La cantidad del lote inicial no es válida${enPacks ? ' (en packs va un número entero)' : ''}.`
          : null);
    if (falta) {
      setError(falta);
      return;
    }
    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      const payload = {
        nombre: producto.nombre,
        categoria_id: producto.categoria_id === '' ? null : Number(producto.categoria_id),
        codigo_barras: producto.codigo_barras || null,
        proveedor_id: producto.proveedor_id === '' ? null : Number(producto.proveedor_id),
        stock_minimo: stockMinimo,
        dias_aviso_vencimiento: producto.dias_aviso_vencimiento === '' ? null : Number(producto.dias_aviso_vencimiento),
        ...formasParaApi(formas),
      };
      if (cantidadLote) {
        payload.lote_inicial = {
          cantidad: cantidadLote,
          en_packs: enPacks,
          fecha_ingreso: lote.fecha_ingreso || fechaHoyISO(),
          fecha_vencimiento: lote.fecha_vencimiento || null,
        };
      }
      const creado = await api.post('/productos', payload);
      navigate(`/stock/${creado.id}`, { replace: true, state: { exito: 'Producto creado.' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el producto.');
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <div className="cliente-page producto-pagina">
      <div className="cliente-encabezado">
        <Link to="/stock" className="cliente-volver">
          ← Volver a stock
        </Link>
        <h1 className="cliente-h1">Nuevo producto</h1>
      </div>

      <form className="producto-form" onSubmit={crear}>
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="producto-columnas">
          <div className="producto-columna">
            <div className="card cliente-card">
              <span className="cliente-seccion-titulo">Datos del producto</span>
              <div className="cliente-campos">
                <div className="field cliente-campo-full">
                  <label>Nombre *</label>
                  <input required value={producto.nombre} onChange={set('nombre')} />
                </div>
                <div className="field">
                  <label>Categoría</label>
                  <select value={producto.categoria_id} onChange={set('categoria_id')}>
                    <option value="">Sin categoría</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                  {categorias.length === 0 && <span className="stock-hint">Las categorías se crean en Configuración.</span>}
                </div>
                <div className="field">
                  <label>Código de barras</label>
                  <input value={producto.codigo_barras} onChange={set('codigo_barras')} />
                </div>
                <div className="field">
                  <label>Proveedor</label>
                  <select value={producto.proveedor_id} onChange={set('proveedor_id')}>
                    <option value="">Sin proveedor</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>
                    Stock mínimo <span className="stock-label-unidad">en {simboloMedida(formas.medida)}</span>
                  </label>
                  <input
                    type="text"
                    inputMode={esFraccionable(formas.medida) ? 'decimal' : 'numeric'}
                    placeholder="0"
                    value={producto.stock_minimo}
                    onChange={set('stock_minimo')}
                  />
                </div>
                <div className="field">
                  <label>Días de aviso de vencimiento</label>
                  <input type="number" min="0" value={producto.dias_aviso_vencimiento} onChange={set('dias_aviso_vencimiento')} />
                </div>
              </div>
            </div>

            <div className="card cliente-card">
              <span className="cliente-seccion-titulo">Stock inicial (opcional)</span>
              <span className="cliente-hint">
                Si ya tenés mercadería de este producto. La que trae un proveedor se carga desde Proveedores → Cargar mercadería.
              </span>
              {conPack && (
                <SelectorEnPacks
                  enPacks={lote.en_packs}
                  packNombre={formas.pack.nombre.trim()}
                  medida={formas.medida}
                  onChange={(v) => setLote({ ...lote, en_packs: v })}
                />
              )}
              <div className="cliente-campos">
                <div className="field">
                  <label>
                    {enPacks
                      ? `Cantidad (en ${etiquetaPack(formas.pack.nombre.trim() || 'Pack', productoForm.pack_unidades, formas.medida)})`
                      : `Cantidad (en ${simboloMedida(formas.medida)})`}
                  </label>
                  <input
                    type="text"
                    inputMode={esFraccionable(formas.medida) && !enPacks ? 'decimal' : 'numeric'}
                    placeholder="Vacío si todavía no hay stock"
                    value={lote.cantidad}
                    onChange={(e) => setLote({ ...lote, cantidad: e.target.value })}
                  />
                  <CuentaIngreso cantidad={lote.cantidad} enPacks={lote.en_packs} producto={productoForm} textoFinal={null} />
                </div>
                <div className="field">
                  <label>Fecha de ingreso</label>
                  <input type="date" value={lote.fecha_ingreso} onChange={(e) => setLote({ ...lote, fecha_ingreso: e.target.value })} />
                </div>
                <div className="field">
                  <label>Vencimiento (opcional)</label>
                  <input
                    type="date"
                    value={lote.fecha_vencimiento}
                    onChange={(e) => setLote({ ...lote, fecha_vencimiento: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="card cliente-card producto-columna">
            <span className="cliente-seccion-titulo">Cómo se mide y cómo se vende</span>
            <FormasDeVenta valor={formas} onChange={setFormas} editablePrecios verCosto />
          </div>
        </div>

        <div className="cliente-acciones">
          <button type="button" className="btn" onClick={() => navigate('/stock')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear producto'}
          </button>
        </div>
      </form>
    </div>
  );
}
