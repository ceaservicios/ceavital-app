import { Fragment, useState } from 'react';
import { api } from '../api/client.js';
import { formatearFechaHora } from '../utils/format.js';

// Administradores del negocio (EST-01 §5): los da de alta solo el superadmin, con una contraseña
// provisoria que se ve una sola vez (y sale por mail si el correo de la empresa está configurado).
// Al entrar eligen su contraseña y activan la verificación en dos pasos, salvo que el superadmin
// se la desactive: entonces entra solo con la contraseña y no la puede activar él desde "Mi cuenta".
// Diseño (2026-10-29): cada Administrador ocupa dos renglones de la tabla: sus datos y, debajo, sus
// acciones (o la confirmación de la que se eligió) a todo el ancho. En el celular, un bloque por cada uno.

const METODO = { app: 'App autenticadora', mail: 'Código por mail' };

// bloqueado_hasta viene en UTC sin zona ('YYYY-MM-DD HH:MM:SS'): sin la 'Z' se leería como hora local.
const estaBloqueado = (a) => a.bloqueado_hasta && new Date(`${a.bloqueado_hasta.replace(' ', 'T')}Z`) > new Date();

function estadoDe(a) {
  if (a.eliminado_en) return { texto: 'Dado de baja', clase: 'sa-chip-neutro' };
  if (estaBloqueado(a)) return { texto: 'Bloqueado', clase: 'sa-chip-alerta' };
  if (a.debe_cambiar_password) return { texto: 'Contraseña provisoria', clase: 'sa-chip-info' };
  return { texto: 'Activo', clase: 'sa-chip-ok' };
}

const PREGUNTA = {
  password: '¿Generar una contraseña provisoria nueva? Se cierra su sesión.',
  dosfa: '¿Restablecer su verificación en dos pasos? La configura de nuevo al ingresar.',
  desactivar: '¿Desactivar su verificación en dos pasos? Ingresa solo con la contraseña y se borra la configuración actual.',
  activar: '¿Activar su verificación en dos pasos? Se cierra su sesión y la configura al ingresar.',
  baja: '¿Dar de baja a este Administrador? Se cierra su sesión; sus datos se conservan.',
};

// Texto del botón que confirma cada acción (en lugar de "Sí").
const CONFIRMAR = {
  password: 'Generar contraseña',
  dosfa: 'Restablecer verificación',
  desactivar: 'Desactivar verificación',
  activar: 'Activar verificación',
  baja: 'Dar de baja',
};

