import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, setCsrfSuperadmin } from '../api/client.js';
import { formatearFecha, formatearFechaHora } from '../utils/format.js';
import SuperadminPagos from './SuperadminPagos.jsx';
import SuperadminSeguridad from './SuperadminSeguridad.jsx';
import './SuperadminPage.css';

// Panel de CEA sobre esta instalación (/sa): plan y módulos, suspensión, cuota y sus
// pagos, versión y avisos de cuota. Sesión propia (cookie sa_token + token CSRF en
// memoria), completamente aparte del sistema del negocio.

const ETIQUETA_AVISO = {
  por_vencer: 'Por vencer',
  vence_hoy: 'Vence hoy',
  vencida: 'Vencida',
  suspension_proxima: 'Aviso de suspensión',
  suspendida: 'Suspendida',
};

function textoSuspension(instancia) {
  const { cuota } = instancia;
  if (!cuota.suspender_dias) return 'No se suspende sola.';
  if (!cuota.suspende_el || instancia.estado === 'suspendida') return `Se suspende sola a los ${cuota.suspender_dias} días de vencida.`;
  if (instancia.suspension_auto_vence === cuota.vence) return 'Reactivada a mano sin el pago: no se vuelve a suspender sola por este vencimiento.';
  if (cuota.dias_para_suspender <= 0) return 'Se suspende sola en la próxima revisión (dentro de una hora).';
  return `Se suspende sola el ${formatearFecha(cuota.suspende_el)} si no se anota el pago.`;
}

const ETIQUETA_ROL = { admin: 'Administrador', encargado: 'Encargado', cajero: 'Cajero' };

const ESTADO_CUOTA = {
  sin_definir: { texto: 'Sin cuota definida', clase: 'sa-chip-neutro' },
  vigente: { texto: 'Vigente', clase: 'sa-chip-ok' },
  por_vencer: { texto: 'Por vencer', clase: 'sa-chip-aviso' },
  vencida: { texto: 'Vencida', clase: 'sa-chip-alerta' },
};

function textoDias(cuota) {
  if (cuota.dias_restantes === null) return '';
  if (cuota.dias_restantes === 0) return 'vence hoy';
  if (cuota.dias_restantes > 0) return `faltan ${cuota.dias_restantes} día${cuota.dias_restantes === 1 ? '' : 's'}`;
  const atraso = -cuota.dias_restantes;
  return `venció hace ${atraso} día${atraso === 1 ? '' : 's'}`;
}

