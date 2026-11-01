import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearMonto } from '../utils/format.js';
import {
  esFraccionable,
  etiquetaPack,
  formatearCantidad,
  parsearCantidad,
  plural,
  simboloMedida,
  sufijoPrecio,
  textoDeCantidad,
  tienePack,
  vendeSuelto,
} from '../utils/presentacion.js';
import { alternarEn, TarjetaPromo } from './promocionesComun.jsx';

// Configuración → Promociones → Grupos (pedido del usuario, 2026-11-01, como los grupos de promoción
// de Somnia; solo el Administrador). Los productos de un mismo grupo suman juntos para llegar al
// precio por cantidad de cada uno: sueltos con sueltos y cajas con cajas. Cada grupo es una tarjeta
// desplegable; adentro, cada producto con su precio por cantidad en cada forma en que se vende (el
// mismo dato de su ficha), que se cambia acá mismo.

const MAX_SUGERENCIAS = 6;

const soloDigitos = (texto) => texto.replace(/\D/g, '');

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

// Las formas en que se vende el producto, cada una con su precio normal y su precio por cantidad.
function formasDe(p) {
  const formas = [];
  if (vendeSuelto(p)) {
    formas.push({
      presentacion: 'unidad',
      etiqueta: esFraccionable(p.medida) ? `Por ${simboloMedida(p.medida)}` : 'Unidad',
      normal: `${formatearMonto(p.precio_venta)}${sufijoPrecio(p.medida)}`,
      desde: p.precio_cantidad_desde,
      precio: p.precio_cantidad,
    });
  }
  if (tienePack(p)) {
    formas.push({
      presentacion: 'pack',
      etiqueta: etiquetaPack(p.pack_nombre, p.pack_unidades, p.medida),
      normal: formatearMonto(p.precio_pack),
      desde: p.pack_cantidad_desde,
      precio: p.precio_pack_cantidad,
    });
  }
  return formas;
}

// Una forma de venta de un producto del grupo: desde cuántos y a qué precio cada uno. Vacío = sin
// precio por cantidad en esa forma (suma para el grupo, pero sale a su precio normal).
function FilaPrecioCantidad({ producto, forma, grupo, ocupado, onAccion }) {
  const porPack = forma.presentacion === 'pack';
  const medidaDesde = porPack ? 'unidad' : producto.medida;
  const [desdeTexto, setDesdeTexto] = useState(forma.desde != null ? textoDeCantidad(forma.desde, medidaDesde) : '');
  const [precioTexto, setPrecioTexto] = useState(forma.precio != null ? String(forma.precio) : '');
  const desde = desdeTexto.trim() === '' ? null : parsearCantidad(desdeTexto, medidaDesde);
  const precio = precioTexto === '' ? null : Number(precioTexto);
  const vacio = desdeTexto.trim() === '' && precioTexto === '';
  const valido = vacio || (desde != null && precio != null);
  const cambio = vacio ? forma.desde != null : desde !== forma.desde || precio !== forma.precio;
  const unidad = porPack ? plural(producto.pack_nombre, desde ?? 2) : simboloMedida(producto.medida, desde ?? 2);

  return (
    <div className="promo-fila promo-fila-grupo">
      <span className="promo-fila-producto">
        <span className="promo-forma">{forma.etiqueta}</span>
        <span className="promo-resumen">Normal {forma.normal}</span>
      </span>
      <span className="combo-cantidad">
        <span className="combo-unidad">desde</span>
        <input
          className="combo-control combo-control-cantidad"
          type="text"
          inputMode={!porPack && esFraccionable(producto.medida) ? 'decimal' : 'numeric'}
          aria-label={`${producto.nombre}, ${forma.etiqueta}: desde cuántos`}
          placeholder="—"
          value={desdeTexto}
          onChange={(e) => setDesdeTexto(e.target.value)}
        />
        <span className="combo-unidad">{unidad}</span>
      </span>
      <span className="combo-cantidad">
        <span className="combo-unidad">a $</span>
        <input
          className="combo-control combo-control-precio"
          inputMode="numeric"
          aria-label={`${producto.nombre}, ${forma.etiqueta}: precio por cantidad`}
          placeholder="—"
          value={precioTexto}
          onChange={(e) => setPrecioTexto(soloDigitos(e.target.value))}
        />
        <span className="combo-unidad">{!porPack && esFraccionable(producto.medida) ? sufijoPrecio(producto.medida) : 'c/u'}</span>
      </span>
      <span className="promo-fila-acciones">
        {cambio && (
          <button
            type="button"
            className="btn btn-primary promo-btn-chico"
            disabled={ocupado || !valido}
            onClick={() =>
              onAccion(() =>
                api.put(`/grupos-promocion/${grupo.id}/productos/${producto.id}/precio-cantidad`, {
                  presentacion: forma.presentacion,
                  desde,
                  precio,
                })
              )
            }
          >
            Guardar
          </button>
        )}
      </span>
    </div>
  );
}

