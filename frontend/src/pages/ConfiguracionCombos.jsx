import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearMonto } from '../utils/format.js';
import {
  esFraccionable,
  etiquetaPack,
  factorMedida,
  parsearCantidad,
  plural,
  porMedida,
  precioNormalCombo,
  simboloMedida,
  sufijoPrecio,
  textoDeCantidad,
  tienePack,
  vendeSuelto,
} from '../utils/presentacion.js';
import { alternarEn, TarjetaPromo } from './promocionesComun.jsx';

// Configuración → Promociones → Combos (pedidos del usuario, 2026-11-01; aprobó la maqueta). Solo el
// Administrador. Cada combo es una tarjeta desplegable con sus productos en una tabla, uno por fila,
// con su forma, su cantidad y su precio en la promo, que arranca con el precio normal del producto
// (el del pack o el de la unidad, el kg o el litro) y se cambia ahí mismo. Ese precio vale solo para
// el combo: "No debe cambiar el valor en el sistema. Es solo un apartado. El stock sí, pero precio
// no". El precio del combo es la suma de las filas.

const MAX_SUGERENCIAS = 6;

const soloDigitos = (texto) => texto.replace(/\D/g, '');

// Productos que coinciden con lo que se tipea, por nombre o por código.
function buscar(productos, busqueda) {
  const texto = busqueda.trim().toLowerCase();
  if (!texto) return [];
  return productos
    .filter(
      (p) =>
        p.nombre.toLowerCase().includes(texto) ||
        p.codigo_barras?.toLowerCase() === texto ||
        p.codigo_barras_pack?.toLowerCase() === texto
    )
    .slice(0, MAX_SUGERENCIAS);
}

const etiquetaSuelto = (medida) => (esFraccionable(medida) ? `Por ${simboloMedida(medida)}` : 'Unidad');

// Formas en que se vende un producto: las mismas que en Caja (y la que tiene ahora, aunque ya no se
// venda así, para que se vea qué hay que corregir).
function formasDeProducto(producto, actual = null) {
  const formas = [];
  if (vendeSuelto(producto) || actual === 'unidad') formas.push({ presentacion: 'unidad', etiqueta: etiquetaSuelto(producto.medida) });
  if (tienePack(producto) || actual === 'pack') {
    formas.push({
      presentacion: 'pack',
      etiqueta: tienePack(producto) ? etiquetaPack(producto.pack_nombre, producto.pack_unidades, producto.medida) : 'Caja o pack',
    });
  }
  return formas;
}

// Precio normal del producto en esa forma (el de Caja y Stock): el del pack, o el de la unidad, el kg o el litro.
const precioNormal = (producto, presentacion) => (presentacion === 'pack' ? producto.precio_pack : producto.precio_venta);

// "por unidad", "por kg", "por pack".
const porCadaForma = (producto, presentacion) =>
  presentacion === 'pack' ? `por ${String(producto.pack_nombre || 'pack').toLowerCase()}` : porMedida(producto.medida);

// Cantidad × precio (en kg o litro, la cantidad viene en gramos o mililitros).
function subtotalDeForma(producto, presentacion, cantidad, precio) {
  if (!cantidad || precio == null) return null;
  return presentacion === 'pack' ? cantidad * precio : Math.round((cantidad * precio) / factorMedida(producto.medida));
}

const textoDePrecio = (precio) => (precio == null ? '' : String(precio));

// "unidades", "kg", "cajas": lo que va al lado de la cantidad.
function unidadDeCantidad(presentacion, medida, packNombre, cantidad) {
  if (presentacion === 'pack') return packNombre ? plural(packNombre, cantidad ?? 2) : 'cajas o packs';
  return simboloMedida(medida, cantidad ?? 2);
}

// En packs y en unidades la cantidad es entera; en kg o litro se tipea con decimales.
const medidaDeCantidad = (presentacion, medida) => (presentacion === 'pack' ? 'unidad' : medida);

function CampoCantidad({ presentacion, medida, packNombre, texto, onTexto, etiqueta }) {
  return (
    <span className="combo-cantidad">
      <input
        className="combo-control combo-control-cantidad"
        type="text"
        inputMode={presentacion !== 'pack' && esFraccionable(medida) ? 'decimal' : 'numeric'}
        aria-label={etiqueta}
        value={texto}
        onChange={(e) => onTexto(e.target.value)}
      />
      <span className="combo-unidad">
        {unidadDeCantidad(presentacion, medida, packNombre, parsearCantidad(texto, medidaDeCantidad(presentacion, medida)))}
      </span>
    </span>
  );
}

