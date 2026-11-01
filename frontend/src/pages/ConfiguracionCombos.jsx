import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearMonto } from '../utils/format.js';
import {
  esFraccionable,
  etiquetaPack,
  parsearCantidad,
  plural,
  precioNormalCombo,
  simboloMedida,
  textoDeCantidad,
  tienePack,
  vendeSuelto,
} from '../utils/presentacion.js';
import { alternarEn, TarjetaPromo } from './promocionesComun.jsx';

// Configuración → Promociones → Combos (pedido del usuario, 2026-11-01; aprobó la maqueta: "me
// gusta"). Un combo lleva renglones ("Fernet", "Cola"), cada uno con su forma (unidad, kg, caja o
// pack), su cantidad y las marcas que valen; en Caja cualquier marca del renglón cuenta, mezcladas.
// Solo el Administrador. Cada combo es una tarjeta desplegable con sus renglones en una tabla, donde
// se cambia todo ahí mismo.

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

// Formas en que se vende un producto: las mismas que en Caja.
function formasDeProducto(producto) {
  const formas = [];
  if (vendeSuelto(producto)) formas.push({ presentacion: 'unidad', etiqueta: etiquetaSuelto(producto.medida) });
  if (tienePack(producto)) {
    formas.push({ presentacion: 'pack', etiqueta: etiquetaPack(producto.pack_nombre, producto.pack_unidades, producto.medida) });
  }
  return formas;
}

// Formas que puede tener un renglón: las que tienen todas sus marcas (y la que tiene ahora, aunque
// alguna marca ya no se venda así). La caja o pack es la de cada marca.
function formasDeRenglon(renglon) {
  const marcas = renglon.productos.filter((m) => !m.producto_eliminado);
  const formas = [];
  if (marcas.every(vendeSuelto) || renglon.presentacion === 'unidad') {
    formas.push({ presentacion: 'unidad', etiqueta: etiquetaSuelto(marcas[0]?.medida ?? 'unidad') });
  }
  if (marcas.every(tienePack) || renglon.presentacion === 'pack') {
    const etiquetas = [...new Set(marcas.filter(tienePack).map((m) => etiquetaPack(m.pack_nombre, m.pack_unidades, m.medida)))];
    formas.push({ presentacion: 'pack', etiqueta: etiquetas.length === 1 ? etiquetas[0] : 'Caja o pack (la de cada marca)' });
  }
  return formas;
}

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

