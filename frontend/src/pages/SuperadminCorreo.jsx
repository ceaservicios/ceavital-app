import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearFechaHora } from '../utils/format.js';

// Pestaña "Correo" del panel del superadmin (EST-01 §10): los dos correos de la instalación, si
// están configurados, su cola y un correo de prueba de cada uno (sale en el momento, sin cola, al
// mail del superadmin). Abajo, los últimos mails que salieron o están por salir (sin su contenido).

const CANAL = {
  cea: {
    nombre: 'Correo de CEA',
    variables: 'SA_SMTP_*',
    uso: 'Avisos de cuota a la empresa, alertas de seguridad, copias de seguridad fallidas y tus códigos de ingreso.',
    sin: 'Mientras falte, no sale ningún aviso de cuota ni alerta de seguridad, y tu verificación en dos pasos solo puede ser con la app.',
  },
  empresa: {
    nombre: 'Correo de la empresa',
    variables: 'SMTP_*',
    uso: 'Mails a los usuarios del negocio y a los clientes del portal: códigos de ingreso, contraseñas provisorias y datos de acceso.',
    sin: 'Mientras falte, la app funciona igual: la contraseña provisoria de un Administrador se ve en pantalla, el 2FA de los Administradores va por app, la verificación del email de Encargados y Cajeros queda en pausa y una contraseña olvidada la restablece el Administrador (o vos, si es de un Administrador).',
  },
};

const TIPO = {
  codigo: 'Código de ingreso',
  'cuenta-admin': 'Datos de un Administrador',
  'acceso-portal': 'Acceso al portal',
  'aviso-cuota': 'Aviso de cuota',
  'alerta-seguridad': 'Alerta de seguridad',
  'copia-fallida': 'Copia de seguridad fallida',
  restauracion: 'Restauración de una copia',
};

const ESTADO = {
  pendiente: { texto: 'En cola', clase: 'sa-chip-aviso' },
  enviado: { texto: 'Enviado', clase: 'sa-chip-ok' },
  fallido: { texto: 'Falló', clase: 'sa-chip-alerta' },
  descartado: { texto: 'Descartado', clase: 'sa-chip-neutro' },
};

function detalleDeCorreo(c) {
  const partes = [];
  if (c.estado !== 'enviado' && c.ultimo_error) partes.push(c.ultimo_error);
  if (c.intentos > 1) partes.push(`${c.intentos} intentos`);
  return partes.join(' · ');
}

export default function SuperadminCorreo({ usuario, irAlLogin }) {
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
    setEstado(await api.get('/sa/correo'));
  }, []);

  useEffect(() => {
    let cancelado = false;
    const tick = () => cargar().catch((err) => !cancelado && manejarError(err));
    tick();
    const t = setInterval(tick, 30_000); // la cola avanza sola: se refresca
    return () => {
      cancelado = true;
      clearInterval(t);
    };
  }, [cargar, manejarError]);

  async function probar(canal) {
    if (guardia.current) return;
    guardia.current = true;
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const r = await api.post('/sa/correo/prueba', { canal });
      setAviso(`${CANAL[canal].nombre}: correo de prueba enviado a ${r.enviado_a}. Fijate que te llegue.`);
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
        <h2 className="sa-h2">Correo</h2>
        {error ? <div className="alert alert-danger">{error}</div> : <p className="sa-cargando">Cargando…</p>}
      </section>
    );
  }

  return (
    <>
      <section className="card sa-card">
        <h2 className="sa-h2">Correos de esta instalación</h2>
        <p className="sa-ayuda">
          Todos los mails salen en cola: si uno no sale, se reintenta solo (al minuto, a los 5, a los 30 minutos, a las 2 y a las 6 horas). Un
          código de ingreso que no salió en 10 minutos se descarta. La prueba sale en el momento, sin cola, a tu mail ({usuario}).
        </p>
        {error && <div className="alert alert-danger">{error}</div>}
        {aviso && <div className="alert sa-alert-ok">{aviso}</div>}
        <div className="sa-planes-grilla">
          {estado.canales.map((c) => {
            const info = CANAL[c.id];
            return (
              <div key={c.id} className="sa-plan-tarjeta">
                <div className="sa-plan-cabecera">
                  <span className="sa-plan-nombre">{info.nombre}</span>
                  <span className={`sa-chip ${c.configurado ? 'sa-chip-ok' : c.id === 'cea' ? 'sa-chip-alerta' : 'sa-chip-aviso'}`}>
                    {c.configurado ? 'Configurado' : 'Sin configurar'}
                  </span>
                </div>
                <p className="sa-detalle">{info.uso}</p>
                <dl className="sa-correo-datos">
                  <dt>Sale desde</dt>
                  <dd>{c.remitente ?? '—'}</dd>
                  {c.id === 'empresa' && (
                    <>
                      <dt>Respuestas a</dt>
                      <dd>{c.responder_a ?? (c.configurado ? 'al mismo remitente' : '—')}</dd>
                    </>
                  )}
                  <dt>En cola</dt>
                  <dd>{c.pendientes}</dd>
                  <dt>Fallidos (30 días)</dt>
                  <dd>{c.fallidos_30d}</dd>
                  <dt>Último enviado</dt>
                  <dd>{c.ultimo_enviado ? formatearFechaHora(c.ultimo_enviado) : '—'}</dd>
                </dl>
                {!c.configurado && (
                  <p className="sa-ayuda">
                    Faltan las variables {info.variables} en el servidor. {info.sin}
                  </p>
                )}
                <div className="sa-plan-pie">
                  <button type="button" className="btn" disabled={ocupado || !c.configurado} onClick={() => probar(c.id)}>
                    Mandar correo de prueba
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card sa-card">
        <h2 className="sa-h2">Últimos mails</h2>
        {estado.correos.length === 0 ? (
          <p className="sa-ayuda">Todavía no salió ningún mail.</p>
        ) : (
          <div className="sa-tabla-scroll">
            <table className="sa-tabla sa-tabla-correos">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Correo</th>
                  <th>Qué</th>
                  <th>A</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {estado.correos.map((c) => {
                  const e = ESTADO[c.estado] ?? { texto: c.estado, clase: 'sa-chip-neutro' };
                  const detalle = detalleDeCorreo(c);
                  return (
                    <tr key={c.id}>
                      <td>{formatearFechaHora(c.creado_en)}</td>
                      <td>{c.canal === 'cea' ? 'CEA' : 'Empresa'}</td>
                      <td>{TIPO[c.tipo] ?? c.tipo}</td>
                      <td>{c.para}</td>
                      <td className="sa-correo-estado">
                        <span className={`sa-chip ${e.clase}`}>{e.texto}</span>
                        {detalle && <span className="sa-detalle-fila">{detalle}</span>}
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
