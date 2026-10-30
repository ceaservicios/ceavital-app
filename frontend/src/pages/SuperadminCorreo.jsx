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
    sin: 'Mientras falte, no se envían avisos de cuota ni alertas de seguridad, y tu verificación en dos pasos solo puede usar la app autenticadora.',
  },
  empresa: {
    nombre: 'Correo de la empresa',
    variables: 'SMTP_*',
    uso: 'Mails a los usuarios del negocio y a los clientes del portal: códigos de ingreso, contraseñas provisorias y datos de acceso.',
    sin: 'Mientras falte, el sistema funciona igual: la contraseña provisoria de un Administrador se muestra en pantalla, su verificación en dos pasos usa la app, la verificación del email de Encargados y Cajeros queda en pausa y una contraseña olvidada la restablece el Administrador (o CEA, si es de un Administrador).',
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
  pendiente: { texto: 'En cola', clase: 'sa-chip-info' },
  enviado: { texto: 'Enviado', clase: 'sa-chip-ok' },
  fallido: { texto: 'Fallido', clase: 'sa-chip-alerta' },
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
      setError(err instanceof ApiError ? err.message : 'No se pudo completar la acción. Intentá de nuevo.');
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
      setAviso(`${CANAL[canal].nombre}: correo de prueba enviado a ${r.enviado_a}. Verificá que haya llegado.`);
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
      {error && <div className="alert alert-danger">{error}</div>}
      {aviso && <div className="alert alert-exito">{aviso}</div>}

      <div className="sa-grilla-2">
        {estado.canales.map((c) => {
          const info = CANAL[c.id];
          return (
            <section key={c.id} className="card sa-card">
              <div className="sa-card-cabecera">
                <h2 className="sa-h2">{info.nombre}</h2>
                <span className={`sa-chip ${c.configurado ? 'sa-chip-ok' : c.id === 'cea' ? 'sa-chip-alerta' : 'sa-chip-aviso'}`}>
                  {c.configurado ? 'Configurado' : 'Sin configurar'}
                </span>
              </div>
              <p className="sa-ayuda">{info.uso}</p>
              <dl className="sa-datos sa-datos-2">
                <div className="sa-dato-full">
                  <dt>Remitente</dt>
                  <dd>{c.remitente ?? '—'}</dd>
                </div>
                {c.id === 'empresa' && (
                  <div className="sa-dato-full">
                    <dt>Respuestas a</dt>
                    <dd>{c.responder_a ?? (c.configurado ? 'Al remitente' : '—')}</dd>
                  </div>
                )}
                <div>
                  <dt>En cola</dt>
                  <dd>{c.pendientes}</dd>
                </div>
                <div>
                  <dt>Fallidos (30 días)</dt>
                  <dd>{c.fallidos_30d}</dd>
                </div>
                <div className="sa-dato-full">
                  <dt>Último envío</dt>
                  <dd>{c.ultimo_enviado ? formatearFechaHora(c.ultimo_enviado) : '—'}</dd>
                </div>
              </dl>
              {!c.configurado && (
                <p className="sa-ayuda">
                  Faltan las variables {info.variables} en el servidor. {info.sin}
                </p>
              )}
              <div className="sa-card-pie">
                <button type="button" className="btn" disabled={ocupado || !c.configurado} onClick={() => probar(c.id)}>
                  Enviar correo de prueba
                </button>
              </div>
            </section>
          );
        })}
      </div>

      <section className="card sa-card">
        <h2 className="sa-h2">Últimos mails</h2>
        <p className="sa-ayuda">
          Los mails salen en cola: si uno falla, se reintenta automáticamente (al minuto, a los 5 y 30 minutos, a las 2 y a las 6 horas). Un código
          de ingreso que no sale en 10 minutos se descarta. El correo de prueba sale en el momento, sin cola, a tu mail ({usuario}).
        </p>
        {estado.correos.length === 0 ? (
          <p className="sa-vacio">Todavía no se envió ningún mail.</p>
        ) : (
          <div className="sa-tabla-scroll">
            <table className="sa-tabla sa-tabla-correos">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Canal</th>
                  <th>Tipo</th>
                  <th>Destinatario</th>
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
                      <td>
                        <div className="sa-celda-estado">
                          <span className={`sa-chip ${e.clase}`}>{e.texto}</span>
                          {detalle && <span className="sa-detalle-fila">{detalle}</span>}
                        </div>
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
