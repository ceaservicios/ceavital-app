import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { IconoFila } from '../components/ConAvatar.jsx';
import { colorDe } from '../utils/colores.js';
import { formatearMonto } from '../utils/format.js';
import { esFraccionable, etiquetaPack, formatearCantidad, plural, simboloMedida, sufijoPrecio } from '../utils/presentacion.js';

// Configuración → Promociones (pedido del usuario, 2026-11-01, como los grupos de promoción de
// Somnia; solo el Administrador). Los productos de un mismo grupo suman juntos para llegar al precio
// por cantidad de cada uno: sueltos con sueltos y cajas con cajas. Cada producto conserva su propio
// "desde" y su precio, que se cargan en su ficha. Mismas filas que los catálogos de esta pantalla.

const MAX_SUGERENCIAS = 6;

// "Por unidad: desde 10 a $ 1.150" / "Caja x 6: desde 5 cajas a $ 6.600". Null si no tiene ninguno.
function preciosPorCantidad(p) {
  const partes = [];
  if (p.precio_cantidad_desde != null) {
    const forma = esFraccionable(p.medida) ? `Por ${simboloMedida(p.medida)}` : 'Por unidad';
    const desde = formatearCantidad(p.precio_cantidad_desde, p.medida, { corta: true });
    partes.push(`${forma}: desde ${desde} a ${formatearMonto(p.precio_cantidad)}${sufijoPrecio(p.medida)}`);
  }
  if (p.pack_cantidad_desde != null && p.pack_nombre) {
    const desde = `${p.pack_cantidad_desde} ${plural(p.pack_nombre, p.pack_cantidad_desde)}`;
    partes.push(`${etiquetaPack(p.pack_nombre, p.pack_unidades, p.medida)}: desde ${desde} a ${formatearMonto(p.precio_pack_cantidad)}`);
  }
  return partes.length ? partes.join(' · ') : null;
}

const tienePrecioPorCantidad = (p) => p.precio_cantidad_desde != null || p.pack_cantidad_desde != null;

