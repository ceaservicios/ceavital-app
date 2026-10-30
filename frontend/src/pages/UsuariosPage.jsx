import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import { colorDe } from '../utils/colores.js';
import { etiquetaRol, iniciales } from '../constants/roles.js';
import { formatearFechaHora } from '../utils/format.js';
import './UsuariosPage.css';

const ROLES = ['admin', 'encargado', 'cajero'];
// A los Administradores los da de alta, restablece y da de baja CEA Servicios desde su panel
// (EST-01 §5): acá el Admin gestiona Encargados y Cajeros, y ve a los Administradores.
const ROLES_CREABLES = ['encargado', 'cajero'];
const ETIQUETA_KPI = { admin: 'Administradores', encargado: 'Encargados', cajero: 'Cajeros' };

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
  if (cupo?.rol === 'admin') return 'Alta por CEA Servicios';
  if (!cupo || cupo.tope === null) return 'Sin cupo habilitado';
  return `Cupo ${cupo.tope} · ${cupo.libres === 1 ? '1 disponible' : `${cupo.libres} disponibles`}`;
}

const IconoMas = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IconoFlecha = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

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
  // Misma guardia para "Guardar cambios" (con dos clicks, el segundo PATCH volvía a cerrar la sesión del usuario).
  const guardandoRef = useRef(false);

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
    if (guardandoRef.current) return;
    guardandoRef.current = true;
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
      guardandoRef.current = false;
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
    return <div className="card usuarios-cargando">Cargando…</div>;
  }

  // Rediseño 2026-10-29: la lista ocupa todo el ancho; el alta y la ficha de un usuario se abren
  // en su lugar, en un formulario de ancho proporcionado (antes era un panel lateral que quedaba
  // vacío y angosto al lado de la lista).
  const conPanel = panel !== 'ninguno';

  return (
    <div className="usuarios-page">
      <Hero
        etiqueta="Usuarios del sistema"
        valor={usuarios.length}
        sub="Cada rol tiene su cupo según el plan."
        minis={ROLES.map((rol) => ({
          etiqueta: ETIQUETA_KPI[rol],
          valor: usuarios.filter((u) => u.rol === rol).length,
          sub: textoCupo(cupoDe(rol)),
          icono: 'usuarios',
          tono: { admin: 'verde', encargado: 'azul', cajero: 'amarillo' }[rol] ?? 'blanco',
        }))}
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {!correoDisponible && (
        <div className="alert alert-aviso">
          El correo de la empresa todavía no está configurado: los usuarios ingresan sin verificar su email y no se puede activar la
          verificación en dos pasos. La configuración está a cargo de CEA Servicios.
        </div>
      )}

      {!conPanel && (
        <div className="card usuarios-lista">
          <div className="usuarios-lista-header">
            <div className="usuarios-lista-titulos">
              <h2 className="usuarios-titulo">Usuarios del sistema</h2>
              {!puedeCrear && (
                <span className="usuarios-hint">No hay cupos disponibles para nuevos usuarios. Para ampliarlos, contactá a CEA Servicios.</span>
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={abrirNuevo}
              disabled={!puedeCrear}
              title={puedeCrear ? undefined : 'No quedan lugares libres'}
            >
              <IconoMas />
              Agregar usuario
            </button>
          </div>
          <div className="usuarios-tabla">
            <div className="usuarios-tabla-head">
              <span style={{ flex: 2.4 }}>Usuario</span>
              <span style={{ flex: 1.1 }}>Rol</span>
              <span style={{ flex: 1.5 }}>Estado</span>
              <span style={{ flex: 1.3 }}>Último ingreso</span>
              <span className="usuarios-col-flecha" />
            </div>
            {usuarios.map((u) => {
              // Los Administradores no verifican el email con un código: su resguardo es la verificación en dos pasos.
              const sinVerificar = u.rol !== 'admin' && u.email && !u.email_verificado_en;
              return (
                <button type="button" className="usuarios-fila" key={u.id} onClick={() => abrirDetalle(u)}>
                  <span style={{ flex: 2.4 }} className="usuarios-fila-usuario">
                    <span className="usuarios-avatar avatar-color" style={{ '--c': colorDe(u.id) }} aria-hidden="true">
                      {iniciales(u.nombre)}
                    </span>
                    <span className="usuarios-fila-textos">
                      <span className="usuarios-fila-nombre">{u.nombre}</span>
                      <span className="usuarios-fila-sub celda-ellipsis" title={u.email ?? u.usuario}>
                        {u.email ?? u.usuario}
                      </span>
                    </span>
                  </span>
                  <span style={{ flex: 1.1 }} className="usuarios-fila-rol">
                    <span className={`usuarios-badge usuarios-badge-${u.rol}`}>{etiquetaRol(u.rol)}</span>
                  </span>
                  <span style={{ flex: 1.5 }} className="usuarios-estado">
                    <span className="usuarios-estado-linea">
                      <span
                        className={`usuarios-dot ${
                          estaBloqueado(u) ? 'usuarios-dot-bloqueado' : sinVerificar ? 'usuarios-dot-pendiente' : 'usuarios-dot-activo'
                        }`}
                      />
                      {estaBloqueado(u)
                        ? 'Bloqueado'
                        : u.debe_cambiar_password
                          ? 'Primer ingreso pendiente'
                          : sinVerificar
                            ? 'Email sin verificar'
                            : 'Activo'}
                    </span>
                    {(u.dos_fa || u.dosfa_configurado) && <span className="usuarios-fila-sub">Verificación en dos pasos</span>}
                  </span>
                  <span style={{ flex: 1.3 }} className="usuarios-fila-fecha num">
                    {u.ultimo_acceso ? formatearFechaHora(u.ultimo_acceso) : <span className="usuarios-sin-dato">Sin ingresos</span>}
                  </span>
                  <span className="usuarios-col-flecha">
                    <IconoFlecha />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {panel === 'nuevo' && (
        <form className="card usuarios-form-card" onSubmit={crearUsuario}>
          <div className="usuarios-form-cabecera">
            <h2 className="usuarios-form-titulo">Nuevo usuario</h2>
            <span className="usuarios-hint">Alta de Encargados y Cajeros. Las altas de Administradores están a cargo de CEA Servicios.</span>
          </div>
          {panelError && <div className="alert alert-danger">{panelError}</div>}
          <div className="usuarios-campos">
            <div className="field usuarios-campo-full">
              <label htmlFor="nuevo-nombre">Nombre y apellido</label>
              <input
                id="nuevo-nombre"
                required
                value={nuevoUsuario.nombre}
                onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, nombre: e.target.value })}
              />
            </div>
            <div className="field usuarios-campo-full">
              <label htmlFor="nuevo-email">Email</label>
              <input
                id="nuevo-email"
                required
                type="email"
                maxLength={100}
                value={nuevoUsuario.email}
                onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, email: e.target.value })}
              />
              <span className="usuarios-hint">
                {correoDisponible
                  ? 'Lo usa para ingresar. En el primer ingreso recibe un código en este email para confirmarlo.'
                  : 'Lo usa para ingresar. Cuando se configure el correo de la empresa, se le va a pedir confirmarlo con un código.'}
              </span>
            </div>
            <div className="field">
              <label htmlFor="nuevo-rol">Rol</label>
              <select id="nuevo-rol" value={nuevoUsuario.rol} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, rol: e.target.value })}>
                {ROLES_CREABLES.map((r) => (
                  <option key={r} value={r} disabled={!hayLugar(r)}>
                    {etiquetaRol(r)}
                    {hayLugar(r) ? '' : ' (sin cupo disponible)'}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="nuevo-password">Contraseña inicial</label>
              <input
                id="nuevo-password"
                required
                type="password"
                minLength={8}
                maxLength={72}
                value={nuevoUsuario.password}
                onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, password: e.target.value })}
              />
              <span className="usuarios-hint">Mínimo 8 caracteres.</span>
            </div>
            <label className="usuarios-check usuarios-campo-full">
              <input
                type="checkbox"
                checked={nuevoUsuario.dos_fa}
                disabled={!correoDisponible}
                onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, dos_fa: e.target.checked })}
              />
              <span className="usuarios-check-textos">
                <span className="usuarios-check-titulo">Verificación en dos pasos</span>
                <span className="usuarios-hint">
                  {correoDisponible
                    ? 'Pide un código por email al ingresar, una vez por semana en cada navegador.'
                    : 'Requiere el correo de la empresa, que todavía no está configurado.'}
                </span>
              </span>
            </label>
          </div>
          <div className="usuarios-form-acciones">
            <button type="button" className="btn" onClick={cerrarPanel}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </form>
      )}

      {panel === 'detalle' && detalle && detalle.rol === 'admin' && (
        <div className="card usuarios-form-card">
          <div className="usuarios-ficha-cabecera">
            <span className="usuarios-avatar usuarios-avatar-grande avatar-color" style={{ '--c': colorDe(detalle.id) }} aria-hidden="true">
              {iniciales(detalle.nombre)}
            </span>
            <div className="usuarios-ficha-nombre">
              <h2 className="usuarios-form-titulo">{detalle.nombre}</h2>
              <span className="usuarios-fila-sub">Gestionado por CEA Servicios</span>
            </div>
            <span className={`usuarios-badge usuarios-badge-${detalle.rol}`}>{etiquetaRol(detalle.rol)}</span>
          </div>
          <dl className="usuarios-ficha">
            <div>
              <dt>Email o usuario</dt>
              <dd>{detalle.email ?? detalle.usuario}</dd>
            </div>
            <div>
              <dt>Rol</dt>
              <dd>{etiquetaRol(detalle.rol)}</dd>
            </div>
            <div>
              <dt>Verificación en dos pasos</dt>
              <dd>{detalle.dosfa_configurado ? 'Activa' : 'Sin configurar (se configura al ingresar)'}</dd>
            </div>
            <div>
              <dt>Último ingreso</dt>
              <dd>{detalle.ultimo_acceso ? formatearFechaHora(detalle.ultimo_acceso) : 'Todavía no ingresó'}</dd>
            </div>
          </dl>
          <p className="usuarios-nota">
            Los Administradores los gestiona CEA Servicios: alta, contraseña, verificación en dos pasos y baja. Para cambiar tu propia
            contraseña, ingresá a Mi cuenta.
          </p>
          <div className="usuarios-form-acciones">
            <button type="button" className="btn" onClick={cerrarPanel}>
              Volver al listado
            </button>
          </div>
        </div>
      )}

      {panel === 'detalle' && detalle && detalle.rol !== 'admin' && edicion && (
        <div className="card usuarios-form-card">
          <div className="usuarios-ficha-cabecera">
            <span className="usuarios-avatar usuarios-avatar-grande avatar-color" style={{ '--c': colorDe(detalle.id) }} aria-hidden="true">
              {iniciales(detalle.nombre)}
            </span>
            <div className="usuarios-ficha-nombre">
              <h2 className="usuarios-form-titulo">{detalle.nombre}</h2>
              <span className="usuarios-fila-sub">
                {detalle.ultimo_acceso ? `Último ingreso: ${formatearFechaHora(detalle.ultimo_acceso)}` : 'Todavía no ingresó'}
              </span>
            </div>
            <span className={`usuarios-badge usuarios-badge-${detalle.rol}`}>{etiquetaRol(detalle.rol)}</span>
          </div>
          {panelError && <div className="alert alert-danger">{panelError}</div>}
          {panelExito && <div className="alert alert-exito">{panelExito}</div>}

          <div className="usuarios-campos">
            <div className="field">
              <label htmlFor="edicion-nombre">Nombre y apellido</label>
              <input id="edicion-nombre" value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="edicion-rol">Rol</label>
              <select id="edicion-rol" value={edicion.rol} onChange={(e) => setEdicion({ ...edicion, rol: e.target.value })}>
                {ROLES_CREABLES.map((r) => (
                  <option key={r} value={r} disabled={r !== detalle.rol && !hayLugar(r)}>
                    {etiquetaRol(r)}
                    {r !== detalle.rol && !hayLugar(r) ? ' (sin cupo disponible)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field usuarios-campo-full">
              <label htmlFor="edicion-email">Email</label>
              <input
                id="edicion-email"
                type="email"
                maxLength={100}
                value={edicion.email}
                onChange={(e) => setEdicion({ ...edicion, email: e.target.value })}
                placeholder={detalle.email ? undefined : 'Sin email'}
              />
              <span className="usuarios-hint">
                {!detalle.email
                  ? 'Sin email: ingresa con su usuario y sin código. Si se le registra uno, lo confirma con un código en su próximo ingreso.'
                  : detalle.email_verificado_en
                    ? 'Email confirmado. Si se modifica, se vuelve a confirmar con un código en su próximo ingreso.'
                    : 'Sin confirmar: lo confirma con el código que recibe en su próximo ingreso.'}
              </span>
            </div>
            {entraConUsuarioAparte(detalle) && (
              <div className="field">
                <label htmlFor="edicion-usuario">Usuario de ingreso</label>
                <input id="edicion-usuario" value={edicion.usuario} onChange={(e) => setEdicion({ ...edicion, usuario: e.target.value })} />
              </div>
            )}
            <div className="field">
              <label htmlFor="edicion-password">Nueva contraseña</label>
              <input
                id="edicion-password"
                type="password"
                minLength={8}
                maxLength={72}
                value={edicion.password}
                onChange={(e) => setEdicion({ ...edicion, password: e.target.value })}
              />
              <span className="usuarios-hint">Dejala vacía para mantener la actual.</span>
            </div>
            <label className="usuarios-check usuarios-campo-full">
              <input
                type="checkbox"
                checked={edicion.dos_fa}
                disabled={!edicion.dos_fa && (!edicion.email.trim() || !correoDisponible)}
                onChange={(e) => setEdicion({ ...edicion, dos_fa: e.target.checked })}
              />
              <span className="usuarios-check-textos">
                <span className="usuarios-check-titulo">Verificación en dos pasos</span>
                <span className="usuarios-hint">
                  {edicion.dos_fa || (edicion.email.trim() && correoDisponible)
                    ? 'Pide un código por email al ingresar, una vez por semana en cada navegador.'
                    : !edicion.email.trim()
                      ? 'Requiere un email registrado.'
                      : 'Requiere el correo de la empresa, que todavía no está configurado.'}
                </span>
              </span>
            </label>
          </div>

          <div className="usuarios-form-pie">
            <span className="usuarios-hint">Cambiar el rol o la contraseña cierra de inmediato la sesión activa de este usuario.</span>
            <div className="usuarios-form-acciones">
              <button type="button" className="btn" onClick={cerrarPanel}>
                Volver al listado
              </button>
              <button type="button" className="btn btn-primary" disabled={guardando} onClick={guardarUsuario}>
                {guardando ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>

          <div className="usuarios-eliminar">
            {!confirmandoEliminar ? (
              <button type="button" className="usuarios-eliminar-link" onClick={() => setConfirmandoEliminar(true)}>
                Eliminar usuario
              </button>
            ) : (
              <div className="usuarios-eliminar-confirm">
                <span>¿Eliminar a "{detalle.nombre}"? Ya no va a poder ingresar al sistema.</span>
                <div>
                  <button type="button" className="btn" onClick={() => setConfirmandoEliminar(false)}>
                    Cancelar
                  </button>
                  <button type="button" className="btn btn-peligro" disabled={guardando} onClick={eliminarUsuario}>
                    Eliminar usuario
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
