import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import './ConfigurarDosfa.css';

// Verificación en dos pasos (EST-01 §4): cada uno elige app autenticadora o código por mail. La usa
// "Mi cuenta" del Admin del negocio (base '/cuenta/2fa') y el panel del superadmin (base '/sa/2fa').
// La primera vez alcanza con la sesión; cambiar de método o generar códigos nuevos pide la
// contraseña. Los códigos de recuperación se muestran una sola vez.

const NOMBRE_METODO = { app: 'App autenticadora', mail: 'Código por email' };

export default function ConfigurarDosfa({ base, estado, onCambio, onSesionVencida }) {
  const [vista, setVista] = useState(estado.metodo ? 'resumen' : 'elegir'); // resumen | elegir | app | mail | codigos | regenerar
  const [qr, setQr] = useState(null); // { qr, clave, emisor }
  const [desafio, setDesafio] = useState(null); // { desafio, email }
  const [codigo, setCodigo] = useState('');
  const [password, setPassword] = useState('');
  const [codigos, setCodigos] = useState(null);
  const [copiados, setCopiados] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const guardia = useRef(false); // sincrónica: un doble click no manda dos veces

  const cambiando = Boolean(estado.metodo); // ya tiene un método: cambiarlo pide la contraseña

  async function ejecutar(accion) {
    if (guardia.current) return;
    guardia.current = true;
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      await accion();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && onSesionVencida) return onSesionVencida();
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor. Intentá nuevamente.');
    } finally {
      guardia.current = false;
      setOcupado(false);
    }
  }

  function ir(nueva) {
    setVista(nueva);
    setCodigo('');
    setPassword('');
    setError(null);
    setAviso(null);
  }

  function elegirApp() {
    ir('app');
    setQr(null);
    ejecutar(async () => setQr(await api.post(`${base}/app/iniciar`, {})));
  }

  function elegirMail() {
    ir('mail');
    setDesafio(null);
  }

  function mandarCodigoMail() {
    ejecutar(async () => {
      const r = await api.post(`${base}/mail/iniciar`, {});
      setDesafio(r);
      setCodigo('');
      setAviso(`Enviamos un código a ${r.email}. Vence en 10 minutos.`);
    });
  }

  function confirmarApp(e) {
    e.preventDefault();
    ejecutar(async () => {
      const r = await api.post(`${base}/app/confirmar`, { codigo, password: cambiando ? password : undefined });
      setCodigos(r.codigos);
      setCopiados(false);
      ir('codigos');
    });
  }

  function confirmarMail(e) {
    e.preventDefault();
    ejecutar(async () => {
      await api.post(`${base}/mail/confirmar`, { desafio: desafio.desafio, codigo, password: cambiando ? password : undefined });
      await onCambio('Verificación por email activada.');
      ir('resumen');
    });
  }

  function regenerar(e) {
    e.preventDefault();
    ejecutar(async () => {
      const r = await api.post(`${base}/codigos`, { password });
      setCodigos(r.codigos);
      setCopiados(false);
      ir('codigos');
    });
  }

  async function copiarCodigos() {
    try {
      await navigator.clipboard.writeText(codigos.join('\n'));
      setCopiados(true);
    } catch {
      setError('No se pudieron copiar. Anotalos manualmente.');
    }
  }

  const campoPassword = cambiando && (
    <div className="field">
      <label htmlFor="dosfa-password">Contraseña actual</label>
      <input
        id="dosfa-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={ocupado}
        required
      />
    </div>
  );

  const campoCodigo = (
    <div className="field">
      <label htmlFor="dosfa-codigo">Código de verificación</label>
      <input
        id="dosfa-codigo"
        className="dosfa-codigo-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
        disabled={ocupado}
        required
      />
    </div>
  );

  // Rediseño 2026-10-29: el método activo en un pozo con su ícono; la elección del método en dos
  // opciones tipo tarjeta; la app autenticadora en dos pasos numerados (QR y clave, después el
  // código); acciones a la derecha con la principal al final.
  return (
    <div className="dosfa">
      {error && <div className="alert alert-danger">{error}</div>}
      {aviso && <div className="alert alert-exito">{aviso}</div>}

      {vista === 'resumen' && (
        <>
          <div className="dosfa-resumen">
            <span className="dosfa-icono" aria-hidden="true">
              {estado.metodo === 'app' ? <IconoCelular /> : <IconoMail />}
            </span>
            <div className="dosfa-resumen-textos">
              <span className="dosfa-resumen-titulo">
                {NOMBRE_METODO[estado.metodo]}
                {estado.metodo === 'mail' && estado.email ? ` (${estado.email})` : ''}
              </span>
              <span className="dosfa-ayuda">Se solicita una vez por semana en cada navegador, además de la contraseña.</span>
              {estado.metodo === 'app' && (
                <span className="dosfa-ayuda">
                  Códigos de recuperación disponibles: {estado.codigos_restantes}.
                  {estado.codigos_restantes <= 3 && ' Se recomienda generar códigos nuevos.'}
                </span>
              )}
            </div>
            <span className="dosfa-chip">Activa</span>
          </div>
          <div className="dosfa-acciones">
            <button type="button" className="btn" onClick={() => ir('elegir')}>
              Cambiar método
            </button>
            {estado.metodo === 'app' && (
              <button type="button" className="btn" onClick={() => ir('regenerar')}>
                Generar códigos nuevos
              </button>
            )}
          </div>
        </>
      )}

      {vista === 'elegir' && (
        <>
          <p className="dosfa-ayuda">Elegí cómo confirmar tu identidad al ingresar desde un navegador nuevo.</p>
          <div className="dosfa-opciones">
            <button type="button" className="dosfa-opcion" onClick={elegirApp} disabled={!estado.app_disponible || ocupado}>
              <span className="dosfa-icono" aria-hidden="true">
                <IconoCelular />
              </span>
              <span className="dosfa-opcion-textos">
                <span className="dosfa-opcion-titulo">
                  App autenticadora
                  {estado.app_disponible && <span className="dosfa-recomendado">Recomendado</span>}
                </span>
                <span className="dosfa-opcion-texto">
                  {estado.app_disponible
                    ? 'Google Authenticator, Microsoft Authenticator u otra similar. Funciona sin conexión.'
                    : 'No disponible: falta configurar el servidor (DOSFA_CLAVE).'}
                </span>
              </span>
            </button>
            <button type="button" className="dosfa-opcion" onClick={elegirMail} disabled={!estado.mail_disponible || ocupado}>
              <span className="dosfa-icono" aria-hidden="true">
                <IconoMail />
              </span>
              <span className="dosfa-opcion-textos">
                <span className="dosfa-opcion-titulo">Código por email</span>
                <span className="dosfa-opcion-texto">
                  {estado.mail_disponible
                    ? `Recibís un código en ${estado.email}.`
                    : estado.mail_falta === 'email'
                      ? base === '/sa/2fa'
                        ? 'No disponible: tu usuario no es un email (falta SUPERADMIN_EMAIL en el servidor). Usá la app autenticadora.'
                        : 'No disponible: tu cuenta no tiene un email registrado. Usá la app autenticadora o solicitá a CEA Servicios que lo registre.'
                      : 'No disponible: el correo todavía no está configurado en el servidor.'}
                </span>
              </span>
            </button>
          </div>
          {cambiando && (
            <div className="dosfa-acciones">
              <button type="button" className="btn" onClick={() => ir('resumen')}>
                Cancelar
              </button>
            </div>
          )}
        </>
      )}

      {vista === 'app' && (
        <form className="dosfa-form" onSubmit={confirmarApp}>
          <div className="dosfa-paso">
            <span className="dosfa-paso-num" aria-hidden="true">
              1
            </span>
            <div className="dosfa-paso-cuerpo">
              <span className="dosfa-paso-titulo">Escaneá el código QR</span>
              <span className="dosfa-ayuda">En la app autenticadora, agregá una cuenta nueva y escaneá este código.</span>
              <div className="dosfa-qr">
                {qr ? (
                  <img src={qr.qr} alt="Código QR para la app autenticadora" width="168" height="168" />
                ) : (
                  <div className="dosfa-qr-espera">{ocupado ? 'Generando el código…' : ''}</div>
                )}
                {qr && (
                  <div className="dosfa-qr-clave">
                    <span className="dosfa-qr-clave-rotulo">¿No podés escanearlo?</span>
                    <span className="dosfa-ayuda">Ingresá esta clave en la app ({qr.emisor}):</span>
                    <code>{qr.clave}</code>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="dosfa-paso">
            <span className="dosfa-paso-num" aria-hidden="true">
              2
            </span>
            <div className="dosfa-paso-cuerpo">
              <span className="dosfa-paso-titulo">Ingresá el código de 6 dígitos que muestra la app</span>
              <div className="dosfa-campos">
                {campoCodigo}
                {campoPassword}
              </div>
            </div>
          </div>
          <div className="dosfa-acciones dosfa-acciones-pie">
            <button type="button" className="btn" onClick={() => ir(cambiando ? 'resumen' : 'elegir')} disabled={ocupado}>
              Volver
            </button>
            <button type="submit" className="btn btn-primary" disabled={ocupado || !qr || codigo.length !== 6}>
              Activar verificación
            </button>
          </div>
        </form>
      )}

      {vista === 'mail' && (
        <form className="dosfa-form" onSubmit={confirmarMail}>
          {!desafio && (
            <p className="dosfa-ayuda">
              Vamos a enviar un código a <strong>{estado.email}</strong> para confirmar que lo recibís.
            </p>
          )}
          {desafio && (
            <div className="dosfa-campos">
              {campoCodigo}
              {campoPassword}
            </div>
          )}
          <div className="dosfa-acciones dosfa-acciones-pie">
            <button type="button" className="btn" onClick={() => ir(cambiando ? 'resumen' : 'elegir')} disabled={ocupado}>
              Volver
            </button>
            {desafio ? (
              <>
                <button type="button" className="btn" onClick={mandarCodigoMail} disabled={ocupado}>
                  Reenviar código
                </button>
                <button type="submit" className="btn btn-primary" disabled={ocupado || codigo.length !== 6}>
                  Activar verificación
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={mandarCodigoMail} disabled={ocupado}>
                Enviar código
              </button>
            )}
          </div>
        </form>
      )}

      {vista === 'regenerar' && (
        <form className="dosfa-form" onSubmit={regenerar}>
          <p className="dosfa-ayuda">Se generan 10 códigos nuevos y los anteriores dejan de ser válidos.</p>
          <div className="dosfa-campos">
            <div className="field">
              <label htmlFor="dosfa-password-regenerar">Contraseña actual</label>
              <input
                id="dosfa-password-regenerar"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={ocupado}
                required
              />
            </div>
          </div>
          <div className="dosfa-acciones dosfa-acciones-pie">
            <button type="button" className="btn" onClick={() => ir('resumen')} disabled={ocupado}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={ocupado || !password}>
              Generar códigos nuevos
            </button>
          </div>
        </form>
      )}

      {vista === 'codigos' && codigos && (
        <>
          <p className="dosfa-ayuda">
            <strong>Guardá estos códigos en un lugar seguro.</strong> Te permiten ingresar si no tenés el celular. Cada código se usa una
            sola vez y no se vuelven a mostrar.
          </p>
          <ul className="dosfa-codigos">
            {codigos.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="dosfa-acciones">
            <button type="button" className="btn" onClick={copiarCodigos}>
              {copiados ? 'Códigos copiados' : 'Copiar códigos'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                ejecutar(async () => {
                  await onCambio('Listo. La verificación en dos pasos quedó actualizada.');
                  ir('resumen');
                })
              }
              disabled={ocupado}
            >
              Ya los guardé
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function IconoCelular() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

function IconoMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </svg>
  );
}
