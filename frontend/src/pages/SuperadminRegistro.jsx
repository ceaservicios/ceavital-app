import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearFechaHora } from '../utils/format.js';

// Registro de acciones (EST-01 §6): solo lectura. Nadie puede modificarlo ni borrarlo (lo impide
// la base). Las más nuevas primero, de a 100, con filtro por tipo.

const FILTROS = [
  { id: '', nombre: 'Todas' },
  { id: 'ingreso', nombre: 'Ingresos y salidas' },
  { id: 'cuenta', nombre: 'Cuentas y contraseñas' },
  { id: 'instalacion', nombre: 'Plan, cuota y pagos' },
  { id: 'seguridad', nombre: 'Seguridad' },
];

const QUIEN = { superadmin: 'CEA', usuario: 'Negocio', cliente: 'Cliente', sistema: 'Sistema' };
const ROL = { admin: 'Administrador', encargado: 'Encargado', cajero: 'Cajero' };

function quien(a) {
  if (a.actor_tipo === 'sistema') return 'Sistema';
  const rol = a.actor_tipo === 'usuario' ? ROL[a.rol] ?? a.rol : QUIEN[a.actor_tipo];
  return { nombre: a.actor ?? '—', rol };
}

export default function SuperadminRegistro({ irAlLogin }) {
  const [categoria, setCategoria] = useState('');
  const [acciones, setAcciones] = useState([]);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const pedido = useRef(0); // descarta respuestas viejas si se cambia el filtro rápido

  const cargar = useCallback(
    async (filtro, antes = null) => {
      const numero = ++pedido.current;
      setCargando(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (filtro) params.set('categoria', filtro);
        if (antes) params.set('antes', String(antes));
        const data = await api.get(`/sa/registro${params.size ? `?${params}` : ''}`);
        if (numero !== pedido.current) return;
        setAcciones((previas) => (antes ? [...previas, ...data.acciones] : data.acciones));
        setHayMas(data.hay_mas);
      } catch (err) {
        if (numero !== pedido.current) return;
        if (err instanceof ApiError && err.status === 401) return irAlLogin();
        setError(err instanceof ApiError ? err.message : 'No se pudo cargar el registro.');
      } finally {
        if (numero === pedido.current) setCargando(false);
      }
    },
    [irAlLogin]
  );

  useEffect(() => {
    cargar(categoria);
  }, [cargar, categoria]);

  return (
    <section className="card sa-card">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Registro de acciones</h2>
        <div className="field sa-campo-filtro">
          <label htmlFor="sa-registro-filtro" className="sa-oculto">
            Tipo de acción
          </label>
          <select id="sa-registro-filtro" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {FILTROS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="sa-ayuda">
        Ingresos, cambios de cuentas y contraseñas, y todo lo que se hace desde este panel. Nadie puede modificarlo ni borrarlo.
      </p>
      {error && <div className="alert alert-danger">{error}</div>}

      {acciones.length === 0 && !cargando ? (
        <p className="sa-ayuda">Todavía no hay acciones registradas{categoria ? ' de este tipo' : ''}.</p>
      ) : (
        <div className="sa-tabla-scroll">
          <table className="sa-tabla sa-tabla-registro">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Quién</th>
                <th>Acción</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {acciones.map((a) => {
                const q = quien(a);
                return (
                  <tr key={a.id}>
                    <td>{formatearFechaHora(a.creado_en)}</td>
                    <td className="sa-registro-quien">
                      {typeof q === 'string' ? (
                        q
                      ) : (
                        <>
                          <span className="sa-registro-nombre">{q.nombre}</span>
                          <span className="sa-detalle-fila">{q.rol}</span>
                        </>
                      )}
                    </td>
                    <td className="sa-registro-accion">
                      <span className="sa-registro-titulo">{a.titulo}</span>
                      {a.detalle && <span className="sa-detalle-fila">{a.detalle}</span>}
                    </td>
                    <td className="sa-mono">{a.ip ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {cargando && <p className="sa-ayuda">Cargando…</p>}
      {hayMas && !cargando && (
        <div>
          <button type="button" className="btn" onClick={() => cargar(categoria, acciones[acciones.length - 1]?.id)}>
            Ver más
          </button>
        </div>
      )}
    </section>
  );
}
