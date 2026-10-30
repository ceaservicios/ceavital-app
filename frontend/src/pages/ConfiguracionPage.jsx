import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { IconoFila } from '../components/ConAvatar.jsx';
import Hero from '../components/Hero.jsx';
import Pestanas from '../components/Pestanas.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { COLOR, colorDe } from '../utils/colores.js';
import './ConfiguracionPage.css';

// Rediseño 2026-10-29: cada sección es una tarjeta con el título y la descripción a la izquierda
// y los controles a la derecha (en celular, uno debajo del otro). Cada sección guarda a su modo:
// Datos del negocio con su botón, Cómo se ve el stock al elegir la opción, los catálogos por fila.

// Sección genérica de catálogo (categorías / unidades de medida / condiciones
// de pago): misma forma exacta para las 3, evita duplicar el mismo CRUD
// (corrección pedida 2026-09-15; condiciones de pago sumada 2026-09-18). Exclusivo Admin -- esta pantalla entera ya está gateada por
// RequireRole en App.jsx.
function SeccionCatalogo({ titulo, endpoint, singular, descripcion, icono, onCambio }) {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [nombreEditado, setNombreEditado] = useState('');
  const [confirmandoEliminarId, setConfirmandoEliminarId] = useState(null);
  // Guardia sincrónica de "Agregar": `disabled={guardando}` no alcanza contra dos clicks en el mismo tick.
  const creandoRef = useRef(false);
  // Lo mismo para "Guardar" (editar) y "Sí, eliminar": con dos clicks, el segundo pedido volvía con un error falso.
  const editandoRef = useRef(false);
  const eliminandoRef = useRef(false);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const data = await api.get(endpoint);
      setItems(data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `No se pudo cargar ${titulo.toLowerCase()}.`);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function crear(e) {
    e.preventDefault();
    if (creandoRef.current) return;
    creandoRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      await api.post(endpoint, { nombre: nombreNuevo });
      setNombreNuevo('');
      await cargar();
      onCambio();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `No se pudo crear la ${singular}.`);
    } finally {
      creandoRef.current = false;
      setGuardando(false);
    }
  }

  function empezarEdicion(item) {
    setEditandoId(item.id);
    setNombreEditado(item.nombre);
    setConfirmandoEliminarId(null);
  }

  async function guardarEdicion(id) {
    if (editandoRef.current) return;
    editandoRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      await api.patch(`${endpoint}/${id}`, { nombre: nombreEditado });
      setEditandoId(null);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el cambio.');
    } finally {
      editandoRef.current = false;
      setGuardando(false);
    }
  }

  async function eliminar(id) {
    if (eliminandoRef.current) return;
    eliminandoRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      await api.delete(`${endpoint}/${id}`);
      setConfirmandoEliminarId(null);
      await cargar();
      onCambio();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo eliminar.');
    } finally {
      eliminandoRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <section className="card config-seccion">
      <div className="config-seccion-info">
        <h2 className="config-seccion-titulo">{titulo}</h2>
        <p className="config-seccion-desc">{descripcion}</p>
      </div>
      <div className="config-seccion-cuerpo">
        {error && <div className="alert alert-danger">{error}</div>}

        <form className="config-catalogo-nuevo" onSubmit={crear}>
          <input
            required
            aria-label={`Nueva ${singular}`}
            placeholder={`Nombre de la nueva ${singular}`}
            value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            Agregar
          </button>
        </form>

        <div className="config-catalogo-lista">
          {cargando && <div className="config-catalogo-vacio">Cargando…</div>}
          {!cargando && items.length === 0 && <div className="config-catalogo-vacio">Sin {titulo.toLowerCase()} registradas.</div>}
          {items.map((item) => (
            <div className="config-catalogo-fila" key={item.id}>
              {editandoId === item.id ? (
                <>
                  <input
                    className="config-catalogo-input-edicion"
                    aria-label={`Nombre de la ${singular}`}
                    value={nombreEditado}
                    onChange={(e) => setNombreEditado(e.target.value)}
                  />
                  <div className="config-catalogo-botones">
                    <button type="button" className="btn" onClick={() => setEditandoId(null)}>
                      Cancelar
                    </button>
                    <button type="button" className="btn btn-primary" disabled={guardando} onClick={() => guardarEdicion(item.id)}>
                      Guardar
                    </button>
                  </div>
                </>
              ) : confirmandoEliminarId === item.id ? (
                <>
                  <span className="config-catalogo-nombre">¿Eliminar "{item.nombre}"?</span>
                  <div className="config-catalogo-botones">
                    <button type="button" className="btn" onClick={() => setConfirmandoEliminarId(null)}>
                      Cancelar
                    </button>
                    <button type="button" className="btn btn-peligro" disabled={guardando} onClick={() => eliminar(item.id)}>
                      Eliminar
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <IconoFila icono={icono} color={colorDe(item.id)} />
                  <span className="config-catalogo-nombre">{item.nombre}</span>
                  <div className="config-catalogo-acciones">
                    <button type="button" className="config-catalogo-accion" onClick={() => empezarEdicion(item)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="config-catalogo-accion config-catalogo-accion-danger"
                      onClick={() => setConfirmandoEliminarId(item.id)}
                    >
                      Eliminar
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Datos del negocio (2026-10-14): van al pie de los mails que manda el sistema a los usuarios y a
// los clientes del portal, junto al logo del negocio. Vacíos, el mail no los muestra.
const CAMPOS_NEGOCIO = [
  { clave: 'nombre', etiqueta: 'Nombre del negocio', max: 100, requerido: true },
  { clave: 'telefono', etiqueta: 'Teléfono', max: 40, placeholder: 'Ej. 299 412-3456', inputMode: 'tel' },
  { clave: 'email', etiqueta: 'Email de contacto', max: 100, placeholder: 'Ej. ventas@tunegocio.com', type: 'email' },
  { clave: 'direccion', etiqueta: 'Dirección', max: 200, placeholder: 'Ej. Av. San Martín 1234' },
  { clave: 'instagram', etiqueta: 'Instagram', max: 60, placeholder: 'Ej. tu.negocio' },
];
const VACIOS = { nombre: '', telefono: '', email: '', direccion: '', instagram: '' };

function SeccionDatosNegocio({ onCambio }) {
  const [datos, setDatos] = useState(VACIOS);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const guardandoRef = useRef(false); // contra el doble click

  const aFormulario = (d) => Object.fromEntries(Object.keys(VACIOS).map((k) => [k, d?.[k] ?? '']));

  useEffect(() => {
    (async () => {
      try {
        setDatos(aFormulario(await api.get('/negocio')));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los datos del negocio.');
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  async function guardar(e) {
    e.preventDefault();
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      setDatos(aFormulario(await api.put('/negocio', datos)));
      setAviso('Datos guardados. Se aplican a partir de los próximos envíos.');
      onCambio();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron guardar los datos.');
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <section className="card config-seccion">
      <div className="config-seccion-info">
        <h2 className="config-seccion-titulo">Datos del negocio</h2>
        <p className="config-seccion-desc">
          Se muestran junto al logo en los emails que envía el sistema, en el resumen de cuenta en PDF y en el portal de clientes. Los
          campos vacíos no se muestran.
        </p>
      </div>
      <div className="config-seccion-cuerpo">
        {error && <div className="alert alert-danger">{error}</div>}
        {aviso && <div className="alert alert-exito">{aviso}</div>}
        {cargando ? (
          <div className="config-catalogo-vacio">Cargando…</div>
        ) : (
          <form className="config-negocio-form" onSubmit={guardar}>
            {CAMPOS_NEGOCIO.map((c) => (
              <div className="field" key={c.clave}>
                <label htmlFor={`negocio-${c.clave}`}>{c.etiqueta}</label>
                <input
                  id={`negocio-${c.clave}`}
                  value={datos[c.clave]}
                  onChange={(e) => setDatos((d) => ({ ...d, [c.clave]: e.target.value }))}
                  maxLength={c.max}
                  required={c.requerido}
                  placeholder={c.placeholder}
                  inputMode={c.inputMode}
                  type={c.type ?? 'text'}
                  disabled={guardando}
                />
              </div>
            ))}
            <div className="config-negocio-acciones">
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

// Cómo se ve el stock de los productos con pack (2026-10-28, clientes que lo piden por pack): lo
// elige el Admin para todo el negocio y se guarda al tocar la opción. Es solo cómo se muestra.
const OPCIONES_STOCK = [
  { valor: 'unidades', titulo: 'En unidades', grande: '840', chico: '140 packs' },
  { valor: 'packs', titulo: 'En packs', grande: '140 packs', chico: '840 unidades' },
];

function SeccionStockEn() {
  const { setStockEnPacks } = useAuth();
  const [stockEn, setStockEn] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const guardandoRef = useRef(false); // contra el doble click

  useEffect(() => {
    api
      .get('/negocio/stock-en')
      .then((data) => setStockEn(data.stock_en))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar la preferencia de stock.'));
  }, []);

  async function elegir(valor) {
    if (valor === stockEn || guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const data = await api.put('/negocio/stock-en', { stock_en: valor });
      setStockEn(data.stock_en);
      setStockEnPacks(data.stock_en === 'packs');
      setAviso(`Preferencia guardada: el stock se muestra en ${data.stock_en} para todos los usuarios.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar.');
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <section className="card config-seccion">
      <div className="config-seccion-info">
        <h2 className="config-seccion-titulo">Visualización del stock</h2>
        <p className="config-seccion-desc">
          Define cómo se muestra el stock de los productos con pack o caja en Stock, Caja y Vencimientos, para todos los usuarios. No
          modifica el stock ni las ventas. Los productos sin pack se muestran siempre en unidades o kg.
        </p>
      </div>
      <div className="config-seccion-cuerpo">
        {error && <div className="alert alert-danger">{error}</div>}
        {aviso && <div className="alert alert-exito">{aviso}</div>}
        {stockEn === null ? (
          !error && <div className="config-catalogo-vacio">Cargando…</div>
        ) : (
          <div className="config-stock-opciones" role="radiogroup" aria-label="Visualización del stock">
            {OPCIONES_STOCK.map((o) => (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={stockEn === o.valor}
                className="config-stock-opcion"
                disabled={guardando}
                onClick={() => elegir(o.valor)}
              >
                <span className="config-stock-opcion-titulo">
                  <span className="config-stock-radio" />
                  {o.titulo}
                </span>
                <span className="config-stock-ejemplo">
                  <span className="config-stock-ejemplo-rotulo">Ejemplo</span>
                  <strong>{o.grande}</strong>
                  <span>{o.chico}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const SECCIONES = [
  // Datos del negocio: no es un catálogo, tiene su propio formulario (SeccionDatosNegocio) y, debajo,
  // cómo se ve el stock (SeccionStockEn).
  { clave: 'negocio', texto: 'Datos del negocio', icono: 'casa', color: COLOR.verde },
  {
    clave: 'categorias',
    texto: 'Categorías',
    icono: 'etiqueta',
    color: COLOR.violeta,
    descripcion: 'Rubros para clasificar los productos (por ejemplo, Bebidas o Lácteos). Se eligen al dar de alta o editar un producto.',
    endpoint: '/categorias',
    singular: 'categoría',
  },
  // "Unidades de medida" se sacó el 2026-10-11: el producto elige Unidad / Kg / Litro (migración
  // 019) y la lista libre dejaba cargar "Caja x 12" como unidad. La tabla queda como historial.
  {
    clave: 'pagos',
    texto: 'Condiciones de pago',
    icono: 'calendario',
    color: COLOR.azul,
    descripcion: 'Plazos de pago que se asignan a cada cliente (por ejemplo, Contado o 30 días). Se eligen en la ficha del cliente.',
    endpoint: '/condiciones-pago',
    singular: 'condición de pago',
  },
];

export default function ConfiguracionPage() {
  const { moduloActivo, stockEnPacks } = useAuth();
  const conPagos = moduloActivo('clientes_empresa');
  const secciones = SECCIONES.filter((s) => s.clave !== 'pagos' || conPagos);
  const [tab, setTab] = useState('negocio');
  const seccion = secciones.find((s) => s.clave === tab) ?? secciones[0];

  // Panel verde (2026-10-29): el nombre del negocio y cuánto tiene cada catálogo. Se vuelve a pedir
  // cuando una sección guarda algo; si un pedido falla, esa cifra queda en "—".
  const [resumen, setResumen] = useState({ nombre: null, categorias: null, pagos: null });
  const cargarResumen = useCallback(async () => {
    const [negocio, categorias, pagos] = await Promise.all([
      api.get('/negocio').catch(() => null),
      api.get('/categorias').catch(() => null),
      conPagos ? api.get('/condiciones-pago').catch(() => null) : null,
    ]);
    setResumen({ nombre: negocio?.nombre ?? null, categorias: categorias?.items.length ?? null, pagos: pagos?.items.length ?? null });
  }, [conPagos]);

  useEffect(() => {
    cargarResumen();
  }, [cargarResumen]);

  return (
    <div className="config-page">
      <Hero
        etiqueta="Tu negocio"
        valor={resumen.nombre || '—'}
        sub="Así figura en emails y documentos."
        minis={[
          { etiqueta: 'Categorías', valor: resumen.categorias ?? '—', sub: 'Para los productos', icono: 'etiqueta', tono: 'violeta' },
          ...(conPagos
            ? [{ etiqueta: 'Condiciones de pago', valor: resumen.pagos ?? '—', sub: 'Para los clientes', icono: 'calendario', tono: 'azul' }]
            : []),
          { etiqueta: 'Stock', valor: stockEnPacks ? 'En packs' : 'En unidades', sub: 'Productos con pack', icono: 'paquete', tono: 'verde' },
        ]}
      />

      <Pestanas items={secciones} activa={seccion.clave} onCambiar={setTab} etiqueta="Secciones de la configuración" />

      {seccion.clave === 'negocio' ? (
        <>
          <SeccionDatosNegocio onCambio={cargarResumen} />
          <SeccionStockEn />
        </>
      ) : (
        <SeccionCatalogo
          key={seccion.clave}
          titulo={seccion.texto}
          descripcion={seccion.descripcion}
          endpoint={seccion.endpoint}
          singular={seccion.singular}
          icono={seccion.icono}
          onCambio={cargarResumen}
        />
      )}
    </div>
  );
}
