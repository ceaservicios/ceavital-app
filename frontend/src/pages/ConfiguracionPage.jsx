import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import './ConfiguracionPage.css';

// Sección genérica de catálogo (categorías / unidades de medida / condiciones
// de pago): misma forma exacta para las 3, evita duplicar el mismo CRUD
// (corrección pedida 2026-09-15; condiciones de pago sumada 2026-09-18). Exclusivo Admin -- esta pantalla entera ya está gateada por
// RequireRole en App.jsx.
function SeccionCatalogo({ titulo, endpoint, singular, descripcion }) {
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo eliminar.');
    } finally {
      eliminandoRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <div className="card config-catalogo">
      <div className="config-seccion-cabecera">
        <span className="config-seccion-titulo">{titulo}</span>
        <p className="config-seccion-desc">{descripcion}</p>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}

      <form className="config-catalogo-nuevo" onSubmit={crear}>
        <input
          required
          placeholder={`Nueva ${singular}…`}
          value={nombreNuevo}
          onChange={(e) => setNombreNuevo(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={guardando}>
          Agregar
        </button>
      </form>

      <div className="config-catalogo-lista">
        {cargando && <div className="config-catalogo-vacio">Cargando…</div>}
        {!cargando && items.length === 0 && (
          <div className="config-catalogo-vacio">Todavía no hay {titulo.toLowerCase()} cargadas.</div>
        )}
        {items.map((item) => (
          <div className="config-catalogo-fila" key={item.id}>
            {editandoId === item.id ? (
              <>
                <input
                  className="config-catalogo-input-edicion"
                  value={nombreEditado}
                  onChange={(e) => setNombreEditado(e.target.value)}
                />
                <button type="button" className="btn" onClick={() => setEditandoId(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn btn-primary" disabled={guardando} onClick={() => guardarEdicion(item.id)}>
                  Guardar
                </button>
              </>
            ) : confirmandoEliminarId === item.id ? (
              <>
                <span className="config-catalogo-nombre">¿Eliminar "{item.nombre}"?</span>
                <button type="button" className="btn" onClick={() => setConfirmandoEliminarId(null)}>
                  No
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
                  disabled={guardando}
                  onClick={() => eliminar(item.id)}
                >
                  Sí, eliminar
                </button>
              </>
            ) : (
              <>
                <span className="config-catalogo-nombre">{item.nombre}</span>
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
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Datos del negocio (2026-10-14): van al pie de los mails que manda el sistema a los usuarios y a
// los clientes del portal, junto al logo del negocio. Vacíos, el mail no los muestra.
const CAMPOS_NEGOCIO = [
  { clave: 'nombre', etiqueta: 'Nombre del negocio', max: 100, requerido: true },
  { clave: 'telefono', etiqueta: 'Teléfono', max: 40, placeholder: 'Ej. 299 412-3456', inputMode: 'tel' },
  { clave: 'email', etiqueta: 'Mail de contacto', max: 100, placeholder: 'Ej. ventas@tunegocio.com', type: 'email' },
  { clave: 'direccion', etiqueta: 'Dirección', max: 200, placeholder: 'Ej. Av. San Martín 1234' },
  { clave: 'instagram', etiqueta: 'Instagram', max: 60, placeholder: 'Ej. tu.negocio' },
];
const VACIOS = { nombre: '', telefono: '', email: '', direccion: '', instagram: '' };

function SeccionDatosNegocio() {
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
      setAviso('Datos guardados. Los próximos mails ya salen con estos datos.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron guardar los datos.');
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <div className="card config-catalogo">
      <div className="config-seccion-cabecera">
        <span className="config-seccion-titulo">Datos del negocio</span>
        <p className="config-seccion-desc">
          Salen, junto al logo, al pie de los mails que el sistema les manda a tus usuarios (códigos de ingreso) y a los clientes del
          portal (datos de acceso), en el resumen de cuenta en PDF y en el portal. Los que dejes vacíos no aparecen.
        </p>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {aviso && <div className="alert config-alert-ok">{aviso}</div>}
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
              Guardar datos
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const SECCIONES = [
  // Datos del negocio: no es un catálogo, tiene su propio formulario (SeccionDatosNegocio).
  { clave: 'negocio', texto: 'Datos del negocio' },
  {
    clave: 'categorias',
    texto: 'Categorías',
    descripcion: 'Rubros con los que se clasifican los productos en Stock (ej. Bebidas, Lácteos). Aparecen como opciones al cargar o editar un producto.',
    endpoint: '/categorias',
    singular: 'categoría',
  },
  // "Unidades de medida" se sacó el 2026-10-11: el producto elige Unidad / Kg / Litro (migración
  // 019) y la lista libre dejaba cargar "Caja x 12" como unidad. La tabla queda como historial.
  {
    clave: 'pagos',
    texto: 'Condiciones de pago',
    descripcion: 'Plazos que se le pueden asignar a un cliente-empresa (ej. Contado, 30 días). Aparecen como opciones en la ficha del cliente.',
    endpoint: '/condiciones-pago',
    singular: 'condición de pago',
  },
];

export default function ConfiguracionPage() {
  const { moduloActivo } = useAuth();
  const secciones = SECCIONES.filter((s) => s.clave !== 'pagos' || moduloActivo('clientes_empresa'));
  const [tab, setTab] = useState('negocio');
  const seccion = secciones.find((s) => s.clave === tab) ?? secciones[0];

  return (
    <div className="config-page">
      <div className="config-encabezado">
        <span className="config-subtitulo">Listas de opciones y ajustes generales del sistema. Solo el Administrador tiene acceso.</span>
      </div>

      <div className="config-tabs" role="tablist">
        {secciones.map((s) => (
          <button
            key={s.clave}
            type="button"
            role="tab"
            aria-selected={tab === s.clave}
            className={`config-tab${tab === s.clave ? ' config-tab-activa' : ''}`}
            onClick={() => setTab(s.clave)}
          >
            {s.texto}
          </button>
        ))}
      </div>

      {seccion.clave === 'negocio' ? (
        <SeccionDatosNegocio />
      ) : (
        <SeccionCatalogo
          key={seccion.clave}
          titulo={seccion.texto}
          descripcion={seccion.descripcion}
          endpoint={seccion.endpoint}
          singular={seccion.singular}
        />
      )}
    </div>
  );
}