// Un producto del combo: forma, cantidad y precio en la promo se cambian acá mismo. El precio vale
// solo para el combo: el del producto en Caja y en Stock no cambia.
function FilaProducto({ renglon, combo, ocupado, onAccion }) {
  const producto = renglon.productos[0];
  const medida = producto.medida;
  const [presentacion, setPresentacion] = useState(renglon.presentacion);
  const [cantidadTexto, setCantidadTexto] = useState(textoDeCantidad(renglon.cantidad, medidaDeCantidad(renglon.presentacion, medida)));
  // Un precio por forma: al pasar de unidad a pack, el campo arranca con el precio normal del pack.
  const [precios, setPrecios] = useState(() => ({
    unidad: textoDePrecio(renglon.presentacion === 'unidad' ? renglon.precio : producto.precio_venta),
    pack: textoDePrecio(renglon.presentacion === 'pack' ? renglon.precio : producto.precio_pack),
  }));
  const cantidad = parsearCantidad(cantidadTexto, medidaDeCantidad(presentacion, medida));
  const precio = precios[presentacion] === '' ? null : Number(precios[presentacion]);
  const normal = precioNormal(producto, presentacion);
  const cambio = presentacion !== renglon.presentacion || cantidad !== renglon.cantidad || precio !== renglon.precio;
  const subtotal = subtotalDeForma(producto, presentacion, cantidad, precio);

  return (
    <div className="promo-fila promo-fila-combo">
      <span className="promo-fila-producto">
        <strong>{producto.producto_nombre}</strong>
        {producto.problema && <span className="promo-aviso">{producto.problema}: el combo no se cobra hasta corregirlo.</span>}
      </span>
      <select
        className="combo-control"
        aria-label={`Cómo se vende ${producto.producto_nombre} en el combo`}
        value={presentacion}
        onChange={(e) => setPresentacion(e.target.value)}
      >
        {formasDeProducto(producto, renglon.presentacion).map((f) => (
          <option key={f.presentacion} value={f.presentacion}>
            {f.etiqueta}
          </option>
        ))}
      </select>
      <CampoCantidad
        presentacion={presentacion}
        medida={medida}
        packNombre={producto.pack_nombre}
        texto={cantidadTexto}
        onTexto={setCantidadTexto}
        etiqueta={`Cantidad de ${producto.producto_nombre}`}
      />
      {/* Una línea por celda (pedido del usuario: "que quede la fila simétricamente bien"): la forma ya
          la dice "Se vende por"; en kg o litro el precio normal lleva "/kg" o "/L". */}
      <span className="combo-monto combo-normal">
        {normal != null ? `${formatearMonto(normal)}${presentacion === 'pack' ? '' : sufijoPrecio(medida)}` : '—'}
      </span>
      <span className="combo-monto combo-promo">
        <span className="combo-precio-fila">
          $
          <input
            className="combo-control combo-control-precio"
            inputMode="numeric"
            aria-label={`Precio en la promo de ${producto.producto_nombre} ${porCadaForma(producto, presentacion)}`}
            value={precios[presentacion]}
            onChange={(e) => setPrecios((p) => ({ ...p, [presentacion]: soloDigitos(e.target.value) }))}
          />
        </span>
      </span>
      <span className="combo-monto combo-subtotal">{subtotal != null ? formatearMonto(subtotal) : '—'}</span>
      <span className="promo-fila-acciones">
        {cambio && (
          <button
            type="button"
            className="btn btn-primary promo-btn-chico"
            disabled={ocupado || !cantidad || precio == null}
            onClick={() => onAccion(() => api.patch(`/combos/${combo.id}/renglones/${renglon.id}`, { presentacion, cantidad, precio }))}
          >
            Guardar
          </button>
        )}
        <button
          type="button"
          className="config-catalogo-accion config-catalogo-accion-danger promo-sacar"
          disabled={ocupado}
          onClick={() => onAccion(() => api.delete(`/combos/${combo.id}/renglones/${renglon.id}`))}
        >
          Sacar
        </button>
      </span>
    </div>
  );
}

// Debajo de la tabla: el precio del combo, que es la suma de los subtotales.
function TotalDelCombo({ combo }) {
  return (
    <div className="combo-precio-final">
      <span className="combo-precio-final-rotulo">
        Precio del combo
        <span className="combo-monto-por">la suma de los productos</span>
      </span>
      <strong className="combo-precio-final-valor">{formatearMonto(combo.precio)}</strong>
    </div>
  );
}

