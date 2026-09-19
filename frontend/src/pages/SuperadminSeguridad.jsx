import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearFechaHora } from '../utils/format.js';

// Sección "Seguridad" del panel del superadmin: IPs bloqueadas por la defensa activa
// (services/defensa-ip.service.js), con motivo, tiempo que les queda y botón para
// desbloquear un falso positivo, más el bloqueo manual y los últimos eventos detectados.

const DURACIONES = [
  { minutos: 60, texto: '1 hora' },
  { minutos: 24 * 60, texto: '24 horas' },
  { minutos: 7 * 24 * 60, texto: '7 días' },
  { minutos: 30 * 24 * 60, texto: '30 días' },
];

function textoRestante(minutos) {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 48 * 60) return `${Math.round(minutos / 60)} h`;
  return `${Math.round(minutos / 1440)} días`;
}

export default function SuperadminSeguridad({ irAlLogin }) {
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarTodas, setConfirmarTodas] = useState(false);
  const [ip, setIp] = useState('');
  const [minutos, setMinutos] = useState(String(DURACIONES[0].minutos));
  const [detalle, setDetalle] = useState('');
  const guardia = useRef(false);

  const manejarError = useCallback(
    (err) => {
      if (err instanceof ApiError && err.status === 401) return irAlLogin();
      setError(err instanceof ApiError ? err.message : 'No se pudo completar la acción. Probá de nuevo.');
    },
    [irAlLogin]
  );

  const cargar = useCallback(async () => {
    setEstado(await api.get('/sa/defensa'));
  }, []);

  useEffect(() => {
    let cancelado = false;
    const tick = () => cargar().catch((err) => !cancelado && manejarError(err));
    tick();
    const t = setInterval(tick, 30_000); // los bloqueos vencen solos: se refresca la lista
    return () => {
      cancelado = true;
      clearInterval(t);
    };
  }, [cargar, manejarError]);

  async function ejecutar(accion, mensajeOk) {
    if (guardia.current) return;
    guardia.current = true;
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      await accion();
      await cargar();
      setAviso(mensajeOk);
    } catch (err) {
      manejarError(err);
    } finally {
      guardia.current = false;
      setOcupado(false);
    }
  }

  if (!estado) {
    return (
      <section className="card sa-card">
        <h2 className="sa-h2">Seguridad</h2>
        {error ? <div className="alert alert-danger">{error}</div> : <p className="sa-cargando">Cargando…</p>}
      </section>
    );
  }

  return (
    <section className="card sa-card">
      <h2 className="sa-h2">Seguridad · defensa por IP</h2>
      <p>
        <span className={`sa-chip ${estado.activa ? 'sa-chip-ok' : 'sa-chip-alerta'}`}>{estado.activa ? 'Defensa activa' : 'Defensa apagada'}</span>{' '}
        <span className="sa-chip sa-chip-neutro">{estado.bloqueadas.length} bloqueada{estado.bloqueadas.length === 1 ? '' : 's'} ahora</span>{' '}
        <span className="sa-chip sa-chip-neutro">{estado.resumen.bloqueos_24h} bloqueo{estado.resumen.bloqueos_24h === 1 ? '' : 's'} en 24 h</span>{' '}
        <span className="sa-chip sa-chip-neutro">{estado.resumen.eventos_24h} ataque{estado.resumen.eventos_24h === 1 ? '' : 's'} detectado{estado.resumen.eventos_24h === 1 ? '' : 's'} en 24 h</span>
      </p>
      <p className="sa-ayuda">
        Se bloquea sola, en el acto, la IP que sondea archivos (.env, wp-admin…), intenta inyecciones o comandos, usa herramientas de hacking,
        mapea la API (15 rutas inexistentes en 5 min), prueba contraseñas (15 fallos en 10 min) o hace ráfagas de pedidos. Bloqueo de 1 hora; si
        reincide en 30 días, 24 horas y después 7 días.{' '}
        {estado.alerta_email
          ? estado.correo_disponible
            ? `Cada bloqueo avisa por mail a ${estado.alerta_email}.`
            : `Falta el correo de CEA (SA_SMTP_*) para avisar a ${estado.alerta_email}.`
          : 'Para recibir un mail por cada bloqueo, definí DEFENSA_IP_ALERTA_EMAIL en el servidor.'}
      </p>

      {error && <div className="alert alert-danger">{error}</div>}
      {aviso && <div className="alert sa-alert-ok">{aviso}</div>}

      <details className="sa-eventos">
        <summary>IPs bloqueadas ahora ({estado.bloqueadas.length})</summary>
        {estado.bloqueadas.length === 0 ? (
          <p className="sa-detalle">No hay ninguna IP bloqueada en este momento.</p>
        ) : (
          <div className="sa-tabla-scroll">
            <table className="sa-tabla sa-tabla-seg">
              <thead>
                <tr>
                  <th>IP</th>
                  <th>Motivo</th>
                  <th>Desde</th>
                  <th>Quedan</th>
                  <th>Reinc.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {estado.bloqueadas.map((b) => (
                  <tr key={b.id}>
                    <td className="sa-mono">{b.ip}</td>
                    <td>
                      {estado.motivos[b.motivo] ?? b.motivo}
                      {b.detalle && <div className="sa-detalle-fila">{b.detalle}</div>}
                    </td>
                    <td>{formatearFechaHora(b.bloqueada_en)}</td>
                    <td>{textoRestante(b.minutos_restantes)}</td>
                    <td>{b.reincidencia}</td>
                    <td>
                      <button type="button" className="btn" disabled={ocupado} onClick={() => ejecutar(() => api.post('/sa/defensa/desbloquear', { id: b.id }), `IP ${b.ip} desbloqueada.`)}>
                        Desbloquear
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {estado.bloqueadas.length > 1 &&
          (confirmarTodas ? (
            <div className="sa-confirmar">
              <span>¿Desbloquear las {estado.bloqueadas.length} IPs?</span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={ocupado}
                onClick={() => ejecutar(async () => { await api.post('/sa/defensa/desbloquear-todas', {}); setConfirmarTodas(false); }, 'Todas las IPs quedaron desbloqueadas.')}
              >
                Sí, desbloquear todas
              </button>
              <button type="button" className="btn" onClick={() => setConfirmarTodas(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="btn" disabled={ocupado} onClick={() => setConfirmarTodas(true)}>
              Desbloquear todas
            </button>
          ))}
      </details>

      <details className="sa-eventos">
        <summary>Bloquear una IP a mano</summary>
        <form
          className="sa-form-email"
          onSubmit={(e) => {
            e.preventDefault();
            ejecutar(async () => {
              await api.post('/sa/defensa/bloquear', { ip: ip.trim(), minutos: Number(minutos), detalle: detalle.trim() || undefined });
              setIp('');
              setDetalle('');
            }, 'IP bloqueada.');
          }}
        >
          <div className="field">
            <label htmlFor="sa-ip">IP</label>
            <input id="sa-ip" value={ip} onChange={(e) => setIp(e.target.value)} disabled={ocupado} placeholder="203.0.113.10" maxLength={45} required />
          </div>
          <div className="field sa-campo-corto">
            <label htmlFor="sa-ip-dur">Duración</label>
            <select id="sa-ip-dur" value={minutos} onChange={(e) => setMinutos(e.target.value)} disabled={ocupado}>
              {DURACIONES.map((d) => (
                <option key={d.minutos} value={d.minutos}>
                  {d.texto}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sa-ip-det">Nota (opcional)</label>
            <input id="sa-ip-det" value={detalle} onChange={(e) => setDetalle(e.target.value)} disabled={ocupado} maxLength={300} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={ocupado || !ip.trim()}>
            Bloquear
          </button>
        </form>
      </details>
      {estado.permitidas.length > 0 && <p className="sa-ayuda">Nunca se bloquean (DEFENSA_IP_PERMITIDAS): {estado.permitidas.join(', ')}.</p>}

      <details className="sa-eventos">
        <summary>Últimos ataques detectados ({estado.eventos.length})</summary>
        {estado.eventos.length === 0 ? (
          <p className="sa-detalle">Todavía no se detectó nada.</p>
        ) : (
          <div className="sa-tabla-scroll">
            <table className="sa-tabla sa-tabla-seg">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>IP</th>
                  <th>Tipo</th>
                  <th>Pedido</th>
                </tr>
              </thead>
              <tbody>
                {estado.eventos.map((ev) => (
                  <tr key={ev.id}>
                    <td>{formatearFechaHora(ev.creado_en)}</td>
                    <td className="sa-mono">{ev.ip}</td>
                    <td>{estado.motivos[ev.tipo] ?? ev.tipo}</td>
                    <td className="sa-mono sa-corta">{[ev.metodo, ev.ruta].filter(Boolean).join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}