function Grupo({ grupo, productos, nombreDeGrupo, ocupado, onAccion }) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(grupo.nombre);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  // Al tipear aparecen todos los que coinciden y no están ya en este grupo (pedido del usuario,
  // 2026-11-01: "si voy tipeando debe traer los productos que coinciden"). Solo se suman los que
  // tienen precio por cantidad y se miden igual que los del grupo (un kg no suma con una unidad; el
  // servidor también lo controla); los demás dicen por qué.
  const medida = grupo.productos[0]?.medida ?? null;
  const texto = busqueda.trim().toLowerCase();
  const sugerencias = texto
    ? productos
        .filter((p) => p.grupo_promocion_id !== grupo.id && p.nombre.toLowerCase().includes(texto))
        .slice(0, MAX_SUGERENCIAS)
    : [];
  const porQueNo = (p) =>
    !tienePrecioPorCantidad(p)
      ? 'No tiene precio por cantidad: cargalo en su ficha (Stock) y después sumalo.'
      : medida && p.medida !== medida
        ? 'Se mide distinto que los productos del grupo.'
        : null;
  const n = grupo.productos.length;

  return (
    <div className="promo-grupo">
      <div className="config-catalogo-fila promo-grupo-cabeza">
        {editando ? (
          <>
            <input
              className="config-catalogo-input-edicion"
              aria-label="Nombre del grupo"
              maxLength={60}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
            <div className="config-catalogo-botones">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setEditando(false);
                  setNombre(grupo.nombre);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={ocupado}
                onClick={() => onAccion(() => api.patch(`/grupos-promocion/${grupo.id}`, { nombre }), () => setEditando(false))}
              >
                Guardar
              </button>
            </div>
          </>
        ) : confirmandoEliminar ? (
          <>
            <span className="config-catalogo-nombre">
              ¿Eliminar "{grupo.nombre}"?
              {n > 0 && <span className="promo-grupo-sub">{n === 1 ? 'Su producto queda' : `Sus ${n} productos quedan`} sin grupo.</span>}
            </span>
            <div className="config-catalogo-botones">
              <button type="button" className="btn" onClick={() => setConfirmandoEliminar(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-peligro"
                disabled={ocupado}
                onClick={() => onAccion(() => api.delete(`/grupos-promocion/${grupo.id}`))}
              >
                Eliminar
              </button>
            </div>
          </>
        ) : (
          <>
            <IconoFila icono="rayo" color={colorDe(grupo.id)} />
            <span className="config-catalogo-nombre">
              {grupo.nombre}
              <span className="promo-grupo-sub">
                {n === 0 ? 'Sin productos todavía' : `${n} ${n === 1 ? 'producto' : 'productos'} · suman juntos`}
              </span>
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

      {grupo.productos.map((p) => {
        const precios = preciosPorCantidad(p);
        return (
          <div className="config-catalogo-fila promo-producto" key={p.id}>
            <IconoFila icono="paquete" color={colorDe(p.id)} />
            <span className="config-catalogo-nombre">
              {p.nombre}
              {precios ? (
                <span className="promo-grupo-sub">{precios}</span>
              ) : (
                <span className="promo-aviso">Sin precio por cantidad: suma para el grupo, pero sale a su precio normal.</span>
              )}
            </span>
            <div className="config-catalogo-acciones">
              <button
                type="button"
                className="config-catalogo-accion config-catalogo-accion-danger"
                disabled={ocupado}
                onClick={() => onAccion(() => api.delete(`/grupos-promocion/${grupo.id}/productos/${p.id}`))}
              >
                Sacar
              </button>
            </div>
          </div>
        );
      })}

      <div className="promo-sumar">
        <input
          type="search"
          aria-label={`Buscar un producto para sumar a ${grupo.nombre}`}
          placeholder="Buscar un producto para sumar al grupo"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {texto && sugerencias.length === 0 && <span className="promo-sumar-ayuda">No hay productos que coincidan.</span>}
        {sugerencias.map((p) => {
          const motivo = porQueNo(p);
          return (
            <div className="promo-sugerencia" key={p.id}>
              <span className="promo-sugerencia-texto">
                <strong>{p.nombre}</strong>
                {motivo ? (
                  <span className="promo-aviso">{motivo}</span>
                ) : (
                  <span>
                    {[preciosPorCantidad(p), p.grupo_promocion_id && `hoy en ${nombreDeGrupo(p.grupo_promocion_id)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </span>
              {!motivo && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={ocupado}
                  onClick={() => onAccion(() => api.put(`/grupos-promocion/${grupo.id}/productos/${p.id}`), () => setBusqueda(''))}
                >
                  Sumar
                </button>
              )}
            </div>
          );
        })}
        {!texto && (
          <span className="promo-sumar-ayuda">
            Se suman los productos con precio por cantidad{medida ? ' que se miden igual que los del grupo' : ''}. Si ya está en
            otro grupo, pasa a este.
          </span>
        )}
      </div>
    </div>
  );
}

export default function SeccionPromociones() {
  const [grupos, setGrupos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  // Guardia sincrónica contra el doble click: `disabled={ocupado}` no alcanza en el mismo tick.
  const ocupadoRef = useRef(false);

  async function cargar() {
    const [g, p] = await Promise.all([api.get('/grupos-promocion'), api.get('/productos')]);
    setGrupos(g.items);
    setProductos(p.productos);
  }

  useEffect(() => {
    cargar()
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar las promociones.'))
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
    accion(() => api.post('/grupos-promocion', { nombre: nombreNuevo }), () => setNombreNuevo(''));
  }

  const nombres = new Map(grupos.map((g) => [g.id, g.nombre]));
  const nombreDeGrupo = (id) => nombres.get(id) ?? 'otro grupo';

  return (
    <section className="card config-seccion">
      <div className="config-seccion-info">
        <h2 className="config-seccion-titulo">Grupos de promoción</h2>
        <p className="config-seccion-desc">
          Los productos de un mismo grupo se suman para llegar al precio por cantidad: 5 Coca + 3 Sprite + 2 Fanta llegan a 10, y
          cada uno sale a su precio "desde 10". Las unidades sueltas se suman entre sí y las cajas entre sí. Vale en Caja y en los
          pedidos del portal. Cada producto mantiene sus propios precios, que se cargan en su ficha. Las ventas ya hechas no cambian.
        </p>
      </div>
      <div className="config-seccion-cuerpo">
        {error && <div className="alert alert-danger">{error}</div>}

        <form className="config-catalogo-nuevo" onSubmit={crear}>
          <input
            required
            maxLength={60}
            aria-label="Nombre del nuevo grupo"
            placeholder="Nombre del nuevo grupo, por ejemplo Gaseosas 2,25 L"
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
        ) : grupos.length === 0 ? (
          <div className="config-catalogo-lista">
            <div className="config-catalogo-vacio">Todavía no hay grupos. Creá el primero con un nombre y después sumale productos.</div>
          </div>
        ) : (
          grupos.map((g) => (
            <Grupo key={g.id} grupo={g} productos={productos} nombreDeGrupo={nombreDeGrupo} ocupado={ocupado} onAccion={accion} />
          ))
        )}
      </div>
    </section>
  );
}
