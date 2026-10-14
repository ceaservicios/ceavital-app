import { useState } from 'react';
import { api } from '../api/client.js';
import { formatearFechaHora } from '../utils/format.js';

// Administradores del negocio (EST-01 §5): los da de alta solo el superadmin, con una contraseña
// provisoria que se ve una sola vez (y sale por mail si el correo de la empresa está configurado).
// Al entrar eligen su contraseña y activan la verificación en dos pasos.

const METODO = { app: 'App', mail: 'Mail' };

// bloqueado_hasta viene en UTC sin zona ('YYYY-MM-DD HH:MM:SS'): sin la 'Z' se leería como hora local.
const estaBloqueado = (a) => a.bloqueado_hasta && new Date(`${a.bloqueado_hasta.replace(' ', 'T')}Z`) > new Date();

function estadoDe(a) {
  if (a.eliminado_en) return { texto: 'Dado de baja', clase: 'sa-chip-neutro' };
  if (estaBloqueado(a)) return { texto: 'Bloqueado', clase: 'sa-chip-alerta' };
  if (a.debe_cambiar_password) return { texto: 'Contraseña provisoria', clase: 'sa-chip-aviso' };
  return { texto: 'Activo', clase: 'sa-chip-ok' };
}

const PREGUNTA = {
  password: '¿Generar una contraseña provisoria nueva? Se le cierra la sesión.',
  dosfa: '¿Restablecer su verificación en dos pasos? La vuelve a configurar al entrar.',
  baja: '¿Dar de baja a este Administrador? Se le cierra la sesión; sus datos se conservan.',
};

export default function SuperadminAdmins({ administradores, cupo, correoEmpresa, ocupado, ejecutar }) {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [credenciales, setCredenciales] = useState(null); // { usuario, sin_email, password, por_mail }
  const [confirmando, setConfirmando] = useState(null); // { id, accion }
  const [copiada, setCopiada] = useState(false);

  const sinTope = !cupo || cupo.tope === null;
  const hayLugar = !sinTope && cupo.libres > 0;

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
      baja: () => api.post(`/sa/administradores/${admin.id}/baja`, {}),
      reactivar: () => api.post(`/sa/administradores/${admin.id}/reactivar`, {}),
    };
    const mensajes = {
      password: 'Contraseña provisoria nueva generada.',
      dosfa: 'Verificación en dos pasos restablecida: la vuelve a configurar al entrar.',
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
      <h2 className="sa-h2">Administradores del negocio</h2>
      <p className="sa-ayuda">
        Los da de alta CEA. Al entrar por primera vez eligen su contraseña y activan la verificación en dos pasos.{' '}
        {sinTope ? 'Cargá el tope de Administradores (arriba) para poder crear uno.' : `Tope ${cupo.tope} · en uso ${cupo.usados}.`}
      </p>

      {credenciales && (
        <div className="sa-credenciales">
          <p>
            Entra con el usuario <strong>{credenciales.usuario}</strong> y esta contraseña provisoria:
          </p>
          <div className="sa-credenciales-fila">
            <code className="sa-credenciales-clave">{credenciales.password}</code>
            <button type="button" className="btn sa-btn-chico" onClick={copiar}>
              {copiada ? 'Copiada' : 'Copiar'}
            </button>
          </div>
          <p className="sa-ayuda">
            {credenciales.por_mail
              ? 'También se le mandó por mail. '
              : credenciales.sin_email
                ? 'No se mandó por mail (la cuenta no tiene email): pasásela vos. '
                : correoEmpresa
                ? 'No se pudo mandar por mail: pasásela vos. '
                : 'No se mandó por mail (falta el correo de la empresa): pasásela vos. '}
            Se muestra una sola vez.
          </p>
          <div>
            <button type="button" className="btn sa-btn-chico" onClick={() => setCredenciales(null)}>
              Listo
            </button>
          </div>
        </div>
      )}

      <form className="sa-form-admin" onSubmit={crear}>
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
          <label htmlFor="sa-admin-email">Email (con el que va a entrar)</label>
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
      {!sinTope && !hayLugar && <p className="sa-ayuda">No quedan lugares libres: para sumar otro, subí el tope.</p>}

      {administradores.length > 0 && (
        <div className="sa-tabla-scroll">
          <table className="sa-tabla sa-tabla-admins">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Estado</th>
                <th>2 pasos</th>
                <th>Último ingreso</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {administradores.map((a) => {
                const estado = estadoDe(a);
                const preguntando = confirmando?.id === a.id ? confirmando.accion : null;
                return (
                  <tr key={a.id}>
                    <td>{a.nombre}</td>
                    <td className="sa-una-linea">{a.email ?? a.usuario}</td>
                    <td>
                      <span className={`sa-chip ${estado.clase}`}>{estado.texto}</span>
                    </td>
                    <td>{METODO[a.dosfa_metodo] ?? 'Sin configurar'}</td>
                    <td className="sa-una-linea">{a.ultimo_acceso ? formatearFechaHora(a.ultimo_acceso) : '—'}</td>
                    <td className="sa-admin-acciones">
                      {preguntando ? (
                        <div className="sa-confirmar">
                          <span>{PREGUNTA[preguntando]}</span>
                          <button type="button" className="btn sa-btn-chico btn-primary" disabled={ocupado} onClick={() => accionar(a, preguntando)}>
                            Sí
                          </button>
                          <button type="button" className="btn sa-btn-chico" disabled={ocupado} onClick={() => setConfirmando(null)}>
                            Cancelar
                          </button>
                        </div>
                      ) : a.eliminado_en ? (
                        <button type="button" className="btn sa-btn-chico" disabled={ocupado} onClick={() => accionar(a, 'reactivar')}>
                          Reactivar
                        </button>
                      ) : (
                        <div className="sa-admin-botones">
                          <button type="button" className="btn sa-btn-chico" disabled={ocupado} onClick={() => setConfirmando({ id: a.id, accion: 'password' })}>
                            Contraseña nueva
                          </button>
                          <button
                            type="button"
                            className="btn sa-btn-chico"
                            disabled={ocupado || !a.dosfa_metodo}
                            title={a.dosfa_metodo ? undefined : 'Todavía no la configuró'}
                            onClick={() => setConfirmando({ id: a.id, accion: 'dosfa' })}
                          >
                            Restablecer 2 pasos
                          </button>
                          <button type="button" className="btn sa-btn-chico sa-btn-peligro" disabled={ocupado} onClick={() => setConfirmando({ id: a.id, accion: 'baja' })}>
                            Dar de baja
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