// Un producto encontrado para sumar al combo: se elige la forma y la cantidad, y se agrega con su
// precio normal (después se cambia en la tabla).
function NuevoProducto({ producto, combo, ocupado, onAccion, onAgregado }) {
  const formas = formasDeProducto(producto);
  const [presentacion, setPresentacion] = useState(formas[0]?.presentacion ?? 'unidad');
  const [cantidadTexto, setCantidadTexto] = useState('1');
  const cantidad = parsearCantidad(cantidadTexto, medidaDeCantidad(presentacion, producto.medida));

  return (
    <div className="promo-fila">
      <span className="promo-fila-producto">
        <strong>{producto.nombre}</strong>
      </span>
      <select
        className="combo-control"
        aria-label={`Cómo va ${producto.nombre} en el combo`}
        value={presentacion}
        onChange={(e) => setPresentacion(e.target.value)}
      >
        {formas.map((f) => (
          <option key={f.presentacion} value={f.presentacion}>
            {f.etiqueta}
          </option>
        ))}
      </select>
      <CampoCantidad
        presentacion={presentacion}
        medida={producto.medida}
        packNombre={producto.pack_nombre}
        texto={cantidadTexto}
        onTexto={setCantidadTexto}
        etiqueta={`Cantidad de ${producto.nombre} en el combo`}
      />
      <span className="promo-fila-acciones">
        <button
          type="button"
          className="btn btn-primary promo-btn-chico"
          disabled={ocupado || !cantidad || formas.length === 0}
          onClick={() =>
            onAccion(
              () =>
                api.post(`/combos/${combo.id}/renglones`, {
                  producto_id: producto.id,
                  presentacion,
                  cantidad,
                  precio: precioNormal(producto, presentacion),
                }),
              onAgregado
            )
          }
        >
          Agregar
        </button>
      </span>
    </div>
  );
}

function Combo({ combo, productos, abierta, onAlternar, ocupado, onAccion }) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(combo.nombre);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  const n = combo.renglones.length;
  const { min: porSeparado } = precioNormalCombo(combo.renglones);
  const encontrados = buscar(productos, busqueda);

  function cancelarEdicion() {
    setEditando(false);
    setNombre(combo.nombre);
  }

  // "Editar" cambia solo el nombre: el precio es la suma de los productos.
  const reemplazo = editando ? (
    <>
      <input
        className="config-catalogo-input-edicion"
        aria-label="Nombre del combo"
        maxLength={60}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
      />
      <div className="config-catalogo-botones">
        <button type="button" className="btn" onClick={cancelarEdicion}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={ocupado || !nombre.trim()}
          onClick={() => onAccion(() => api.patch(`/combos/${combo.id}`, { nombre }), () => setEditando(false))}
        >
          Guardar
        </button>
      </div>
    </>
  ) : confirmandoEliminar ? (
    <>
      <span className="config-catalogo-nombre">
        ¿Eliminar el combo "{combo.nombre}"?
        <span className="promo-resumen">Deja de cobrarse en Caja. Las ventas ya hechas no cambian.</span>
      </span>
      <div className="config-catalogo-botones">
        <button type="button" className="btn" onClick={() => setConfirmandoEliminar(false)}>
          Cancelar
        </button>
        <button type="button" className="btn btn-peligro" disabled={ocupado} onClick={() => onAccion(() => api.delete(`/combos/${combo.id}`))}>
          Eliminar
        </button>
      </div>
    </>
  ) : null;

  return (
    <TarjetaPromo
      id={combo.id}
      icono="rayo"
      abierta={abierta}
      onAlternar={onAlternar}
      titulo={combo.nombre}
      precio={formatearMonto(combo.precio)}
      resumen={
        n === 0 ? 'Sin productos todavía' : `${n} ${n === 1 ? 'producto' : 'productos'} · por separado ${formatearMonto(porSeparado)}`
      }
      aviso={n > 0 && !combo.vigente ? 'No se cobra en Caja hasta que corrijas el producto marcado.' : null}
      reemplazo={reemplazo}
      acciones={
        <>
          <button type="button" className="config-catalogo-accion" onClick={() => setEditando(true)}>
            Editar
          </button>
          <button type="button" className="config-catalogo-accion config-catalogo-accion-danger" onClick={() => setConfirmandoEliminar(true)}>
            Eliminar
          </button>
        </>
      }
    >
      <span className="promo-cuerpo-titulo">Lo que lleva el combo</span>
      {n === 0 ? (
        <span className="promo-sumar-ayuda">Todavía no lleva nada: agregá el primer producto.</span>
      ) : (
        <div className="promo-tabla">
          <div className="promo-fila promo-fila-combo promo-tabla-cabeza" aria-hidden="true">
            <span>Producto</span>
            <span>Se vende por</span>
            <span>Cantidad</span>
            <span className="combo-monto">Precio normal</span>
            <span className="combo-monto">Precio en la promo</span>
            <span className="combo-monto">Subtotal</span>
            <span />
          </div>
          {combo.renglones.map((r) => (
            // La clave cambia al guardar: la fila vuelve a arrancar con lo guardado.
            <FilaProducto
              key={`${r.id}-${r.presentacion}-${r.cantidad}-${r.precio}`}
              renglon={r}
              combo={combo}
              ocupado={ocupado}
              onAccion={onAccion}
            />
          ))}
        </div>
      )}
      {n > 0 && <TotalDelCombo combo={combo} />}

      {agregando ? (
        <div className="promo-panel">
          <div className="promo-panel-cabeza">
            <input
              type="search"
              className="combo-control promo-panel-buscar"
              aria-label={`Buscar un producto para sumar a ${combo.nombre}`}
              placeholder="Buscar el producto, por nombre o código"
              value={busqueda}
              autoFocus
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <button
              type="button"
              className="config-catalogo-accion"
              onClick={() => {
                setAgregando(false);
                setBusqueda('');
              }}
            >
              Cerrar
            </button>
          </div>
          {busqueda.trim() && encontrados.length === 0 && <span className="promo-sumar-ayuda">No hay productos que coincidan.</span>}
          {encontrados.length > 0 && (
            <div className="promo-tabla">
              {encontrados.map((p) => (
                <NuevoProducto
                  key={p.id}
                  producto={p}
                  combo={combo}
                  ocupado={ocupado}
                  onAccion={onAccion}
                  onAgregado={() => {
                    setBusqueda('');
                    setAgregando(false);
                  }}
                />
              ))}
            </div>
          )}
          {!busqueda.trim() && (
            <span className="promo-sumar-ayuda">
              Elegí si va por unidad, kg, caja o pack, y cuántos. Entra con su precio normal: después lo cambiás en la tabla.
            </span>
          )}
        </div>
      ) : (
        <div>
          <button type="button" className="btn promo-btn-chico" onClick={() => setAgregando(true)}>
            + Agregar producto
          </button>
        </div>
      )}
    </TarjetaPromo>
  );
}

