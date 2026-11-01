import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { IconoFila } from '../components/ConAvatar.jsx';
import { colorDe } from '../utils/colores.js';
import { formatearMonto } from '../utils/format.js';
import {
  describirItemCombo,
  esFraccionable,
  etiquetaPack,
  formatearCantidad,
  parsearCantidad,
  plural,
  precioNormalCombo,
  simboloMedida,
  tienePack,
  vendeSuelto,
} from '../utils/presentacion.js';

// Configuración → Promociones → Combos (pedido del usuario, 2026-11-01: "en esa promoción se debe
// poder elegir si se vende por unidad / caja / pack... cantidades"). Un combo es un conjunto fijo de
// productos, cada uno con su forma y su cantidad, a un precio total. En Caja se cobra solo cuando el
// carrito tiene todo lo del combo. Solo el Administrador. Mismas filas que los grupos de promoción.

const MAX_SUGERENCIAS = 6;

const soloDigitos = (texto) => texto.replace(/\D/g, '');

// Lo que lleva el combo de un producto: "2 unidades", "0,5 kg", "1 Caja x 12".
const lleva = (item) => (item.presentacion === 'pack' ? describirItemCombo(item) : formatearCantidad(item.cantidad, item.medida));

// Formas en que se puede sumar un producto al combo: las mismas en que se vende en Caja.
function formasDe(producto) {
  const formas = [];
  if (vendeSuelto(producto)) {
    formas.push({ presentacion: 'unidad', etiqueta: esFraccionable(producto.medida) ? `Por ${simboloMedida(producto.medida)}` : 'Unidad' });
  }
  if (tienePack(producto)) {
    formas.push({ presentacion: 'pack', etiqueta: etiquetaPack(producto.pack_nombre, producto.pack_unidades, producto.medida) });
  }
  return formas;
}

// Un producto encontrado en el buscador: se elige la forma y la cantidad, y se suma.
function Sugerencia({ producto, combo, ocupado, onAccion, onSumado }) {
  const formas = formasDe(producto);
  const [presentacion, setPresentacion] = useState(formas[0]?.presentacion ?? 'unidad');
  const [cantidadTexto, setCantidadTexto] = useState('1');
  const porPack = presentacion === 'pack';
  // En packs y en unidades la cantidad es entera; en kg o litro se tipea con decimales.
  const medidaDeLaCantidad = porPack ? 'unidad' : producto.medida;
  const cantidad = parsearCantidad(cantidadTexto, medidaDeLaCantidad);
  const unidad = porPack ? plural(producto.pack_nombre, cantidad ?? 2) : simboloMedida(producto.medida, cantidad ?? 2);
  const yaEsta = combo.items.find((i) => i.producto_id === producto.id && i.presentacion === presentacion);

  return (
    <div className="promo-sugerencia combo-sugerencia">
      <span className="promo-sugerencia-texto">
        <strong>{producto.nombre}</strong>
        {yaEsta && <span>Ya está en el combo: {lleva(yaEsta)}. Sumalo de nuevo para cambiar la cantidad.</span>}
      </span>
      <span className="combo-sugerencia-controles">
        {formas.length > 1 ? (
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
        ) : (
          <span className="combo-forma-unica">{formas[0]?.etiqueta}</span>
        )}
        <input
          className="combo-control combo-control-cantidad"
          type="text"
          inputMode={!porPack && esFraccionable(producto.medida) ? 'decimal' : 'numeric'}
          aria-label={`Cantidad de ${producto.nombre} en el combo`}
          value={cantidadTexto}
          onChange={(e) => setCantidadTexto(e.target.value)}
        />
        <span className="combo-unidad">{unidad}</span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={ocupado || !cantidad || formas.length === 0}
          onClick={() =>
            onAccion(
              () => api.put(`/combos/${combo.id}/productos`, { producto_id: producto.id, presentacion, cantidad }),
              onSumado
            )
          }
        >
          Sumar
        </button>
      </span>
    </div>
  );
}