// Buscador para sumar otra marca a un renglón: muestra todo lo que coincide y dice por qué no se
// puede sumar lo que no va (otra forma de venta o se mide distinto).
function SumarMarca({ renglon, combo, productos, ocupado, onAccion, onCerrar }) {
  const [busqueda, setBusqueda] = useState('');
  const yaEstan = new Set(renglon.productos.map((m) => m.producto_id));
  const medida = renglon.productos[0]?.medida;
  const encontrados = buscar(productos, busqueda).filter((p) => !yaEstan.has(p.id));
  const porQueNo = (p) =>
    renglon.presentacion === 'pack' && !tienePack(p)
      ? 'No se vende por caja ni por pack'
      : renglon.presentacion === 'unidad' && !vendeSuelto(p)
        ? 'No se vende suelto'
        : medida && p.medida !== medida
          ? 'Se mide distinto que las otras marcas'
          : null;

  return (
    <div className="promo-panel">
      <div className="promo-panel-cabeza">
        <input
          type="search"
          className="combo-control promo-panel-buscar"
          aria-label={`Buscar una marca para ${renglon.nombre}`}
          placeholder={`Buscar otra marca para "${renglon.nombre}"`}
          value={busqueda}
          autoFocus
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <button type="button" className="config-catalogo-accion" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
      {busqueda.trim() && encontrados.length === 0 && <span className="promo-sumar-ayuda">No hay productos que coincidan.</span>}
      {encontrados.map((p) => {
        const motivo = porQueNo(p);
        return (
          <div className="promo-panel-fila" key={p.id}>
            <span className="promo-fila-producto">
              <strong>{p.nombre}</strong>
              {motivo && <span className="promo-aviso">{motivo}</span>}
            </span>
            {!motivo && (
              <button
                type="button"
                className="btn btn-primary promo-btn-chico"
                disabled={ocupado}
                onClick={() => onAccion(() => api.put(`/combos/${combo.id}/renglones/${renglon.id}/productos/${p.id}`), () => setBusqueda(''))}
              >
                Sumar
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Un renglón del combo: nombre, forma y cantidad se cambian acá mismo; las marcas se suman y se sacan.
function FilaRenglon({ renglon, combo, productos, ocupado, onAccion }) {
  const medida = renglon.productos[0]?.medida ?? 'unidad';
  const [nombre, setNombre] = useState(renglon.nombre);
  const [presentacion, setPresentacion] = useState(renglon.presentacion);
  const [cantidadTexto, setCantidadTexto] = useState(textoDeCantidad(renglon.cantidad, medidaDeCantidad(renglon.presentacion, medida)));
  const [sumandoMarca, setSumandoMarca] = useState(false);
  const cantidad = parsearCantidad(cantidadTexto, medidaDeCantidad(presentacion, medida));
  const cambio = nombre.trim() !== renglon.nombre || presentacion !== renglon.presentacion || cantidad !== renglon.cantidad;
  const packs = [...new Set(renglon.productos.filter(tienePack).map((m) => m.pack_nombre))];
  const validas = renglon.productos.filter((m) => !m.problema).length;
  const unica = renglon.productos.length === 1;

  return (
    <div className="promo-fila promo-fila-renglon">
      <input
        className="combo-control combo-control-nombre"
        aria-label="Nombre del renglón"
        maxLength={60}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
      />
      <select
        className="combo-control"
        aria-label={`Cómo se vende ${renglon.nombre}`}
        value={presentacion}
        onChange={(e) => setPresentacion(e.target.value)}
      >
        {formasDeRenglon(renglon).map((f) => (
          <option key={f.presentacion} value={f.presentacion}>
            {f.etiqueta}
          </option>
        ))}
      </select>
      <CampoCantidad
        presentacion={presentacion}
        medida={medida}
        packNombre={packs.length === 1 ? packs[0] : null}
        texto={cantidadTexto}
        onTexto={setCantidadTexto}
        etiqueta={`Cantidad de ${renglon.nombre}`}
      />
      <span className="promo-marcas">
        {renglon.productos.map((m) => (
          <span className={`promo-marca${m.problema ? ' con-problema' : ''}`} key={m.producto_id} title={m.problema ?? undefined}>
            {m.producto_nombre}
            {m.problema && ` · ${m.problema.toLowerCase()}`}
            {!unica && (
              <button
                type="button"
                className="promo-marca-x"
                aria-label={`Sacar ${m.producto_nombre} de ${renglon.nombre}`}
                disabled={ocupado}
                onClick={() => onAccion(() => api.delete(`/combos/${combo.id}/renglones/${renglon.id}/productos/${m.producto_id}`))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!sumandoMarca && (
          <button type="button" className="promo-sumar-marca" onClick={() => setSumandoMarca(true)}>
            + Sumar marca
          </button>
        )}
      </span>
      <span className="promo-fila-acciones">
        {cambio && (
          <button
            type="button"
            className="btn btn-primary promo-btn-chico"
            disabled={ocupado || !cantidad || !nombre.trim()}
            onClick={() =>
              onAccion(() => api.patch(`/combos/${combo.id}/renglones/${renglon.id}`, { nombre: nombre.trim(), presentacion, cantidad }))
            }
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
      {validas > 1 && <span className="promo-nota">Valen mezcladas: cualquier combinación de estas marcas suma la cantidad.</span>}
      {validas === 0 && <span className="promo-nota con-problema">Ninguna marca se puede vender así: el combo no se cobra hasta corregirlo.</span>}
      {sumandoMarca && (
        <SumarMarca
          renglon={renglon}
          combo={combo}
          productos={productos}
          ocupado={ocupado}
          onAccion={onAccion}
          onCerrar={() => setSumandoMarca(false)}
        />
      )}
    </div>
  );
}

// Un producto encontrado para un renglón nuevo: se elige la forma y la cantidad, y se agrega.
function NuevoRenglon({ producto, combo, ocupado, onAccion, onAgregado }) {
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
            onAccion(() => api.post(`/combos/${combo.id}/renglones`, { producto_id: producto.id, presentacion, cantidad }), onAgregado)
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
  const [precioTexto, setPrecioTexto] = useState(String(combo.precio));
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  const n = combo.renglones.length;
  const { min, max } = precioNormalCombo(combo.renglones);
  const porSeparado = min === max ? formatearMonto(min) : `entre ${formatearMonto(min)} y ${formatearMonto(max)} según la marca`;
  const encontrados = buscar(productos, busqueda);

  function cancelarEdicion() {
    setEditando(false);
    setNombre(combo.nombre);
    setPrecioTexto(String(combo.precio));
  }

  const reemplazo = editando ? (
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
          onClick={() => onAccion(() => api.patch(`/combos/${combo.id}`, { nombre, precio: Number(precioTexto) }), () => setEditando(false))}
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
      resumen={n === 0 ? 'Sin renglones todavía' : `${n} ${n === 1 ? 'renglón' : 'renglones'} · por separado ${porSeparado}`}
      aviso={n > 0 && !combo.vigente ? 'No se cobra en Caja hasta que corrijas el renglón marcado.' : null}
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
        <span className="promo-sumar-ayuda">Todavía no lleva nada: agregá el primer renglón.</span>
      ) : (
        <div className="promo-tabla">
          <div className="promo-fila promo-fila-renglon promo-tabla-cabeza" aria-hidden="true">
            <span>Renglón</span>
            <span>Se vende por</span>
            <span>Cantidad</span>
            <span>Marcas que valen</span>
            <span />
          </div>
          {combo.renglones.map((r) => (
            // La clave cambia al guardar: la fila vuelve a arrancar con lo guardado.
            <FilaRenglon
              key={`${r.id}-${r.nombre}-${r.presentacion}-${r.cantidad}`}
              renglon={r}
              combo={combo}
              productos={productos}
              ocupado={ocupado}
              onAccion={onAccion}
            />
          ))}
        </div>
      )}

      {agregando ? (
        <div className="promo-panel">
          <div className="promo-panel-cabeza">
            <input
              type="search"
              className="combo-control promo-panel-buscar"
              aria-label={`Buscar un producto para un renglón nuevo de ${combo.nombre}`}
              placeholder="Buscar el producto del renglón nuevo, por nombre o código"
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
                <NuevoRenglon
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
              El renglón se llama como el producto: después le cambiás el nombre (por ejemplo "Cola") y le sumás otras marcas.
            </span>
          )}
        </div>
      ) : (
        <div>
          <button type="button" className="btn promo-btn-chico" onClick={() => setAgregando(true)}>
            + Agregar renglón
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
  const [precioNuevo, setPrecioNuevo] = useState('');
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

  // El combo recién creado queda abierto, para agregarle los renglones.
  function crear(e) {
    e.preventDefault();
    accion(
      () => api.post('/combos', { nombre: nombreNuevo, precio: Number(precioNuevo) }),
      (combo) => {
        setNombreNuevo('');
        setPrecioNuevo('');
        if (combo?.id) setAbiertos((prev) => new Set(prev).add(combo.id));
      }
    );
  }

  return (
    <section className="card config-seccion config-seccion-ancha">
      <div className="config-seccion-info">
        <h2 className="config-seccion-titulo">Combos</h2>
        <p className="config-seccion-desc">
          Un combo lleva renglones, cada uno con su forma (unidad, kg, caja o pack), su cantidad y las marcas que valen: por
          ejemplo 1 Fernet + 2 Cola (Coca, Pepsi o Manaos) a $15.000. En Caja se cobra solo cuando el carrito tiene todo lo del
          combo, con cualquier marca de cada renglón, mezcladas; lo que sobra va a su precio normal. Vale solo en Caja. Las
          ventas ya hechas no cambian.
        </p>
      </div>
      <div className="config-seccion-cuerpo">
        {error && <div className="alert alert-danger">{error}</div>}

        <form className="config-catalogo-nuevo" onSubmit={crear}>
          <input
            required
            maxLength={60}
            aria-label="Nombre del nuevo combo"
            placeholder="Nombre del combo, por ejemplo Fernet + Cola"
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
              Todavía no hay combos. Creá el primero con su nombre y su precio, y después agregale los renglones.
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
