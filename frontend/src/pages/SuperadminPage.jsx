import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, setCsrfSuperadmin } from '../api/client.js';
import { formatearFecha, formatearFechaHora } from '../utils/format.js';
import ConfigurarDosfa from '../components/ConfigurarDosfa.jsx';
import SuperadminAdmins from './SuperadminAdmins.jsx';
import SuperadminCopias from './SuperadminCopias.jsx';
import SuperadminCorreo from './SuperadminCorreo.jsx';
import SuperadminPagos from './SuperadminPagos.jsx';
import SuperadminRegistro from './SuperadminRegistro.jsx';
import SuperadminSeguridad from './SuperadminSeguridad.jsx';
import './SuperadminPage.css';

// Panel de CEA sobre esta instalación (/sa): estado, plan y módulos, cuota y sus pagos, topes de
// usuarios y Administradores del negocio, los dos correos, copias de seguridad, seguridad, registro de acciones y la
// verificación en dos pasos propia. Arriba,
// un resumen fijo (estado, plan, cuota) y abajo una pestaña por tema, con tarjetas del mismo ancho.
// Sesión propia (cookie sa_token + token CSRF en memoria), aparte del sistema del negocio. Sin la
// verificación en dos pasos configurada, lo único que se ve es la pantalla para activarla (EST-01 §4).

const PESTANAS = [
  { id: 'estado', nombre: 'Estado' },
  { id: 'plan', nombre: 'Plan' },
  { id: 'cuota', nombre: 'Cuota y pagos' },
  { id: 'usuarios', nombre: 'Usuarios' },
  { id: 'correo', nombre: 'Correo' },
  { id: 'copias', nombre: 'Copias' },
  { id: 'seguridad', nombre: 'Seguridad' },
  { id: 'registro', nombre: 'Registro' },
  { id: 'verificacion', nombre: 'Mi verificación' },
];

const ETIQUETA_AVISO = {
  por_vencer: 'Por vencer',
  vence_hoy: 'Vence hoy',
  vencida: 'Vencida',
  suspension_proxima: 'Aviso de suspensión',
  suspendida: 'Suspendida',
};

const ETIQUETA_ROL = { admin: 'Administradores', encargado: 'Encargados', cajero: 'Cajeros' };

const ESTADO_CUOTA = {
  sin_definir: { texto: 'Sin cuota definida', clase: 'sa-chip-neutro' },
  vigente: { texto: 'Cuota vigente', clase: 'sa-chip-ok' },
  por_vencer: { texto: 'Cuota por vencer', clase: 'sa-chip-aviso' },
  vencida: { texto: 'Cuota vencida', clase: 'sa-chip-alerta' },
};

function textoSuspension(instancia) {
  const { cuota } = instancia;
  if (!cuota.suspender_dias) return 'No se suspende sola.';
  if (!cuota.suspende_el || instancia.estado === 'suspendida') return `Se suspende sola a los ${cuota.suspender_dias} días de vencida.`;
  if (instancia.suspension_auto_vence === cuota.vence) return 'Reactivada a mano sin el pago: no se vuelve a suspender sola por este vencimiento.';
  if (cuota.dias_para_suspender <= 0) return 'Se suspende sola en la próxima revisión (dentro de una hora).';
  return `Se suspende sola el ${formatearFecha(cuota.suspende_el)} si no se anota el pago.`;
}

function textoDias(cuota) {
  if (cuota.dias_restantes === null) return '';
  if (cuota.dias_restantes === 0) return 'vence hoy';
  if (cuota.dias_restantes > 0) return `faltan ${cuota.dias_restantes} día${cuota.dias_restantes === 1 ? '' : 's'}`;
  const atraso = -cuota.dias_restantes;
  return `venció hace ${atraso} día${atraso === 1 ? '' : 's'}`;
}

// Plan más chico cuyos módulos están todos incluidos en `plan`: se muestra como "Todo lo del Plan
// Comercio, más:" en vez de repetir su lista.
function planIncluido(plan, planes) {
  return planes
    .filter((p) => p.id !== plan.id && p.modulos.length < plan.modulos.length && p.modulos.every((m) => plan.modulos.includes(m)))
    .sort((a, b) => b.modulos.length - a.modulos.length)[0];
}

