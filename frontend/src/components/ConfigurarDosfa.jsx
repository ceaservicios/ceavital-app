import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import './ConfigurarDosfa.css';

// Verificación en dos pasos (EST-01 §4): cada uno elige app autenticadora o código por mail. La usa
// "Mi cuenta" del Admin del negocio (base '/cuenta/2fa') y el panel del superadmin (base '/sa/2fa').
// La primera vez alcanza con la sesión; cambiar de método o generar códigos nuevos pide la
// contraseña. Los códigos de recuperación se muestran una sola vez.

const NOMBRE_METODO = { app: 'App autenticadora', mail: 'Código por mail' };

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
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor. Probá de nuevo.');
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
      setAviso(`Te mandamos un código a ${r.email}. Vence en 10 minutos.`);
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
      await onCambio('La verificación por mail quedó activa.');
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
      setError('No se pudieron copiar: anotalos a mano.');
    }
  }

  const campoPassword = cambiando && (
    <div className="field">
      <label htmlFor="dosfa-password">Tu contraseña (para confirmar el cambio)</label>
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
      <label htmlFor="dosfa-codigo">Código de 6 números</label>
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

  return (
    <div className="dosfa">
      {error && <div className="alert alert-danger">{error}</div>}
      {aviso && <div className="alert dosfa-aviso">{aviso}</div>}

      {vista === 'resumen' && (
        <>
          <p className="dosfa-estado">
            <span className="dosfa-chip">Activa</span> {NOMBRE_METODO[estado.metodo]}
            {estado.metodo === 'mail' && estado.email ? ` (${estado.email})` : ''}
          </p>
          {estado.metodo === 'app' && (
            <p className="dosfa-ayuda">
              Te quedan {estado.codigos_restantes} código{estado.codigos_restantes === 1 ? '' : 's'} de recuperación.
              {estado.codigos_restantes <= 3 && ' Conviene generar códigos nuevos.'}
            </p>
          )}
          <p className="dosfa-ayuda">Se pide una vez por semana en cada navegador, además de la contraseña.</p>
          <div className="dosfa-acciones">
            <button type="button" className="btn" onClick={() => ir('elegir')}>
              Cambiar método
            </button>
            {estado.metodo === 'app' && (
              <button type="button" className="btn" onClick={() => ir('regenerar')}>
                Códigos de recuperación nuevos
              </button>
            )}
          </div>
        </>
      )}

      {vista === 'elegir' && (
        <>
          <p className="dosfa-ayuda">Elegí cómo vas a confirmar que sos vos cada vez que entres desde un navegador nuevo.</p>
          <div className="dosfa-opciones">
            <button type="button" className="dosfa-opcion" onClick={elegirApp} disabled={!estado.app_disponible || ocupado}>
              <span className="dosfa-opcion-titulo">App autenticadora (recomendado)</span>
              <span className="dosfa-opcion-texto">
                {estado.app_disponible
                  ? 'Google Authenticator, Microsoft Authenticator u otra. Funciona aunque el celular no tenga señal.'
                  : 'No disponible: falta configurar el servidor (DOSFA_CLAVE).'}
              </span>
            </button>
            <button type="button" className="dosfa-opcion" onClick={elegirMail} disabled={!estado.mail_disponible || ocupado}>
              <span className="dosfa-opcion-titulo">Código por mail</span>
              <span className="dosfa-opcion-texto">
                {estado.mail_disponible
                  ? `Te llega un código a ${estado.email}.`
                  : estado.mail_falta === 'email'
                    ? base === '/sa/2fa'
                      ? 'No disponible: tu usuario no es un mail (falta SUPERADMIN_EMAIL en el servidor). Usá la app autenticadora.'
                      : 'No disponible: tu cuenta no tiene un email cargado. Usá la app autenticadora o pedile a CEA Servicios que te lo cargue.'
                    : 'No disponible: el correo todavía no está configurado en el servidor.'}
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
          <ol className="dosfa-pasos">
            <li>En la app autenticadora, agregá una cuenta nueva y escaneá este código.</li>
            <li>Escribí abajo el código de 6 números que te muestra la app.</li>
          </ol>
          {/* El código y los botones van al lado del QR: así el paso entra en una ventana de notebook. */}
          <div className="dosfa-qr">
            {qr ? (
              <img src={qr.qr} alt="Código QR para la app autenticadora" width="180" height="180" />
            ) : (
              <div className="dosfa-qr-espera">{ocupado ? 'Generando el código…' : ''}</div>
            )}
            <div className="dosfa-qr-lado">
              {qr && (
                <div className="dosfa-qr-clave">
                  <span className="dosfa-ayuda">¿No podés escanearlo? Cargá esta clave a mano ({qr.emisor}):</span>
                  <code>{qr.clave}</code>
                </div>
              )}
              {campoCodigo}
              {campoPassword}
              <div className="dosfa-acciones">
                <button type="submit" className="btn btn-primary" disabled={ocupado || !qr || codigo.length !== 6}>
                  Activar
                </button>
                <button type="button" className="btn" onClick={() => ir(cambiando ? 'resumen' : 'elegir')} disabled={ocupado}>
                  Volver
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {vista === 'mail' && (
        <form className="dosfa-form" onSubmit={confirmarMail}>
          {!desafio && (
            <p className="dosfa-ayuda">
              Te vamos a mandar un código a <strong>{estado.email}</strong> para comprobar que te llega.
            </p>
          )}
          {desafio && campoCodigo}
          {desafio && campoPassword}
          <div className="dosfa-acciones">
            {desafio ? (
              <>
                <button type="submit" className="btn btn-primary" disabled={ocupado || codigo.length !== 6}>
                  Activar
                </button>
                <button type="button" className="btn" onClick={mandarCodigoMail} disabled={ocupado}>
                  Mandarme otro
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={mandarCodigoMail} disabled={ocupado}>
                Mandarme el código
              </button>
            )}
            <button type="button" className="btn" onClick={() => ir(cambiando ? 'resumen' : 'elegir')} disabled={ocupado}>
              Volver
            </button>
          </div>
        </form>
      )}

      {vista === 'regenerar' && (
        <form className="dosfa-form" onSubmit={regenerar}>
          <p className="dosfa-ayuda">Se generan 10 códigos nuevos y los anteriores dejan de servir.</p>
          <div className="field">
            <label htmlFor="dosfa-password-regenerar">Tu contraseña</label>
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
          <div className="dosfa-acciones">
            <button type="submit" className="btn btn-primary" disabled={ocupado || !password}>
              Generar códigos nuevos
            </button>
            <button type="button" className="btn" onClick={() => ir('resumen')} disabled={ocupado}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {vista === 'codigos' && codigos && (
        <>
          <p className="dosfa-ayuda">
            <strong>Guardá estos códigos de recuperación en un lugar seguro.</strong> Si no tenés el celular, cada uno sirve una
            sola vez para entrar. No se vuelven a mostrar.
          </p>
          <ul className="dosfa-codigos">
            {codigos.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="dosfa-acciones">
            <button type="button" className="btn" onClick={copiarCodigos}>
              {copiados ? 'Copiados' : 'Copiar los códigos'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                ejecutar(async () => {
                  await onCambio('Listo, los códigos de recuperación quedaron guardados.');
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