export default function SuperadminAdmins({ administradores, cupo, correoEmpresa, ocupado, ejecutar }) {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [credenciales, setCredenciales] = useState(null); // { usuario, sin_email, password, por_mail }
  const [confirmando, setConfirmando] = useState(null); // { id, accion }
  const [emailNuevo, setEmailNuevo] = useState('');
  const [copiada, setCopiada] = useState(false);

  const sinTope = !cupo || cupo.tope === null;
  const hayLugar = !sinTope && cupo.libres > 0;
  // Al único Administrador activo no se lo da de baja (el negocio quedaría sin Administrador).
  const unicoActivo = administradores.filter((a) => !a.eliminado_en).length <= 1;

  function pedirEmail(admin) {
    setEmailNuevo(admin.email ?? '');
    setConfirmando({ id: admin.id, accion: 'email' });
  }

  function mostrarCredenciales(datos) {
    setCredenciales(datos);
    setCopiada(false);
  }

  function crear(e) {
    e.preventDefault();
    ejecutar(async () => {
      const r = await api.post('/sa/administradores', { nombre, email });
      mostrarCredenciales({
        usuario: r.administrador.email ?? r.administrador.usuario,
        sin_email: !r.administrador.email,
        password: r.password_provisoria,
        por_mail: r.por_mail,
      });
      setNombre('');
      setEmail('');
    }, 'Administrador creado.');
  }

  function accionar(admin, accion) {
    const pedidos = {
      password: async () => {
        const r = await api.post(`/sa/administradores/${admin.id}/password`, {});
        mostrarCredenciales({
          usuario: r.usuario ?? admin.email ?? admin.usuario,
          sin_email: !r.email,
          password: r.password_provisoria,
          por_mail: r.por_mail,
        });
      },
      dosfa: () => api.post(`/sa/administradores/${admin.id}/2fa`, {}),
      desactivar: () => api.post(`/sa/administradores/${admin.id}/2fa/desactivar`, {}),
      activar: () => api.post(`/sa/administradores/${admin.id}/2fa/activar`, {}),
      email: () => api.post(`/sa/administradores/${admin.id}/email`, { email: emailNuevo }),
      baja: () => api.post(`/sa/administradores/${admin.id}/baja`, {}),
      reactivar: () => api.post(`/sa/administradores/${admin.id}/reactivar`, {}),
    };
    const mensajes = {
      password: 'Contraseña provisoria nueva generada.',
      dosfa: 'Verificación en dos pasos restablecida: la configura de nuevo al ingresar.',
      desactivar: 'Verificación en dos pasos desactivada: ingresa solo con la contraseña.',
      activar: 'Verificación en dos pasos activada: la configura al ingresar.',
      email: `Email actualizado: ahora ingresa con ${emailNuevo.trim()}.`,
      baja: 'Administrador dado de baja.',
      reactivar: 'Administrador reactivado.',
    };
    ejecutar(async () => {
      await pedidos[accion]();
      setConfirmando(null);
    }, mensajes[accion]);
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(credenciales.password);
      setCopiada(true);
    } catch {
      /* si el navegador no deja copiar, se anota a mano */
    }
  }

  return (
    <section className="card sa-card">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Administradores del negocio</h2>
        {/* Con espacios que no cortan: "3 de 4 en uso" no se parte en dos líneas. */}
        <span className="sa-chip sa-chip-neutro">{sinTope ? 'Sin tope cargado' : `${cupo.usados} de ${cupo.tope} en uso`}</span>
      </div>
      <p className="sa-ayuda">
        Los da de alta CEA. Al ingresar por primera vez eligen su contraseña y activan la verificación en dos pasos, que se puede desactivar para
        cada uno.
        {sinTope && ' Cargá el tope de Administradores (arriba) para poder crear uno.'}
      </p>

      {credenciales && (
        <div className="sa-credenciales" role="status">
          <p>
            Ingresa con el usuario <strong>{credenciales.usuario}</strong> y esta contraseña provisoria:
          </p>
          <div className="sa-credenciales-fila">
            <code className="sa-credenciales-clave">{credenciales.password}</code>
            <button type="button" className="btn sa-btn-chico" onClick={copiar}>
              {copiada ? 'Copiada' : 'Copiar'}
            </button>
          </div>
          <p className="sa-ayuda">
            {credenciales.por_mail
              ? 'También se envió por mail. '
              : credenciales.sin_email
                ? 'No se envió por mail porque la cuenta no tiene email: compartila por un medio seguro. '
                : correoEmpresa
                ? 'No se pudo enviar por mail: compartila por un medio seguro. '
                : 'No se envió por mail (falta el correo de la empresa): compartila por un medio seguro. '}
            Esta contraseña se muestra una sola vez.
          </p>
          <div>
            <button type="button" className="btn sa-btn-chico" onClick={() => setCredenciales(null)}>
              Cerrar
            </button>
          </div>
        </div>
      )}

      {administradores.length > 0 && (
        <div className="sa-tabla-scroll">
          <table className="sa-tabla sa-tabla-admins">
            <thead>
              <tr>
                <th>Administrador</th>
                <th>Estado</th>
                <th>Verificación en dos pasos</th>
                <th>Último ingreso</th>
              </tr>
            </thead>
            <tbody>
              {administradores.map((a) => {
                const estado = estadoDe(a);
                const preguntando = confirmando?.id === a.id ? confirmando.accion : null;
                return (
                  <Fragment key={a.id}>
                    <tr className="sa-admin-fila">
                      <td>
                        <div className="sa-admin-nombre">{a.nombre}</div>
                        <div className="sa-detalle-fila">{a.email ?? a.usuario}</div>
                      </td>
                      <td>
                        <span className={`sa-chip ${estado.clase}`}>{estado.texto}</span>
                      </td>
                      <td data-etiqueta="Verificación">
                        {a.dosfa_desactivada ? (
                          <span className="sa-chip sa-chip-aviso">Desactivada</span>
                        ) : (
                          <span className={a.dosfa_metodo ? undefined : 'sa-faltante'}>{METODO[a.dosfa_metodo] ?? 'Sin configurar'}</span>
                        )}
                      </td>
                      <td className="sa-una-linea" data-etiqueta="Último ingreso">
                        {a.ultimo_acceso ? formatearFechaHora(a.ultimo_acceso) : <span className="sa-faltante">—</span>}
                      </td>
                    </tr>
                    <tr className="sa-admin-acciones-fila">
                      <td colSpan={4}>
                        {preguntando === 'email' ? (
                          <form
                            className="sa-confirmar"
                            onSubmit={(e) => {
                              e.preventDefault();
                              accionar(a, 'email');
                            }}
                          >
                            <span>Nuevo email de ingreso de {a.nombre}. Al guardarlo se cierra su sesión.</span>
                            <input
                              type="email"
                              className="sa-admin-email-nuevo"
                              aria-label={`Email nuevo de ${a.nombre}`}
                              maxLength={100}
                              value={emailNuevo}
                              onChange={(e) => setEmailNuevo(e.target.value)}
                              disabled={ocupado}
                              required
                              autoFocus
                            />
                            <button type="submit" className="btn btn-primary" disabled={ocupado}>
                              Guardar email
                            </button>
                            <button type="button" className="btn" disabled={ocupado} onClick={() => setConfirmando(null)}>
                              Cancelar
                            </button>
                          </form>
                        ) : preguntando ? (
                          <div className="sa-confirmar">
                            <span>{PREGUNTA[preguntando]}</span>
                            <button
                              type="button"
                              className={`btn ${preguntando === 'baja' ? 'btn-peligro' : 'btn-primary'}`}
                              disabled={ocupado}
                              onClick={() => accionar(a, preguntando)}
                            >
                              {CONFIRMAR[preguntando]}
                            </button>
                            <button type="button" className="btn" disabled={ocupado} onClick={() => setConfirmando(null)}>
                              Cancelar
                            </button>
                          </div>
                        ) : a.eliminado_en ? (
                          <div className="sa-admin-botones">
                            <button type="button" className="btn sa-btn-fantasma" disabled={ocupado} onClick={() => accionar(a, 'reactivar')}>
                              Reactivar
                            </button>
                          </div>
                        ) : (
                          <div className="sa-admin-botones">
                            <button type="button" className="btn sa-btn-fantasma" disabled={ocupado} onClick={() => setConfirmando({ id: a.id, accion: 'password' })}>
                              Restablecer contraseña
                            </button>
                            <button type="button" className="btn sa-btn-fantasma" disabled={ocupado} onClick={() => pedirEmail(a)}>
                              Cambiar email
                            </button>
                            <button
                              type="button"
                              className="btn sa-btn-fantasma"
                              disabled={ocupado || a.dosfa_desactivada || !a.dosfa_metodo}
                              title={
                                a.dosfa_desactivada
                                  ? 'Tiene la verificación en dos pasos desactivada'
                                  : a.dosfa_metodo
                                    ? undefined
                                    : 'Todavía no la configuró'
                              }
                              onClick={() => setConfirmando({ id: a.id, accion: 'dosfa' })}
                            >
                              Restablecer verificación
                            </button>
                            <button
                              type="button"
                              className="btn sa-btn-fantasma"
                              disabled={ocupado}
                              onClick={() => setConfirmando({ id: a.id, accion: a.dosfa_desactivada ? 'activar' : 'desactivar' })}
                            >
                              {a.dosfa_desactivada ? 'Activar verificación' : 'Desactivar verificación'}
                            </button>
                            <button
                              type="button"
                              className="btn sa-btn-fantasma sa-btn-fantasma-peligro"
                              disabled={ocupado || unicoActivo}
                              title={unicoActivo ? 'Es el único Administrador activo: creá otro antes de darlo de baja.' : undefined}
                              onClick={() => setConfirmando({ id: a.id, accion: 'baja' })}
                            >
                              Dar de baja
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="sa-pozo">
        <h3 className="sa-h3">Nuevo Administrador</h3>
        <form className="sa-form-alta" onSubmit={crear}>
          <div className="field">
            <label htmlFor="sa-admin-nombre">Nombre</label>
            <input
              id="sa-admin-nombre"
              maxLength={200}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              disabled={ocupado || !hayLugar}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="sa-admin-email">Email de ingreso</label>
            <input
              id="sa-admin-email"
              type="email"
              maxLength={100}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={ocupado || !hayLugar}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={ocupado || !hayLugar}>
            Crear Administrador
          </button>
        </form>
        {!sinTope && !hayLugar && <p className="sa-ayuda">No quedan lugares disponibles: para crear otro, aumentá el tope.</p>}
      </div>
    </section>
  );
}