export default function SeccionCombos() {
  const [combos, setCombos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [ocupado, setOcupado] = useState(false);
  // Guardia sincrónica contra el doble click: `disabled={ocupado}` no alcanza en el mismo tick.
  const ocupadoRef = useRef(false);

  async function cargar() {
    const [c, p] = await Promise.all([api.get('/combos'), api.get('/productos')]);
    setCombos(c.items);
    setProductos(p.productos);
  }

  useEffect(() => {
    cargar()
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los combos.'))
      .finally(() => setCargando(false));
  }, []);

  // Toda escritura: corre el pedido, vuelve a cargar y, si salió bien, `despues` con lo que devolvió.
  async function accion(pedido, despues) {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOcupado(true);
    setError(null);
    try {
      const respuesta = await pedido();
      despues?.(respuesta);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el cambio.');
    } finally {
      ocupadoRef.current = false;
      setOcupado(false);
    }
  }

  // El combo recién creado queda abierto, para agregarle los productos.
  function crear(e) {
    e.preventDefault();
    accion(
      () => api.post('/combos', { nombre: nombreNuevo }),
      (combo) => {
        setNombreNuevo('');
        if (combo?.id) setAbiertos((prev) => new Set(prev).add(combo.id));
      }
    );
  }

  return (
    <section className="card config-seccion config-seccion-ancha">
      <div className="config-seccion-info">
        <h2 className="config-seccion-titulo">Combos</h2>
        <p className="config-seccion-desc">
          Un combo lleva productos, cada uno con su forma (unidad, kg, caja o pack), su cantidad y su precio en la promo: por ejemplo
          1 Fernet a $11.000 + 2 Coca-Cola a $3.250 = $17.500. Ese precio vale solo para el combo: el precio del producto en Caja y
          en Stock no cambia. En Caja se cobra cuando se lo elige en el buscador, las veces que se pida; los productos que se
          escanean sueltos van a su precio normal aunque completen el combo. El stock se descuenta como en cualquier venta. Vale
          solo en Caja. Las ventas ya hechas no cambian.
        </p>
      </div>
      <div className="config-seccion-cuerpo">
        {error && <div className="alert alert-danger">{error}</div>}

        <form className="config-catalogo-nuevo" onSubmit={crear}>
          <input
            required
            maxLength={60}
            aria-label="Nombre del nuevo combo"
            placeholder="Nombre del combo, por ejemplo Fernet + Coca"
            value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={ocupado}>
            Agregar
          </button>
        </form>

        {cargando ? (
          <div className="config-catalogo-lista">
            <div className="config-catalogo-vacio">Cargando…</div>
          </div>
        ) : combos.length === 0 ? (
          <div className="config-catalogo-lista">
            <div className="config-catalogo-vacio">
              Todavía no hay combos. Creá el primero con su nombre y después agregale los productos con su precio en la promo.
            </div>
          </div>
        ) : (
          combos.map((c) => (
            <Combo
              key={c.id}
              combo={c}
              productos={productos}
              abierta={abiertos.has(c.id)}
              onAlternar={() => setAbiertos((prev) => alternarEn(prev, c.id))}
              ocupado={ocupado}
              onAccion={accion}
            />
          ))
        )}
      </div>
    </section>
  );
}
