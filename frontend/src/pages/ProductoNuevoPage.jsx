import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { fechaHoyISO } from '../utils/format.js';
import { esFraccionable, etiquetaPack, plural, simboloMedida, tienePack } from '../utils/presentacion.js';
import FormasDeVenta, { ConUnidad, faltaEnFormas, FORMAS_VACIAS, formasParaApi } from '../components/FormasDeVenta.jsx';
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
// Rediseño 2026-10-29: una sola hoja (datos, medida y formas de venta, stock inicial) con las
// acciones al pie y el error junto a ellas.
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
  const nombrePack = formas.pack.nombre.trim() || 'Pack';

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
          ? `La cantidad del stock inicial no es válida${enPacks ? ': por caja o pack se ingresa un número entero' : ''}.`
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
        <h1 className="cliente-h1">Nuevo producto</h1>
      </div>

      <form className="card producto-hoja producto-hoja-alta" onSubmit={crear}>
        <section className="producto-seccion">
          <h2 className="producto-seccion-titulo">Datos del producto</h2>
          <div className="producto-datos">
            <div className="field producto-campo-nombre">
              <label>Nombre</label>
              <input required value={producto.nombre} onChange={set('nombre')} />
            </div>
            <div className="field producto-campo-codigo">
              <label>Código de barras</label>
              <input placeholder="Opcional" value={producto.codigo_barras} onChange={set('codigo_barras')} />
            </div>
            <div className="field producto-campo-categoria">
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
            <div className="field producto-campo-proveedor">
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
            <div className="field producto-campo-minimo">
              <label>Stock mínimo</label>
              <ConUnidad sufijo={simboloMedida(formas.medida)}>
                <input
                  type="text"
                  inputMode={esFraccionable(formas.medida) ? 'decimal' : 'numeric'}
                  placeholder="0"
                  value={producto.stock_minimo}
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
                  value={producto.dias_aviso_vencimiento}
                  onChange={set('dias_aviso_vencimiento')}
                />
              </ConUnidad>
            </div>
          </div>
        </section>

        <section className="producto-seccion">
          <h2 className="producto-seccion-titulo">Medida y formas de venta</h2>
          <FormasDeVenta valor={formas} onChange={setFormas} editablePrecios verCosto />
        </section>

        {/* El stock inicial va último: depende de la caja o pack elegido arriba. */}
        <section className="producto-seccion">
          <div className="producto-seccion-cabecera">
            <h2 className="producto-seccion-titulo">
              Stock inicial <span className="producto-opcional">(opcional)</span>
            </h2>
            <p className="producto-seccion-ayuda">
              Si ya hay mercadería en el depósito. Las compras a proveedores se registran en Proveedores → Ingresar mercadería.
            </p>
          </div>
          <div className="producto-campos-ingreso">
            {conPack && (
              <div className="field producto-cargar-en">
                <label>Cargar en</label>
                <SelectorEnPacks
                  enPacks={lote.en_packs}
                  packNombre={etiquetaPack(nombrePack, productoForm.pack_unidades, formas.medida)}
                  medida={formas.medida}
                  onChange={(v) => setLote({ ...lote, en_packs: v })}
                />
              </div>
            )}
            <div className="field">
              <label>Cantidad</label>
              <ConUnidad sufijo={enPacks ? plural(nombrePack, 2) : simboloMedida(formas.medida)}>
                <input
                  type="text"
                  inputMode={esFraccionable(formas.medida) && !enPacks ? 'decimal' : 'numeric'}
                  placeholder="Sin stock inicial"
                  value={lote.cantidad}
                  onChange={(e) => setLote({ ...lote, cantidad: e.target.value })}
                />
              </ConUnidad>
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
          <CuentaIngreso cantidad={lote.cantidad} enPacks={lote.en_packs} producto={productoForm} textoFinal={null} />
        </section>

        <div className="producto-pie">
          {error && <div className="alert alert-danger producto-pie-error">{error}</div>}
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
