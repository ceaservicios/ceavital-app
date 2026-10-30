import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearFechaHora } from '../utils/format.js';

// Tarjeta "Restaurar una copia" de la pestaña Copias (diseño del agente disenador-ux, 2026-10-11).
// Reemplaza TODOS los datos del negocio por los de una copia del Drive. Va plegada; la lista sale
// del Drive (no del historial). Para confirmar: contraseña, código de verificación y el dominio
// escrito. Antes de restaurar el servidor guarda una copia de cómo está todo (el "deshacer").
// Mientras corre, el sistema queda en mantenimiento y acá se ven las etapas.

const ETAPAS = [
  { id: 'resguardo', texto: 'Resguardo del estado actual (queda en el Drive)' },
  { id: 'descargando', texto: 'Descarga de la copia elegida' },
  { id: 'restaurando', texto: 'Reemplazo de los datos' },
];
const TIPO = { automatica: 'Automática', manual: 'Pedida desde el panel', resguardo: 'Resguardo antes de restaurar' };

const fechaUtc = (texto) => new Date(`${texto.replace(' ', 'T')}Z`);

function fechaLarga(texto) {
  return fechaUtc(texto).toLocaleString('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// "hace 3 días", "hace 5 h", "hace 20 min".
function antiguedad(texto) {
  const minutos = Math.max(0, Math.round((Date.now() - fechaUtc(texto).getTime()) / 60_000));
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.round(horas / 24)} días`;
}

// Lo que se pierde, en palabras: "los últimos 3 días y 5 horas".
function loQueSePierde(texto) {
  const minutos = Math.max(0, Math.round((Date.now() - fechaUtc(texto).getTime()) / 60_000));
  const dias = Math.floor(minutos / 1440);
  const horas = Math.floor((minutos % 1440) / 60);
  const plural = (n, una, varias) => `${n} ${n === 1 ? una : varias}`;
  if (dias > 0) return `los últimos ${plural(dias, 'día', 'días')}${horas ? ` y ${plural(horas, 'hora', 'horas')}` : ''}`;
  if (horas > 0) return `las últimas ${plural(horas, 'hora', 'horas')}`;
  return `los últimos ${plural(Math.max(1, minutos), 'minuto', 'minutos')}`;
}

function tamanio(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function duracion(desde) {
  const s = Math.max(0, Math.round((Date.now() - fechaUtc(desde).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function SuperadminRestaurar({ irAlLogin, configuradas, copiaEnCurso }) {
  const [estado, setEstado] = useState(null); // /sa/restauraciones
  const [copias, setCopias] = useState(null); // lista del Drive (al abrir la tarjeta)
  const [cargandoLista, setCargandoLista] = useState(false);
  const [elegida, setElegida] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [dominio, setDominio] = useState('');
  const [password, setPassword] = useState('');
  const [desafio, setDesafio] = useState(null); // { desafio, metodo, email }
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [, setTic] = useState(0);
  const guardia = useRef(false);

  const manejarError = useCallback(
    (err) => {
      if (err instanceof ApiError && err.status === 401) return irAlLogin();
      setError(err instanceof ApiError ? err.message : 'No se pudo completar la acción. Intentá de nuevo.');
    },
    [irAlLogin]
  );

  const cargarEstado = useCallback(async () => setEstado(await api.get('/sa/restauraciones')), []);
  const enCurso = estado?.ultimas.find((r) => r.estado === 'en_curso') ?? null;

  useEffect(() => {
    cargarEstado().catch(manejarError);
  }, [cargarEstado, manejarError]);

  // En curso: se refresca seguido (y corre el reloj); si no, cada 30 s. Mientras se reemplazan los
  // datos la base hace esperar los pedidos unos segundos: nunca se manda uno nuevo con otro pendiente.
  const consultando = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      setTic((n) => n + 1);
      if (consultando.current) return;
      consultando.current = true;
      cargarEstado()
        .catch(() => {})
        .finally(() => {
          consultando.current = false;
        });
    }, enCurso ? 2_500 : 30_000);
    return () => clearInterval(t);
  }, [cargarEstado, enCurso]);

  async function cargarLista() {
    setCargandoLista(true);
    setError(null);
    try {
      setCopias((await api.get('/sa/copias/drive')).copias);
    } catch (err) {
      setCopias(null);
      manejarError(err);
    } finally {
      setCargandoLista(false);
    }
  }

  function cancelar() {
    setConfirmando(false);
    setDesafio(null);
    setPassword('');
    setCodigo('');
    setDominio('');
    setError(null);
  }

  // Una acción a la vez (guardia sincrónica contra el doble click).
  async function ejecutar(accion) {
    if (guardia.current) return;
    guardia.current = true;
    setOcupado(true);
    setError(null);
    try {
      await accion();
    } catch (err) {
      manejarError(err);
    } finally {
      guardia.current = false;
      setOcupado(false);
    }
  }

  const pedirCodigo = () =>
    ejecutar(async () => {
      setDesafio(await api.post('/sa/restauraciones/desafio', { password }));
      setPassword('');
    });

  const restaurar = () =>
    ejecutar(async () => {
      await api.post('/sa/restauraciones', { desafio: desafio.desafio, codigo, dominio, archivo_id: elegida.id });
      cancelar();
      setElegida(null);
      setCopias(null);
      await cargarEstado();
    });

  if (!estado) return null;

  const ultima = estado.ultimas.find((r) => r.estado !== 'en_curso') ?? null;
  const masNueva = copias?.[0];
  const dominioOk = dominio.trim().toLowerCase() === estado.dominio;

  // ---- En curso: etapas ----
  if (enCurso) {
    const indice = ETAPAS.findIndex((e) => e.id === enCurso.fase);
    return (
      <section className="card sa-card">
        <div className="sa-card-cabecera">
          <h2 className="sa-h2">Restaurando una copia</h2>
          <span className="sa-chip sa-chip-aviso">En mantenimiento</span>
        </div>
        <p className="sa-detalle sa-quiebre">{enCurso.archivo}</p>
        <p className="sa-ayuda">
          Mientras tanto, nadie del negocio ni del portal puede usar el sistema. Tiempo transcurrido: {duracion(enCurso.iniciada_en)}. El proceso
          sigue en el servidor aunque cierres esta ventana.
        </p>
        <ol className="sa-etapas">
          {ETAPAS.map((e, i) => {
            const marca = i < indice ? '✓' : i === indice ? '●' : '';
            return (
              <li key={e.id} className={i < indice ? 'sa-etapa-lista' : i === indice ? 'sa-etapa-actual' : ''}>
                <span className="sa-etapa-marca" aria-hidden="true">
                  {marca}
                </span>
                {e.texto}
                {i === indice ? '…' : ''}
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  return (
    <section className="card sa-card">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Restaurar una copia</h2>
      </div>
      <p className="sa-ayuda">Devuelve los datos del negocio al estado de una copia anterior del Drive.</p>

      {ultima && (
        <div className={`alert ${ultima.estado === 'ok' ? 'alert-exito' : 'alert-danger'} sa-restaurar-ultima`}>
          {ultima.estado === 'ok' ? (
            <>
              <strong>Última restauración: {formatearFechaHora(ultima.terminada_en)}</strong> ({ultima.superadmin}). Se restauró la copia{' '}
              <span className="sa-quiebre">{ultima.archivo}</span>. Para volver atrás, el resguardo{' '}
              <span className="sa-quiebre">{ultima.resguardo}</span> está en la lista.
              {ultima.migraciones?.length > 0 && ` Se aplicaron ${ultima.migraciones.length} actualizaciones del sistema.`}
              {ultima.cambios_admins?.length > 0 && (
                <ul className="sa-restaurar-cambios">
                  {ultima.cambios_admins.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <strong>Última restauración fallida ({formatearFechaHora(ultima.terminada_en)}).</strong> No se modificó ningún dato. Detalle:{' '}
              {ultima.detalle}
            </>
          )}
        </div>
      )}

      <details
        className="sa-plegable"
        onToggle={(e) => {
          if (e.currentTarget.open && !copias && !cargandoLista && configuradas) cargarLista();
        }}
      >
        <summary>Elegir una copia para restaurar</summary>
        <div className="sa-plegable-cuerpo">
          <p className="sa-ayuda">
            Reemplaza <strong>todos</strong> los datos del negocio (stock, clientes y cuentas corrientes, ventas, caja, gastos, proveedores, pedidos
            y usuarios) por los de la copia elegida. Usala solo si se perdieron o se dañaron datos.
          </p>
          {!configuradas && <p className="sa-ayuda">Las copias no están configuradas en el servidor (ver arriba).</p>}
          {configuradas && !estado.permiso && (
            <div className="alert alert-danger">
              El usuario de la base de datos no tiene permiso para restaurar (tiene que ser dueño de la base). Revisalo en Easypanel antes de
              restaurar.
            </div>
          )}
          {error && !confirmando && <div className="alert alert-danger">{error}</div>}
          {cargandoLista && <p className="sa-cargando">Buscando las copias en el Drive…</p>}
          {configuradas && !cargandoLista && copias === null && error && (
            <div>
              <button type="button" className="btn" onClick={cargarLista}>
                Reintentar
              </button>
            </div>
          )}
          {copias?.length === 0 && <p className="sa-vacio">No hay copias en el Drive (se conservan 30 días).</p>}

          {copias?.length > 0 && !confirmando && (
            <>
              <div className="sa-restaurar-lista" role="radiogroup" aria-label="Copias del Drive">
                {copias.map((c) => (
                  <label key={c.id} className={`sa-restaurar-opcion${elegida?.id === c.id ? ' sa-restaurar-elegida' : ''}`}>
                    <input type="radio" name="copia" checked={elegida?.id === c.id} onChange={() => setElegida(c)} />
                    <span className="sa-restaurar-dato">
                      <strong>{fechaLarga(c.fecha)}</strong>
                      <span className="sa-meta">{antiguedad(c.fecha)}</span>
                    </span>
                    <span className="sa-restaurar-dato sa-meta">
                      {TIPO[c.tipo] ?? 'Copia'} · {tamanio(c.bytes)}
                      {masNueva && c.bytes < masNueva.bytes / 2 && <span className="sa-chip sa-chip-aviso">Mucho menor que la última copia</span>}
                    </span>
                  </label>
                ))}
              </div>
              <div className="sa-restaurar-pie">
                <button type="button" className="btn" onClick={cargarLista} disabled={cargandoLista}>
                  Actualizar lista
                </button>
                <button
                  type="button"
                  className="btn btn-peligro"
                  disabled={!elegida || copiaEnCurso || !estado.permiso}
                  title={copiaEnCurso ? 'Esperá a que termine la copia en curso' : undefined}
                  onClick={() => setConfirmando(true)}
                >
                  Restaurar copia elegida…
                </button>
              </div>
              {copiaEnCurso && <p className="sa-ayuda">Esperá a que termine la copia en curso.</p>}
            </>
          )}

          {confirmando && elegida && (
            <div className="sa-restaurar-confirmar">
              <h3 className="sa-h3">Restaurar la copia del {fechaLarga(elegida.fecha)}</h3>
              <p className="sa-restaurar-perdida">Se pierde todo lo cargado en {loQueSePierde(elegida.fecha)}.</p>
              <ul className="sa-restaurar-puntos">
                <li>
                  Stock, clientes y cuentas corrientes, ventas, caja, gastos, proveedores, pedidos y los usuarios del negocio vuelven a como estaban
                  ese día a esa hora. Lo cargado después se pierde.
                </li>
                <li>No vuelven atrás: tu cuenta, el plan, la cuota y sus pagos, la seguridad, el registro de acciones y el historial de copias.</li>
                <li>Antes se guarda un resguardo del estado actual: si fue un error, se restaura desde esta misma lista.</li>
                <li>
                  Tarda unos minutos. Mientras tanto nadie del negocio ni del portal puede ingresar, y al terminar todos tienen que volver a
                  iniciar sesión. <strong>Avisale al negocio antes.</strong>
                </li>
              </ul>
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="sa-restaurar-campos">
                <div className="field">
                  <label htmlFor="sa-restaurar-dominio">
                    Para confirmar, escribí <span className="sa-mono">{estado.dominio}</span>
                  </label>
                  <input
                    id="sa-restaurar-dominio"
                    type="text"
                    autoComplete="off"
                    spellCheck="false"
                    value={dominio}
                    onChange={(e) => setDominio(e.target.value)}
                    disabled={ocupado}
                  />
                </div>
                {!desafio ? (
                  <div className="field">
                    <label htmlFor="sa-restaurar-password">Tu contraseña</label>
                    <input
                      id="sa-restaurar-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={ocupado}
                    />
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="sa-restaurar-codigo">
                      {desafio.metodo === 'mail' ? `Código enviado a ${desafio.email}` : 'Código de tu app autenticadora'}
                    </label>
                    <input
                      id="sa-restaurar-codigo"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={20}
                      value={codigo}
                      onChange={(e) => setCodigo(e.target.value)}
                      disabled={ocupado}
                    />
                  </div>
                )}
              </div>
              <div className="sa-restaurar-pie">
                <button type="button" className="btn" onClick={cancelar} disabled={ocupado}>
                  Cancelar
                </button>
                {!desafio ? (
                  <button type="button" className="btn btn-primary" onClick={pedirCodigo} disabled={ocupado || !password}>
                    Continuar
                  </button>
                ) : (
                  <button type="button" className="btn sa-btn-restaurar" onClick={restaurar} disabled={ocupado || !dominioOk || codigo.trim().length < 6}>
                    Restaurar copia
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