export default function SuperadminPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [parametros, setParametros] = useSearchParams();
  const [panel, setPanel] = useState(null);
  const [usuario, setUsuario] = useState('');
  const [dosfa, setDosfa] = useState(null); // estado de su verificación en dos pasos
  const [pendienteDosfa, setPendienteDosfa] = useState(false);
  const [error, setError] = useState(null);
  // EST-01 §3: si el ingreso cerró una sesión abierta en otro dispositivo, se le avisa.
  const [aviso, setAviso] = useState(() =>
    location.state?.sesionAnteriorCerrada ? 'Tenías una sesión abierta en otro dispositivo: se cerró al entrar acá.' : null
  );
  const [ocupado, setOcupado] = useState(false);
  const guardia = useRef(false); // sincrónica: un doble click no manda dos veces

  const [confirmando, setConfirmando] = useState(null); // 'suspender' | 'reactivar' | 'plan:<id>'
  const [motivo, setMotivo] = useState('');
  const [vence, setVence] = useState('');
  const [avisoDias, setAvisoDias] = useState('15');
  const [suspenderDias, setSuspenderDias] = useState('');
  const [avisoSuspension, setAvisoSuspension] = useState('0');
  const [emailEmpresa, setEmailEmpresa] = useState('');
  const [topes, setTopes] = useState({ admin: '', encargado: '', cajero: '', portal: '' });

  // La pestaña va en la dirección (?pestana=plan): sobrevive a una recarga.
  const pestana = PESTANAS.some((p) => p.id === parametros.get('pestana')) ? parametros.get('pestana') : 'estado';

  const irAlLogin = useCallback(() => navigate('/login', { replace: true }), [navigate]);

  // El aviso de la sesión anterior ya se tomó: se saca del historial para que no vuelva al recargar.
  useEffect(() => {
    if (location.state?.sesionAnteriorCerrada) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location, navigate]);

  const cargar = useCallback(async () => {
    const data = await api.get('/sa/panel');
    setPanel(data);
    setVence(data.instancia.cuota.vence ?? '');
    setAvisoDias(String(data.instancia.cuota.aviso_dias));
    setSuspenderDias(data.instancia.cuota.suspender_dias ? String(data.instancia.cuota.suspender_dias) : '');
    setAvisoSuspension(String(data.instancia.cuota.aviso_suspension_dias));
    setEmailEmpresa(data.instancia.empresa_email ?? '');
    setTopes({
      ...Object.fromEntries(data.usuarios.cupos.map((c) => [c.rol, c.tope === null ? '' : String(c.tope)])),
      portal: data.usuarios.portal.tope === null ? '' : String(data.usuarios.portal.tope),
    });
  }, []);

  const cargarDosfa = useCallback(async () => {
    const data = await api.get('/sa/2fa');
    setDosfa(data);
    return data;
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const me = await api.get('/sa/me'); // devuelve el token CSRF de la sesión abierta
        if (cancelado) return;
        setCsrfSuperadmin(me.csrf_token);
        setUsuario(me.superadmin.usuario);
        await cargarDosfa();
        if (me.superadmin.pendiente_dosfa) {
          if (!cancelado) setPendienteDosfa(true);
          return;
        }
        await cargar();
      } catch (err) {
        if (cancelado) return;
        if (err instanceof ApiError && err.status === 401) irAlLogin();
        else setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor.');
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [cargar, cargarDosfa, irAlLogin]);

  // Toda acción que escribe pasa por acá: una a la vez, recarga el panel y maneja la sesión vencida.
  // mensajeOk puede ser una función que arma el mensaje con lo que devolvió la acción.
  async function ejecutar(accion, mensajeOk) {
    if (guardia.current) return;
    guardia.current = true;
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const resultado = await accion();
      await cargar();
      setConfirmando(null);
      setAviso(typeof mensajeOk === 'function' ? mensajeOk(resultado) : mensajeOk);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return irAlLogin();
      setError(err instanceof ApiError ? err.message : 'No se pudo completar la acción. Probá de nuevo.');
    } finally {
      guardia.current = false;
      setOcupado(false);
    }
  }

  async function salir() {
    try {
      await api.post('/sa/logout', {});
    } catch {
      /* si la sesión ya venció, igual se sale */
    }
    setCsrfSuperadmin(null);
    irAlLogin();
  }

  // Su verificación en dos pasos cambió (desde la pantalla obligatoria o desde su pestaña).
  async function alCambiarDosfa(mensaje) {
    const estado = await cargarDosfa();
    if (pendienteDosfa && estado.metodo) {
      await cargar();
      setPendienteDosfa(false);
      setAviso('Listo: la verificación en dos pasos quedó activa.');
      return;
    }
    setAviso(mensaje);
  }

  function irAPestana(id) {
    const nuevos = new URLSearchParams(parametros);
    nuevos.set('pestana', id);
    setParametros(nuevos, { replace: true });
    setConfirmando(null);
    setError(null);
    setAviso(null);
  }

  const encabezado = (
    <header className="sa-encabezado">
      <div>
        <h1 className="sa-h1">Administración CEA</h1>
        <p className="sa-subtitulo">
          {panel ? `Versión ${panel.version} · ` : ''}sesión de {usuario}
        </p>
      </div>
      <button type="button" className="btn" onClick={salir}>
        Salir
      </button>
    </header>
  );

  if (pendienteDosfa && dosfa) {
    return (
      <div className="sa-page">
        {encabezado}
        {error && <div className="alert alert-danger">{error}</div>}
        <section className="card sa-card sa-card-dosfa">
          <h2 className="sa-h2">Activá la verificación en dos pasos</h2>
          <p className="sa-ayuda">Para usar el panel tenés que activarla: además de la contraseña, se pide una vez por semana en cada navegador.</p>
          <ConfigurarDosfa base="/sa/2fa" estado={dosfa} onCambio={alCambiarDosfa} onSesionVencida={irAlLogin} />
        </section>
      </div>
    );
  }

  if (!panel) {
    return (
      <div className="sa-page">
        {error ? <div className="alert alert-danger">{error}</div> : <p className="sa-cargando">Cargando…</p>}
      </div>
    );
  }

  const { instancia } = panel;
  const suspendida = instancia.estado === 'suspendida';
  const estadoCuota = ESTADO_CUOTA[instancia.cuota.estado];
  const moduloPorId = Object.fromEntries(panel.modulos.map((m) => [m.id, m]));

  // ---- Secciones (cada una es una tarjeta a todo el ancho) ----

  const seccionEstado = (
    <section className="card sa-card" key="estado">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Estado de la instalación</h2>
        <span className={`sa-chip ${suspendida ? 'sa-chip-alerta' : 'sa-chip-ok'}`}>{suspendida ? 'Suspendida' : 'Activa'}</span>
      </div>
      {suspendida ? (
        <>
          <p className="sa-detalle">
            Motivo: {instancia.motivo_suspension} · desde {formatearFechaHora(instancia.suspendida_en)}
          </p>
          <p className="sa-ayuda">
            Nadie del negocio ni ningún cliente puede ingresar. Los datos se conservan.
            {instancia.suspension_por_cuota &&
              ' La suspendió el sistema por la cuota: anotar el pago la reactiva sola. Si la reactivás a mano sin el pago, no se vuelve a suspender sola por este vencimiento.'}
          </p>
          {confirmando === 'reactivar' ? (
            <div className="sa-confirmar">
              <span>¿Reactivar la instalación?</span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={ocupado}
                onClick={() =>
                  ejecutar(
                    () => api.post('/sa/reactivar', {}),
                    (r) => `Instalación reactivada.${r.avisado_a ? ` Se le avisó por mail a ${r.avisado_a}.` : ''}`
                  )
                }
              >
                Sí, reactivar
              </button>
              <button type="button" className="btn" disabled={ocupado} onClick={() => setConfirmando(null)}>
                Cancelar
              </button>
            </div>
          ) : (
            <div>
              <button type="button" className="btn btn-primary" onClick={() => setConfirmando('reactivar')}>
                Reactivar
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="sa-ayuda">Suspender corta las sesiones abiertas y bloquea los ingresos del negocio y de sus clientes. No borra ningún dato.</p>
          <div className="sa-form-fila">
            <div className="field">
              <label htmlFor="sa-motivo">Motivo de la suspensión</label>
              <input
                id="sa-motivo"
                type="text"
                maxLength={500}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                disabled={ocupado}
                placeholder="Ej.: cuota impaga…"
              />
            </div>
            {confirmando === 'suspender' ? (
              <div className="sa-confirmar sa-confirmar-linea">
                <span>¿Suspender ahora?</span>
                <button
                  type="button"
                  className="btn sa-btn-peligro"
                  disabled={ocupado}
                  onClick={() =>
                    ejecutar(async () => {
                      await api.post('/sa/suspender', { motivo });
                      setMotivo('');
                    }, 'Instalación suspendida.')
                  }
                >
                  Sí, suspender
                </button>
                <button type="button" className="btn" disabled={ocupado} onClick={() => setConfirmando(null)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button type="button" className="btn sa-btn-peligro" disabled={!motivo.trim()} onClick={() => setConfirmando('suspender')}>
                Suspender
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );

  const seccionPlan = (
    <section className="card sa-card" key="plan">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Plan y módulos</h2>
      </div>
      <p className="sa-ayuda">Al cambiar de plan, lo que queda afuera se oculta: sus datos no se borran.</p>
      <div className="sa-planes-grilla">
        {panel.planes.map((p) => {
          const actual = p.id === panel.plan.id;
          const base = planIncluido(p, panel.planes);
          const propios = base ? p.modulos.filter((m) => !base.modulos.includes(m)) : p.modulos;
          const quedanAfuera = panel.plan.modulos.filter((m) => !p.modulos.includes(m));
          return (
            <div key={p.id} className={`sa-plan-tarjeta${actual ? ' sa-plan-actual' : ''}`}>
              <div className="sa-plan-cabecera">
                <span className="sa-plan-nombre">{p.nombre}</span>
                {actual && <span className="sa-chip sa-chip-ok">Plan actual</span>}
              </div>
              {base && <p className="sa-plan-base">Todo lo del {base.nombre}, más:</p>}
              {propios.map((id) => (
                <div className="sa-plan-modulo" key={id}>
                  <span className="sa-plan-modulo-nombre">{moduloPorId[id]?.nombre ?? id}</span>
                  <ul className="sa-plan-lista">
                    {(moduloPorId[id]?.detalle ?? []).map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {!actual && (
                <div className="sa-plan-pie">
                  {confirmando === `plan:${p.id}` ? (
                    <div className="sa-confirmar">
                      <span>
                        ¿Pasar a {p.nombre}?
                        {quedanAfuera.length > 0 && ` Se ocultan: ${quedanAfuera.map((m) => moduloPorId[m]?.nombre ?? m).join(', ')}.`}
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={ocupado}
                        onClick={() => ejecutar(() => api.put('/sa/plan', { plan: p.id }), `Plan cambiado a ${p.nombre}.`)}
                      >
                        Sí, cambiar
                      </button>
                      <button type="button" className="btn" disabled={ocupado} onClick={() => setConfirmando(null)}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="btn" disabled={ocupado} onClick={() => setConfirmando(`plan:${p.id}`)}>
                      Pasar a {p.nombre}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );

  const seccionCuota = (
    <section className="card sa-card" key="cuota">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Cuota</h2>
        <span className={`sa-chip ${estadoCuota.clase}`}>{estadoCuota.texto}</span>
      </div>
      <p className="sa-detalle">
        {instancia.cuota.vence ? `Vence el ${formatearFecha(instancia.cuota.vence)} · ${textoDias(instancia.cuota)}. ` : ''}
        {textoSuspension(instancia)}
      </p>
      <p className="sa-ayuda">
        Con "Suspender a los … días" la instalación se suspende sola esos días después del vencimiento y se le avisa a la empresa por
        mail (antes, con el aviso previo, y al suspenderse). Vacío = no se suspende sola.
      </p>
      <form
        className="sa-form-cuota"
        onSubmit={(e) => {
          e.preventDefault();
          ejecutar(
            () =>
              api.put('/sa/cuota', {
                vence: vence || null,
                aviso_dias: Number(avisoDias),
                suspender_dias: suspenderDias === '' ? null : Number(suspenderDias),
                aviso_suspension_dias: avisoSuspension === '' ? 0 : Number(avisoSuspension),
              }),
            'Cuota guardada.'
          );
        }}
      >
        <div className="field">
          <label htmlFor="sa-vence">Vence el</label>
          <input id="sa-vence" type="date" value={vence} onChange={(e) => setVence(e.target.value)} disabled={ocupado} />
        </div>
        <div className="field">
          <label htmlFor="sa-aviso">Avisar (días antes)</label>
          <input
            id="sa-aviso"
            type="number"
            min="0"
            max="365"
            step="1"
            value={avisoDias}
            onChange={(e) => setAvisoDias(e.target.value)}
            disabled={ocupado}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="sa-suspender">Suspender a los (días de vencida)</label>
          <input
            id="sa-suspender"
            type="number"
            min="1"
            max="365"
            step="1"
            value={suspenderDias}
            onChange={(e) => setSuspenderDias(e.target.value)}
            disabled={ocupado}
            placeholder="No se suspende sola"
          />
        </div>
        <div className="field">
          <label htmlFor="sa-aviso-suspension">Avisar (días antes de suspender)</label>
          <input
            id="sa-aviso-suspension"
            type="number"
            min="0"
            max="364"
            step="1"
            value={avisoSuspension}
            onChange={(e) => setAvisoSuspension(e.target.value)}
            disabled={ocupado || suspenderDias === ''}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={ocupado}>
          Guardar cuota
        </button>
      </form>
    </section>
  );

  const seccionPagos = <SuperadminPagos key="pagos" pagos={panel.pagos} ocupado={ocupado} ejecutar={ejecutar} />;

  const seccionAvisos = (
    <section className="card sa-card" key="avisos">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Avisos de cuota por mail</h2>
        <span className={`sa-chip ${panel.correo.disponible ? 'sa-chip-ok' : 'sa-chip-aviso'}`}>
          {panel.correo.disponible ? 'Correo de CEA configurado' : 'Correo de CEA sin configurar'}
        </span>
      </div>
      <p className="sa-ayuda">
        {panel.correo.disponible
          ? 'Se le manda un mail a la empresa cuando la cuota entra en el período de aviso, el día que vence, cuando ya está vencida, antes de la suspensión automática y al suspenderse (uno por etapa), y cada vez que se reactiva.'
          : 'Faltan las variables SA_SMTP_* en el servidor: hasta cargarlas no se manda ningún mail.'}
      </p>
      <form
        className="sa-form-fila"
        onSubmit={(e) => {
          e.preventDefault();
          ejecutar(() => api.put('/sa/empresa-email', { email: emailEmpresa }), 'Email guardado.');
        }}
      >
        <div className="field">
          <label htmlFor="sa-email-empresa">Email de la empresa</label>
          <input
            id="sa-email-empresa"
            type="email"
            maxLength={200}
            value={emailEmpresa}
            onChange={(e) => setEmailEmpresa(e.target.value)}
            disabled={ocupado}
            placeholder="empresa@ejemplo.com"
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={ocupado}>
          Guardar email
        </button>
        <button
          type="button"
          className="btn"
          disabled={ocupado || !panel.correo.disponible || !instancia.empresa_email || emailEmpresa.trim() !== instancia.empresa_email}
          title={emailEmpresa.trim() !== (instancia.empresa_email ?? '') ? 'Guardá el email antes de probar' : undefined}
          onClick={() =>
            ejecutar(async () => {
              const r = await api.post('/sa/correo-prueba', {});
              return r;
            }, (r) => `Mail de prueba enviado a ${r.enviado_a}.`)
          }
        >
          Enviar mail de prueba
        </button>
      </form>
      {panel.correo.avisos.length > 0 && (
        <div className="sa-tabla-scroll">
          <table className="sa-tabla">
            <thead>
              <tr>
                <th>Enviado</th>
                <th>Aviso</th>
                <th>Cuota vence</th>
                <th>A</th>
              </tr>
            </thead>
            <tbody>
              {panel.correo.avisos.map((a) => (
                <tr key={`${a.tipo}-${a.cuota_vence}`}>
                  <td>{formatearFechaHora(a.enviado_en)}</td>
                  <td>{ETIQUETA_AVISO[a.tipo] ?? a.tipo}</td>
                  <td>{formatearFecha(a.cuota_vence)}</td>
                  <td>{a.destinatario}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const seccionTopes = (
    <section className="card sa-card" key="topes">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Topes de usuarios</h2>
        <span className={`sa-chip ${panel.usuarios.correo_empresa ? 'sa-chip-ok' : 'sa-chip-alerta'}`}>
          {panel.usuarios.correo_empresa ? 'Correo de la empresa configurado' : 'Correo de la empresa sin configurar'}
        </span>
      </div>
      <p className="sa-ayuda">
        Cuántos usuarios de cada rol se pueden registrar (los Administradores los creás vos, abajo; los demás, el Admin del negocio) y
        cuántos clientes pueden tener acceso al portal. Vacío = ninguno.
        {!panel.usuarios.correo_empresa &&
          ' Sin el correo de la empresa (variables SMTP_*) se trabaja igual, con la verificación del email de los empleados en pausa: el detalle está en la pestaña Correo.'}
      </p>
      <form
        className="sa-form-topes"
        onSubmit={(e) => {
          e.preventDefault();
          ejecutar(() => api.put('/sa/cupos', topes), 'Topes guardados.');
        }}
      >
        {panel.usuarios.cupos.map((c) => (
          <div className="field" key={c.rol}>
            <label htmlFor={`sa-tope-${c.rol}`}>{ETIQUETA_ROL[c.rol]}</label>
            <input
              id={`sa-tope-${c.rol}`}
              type="number"
              min="0"
              max="999"
              step="1"
              value={topes[c.rol] ?? ''}
              onChange={(e) => setTopes({ ...topes, [c.rol]: e.target.value })}
              disabled={ocupado}
            />
            <span className="sa-detalle-fila">En uso: {c.usados}</span>
          </div>
        ))}
        <div className="field">
          <label htmlFor="sa-tope-portal">Clientes con portal</label>
          <input
            id="sa-tope-portal"
            type="number"
            min="0"
            max="99999"
            step="1"
            value={topes.portal ?? ''}
            onChange={(e) => setTopes({ ...topes, portal: e.target.value })}
            disabled={ocupado}
          />
          <span className="sa-detalle-fila">En uso: {panel.usuarios.portal.usados}</span>
        </div>
        <button type="submit" className="btn btn-primary" disabled={ocupado}>
          Guardar topes
        </button>
      </form>
    </section>
  );

  const seccionAdmins = (
    <SuperadminAdmins
      key="admins"
      administradores={panel.administradores}
      cupo={panel.usuarios.cupos.find((c) => c.rol === 'admin')}
      correoEmpresa={panel.usuarios.correo_empresa}
      ocupado={ocupado}
      ejecutar={ejecutar}
    />
  );

  const seccionCorreo = <SuperadminCorreo key="correo" usuario={usuario} irAlLogin={irAlLogin} />;

  const seccionCopias = <SuperadminCopias key="copias" irAlLogin={irAlLogin} />;

  const seccionSeguridad = <SuperadminSeguridad key="seguridad" irAlLogin={irAlLogin} />;

  const seccionRegistro = <SuperadminRegistro key="registro" irAlLogin={irAlLogin} />;

  const seccionVerificacion = dosfa && (
    <section className="card sa-card" key="verificacion">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Tu verificación en dos pasos</h2>
      </div>
      <ConfigurarDosfa key={dosfa.metodo ?? 'sin-metodo'} base="/sa/2fa" estado={dosfa} onCambio={alCambiarDosfa} onSesionVencida={irAlLogin} />
    </section>
  );

  const CONTENIDO = {
    estado: [seccionEstado],
    plan: [seccionPlan],
    cuota: [seccionCuota, seccionPagos, seccionAvisos],
    usuarios: [seccionTopes, seccionAdmins],
    correo: [seccionCorreo],
    copias: [seccionCopias],
    seguridad: [seccionSeguridad],
    registro: [seccionRegistro],
    verificacion: [seccionVerificacion],
  };

  return (
    <div className="sa-page">
      {encabezado}

      {/* Resumen fijo: lo que importa de un vistazo, en cualquier pestaña */}
      <div className="sa-resumen">
        <span className={`sa-chip ${suspendida ? 'sa-chip-alerta' : 'sa-chip-ok'}`}>{suspendida ? 'Suspendida' : 'Activa'}</span>
        <span className="sa-chip sa-chip-neutro">{panel.plan.nombre}</span>
        <span className={`sa-chip ${estadoCuota.clase}`}>
          {estadoCuota.texto}
          {instancia.cuota.vence ? ` · vence el ${formatearFecha(instancia.cuota.vence)}` : ''}
        </span>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {aviso && <div className="alert sa-alert-ok">{aviso}</div>}

      <nav className="sa-pestanas" role="tablist" aria-label="Secciones del panel">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={pestana === p.id}
            className={`sa-pestana${pestana === p.id ? ' sa-pestana-activa' : ''}`}
            onClick={() => irAPestana(p.id)}
          >
            {p.nombre}
          </button>
        ))}
      </nav>
      <div className="sa-contenido" role="tabpanel">
        {CONTENIDO[pestana]}
      </div>
    </div>
  );
}