export default function SuperadminPage() {
  const navigate = useNavigate();
  const [panel, setPanel] = useState(null);
  const [usuario, setUsuario] = useState('');
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const guardia = useRef(false); // sincrónica: un doble click no manda dos veces

  const [planElegido, setPlanElegido] = useState('');
  const [confirmando, setConfirmando] = useState(null); // 'plan' | 'suspender' | 'reactivar'
  const [motivo, setMotivo] = useState('');
  const [vence, setVence] = useState('');
  const [avisoDias, setAvisoDias] = useState('15');
  const [suspenderDias, setSuspenderDias] = useState('');
  const [avisoSuspension, setAvisoSuspension] = useState('0');
  const [emailEmpresa, setEmailEmpresa] = useState('');
  const [topes, setTopes] = useState({ admin: '', encargado: '', cajero: '' });

  const irAlLogin = useCallback(() => navigate('/login', { replace: true }), [navigate]);

  const cargar = useCallback(async () => {
    const data = await api.get('/sa/panel');
    setPanel(data);
    setPlanElegido((actual) => actual || data.plan.id);
    setVence(data.instancia.cuota.vence ?? '');
    setAvisoDias(String(data.instancia.cuota.aviso_dias));
    setSuspenderDias(data.instancia.cuota.suspender_dias ? String(data.instancia.cuota.suspender_dias) : '');
    setAvisoSuspension(String(data.instancia.cuota.aviso_suspension_dias));
    setEmailEmpresa(data.instancia.empresa_email ?? '');
    setTopes(Object.fromEntries(data.usuarios.cupos.map((c) => [c.rol, c.tope === null ? '' : String(c.tope)])));
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const me = await api.get('/sa/me'); // devuelve el token CSRF de la sesión abierta
        if (cancelado) return;
        setCsrfSuperadmin(me.csrf_token);
        setUsuario(me.superadmin.usuario);
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
  }, [cargar, irAlLogin]);

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
  const nombreModulo = Object.fromEntries(panel.modulos.map((m) => [m.id, m.nombre]));
  const planNuevo = panel.planes.find((p) => p.id === planElegido);
  const quedanAfuera = planNuevo ? panel.plan.modulos.filter((m) => !planNuevo.modulos.includes(m)) : [];

  return (
    <div className="sa-page">
      <header className="sa-encabezado">
        <div>
          <h1 className="sa-h1">Administración CEA</h1>
          <p className="sa-subtitulo">
            Versión {panel.version} · sesión de {usuario}
          </p>
        </div>
        <button type="button" className="btn" onClick={salir}>
          Salir
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {aviso && <div className="alert sa-alert-ok">{aviso}</div>}

      <div className="sa-grilla">
        {/* Estado de la instalación */}
        <section className="card sa-card">
          <h2 className="sa-h2">Estado</h2>
          <p>
            <span className={`sa-chip ${suspendida ? 'sa-chip-alerta' : 'sa-chip-ok'}`}>
              {suspendida ? 'Suspendida' : 'Activa'}
            </span>
          </p>

          {suspendida ? (
            <>
              <p className="sa-detalle">
                Motivo: {instancia.motivo_suspension}
                <br />
                Desde: {formatearFechaHora(instancia.suspendida_en)}
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
                <button type="button" className="btn btn-primary" onClick={() => setConfirmando('reactivar')}>
                  Reactivar
                </button>
              )}
            </>
          ) : (
            <>
              <p className="sa-ayuda">Suspender corta las sesiones abiertas y bloquea los ingresos. No borra ningún dato.</p>
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
                <div className="sa-confirmar">
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
            </>
          )}
        </section>

        {/* Plan y módulos */}
        <section className="card sa-card">
          <h2 className="sa-h2">Plan y módulos</h2>
          <p className="sa-ayuda">
            Actual: <strong>{panel.plan.nombre}</strong>. Los módulos que se apagan se ocultan; sus datos no se borran.
          </p>
          <div className="sa-planes" role="radiogroup" aria-label="Plan">
            {panel.planes.map((p) => (
              <label key={p.id} className={`sa-plan${planElegido === p.id ? ' sa-plan-elegido' : ''}`}>
                <input
                  type="radio"
                  name="plan"
                  value={p.id}
                  checked={planElegido === p.id}
                  disabled={ocupado}
                  onChange={() => {
                    setPlanElegido(p.id);
                    setConfirmando(null);
                  }}
                />
                <span className="sa-plan-texto">
                  <span className="sa-plan-nombre">
                    {p.nombre}
                    {p.id === panel.plan.id ? ' (actual)' : ''}
                  </span>
                  <span className="sa-plan-modulos">{p.modulos.map((m) => nombreModulo[m] ?? m).join(' · ')}</span>
                </span>
              </label>
            ))}
          </div>

          {planElegido !== panel.plan.id &&
            (confirmando === 'plan' ? (
              <div className="sa-confirmar">
                <span>
                  ¿Pasar a {planNuevo.nombre}?
                  {quedanAfuera.length > 0 && ` Se ocultan: ${quedanAfuera.map((m) => nombreModulo[m] ?? m).join(', ')}.`}
                </span>
                <button type="button" className="btn btn-primary" disabled={ocupado} onClick={() => ejecutar(() => api.put('/sa/plan', { plan: planElegido }), 'Plan cambiado.')}>
                  Sí, cambiar
                </button>
                <button type="button" className="btn" disabled={ocupado} onClick={() => setConfirmando(null)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setConfirmando('plan')}>
                Cambiar plan
              </button>
            ))}
        </section>

        {/* Cuota */}
        <section className="card sa-card">
          <h2 className="sa-h2">Cuota</h2>
          <p>
            <span className={`sa-chip ${estadoCuota.clase}`}>{estadoCuota.texto}</span>{' '}
            <span className="sa-detalle">
              {instancia.cuota.vence ? `${formatearFecha(instancia.cuota.vence)} · ${textoDias(instancia.cuota)}` : ''}
            </span>
          </p>
          <p className="sa-detalle">{textoSuspension(instancia)}</p>
          <p className="sa-ayuda">
            Con "Suspender a los … días" la instalación se suspende sola esos días después del vencimiento y se le avisa a la
            empresa por mail (antes, con el aviso previo, y al suspenderse). Vacío = no se suspende sola.
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

        {/* Usuarios del negocio: topes por rol */}
        <section className="card sa-card">
          <h2 className="sa-h2">Usuarios del negocio</h2>
          <p>
            <span className={`sa-chip ${panel.usuarios.correo_empresa ? 'sa-chip-ok' : 'sa-chip-alerta'}`}>
              {panel.usuarios.correo_empresa ? 'Correo de la empresa configurado' : 'Correo de la empresa sin configurar'}
            </span>
          </p>
          <p className="sa-ayuda">
            Cuántos usuarios de cada rol puede crear el Admin del negocio. Vacío = no puede crear usuarios de ese rol.
            {!panel.usuarios.correo_empresa &&
              ' Sin el correo de la empresa (variables SMTP_*) tampoco puede crear usuarios: los códigos de ingreso salen de ahí.'}
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
            <button type="submit" className="btn btn-primary" disabled={ocupado}>
              Guardar topes
            </button>
          </form>
        </section>
      </div>

      <SuperadminPagos pagos={panel.pagos} ocupado={ocupado} ejecutar={ejecutar} />

      {/* Avisos de cuota por mail */}
      <section className="card sa-card">
        <h2 className="sa-h2">Avisos por mail</h2>
        <p>
          <span className={`sa-chip ${panel.correo.disponible ? 'sa-chip-ok' : 'sa-chip-aviso'}`}>
            {panel.correo.disponible ? 'Correo de CEA configurado' : 'Correo de CEA sin configurar'}
          </span>
        </p>
        <p className="sa-ayuda">
          {panel.correo.disponible
            ? 'Se le manda un mail a la empresa cuando la cuota entra en el período de aviso, el día que vence, cuando ya está vencida, antes de la suspensión automática y al suspenderse (uno por etapa), y cada vez que se reactiva.'
            : 'Faltan las variables SA_SMTP_* en el servidor: hasta cargarlas no se manda ningún mail.'}
        </p>
        <form
          className="sa-form-email"
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
            onClick={() => ejecutar(async () => {
              const r = await api.post('/sa/correo-prueba', {});
              setAviso(`Mail de prueba enviado a ${r.enviado_a}.`);
            }, 'Mail de prueba enviado.')}
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

      {/* Defensa por IP: maneja su propio estado */}
      <SuperadminSeguridad irAlLogin={irAlLogin} />
    </div>
  );
}
