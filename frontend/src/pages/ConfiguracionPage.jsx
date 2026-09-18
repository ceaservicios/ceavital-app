import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';
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
    setGuardando(true);
    setError(null);
    try {
      await api.post(endpoint, { nombre: nombreNuevo });
      setNombreNuevo('');
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `No se pudo crear la ${singular}.`);
    } finally {
      setGuardando(false);
    }
  }

  function empezarEdicion(item) {
    setEditandoId(item.id);
    setNombreEditado(item.nombre);
    setConfirmandoEliminarId(null);
  }

  async function guardarEdicion(id) {
    setGuardando(true);
    setError(null);
    try {
      await api.patch(`${endpoint}/${id}`, { nombre: nombreEditado });
      setEditandoId(null);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el cambio.');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(id) {
    setGuardando(true);
    setError(null);
    try {
      await api.delete(`${endpoint}/${id}`);
      setConfirmandoEliminarId(null);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo eliminar.');
    } finally {
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

const SECCIONES = [
  {
    clave: 'categorias',
    texto: 'Categorías',
    descripcion: 'Rubros con los que se clasifican los productos en Stock (ej. Bebidas, Lácteos). Aparecen como opciones al cargar o editar un producto.',
    endpoint: '/categorias',
    singular: 'categoría',
  },
  {
    clave: 'unidades',
    texto: 'Unidades de medida',
    descripcion: 'Cómo se mide cada producto (ej. unidad, kg, litro). Aparecen como opciones al cargar o editar un producto.',
    endpoint: '/unidades-medida',
    singular: 'unidad de medida',
  },
  {
    clave: 'pagos',
    texto: 'Condiciones de pago',
    descripcion: 'Plazos que se le pueden asignar a un cliente-empresa (ej. Contado, 30 días). Aparecen como opciones en la ficha del cliente.',
    endpoint: '/condiciones-pago',
    singular: 'condición de pago',
  },
  { clave: 'backups', texto: 'Backups y Seguridad' },
];

export default function ConfiguracionPage() {
  const [tab, setTab] = useState('categorias');
  const seccion = SECCIONES.find((s) => s.clave === tab);

  return (
    <div className="config-page">
      <div className="config-encabezado">
        <span className="config-subtitulo">Listas de opciones y ajustes generales del sistema. Solo el Administrador tiene acceso.</span>
      </div>

      <div className="config-tabs" role="tablist">
        {SECCIONES.map((s) => (
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

      {seccion.endpoint ? (
        <SeccionCatalogo
          key={seccion.clave}
          titulo={seccion.texto}
          descripcion={seccion.descripcion}
          endpoint={seccion.endpoint}
          singular={seccion.singular}
        />
      ) : (
        <div className="card config-catalogo">
          <div className="config-seccion-cabecera">
            <span className="config-seccion-titulo">{seccion.texto}</span>
            <p className="config-seccion-desc">
              La configuración de backups (destino, frecuencia, retención) y la restauración ya existen en el backend
              (<code>/api/configuracion</code>) pero todavía no tienen pantalla propia: se gestionan por ahora vía API o
              desde la terminal del servidor. Se suma acá cuando haga falta.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
