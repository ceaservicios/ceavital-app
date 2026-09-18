import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { etiquetaRol } from '../constants/roles.js';
import './UsuariosPage.css';

const ROLES = ['admin', 'encargado', 'cajero'];
const USUARIO_VACIO = { nombre: '', usuario: '', rol: 'cajero', password: '' };

function estaBloqueado(usuario) {
  return usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date();
}

export default function UsuariosPage() {
  const { usuario: sesionActual } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [panel, setPanel] = useState('ninguno'); // 'ninguno' | 'nuevo' | 'detalle'
  const [detalle, setDetalle] = useState(null);
  const [edicion, setEdicion] = useState(null);
  const [nuevoUsuario, setNuevoUsuario] = useState(USUARIO_VACIO);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [panelError, setPanelError] = useState(null);
  const [panelExito, setPanelExito] = useState(null);
  // Guardia real contra doble-click en "Sí, eliminar" (hallazgo Baja #3,
  // verificador-funcional 2026-09-10) -- ref mutado sincrónicamente, no
  // depende de que React ya haya re-renderizado con `guardando=true`.
  const eliminandoRef = useRef(false);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const data = await api.get('/usuarios');
      setUsuarios(data.usuarios);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los usuarios.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const kpis = useMemo(
    () => ({
      admin: usuarios.filter((u) => u.rol === 'admin').length,
      encargado: usuarios.filter((u) => u.rol === 'encargado').length,
      cajero: usuarios.filter((u) => u.rol === 'cajero').length,
    }),
    [usuarios]
  );

  function abrirNuevo() {
    setPanel('nuevo');
    setNuevoUsuario(USUARIO_VACIO);
    setPanelError(null);
    setPanelExito(null);
  }

  function abrirDetalle(usuario) {
    setPanel('detalle');
    setDetalle(usuario);
    setEdicion({ nombre: usuario.nombre, usuario: usuario.usuario, rol: usuario.rol, password: '' });
    setConfirmandoEliminar(false);
    setPanelError(null);
    setPanelExito(null);
  }

  function cerrarPanel() {
    setPanel('ninguno');
    setDetalle(null);
    setEdicion(null);
    setPanelError(null);
    setPanelExito(null);
  }

  async function crearUsuario(e) {
    e.preventDefault();
    setGuardando(true);
    setPanelError(null);
    try {
      await api.post('/usuarios', nuevoUsuario);
      await cargar();
      cerrarPanel();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario.');
    } finally {
      setGuardando(false);
    }
  }

  async function guardarUsuario() {
    setGuardando(true);
    setPanelError(null);
    try {
      const payload = { nombre: edicion.nombre, usuario: edicion.usuario, rol: edicion.rol };
      if (edicion.password) payload.password = edicion.password;
      const actualizado = await api.patch(`/usuarios/${detalle.id}`, payload);
      setDetalle(actualizado);
      setEdicion({ ...edicion, password: '' });
      setPanelExito('Cambios guardados.');
      cargar();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudieron guardar los cambios.');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarUsuario() {
    if (eliminandoRef.current) return;
    eliminandoRef.current = true;
    setGuardando(true);
    setPanelError(null);
    try {
      await api.delete(`/usuarios/${detalle.id}`);
      cerrarPanel();
      cargar();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo eliminar el usuario.');
      setConfirmandoEliminar(false);
    } finally {
      setGuardando(false);
      eliminandoRef.current = false;
    }
  }

  if (cargando) {
    return <div className="card usuarios-vacio">Cargando…</div>;
  }

  return (
    <div className="usuarios-page">
      <div className="usuarios-kpis">
        <div className="card usuarios-kpi">
          <span className="usuarios-kpi-label">Dueño / Administrador</span>
          <span className="usuarios-kpi-value">{kpis.admin}</span>
        </div>
        <div className="card usuarios-kpi">
          <span className="usuarios-kpi-label">Encargado / Supervisor</span>
          <span className="usuarios-kpi-value">{kpis.encargado}</span>
        </div>
        <div className="card usuarios-kpi">
          <span className="usuarios-kpi-label">Empleado / Cajero</span>
          <span className="usuarios-kpi-value">{kpis.cajero}</span>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="usuarios-body">
        <div className="card usuarios-lista">
          <div className="usuarios-lista-header">
            <span className="usuarios-titulo">Usuarios del sistema</span>
            <button type="button" className="btn btn-primary" onClick={abrirNuevo}>
              + Nuevo Usuario
            </button>
          </div>
          <div className="usuarios-tabla">
            <div className="usuarios-tabla-head">
              <span style={{ flex: 1.4 }}>Nombre</span>
              <span style={{ flex: 1.4 }}>Usuario</span>
              <span style={{ flex: 1 }}>Rol</span>
              <span style={{ flex: 1 }}>Estado</span>
            </div>
            {usuarios.map((u) => (
              <button type="button" className="usuarios-fila" key={u.id} onClick={() => abrirDetalle(u)}>
                <span style={{ flex: 1.4 }} className="usuarios-fila-nombre">
                  {u.nombre}
                </span>
                <span style={{ flex: 1.4 }} className="usuarios-fila-muted">
                  {u.usuario}
                </span>
                <span style={{ flex: 1 }}>
                  <span className={`usuarios-badge usuarios-badge-${u.rol}`}>{etiquetaRol(u.rol)}</span>
                </span>
                <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={`usuarios-dot ${estaBloqueado(u) ? 'usuarios-dot-bloqueado' : 'usuarios-dot-activo'}`} />
                  {estaBloqueado(u) ? 'Bloqueado' : 'Activo'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="card usuarios-panel">
          {panel === 'ninguno' && <div className="usuarios-panel-vacio">Seleccioná un usuario para ver el detalle.</div>}

          {panel === 'nuevo' && (
            <form className="usuarios-form" onSubmit={crearUsuario}>
              <div className="usuarios-panel-titulo">
                <span>Nuevo Usuario</span>
                <button type="button" className="usuarios-panel-cerrar" onClick={cerrarPanel}>
                  ✕
                </button>
              </div>
              {panelError && <div className="alert alert-danger">{panelError}</div>}
              <div className="field">
                <label>Nombre</label>
                <input required value={nuevoUsuario.nombre} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, nombre: e.target.value })} />
              </div>
              <div className="field">
                <label>Usuario (login)</label>
                <input required value={nuevoUsuario.usuario} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, usuario: e.target.value })} />
              </div>
              <div className="field">
                <label>Rol</label>
                <select value={nuevoUsuario.rol} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, rol: e.target.value })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {etiquetaRol(r)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Contraseña (mínimo 8 caracteres)</label>
                <input required type="password" minLength={8} value={nuevoUsuario.password} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, password: e.target.value })} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={guardando} style={{ width: '100%' }}>
                {guardando ? 'Creando…' : 'Crear Usuario'}
              </button>
            </form>
          )}

          {panel === 'detalle' && detalle && edicion && (
            <div className="usuarios-detalle">
              <div className="usuarios-panel-titulo">
                <span>{detalle.nombre}</span>
                <button type="button" className="usuarios-panel-cerrar" onClick={cerrarPanel}>
                  ✕
                </button>
              </div>
              {panelError && <div className="alert alert-danger">{panelError}</div>}
              {panelExito && (
                <div className="alert" style={{ background: 'rgba(14,75,56,0.08)', color: '#0e4b38', border: '1px solid rgba(14,75,56,0.25)' }}>
                  {panelExito}
                </div>
              )}

              <div className="field">
                <label>Nombre</label>
                <input value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} />
              </div>
              <div className="field">
                <label>Usuario (login)</label>
                <input value={edicion.usuario} onChange={(e) => setEdicion({ ...edicion, usuario: e.target.value })} />
              </div>
              <div className="field">
                <label>Rol</label>
                <select value={edicion.rol} onChange={(e) => setEdicion({ ...edicion, rol: e.target.value })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {etiquetaRol(r)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Nueva contraseña (dejar vacío para no cambiarla)</label>
                <input type="password" minLength={8} value={edicion.password} onChange={(e) => setEdicion({ ...edicion, password: e.target.value })} />
                <span className="usuarios-hint">
                  Cambiar el rol o la contraseña cierra la sesión activa de este usuario de inmediato
                  {detalle.id === sesionActual?.usuarioId ? ' — incluida esta misma sesión, si cambiás rol o contraseña vas a tener que volver a loguearte.' : '.'}
                </span>
              </div>
              <button type="button" className="btn btn-primary" disabled={guardando} onClick={guardarUsuario}>
                {guardando ? 'Guardando…' : 'Guardar cambios'}
              </button>

              <div className="usuarios-eliminar">
                {!confirmandoEliminar ? (
                  <button type="button" className="usuarios-eliminar-link" onClick={() => setConfirmandoEliminar(true)}>
                    Eliminar usuario
                  </button>
                ) : (
                  <div className="usuarios-eliminar-confirm">
                    <span>¿Eliminar a "{detalle.nombre}"?</span>
                    <div>
                      <button type="button" className="btn" onClick={() => setConfirmandoEliminar(false)}>
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
                        disabled={guardando}
                        onClick={eliminarUsuario}
                      >
                        Sí, eliminar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