function Combo({ combo, productos, ocupado, onAccion }) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(combo.nombre);
  const [precioTexto, setPrecioTexto] = useState(String(combo.precio));
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  // Al tipear, todos los productos que coinciden por nombre o por código.
  const texto = busqueda.trim().toLowerCase();
  const sugerencias = texto
    ? productos
        .filter(
          (p) =>
            p.nombre.toLowerCase().includes(texto) ||
            p.codigo_barras?.toLowerCase() === texto ||
            p.codigo_barras_pack?.toLowerCase() === texto
        )
        .slice(0, MAX_SUGERENCIAS)
    : [];
  const n = combo.items.length;
  const porSeparado = precioNormalCombo(combo.items);

  function cancelarEdicion() {
    setEditando(false);
    setNombre(combo.nombre);
    setPrecioTexto(String(combo.precio));
  }

  return (
    <div className="promo-grupo">
      <div className="config-catalogo-fila promo-grupo-cabeza">
        {editando ? (
          <>
            <input
              className="config-catalogo-input-edicion"
              aria-label="Nombre del combo"
              maxLength={60}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
            <span className="combo-precio-campo">
              $
              <input
                className="config-catalogo-input-edicion"
                inputMode="numeric"
                aria-label="Precio del combo"
                value={precioTexto}
                onChange={(e) => setPrecioTexto(soloDigitos(e.target.value))}
              />
            </span>
            <div className="config-catalogo-botones">
              <button type="button" className="btn" onClick={cancelarEdicion}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={ocupado || !precioTexto}
                onClick={() =>
                  onAccion(() => api.patch(`/combos/${combo.id}`, { nombre, precio: Number(precioTexto) }), () => setEditando(false))
                }
              >
                Guardar
              </button>
            </div>
          </>
        ) : confirmandoEliminar ? (
          <>
            <span className="config-catalogo-nombre">
              ¿Eliminar el combo "{combo.nombre}"?
              <span className="promo-grupo-sub">Deja de cobrarse en Caja. Las ventas ya hechas no cambian.</span>
            </span>
            <div className="config-catalogo-botones">
              <button type="button" className="btn" onClick={() => setConfirmandoEliminar(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-peligro"
                disabled={ocupado}
                onClick={() => onAccion(() => api.delete(`/combos/${combo.id}`))}
              >
                Eliminar
              </button>
            </div>
          </>
        ) : (
          <>
            <IconoFila icono="rayo" color={colorDe(combo.id)} />
            <span className="config-catalogo-nombre">
              {combo.nombre} · {formatearMonto(combo.precio)}
              {n === 0 ? (
                <span className="promo-grupo-sub">Sin productos todavía: sumale lo que lleva.</span>
              ) : (
                <span className="promo-grupo-sub">
                  {n} {n === 1 ? 'producto' : 'productos'} · por separado {formatearMonto(porSeparado)}
                </span>
              )}
              {n > 0 && !combo.vigente && (
                <span className="promo-aviso">No se cobra en Caja hasta que corrijas los productos marcados.</span>
              )}
            </span>
            <div className="config-catalogo-acciones">
              <button type="button" className="config-catalogo-accion" onClick={() => setEditando(true)}>
                Editar
              </button>
              <button
                type="button"
                className="config-catalogo-accion config-catalogo-accion-danger"
                onClick={() => setConfirmandoEliminar(true)}
              >
                Eliminar
              </button>
            </div>
          </>
        )}
      </div>

      {combo.items.map((i) => (
        <div className="config-catalogo-fila promo-producto" key={i.id}>
          <IconoFila icono="paquete" color={colorDe(i.producto_id)} />
          <span className="config-catalogo-nombre">
            {i.producto_nombre}
            <span className="promo-grupo-sub">
              Lleva {lleva(i)}
            </span>
            {i.problema && <span className="promo-aviso">{i.problema}: sacalo o volvé a sumarlo como se vende ahora.</span>}
          </span>
          <div className="config-catalogo-acciones">
            <button
              type="button"
              className="config-catalogo-accion config-catalogo-accion-danger"
              disabled={ocupado}
              onClick={() => onAccion(() => api.delete(`/combos/${combo.id}/productos/${i.id}`))}
            >
              Sacar
            </button>
          </div>
        </div>
      ))}

      <div className="promo-sumar">
        <input
          type="search"
          aria-label={`Buscar un producto para sumar a ${combo.nombre}`}
          placeholder="Buscar un producto para sumar al combo"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {texto && sugerencias.length === 0 && <span className="promo-sumar-ayuda">No hay productos que coincidan.</span>}
        {sugerencias.map((p) => (
          <Sugerencia
            key={p.id}
            producto={p}
            combo={combo}
            ocupado={ocupado}
            onAccion={onAccion}
            onSumado={() => setBusqueda('')}
          />
        ))}
        {!texto && (
          <span className="promo-sumar-ayuda">
            Elegí cada producto con su forma (unidad, kg, caja o pack) y la cantidad que lleva el combo. Si ya está con esa
            forma, se le cambia la cantidad.
          </span>
        )}
      </div>
    </div>
  );
}

export default function SeccionCombos() {
  const [combos, setCombos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [precioNuevo, setPrecioNuevo] = useState('');
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

  // Toda escritura: corre el pedido, vuelve a cargar y, si salió bien, `despues` (cerrar el form).
  async function accion(pedido, despues) {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOcupado(true);
    setError(null);
    try {
      await pedido();
      despues?.();
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el cambio.');
    } finally {
      ocupadoRef.current = false;
      setOcupado(false);
    }
  }

  function crear(e) {
    e.preventDefault();
    accion(
      () => api.post('/combos', { nombre: nombreNuevo, precio: Number(precioNuevo) }),
      () => {
        setNombreNuevo('');
        setPrecioNuevo('');
      }
    );
  }

  return (
    <section className="card config-seccion">
      <div className="config-seccion-info">
        <h2 className="config-seccion-titulo">Combos</h2>
        <p className="config-seccion-desc">
          Un combo junta productos, cada uno con su forma (unidad, kg, caja o pack) y su cantidad, a un precio total: por ejemplo
          1 Fernet + 1 Pack x 6 de Coca a $15.000. En Caja se cobra solo cuando el carrito tiene todo lo del combo, las veces que
          entre; lo que sobra va a su precio normal. Vale solo en Caja. Las ventas ya hechas no cambian.
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
          <span className="combo-precio-campo">
            $
            <input
              required
              inputMode="numeric"
              aria-label="Precio del nuevo combo"
              placeholder="Precio"
              value={precioNuevo}
              onChange={(e) => setPrecioNuevo(soloDigitos(e.target.value))}
            />
          </span>
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
              Todavía no hay combos. Creá el primero con su nombre y su precio, y después sumale los productos.
            </div>
          </div>
        ) : (
          combos.map((c) => <Combo key={c.id} combo={c} productos={productos} ocupado={ocupado} onAccion={accion} />)
        )}
      </div>
    </section>
  );
}
