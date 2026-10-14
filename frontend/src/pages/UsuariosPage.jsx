import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { etiquetaRol } from '../constants/roles.js';
import { formatearFechaHora } from '../utils/format.js';
import './UsuariosPage.css';

const ROLES = ['admin', 'encargado', 'cajero'];
// A los Administradores los da de alta, restablece y da de baja CEA Servicios desde su panel
// (EST-01 §5): acá el Admin gestiona Encargados y Cajeros, y ve a los Administradores.
const ROLES_CREABLES = ['encargado', 'cajero'];
const ETIQUETA_KPI = { admin: 'Dueño / Administrador', encargado: 'Encargado / Supervisor', cajero: 'Empleado / Cajero' };

// bloqueado_hasta viene en UTC sin zona ('YYYY-MM-DD HH:MM:SS'): sin la 'Z' el navegador lo
// leía como hora local y un bloqueo de 15 min se veía 3 h de más (mismo criterio que
// formatearFechaHora en utils/format.js).
function estaBloqueado(usuario) {
  return usuario.bloqueado_hasta && new Date(`${usuario.bloqueado_hasta.replace(' ', 'T')}Z`) > new Date();
}

// Los usuarios nuevos entran con su email; los anteriores a eso, con un usuario aparte.
function entraConUsuarioAparte(usuario) {
  return !usuario.email || usuario.usuario.toLowerCase() !== usuario.email.toLowerCase();
}

function textoCupo(cupo) {
  if (cupo?.rol === 'admin') return 'Los da de alta CEA Servicios';
  if (!cupo || cupo.tope === null) return 'Sin lugares habilitados';
  return `Tope ${cupo.tope} · ${cupo.libres === 1 ? '1 libre' : `${cupo.libres} libres`}`;
}

