import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearFechaHora } from '../utils/format.js';
import SuperadminRestaurar from './SuperadminRestaurar.jsx';

const SUFIJO_RESGUARDO = 'antes-de-restaurar';

// Pestaña "Copias" del panel del superadmin (Fase 4): copias de seguridad de la base en el Google
// Drive de CEA. Estado, dónde quedan, versiones de la base y de pg_dump, "Respaldar ahora" y las
// últimas 30. La copia corre en el servidor: mientras hay una en curso, se refresca cada 3 s. En el
// medio, la tarjeta para restaurar una copia (SuperadminRestaurar.jsx).

const ESTADO = {
  en_curso: { texto: 'En curso', clase: 'sa-chip-aviso' },
  ok: { texto: 'Bien', clase: 'sa-chip-ok' },
  error: { texto: 'Falló', clase: 'sa-chip-alerta' },
};

const mayor = (version) => Number.parseInt(String(version ?? ''), 10) || null;

export default function SuperadminCopias({ irAlLogin }) {
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const guardia = useRef(false);

  const manejarError = useCallback(
    (err) => {
      if (err instanceof ApiError && err.status === 401) return irAlLogin();
      setError(err instanceof ApiError ? err.message : 'No se pudo completar la acción. Probá de nuevo.');
    },
    [irAlLogin]
  );

  const cargar = useCallback(async () => {
    setEstado(await api.get('/sa/copias'));
  }, []);

  const enCurso = Boolean(estado?.historial.some((c) => c.estado === 'en_curso'));

  useEffect(() => {
    cargar().catch(manejarError);
  }, [cargar, manejarError]);

  useEffect(() => {
    let cancelado = false;
    const t = setInterval(() => cargar().catch((err) => !cancelado && manejarError(err)), enCurso ? 3_000 : 30_000);
    return () => {
      cancelado = true;
      clearInterval(t);
    };
  }, [cargar, manejarError, enCurso]);

  async function respaldar() {
    if (guardia.current) return;
    guardia.current = true;
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      await api.post('/sa/copias', {});
      setAviso('Copia en curso. Cuando termine, aparece abajo con su resultado.');
      await cargar();
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
        <h2 className="sa-h2">Copias de seguridad</h2>
        {error ? <div className="alert alert-danger">{error}</div> : <p className="sa-cargando">Cargando…</p>}
      </section>
    );
  }

  const configuradas = estado.faltan.length === 0;
  const chip = !configuradas
    ? { texto: 'Sin configurar', clase: 'sa-chip-alerta' }
    : enCurso
      ? { texto: 'Copia en curso', clase: 'sa-chip-aviso' }
      : { texto: 'Activas', clase: 'sa-chip-ok' };
  // pg_dump no puede copiar una base de una versión mayor más nueva que la suya.
  const versionesMal = mayor(estado.version_base) && mayor(estado.version_pg_dump) && mayor(estado.version_pg_dump) < mayor(estado.version_base);

  return (
    <>
      <section className="card sa-card">
        <div className="sa-card-cabecera">
          <h2 className="sa-h2">Copias de seguridad</h2>
          <span className={`sa-chip ${chip.clase}`}>{chip.texto}</span>
        </div>
        <p className="sa-ayuda">
          Una copia completa de la base por día, desde las {estado.hora} de la mañana (si el servidor estuvo caído, apenas vuelve), en el
          Google Drive de CEA. Se guardan {estado.retencion_dias} días. Si la automática falla, te llega un mail y no se reintenta sola hasta el
          día siguiente: podés probar con "Respaldar ahora".
        </p>
        {!configuradas && (
          <div className="alert alert-danger">Faltan en el servidor: {estado.faltan.join(' y ')}. Hasta cargarlas no se hace ninguna copia.</div>
        )}
        {versionesMal && (
          <div className="alert alert-danger">
            La base es Postgres {estado.version_base} y pg_dump es {estado.version_pg_dump}: las copias van a fallar. Hay que subir el cliente
            de Postgres del Dockerfile.
          </div>
        )}
        {error && <div className="alert alert-danger">{error}</div>}
        {aviso && <div className="alert sa-alert-ok">{aviso}</div>}
        <dl className="sa-correo-datos">
          <dt>Carpeta en Drive</dt>
          <dd>{estado.carpeta}</dd>
          <dt>Última copia buena</dt>
          <dd>{estado.ultima_ok ? formatearFechaHora(estado.ultima_ok) : 'Todavía ninguna'}</dd>
          <dt>Base de datos</dt>
          <dd>{estado.version_base ? `Postgres ${estado.version_base}` : '—'}</dd>
          <dt>pg_dump</dt>
          <dd>{estado.version_pg_dump ?? 'No está instalado en el servidor'}</dd>
        </dl>
        <div>
          <button type="button" className="btn btn-primary" disabled={ocupado || enCurso || !configuradas} onClick={respaldar}>
            {enCurso ? 'Copia en curso…' : 'Respaldar ahora'}
          </button>
        </div>
      </section>

      <SuperadminRestaurar irAlLogin={irAlLogin} configuradas={configuradas} copiaEnCurso={enCurso} />

      <section className="card sa-card">
        <h2 className="sa-h2">Últimas copias</h2>
        {estado.historial.length === 0 ? (
          <p className="sa-ayuda">Todavía no se hizo ninguna copia.</p>
        ) : (
          <div className="sa-tabla-scroll">
            <table className="sa-tabla sa-tabla-copias">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {estado.historial.map((c) => {
                  const e = ESTADO[c.estado] ?? { texto: c.estado, clase: 'sa-chip-neutro' };
                  return (
                    <tr key={c.id}>
                      <td>{formatearFechaHora(c.iniciada_en)}</td>
                      <td>{c.archivo?.endsWith(`_${SUFIJO_RESGUARDO}.dump`) ? 'Resguardo antes de restaurar' : c.manual ? 'Pedida desde el panel' : 'Automática'}</td>
                      <td className="sa-correo-estado">
                        <span className={`sa-chip ${e.clase}`}>{e.texto}</span>
                        {c.archivo && <span className="sa-detalle-fila sa-mono">{c.archivo}</span>}
                        {c.detalle && <span className="sa-detalle-fila">{c.detalle}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