function Grupo({ grupo, productos, nombreDeGrupo, abierta, onAlternar, ocupado, onAccion }) {
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
  const sinPrecio = grupo.productos.filter((p) => !tienePrecioPorCantidad(p)).length;

  const reemplazo = editando ? (
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
        {n > 0 && <span className="promo-resumen">{n === 1 ? 'Su producto queda' : `Sus ${n} productos quedan`} sin grupo.</span>}
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
  ) : null;

  return (
    <TarjetaPromo
      id={grupo.id}
      icono="rayo"
      abierta={abierta}
      onAlternar={onAlternar}
      titulo={grupo.nombre}
      resumen={n === 0 ? 'Sin productos todavía' : `${n} ${n === 1 ? 'producto' : 'productos'} · suman juntos`}
      aviso={
        sinPrecio > 0
          ? `${sinPrecio === 1 ? 'Un producto no tiene' : `${sinPrecio} productos no tienen`} precio por cantidad: suman, pero salen a su precio normal.`
          : null
      }
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
      <span className="promo-cuerpo-titulo">Productos del grupo</span>
      {n === 0 ? (
        <span className="promo-sumar-ayuda">Todavía no tiene productos: buscalos abajo y sumalos.</span>
      ) : (
        <div className="promo-tabla">
          {grupo.productos.map((p) => (
            <div className="promo-bloque" key={p.id}>
              <div className="promo-bloque-cabeza">
                <strong>{p.nombre}</strong>
                <button
                  type="button"
                  className="config-catalogo-accion config-catalogo-accion-danger promo-sacar"
                  disabled={ocupado}
                  onClick={() => onAccion(() => api.delete(`/grupos-promocion/${grupo.id}/productos/${p.id}`))}
                >
                  Sacar
                </button>
              </div>
              {formasDe(p).map((f) => (
                // La clave cambia al guardar: la fila vuelve a arrancar con lo guardado.
                <FilaPrecioCantidad
                  key={`${f.presentacion}-${f.desde}-${f.precio}`}
                  producto={p}
                  forma={f}
                  grupo={grupo}
                  ocupado={ocupado}
                  onAccion={onAccion}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <span className="promo-cuerpo-titulo">Sumar un producto</span>
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
    </TarjetaPromo>
  );
}

export default function SeccionPromociones() {
  const [grupos, setGrupos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [abiertos, setAbiertos] = useState(() => new Set());
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

  // El grupo recién creado queda abierto, para sumarle los productos.
  function crear(e) {
    e.preventDefault();
    accion(
      () => api.post('/grupos-promocion', { nombre: nombreNuevo }),
      (grupo) => {
        setNombreNuevo('');
        if (grupo?.id) setAbiertos((prev) => new Set(prev).add(grupo.id));
      }
    );
  }

  const nombres = new Map(grupos.map((g) => [g.id, g.nombre]));
  const nombreDeGrupo = (id) => nombres.get(id) ?? 'otro grupo';

  return (
    <section className="card config-seccion config-seccion-ancha">
      <div className="config-seccion-info">
        <h2 className="config-seccion-titulo">Grupos de promoción</h2>
        <p className="config-seccion-desc">
          Los productos de un mismo grupo se suman para llegar al precio por cantidad: 5 Coca + 3 Sprite + 2 Fanta llegan a 10, y
          cada uno sale a su precio "desde 10". Las unidades sueltas se suman entre sí y las cajas entre sí. Vale en Caja y en los
          pedidos del portal. El precio por cantidad de cada producto se cambia acá o en su ficha. Las ventas ya hechas no cambian.
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
            <Grupo
              key={g.id}
              grupo={g}
              productos={productos}
              nombreDeGrupo={nombreDeGrupo}
              abierta={abiertos.has(g.id)}
              onAlternar={() => setAbiertos((prev) => alternarEn(prev, g.id))}
              ocupado={ocupado}
              onAccion={accion}
            />
          ))
        )}
      </div>
    </section>
  );
}