const usuarioVacio = (rol) => ({ nombre: '', email: '', rol, password: '', dos_fa: false });

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState([]);
  const [cupos, setCupos] = useState([]);
  const [correoDisponible, setCorreoDisponible] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [panel, setPanel] = useState('ninguno'); // 'ninguno' | 'nuevo' | 'detalle'
  const [detalle, setDetalle] = useState(null);
  const [edicion, setEdicion] = useState(null);
  const [nuevoUsuario, setNuevoUsuario] = useState(usuarioVacio('cajero'));
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [panelError, setPanelError] = useState(null);
  const [panelExito, setPanelExito] = useState(null);
  // Guardia real contra doble-click en "Sí, eliminar" (hallazgo Baja #3,
  // verificador-funcional 2026-09-10) -- ref mutado sincrónicamente, no
  // depende de que React ya haya re-renderizado con `guardando=true`.
  const eliminandoRef = useRef(false);
  // Guardia sincrónica de "Crear Usuario": `disabled={guardando}` no alcanza contra dos clicks en el mismo
  // tick (mandaba dos pedidos).
  const creandoRef = useRef(false);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const data = await api.get('/usuarios');
      setUsuarios(data.usuarios);
      setCupos(data.cupos);
      setCorreoDisponible(data.correo_disponible);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los usuarios.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const cupoDe = (rol) => cupos.find((c) => c.rol === rol);
  const hayLugar = (rol) => (cupoDe(rol)?.libres ?? 0) > 0;
  const puedeCrear = ROLES_CREABLES.some(hayLugar);

  function abrirNuevo() {
    setPanel('nuevo');
    setNuevoUsuario(usuarioVacio(ROLES_CREABLES.find(hayLugar) ?? 'cajero'));
    setPanelError(null);
    setPanelExito(null);
  }

  function abrirDetalle(usuario) {
    setPanel('detalle');
    setDetalle(usuario);
    setEdicion({
      nombre: usuario.nombre,
      email: usuario.email ?? '',
      usuario: usuario.usuario,
      rol: usuario.rol,
      dos_fa: usuario.dos_fa,
      password: '',
    });
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
    if (creandoRef.current) return;
    creandoRef.current = true;
    setGuardando(true);
    setPanelError(null);
    try {
      await api.post('/usuarios', nuevoUsuario);
      await cargar();
      cerrarPanel();
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario.');
    } finally {
      creandoRef.current = false;
      setGuardando(false);
    }
  }

  async function guardarUsuario() {
    setGuardando(true);
    setPanelError(null);
    try {
      const payload = { nombre: edicion.nombre, rol: edicion.rol, dos_fa: edicion.dos_fa };
      const email = edicion.email.trim();
      if (email && email.toLowerCase() !== (detalle.email ?? '').toLowerCase()) payload.email = email;
      if (entraConUsuarioAparte(detalle) && edicion.usuario !== detalle.usuario) payload.usuario = edicion.usuario;
      if (edicion.password) payload.password = edicion.password;
      const actualizado = await api.patch(`/usuarios/${detalle.id}`, payload);
      setDetalle(actualizado);
      setEdicion({ ...edicion, email: actualizado.email ?? '', usuario: actualizado.usuario, password: '' });
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

  if (cargando && usuarios.length === 0) {
    return <div className="card usuarios-vacio">Cargando…</div>;
  }

  return (
    <div className="usuarios-page">
      <div className="usuarios-kpis">
        {ROLES.map((rol) => (
          <div className="card usuarios-kpi" key={rol}>
            <span className="usuarios-kpi-label">{ETIQUETA_KPI[rol]}</span>
            <span className="usuarios-kpi-value">{usuarios.filter((u) => u.rol === rol).length}</span>
            <span className={`usuarios-kpi-cupo${rol === 'admin' || hayLugar(rol) ? '' : ' usuarios-kpi-cupo-lleno'}`}>
              {textoCupo(cupoDe(rol))}
            </span>
          </div>
        ))}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {!correoDisponible && (
        <div className="alert alert-aviso">
          Todavía no está configurado el correo de la empresa: los usuarios entran sin verificar su email (se les va a pedir cuando se
          configure) y no se puede activar el 2FA. Lo configura CEA Servicios.
        </div>
      )}

      <div className="usuarios-body">
        <div className="card usuarios-lista">
          <div className="usuarios-lista-header">
            <span className="usuarios-titulo">Usuarios del sistema</span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={abrirNuevo}
              disabled={!puedeCrear}
              title={puedeCrear ? undefined : 'No quedan lugares libres'}
            >
              + Nuevo Usuario
            </button>
          </div>
          <div className="usuarios-tabla">
            <div className="usuarios-tabla-head">
              <span style={{ flex: 1.4 }}>Nombre</span>
              <span style={{ flex: 1.6 }}>Email / usuario</span>
              <span style={{ flex: 1 }}>Rol</span>
              <span style={{ flex: 1.1 }}>Estado</span>
            </div>
            {usuarios.map((u) => {
              // Los Administradores no verifican el email con un código: su resguardo es la verificación en dos pasos.
              const sinVerificar = u.rol !== 'admin' && u.email && !u.email_verificado_en;
              return (
                <button type="button" className="usuarios-fila" key={u.id} onClick={() => abrirDetalle(u)}>
                  <span style={{ flex: 1.4 }} className="usuarios-fila-nombre">
                    {u.nombre}
                  </span>
                  <span style={{ flex: 1.6 }} className="usuarios-fila-muted usuarios-fila-email">
                    {u.email ?? u.usuario}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span className={`usuarios-badge usuarios-badge-${u.rol}`}>{etiquetaRol(u.rol)}</span>
                  </span>
                  <span style={{ flex: 1.1 }} className="usuarios-estado">
                    <span
                      className={`usuarios-dot ${
                        estaBloqueado(u) ? 'usuarios-dot-bloqueado' : sinVerificar ? 'usuarios-dot-pendiente' : 'usuarios-dot-activo'
                      }`}
                    />
                    {estaBloqueado(u) ? 'Bloqueado' : u.debe_cambiar_password ? 'Sin primer ingreso' : sinVerificar ? 'Sin verificar' : 'Activo'}
                    {(u.dos_fa || u.dosfa_configurado) && <span className="usuarios-2fa">2FA</span>}
                  </span>
                </button>
              );
            })}
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
                <label>Email (con el que va a entrar)</label>
                <input
                  required
                  type="email"
                  maxLength={100}
                  value={nuevoUsuario.email}
                  onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, email: e.target.value })}
                />
                <span className="usuarios-hint">
                  {correoDisponible
                    ? 'La primera vez que entre le va a llegar un código a este email para confirmar que es suyo.'
                    : 'Cuando se configure el correo de la empresa, le va a llegar un código a este email para confirmar que es suyo.'}
                </span>
              </div>
              <div className="field">
                <label>Rol</label>
                <select value={nuevoUsuario.rol} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, rol: e.target.value })}>
                  {ROLES_CREABLES.map((r) => (
                    <option key={r} value={r} disabled={!hayLugar(r)}>
                      {etiquetaRol(r)}
                      {hayLugar(r) ? '' : ' (sin lugares libres)'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Contraseña (mínimo 8 caracteres)</label>
                <input required type="password" minLength={8} value={nuevoUsuario.password} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, password: e.target.value })} />
              </div>
              <label className="usuarios-check">
                <input
                  type="checkbox"
                  checked={nuevoUsuario.dos_fa}
                  disabled={!correoDisponible}
                  onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, dos_fa: e.target.checked })}
                />
                <span>
                  Activar 2FA
                  <span className="usuarios-hint">
                    {correoDisponible
                      ? ' — pide un código por mail al entrar, una vez por semana en cada navegador.'
                      : ' — necesita el correo de la empresa, que todavía no está configurado.'}
                  </span>
                </span>
              </label>
              <button type="submit" className="btn btn-primary" disabled={guardando} style={{ width: '100%' }}>
                {guardando ? 'Creando…' : 'Crear Usuario'}
              </button>
            </form>
          )}

          {panel === 'detalle' && detalle && detalle.rol === 'admin' && (
            <div className="usuarios-detalle">
              <div className="usuarios-panel-titulo">
                <span>{detalle.nombre}</span>
                <button type="button" className="usuarios-panel-cerrar" onClick={cerrarPanel}>
                  ✕
                </button>
              </div>
              <dl className="usuarios-ficha">
                <dt>Email</dt>
                <dd>{detalle.email ?? detalle.usuario}</dd>
                <dt>Rol</dt>
                <dd>{etiquetaRol(detalle.rol)}</dd>
                <dt>Verificación en dos pasos</dt>
                <dd>{detalle.dosfa_configurado ? 'Activa' : 'Sin configurar (la configura al entrar)'}</dd>
                <dt>Último ingreso</dt>
                <dd>{detalle.ultimo_acceso ? formatearFechaHora(detalle.ultimo_acceso) : 'Todavía no ingresó'}</dd>
              </dl>
              <p className="usuarios-hint">
                A los Administradores los gestiona CEA Servicios: alta, contraseña nueva, verificación en dos pasos y baja. Para
                cambiar tu propia contraseña, entrá a Mi cuenta (arriba a la derecha).
              </p>
            </div>
          )}

          {panel === 'detalle' && detalle && detalle.rol !== 'admin' && edicion && (
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
                <label>Email</label>
                <input
                  type="email"
                  maxLength={100}
                  value={edicion.email}
                  onChange={(e) => setEdicion({ ...edicion, email: e.target.value })}
                  placeholder={detalle.email ? undefined : 'Sin email'}
                />
                <span className="usuarios-hint">
                  {!detalle.email
                    ? 'Sin email: entra con su usuario, sin código. Si le cargás uno, se confirma con un código en su próximo ingreso.'
                    : detalle.email_verificado_en
                      ? 'Email confirmado. Si lo cambiás, se vuelve a confirmar con un código en su próximo ingreso.'
                      : 'Sin confirmar: se confirma con el código que le llega en su próximo ingreso.'}
                </span>
              </div>
              {entraConUsuarioAparte(detalle) && (
                <div className="field">
                  <label>Usuario (login)</label>
                  <input value={edicion.usuario} onChange={(e) => setEdicion({ ...edicion, usuario: e.target.value })} />
                </div>
              )}
              <div className="field">
                <label>Rol</label>
                <select value={edicion.rol} onChange={(e) => setEdicion({ ...edicion, rol: e.target.value })}>
                  {ROLES_CREABLES.map((r) => (
                    <option key={r} value={r} disabled={r !== detalle.rol && !hayLugar(r)}>
                      {etiquetaRol(r)}
                      {r !== detalle.rol && !hayLugar(r) ? ' (sin lugares libres)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <label className="usuarios-check">
                <input
                  type="checkbox"
                  checked={edicion.dos_fa}
                  disabled={!edicion.dos_fa && (!edicion.email.trim() || !correoDisponible)}
                  onChange={(e) => setEdicion({ ...edicion, dos_fa: e.target.checked })}
                />
                <span>
                  2FA
                  <span className="usuarios-hint">
                    {edicion.dos_fa || (edicion.email.trim() && correoDisponible)
                      ? ' — pide un código por mail al entrar, una vez por semana en cada navegador.'
                      : !edicion.email.trim()
                        ? ' — necesita un email cargado.'
                        : ' — necesita el correo de la empresa, que todavía no está configurado.'}
                  </span>
                </span>
              </label>
              <div className="field">
                <label>Nueva contraseña (dejar vacío para no cambiarla)</label>
                <input type="password" minLength={8} value={edicion.password} onChange={(e) => setEdicion({ ...edicion, password: e.target.value })} />
                <span className="usuarios-hint">Cambiar el rol o la contraseña cierra la sesión activa de este usuario de inmediato.</span>
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
