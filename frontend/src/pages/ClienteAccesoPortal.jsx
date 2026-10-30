import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearFechaHora } from '../utils/format.js';

// Sin caracteres que se confunden al leerlos o dictarlos (0/O, 1/l/I).
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function generarPassword(largo = 12) {
  const azar = new Uint32Array(largo);
  crypto.getRandomValues(azar);
  return Array.from(azar, (n) => ALFABETO[n % ALFABETO.length]).join('');
}

async function copiarAlPortapapeles(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

// Pestaña "Acceso al portal" de la ficha: el negocio define el usuario y la contraseña con
// los que el cliente entra a ver su propia cuenta (portal del cliente).
export default function ClienteAccesoPortal({ clienteId, razonSocial, email }) {
  const [acceso, setAcceso] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [entregar, setEntregar] = useState(null); // credenciales recién definidas, se muestran una sola vez
  const [copiado, setCopiado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviadoA, setEnviadoA] = useState(null);
  const [errorEnvio, setErrorEnvio] = useState(null);
  const envioRef = useRef(false);
  // Guardia sincrónica contra doble click (mismo criterio que el resto de las pantallas).
  const guardaRef = useRef(false);

  const enlace = `${window.location.origin}/portal/login`;

  useEffect(() => {
    setCargando(true);
    api
      .get(`/clientes-empresa/${clienteId}/acceso`)
      .then((datos) => {
        setAcceso(datos);
        setUsuario(datos.usuario ?? email ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar el acceso.'))
      .finally(() => setCargando(false));
  }, [clienteId, email]);

  async function enviar(cuerpo, mensajeError) {
    if (guardaRef.current) return null;
    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      const nuevo = await api.put(`/clientes-empresa/${clienteId}/acceso`, cuerpo);
      setAcceso(nuevo);
      return nuevo;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : mensajeError);
      return null;
    } finally {
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  async function guardar(e) {
    e.preventDefault();
    const cuerpo = {};
    if (!acceso.configurado || usuario.trim() !== acceso.usuario) cuerpo.usuario = usuario.trim();
    if (password) cuerpo.password = password;
    if (Object.keys(cuerpo).length === 0) {
      setError('No hay cambios para guardar.');
      return;
    }
    const nuevo = await enviar(cuerpo, 'No se pudo guardar el acceso.');
    if (nuevo) {
      if (password) setEntregar({ usuario: nuevo.usuario, password });
      else setEntregar(null);
      setEnviadoA(null);
      setErrorEnvio(null);
      setPassword('');
      setVerPassword(false);
      setCopiado(false);
    }
  }

  async function alternarHabilitado() {
    const nuevo = await enviar({ habilitado: !acceso.habilitado }, 'No se pudo cambiar el estado del acceso.');
    if (nuevo && !nuevo.habilitado) setEntregar(null);
  }

  function textoDeAcceso() {
    return [
      `Acceso a tu cuenta corriente${razonSocial ? ` - ${razonSocial}` : ''}`,
      `Ingresá en: ${enlace}`,
      `Usuario: ${entregar.usuario}`,
      `Contraseña: ${entregar.password}`,
    ].join('\n');
  }

  async function copiarDatos() {
    setCopiado(await copiarAlPortapapeles(textoDeAcceso()));
  }

  // Sin SMTP en el servidor: se abre el programa de correo del usuario con el
  // mensaje armado (funciona sin configurar nada).
  function enlaceMailto() {
    const asunto = `Acceso a tu cuenta corriente${razonSocial ? ` - ${razonSocial}` : ''}`;
    const cuerpo = `Hola,\r\n\r\nYa podés ver tu cuenta corriente con nosotros.\r\n\r\n${textoDeAcceso().split('\n').slice(1).join('\r\n')}\r\n\r\nGuardá estos datos en un lugar seguro.`;
    return `mailto:${encodeURIComponent(acceso.email_cliente)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
  }

  async function enviarPorMail() {
    if (envioRef.current) return;
    envioRef.current = true;
    setEnviando(true);
    setErrorEnvio(null);
    setEnviadoA(null);
    try {
      const resultado = await api.post(`/clientes-empresa/${clienteId}/acceso/enviar`, { password: entregar.password });
      setEnviadoA(resultado.enviado_a);
    } catch (err) {
      setErrorEnvio(err instanceof ApiError ? err.message : 'No se pudo enviar el mail.');
    } finally {
      envioRef.current = false;
      setEnviando(false);
    }
  }

  if (cargando) return <div className="card cliente-card"><div className="cliente-vacio">Cargando…</div></div>;

  if (!acceso) {
    return <div className="card cliente-card">{error && <div className="alert alert-danger">{error}</div>}</div>;
  }

  if (!acceso.portal_disponible) {
    return (
      <div className="card cliente-card form-angosto">
        <span className="cliente-seccion-titulo">Acceso al portal de clientes</span>
        <div className="cliente-vacio">El portal de clientes no está incluido en el plan contratado.</div>
      </div>
    );
  }

  const estado = !acceso.configurado
    ? { clave: 'sin', texto: 'Sin acceso' }
    : acceso.bloqueado
      ? { clave: 'bloqueado', texto: 'Bloqueado' }
      : acceso.habilitado
        ? { clave: 'ok', texto: 'Habilitado' }
        : { clave: 'off', texto: 'Deshabilitado' };

  return (
    <>
      <form className="card cliente-card form-angosto" onSubmit={guardar}>
        <div className="cliente-seccion-cabecera">
          <span className="cliente-seccion-titulo">Acceso al portal de clientes</span>
          <span className={`cliente-acceso-estado cliente-acceso-${estado.clave}`}>{estado.texto}</span>
        </div>
        <div className="cliente-hint">
          Con este usuario y contraseña el cliente consulta su saldo y sus movimientos, y descarga su resumen de cuenta.
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {acceso.bloqueado && (
          <div className="alert alert-danger">Acceso bloqueado por intentos fallidos. Se desbloquea al definir una contraseña nueva.</div>
        )}

        <div className="cliente-campos acceso-campos">
          <div className="field">
            <label htmlFor="acceso-usuario">Usuario</label>
            <input
              id="acceso-usuario"
              autoComplete="off"
              placeholder="Ej.: email del cliente"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="acceso-password">{acceso.configurado ? 'Contraseña nueva (opcional)' : 'Contraseña'}</label>
            <div className="cliente-pass-fila">
              <input
                id="acceso-password"
                type={verPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Mínimo 8 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!acceso.configurado}
              />
              <button type="button" className="btn" onClick={() => setVerPassword((v) => !v)}>
                {verPassword ? 'Ocultar' : 'Mostrar'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setPassword(generarPassword());
                  setVerPassword(true);
                }}
              >
                Generar
              </button>
            </div>
          </div>
        </div>

        <div className="cliente-acciones">
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Guardando…' : acceso.configurado ? 'Guardar cambios' : 'Crear acceso'}
          </button>
        </div>
      </form>

      {entregar && (
        <div className="card cliente-card cliente-credenciales form-angosto">
          <span className="cliente-seccion-titulo">Datos de acceso para el cliente</span>
          <div className="cliente-hint">La contraseña solo se muestra ahora. Después no se puede consultar: solo definir una nueva.</div>
          <dl className="cliente-credenciales-lista">
            <div>
              <dt>Enlace</dt>
              <dd>{enlace}</dd>
            </div>
            <div>
              <dt>Usuario</dt>
              <dd>{entregar.usuario}</dd>
            </div>
            <div>
              <dt>Contraseña</dt>
              <dd>{entregar.password}</dd>
            </div>
          </dl>
          {errorEnvio && <div className="alert alert-danger">{errorEnvio}</div>}
          {enviadoA && <div className="alert alert-exito">Datos enviados a {enviadoA}.</div>}
          {!acceso.email_cliente && (
            <div className="cliente-hint">El cliente no tiene email registrado. Agregalo en la pestaña Datos para enviarle el acceso por correo.</div>
          )}
          {acceso.email_cliente && !acceso.correo_disponible && (
            <div className="cliente-hint">
              El envío automático de correos no está configurado: el botón abre tu programa de correo con el mensaje listo para{' '}
              {acceso.email_cliente}.
            </div>
          )}
          <div className="cliente-acciones cliente-acciones-envio">
            <button type="button" className="btn" onClick={copiarDatos}>
              {copiado ? 'Datos copiados' : 'Copiar datos de acceso'}
            </button>
            {acceso.email_cliente && acceso.correo_disponible && (
              <button type="button" className="btn btn-primary" disabled={enviando} onClick={enviarPorMail}>
                {enviando ? 'Enviando…' : `Enviar por correo a ${acceso.email_cliente}`}
              </button>
            )}
            {acceso.email_cliente && !acceso.correo_disponible && (
              <a className="btn btn-primary" href={enlaceMailto()}>
                Abrir en el programa de correo
              </a>
            )}
          </div>
        </div>
      )}

      {acceso.configurado && (
        <div className="card cliente-card form-angosto">
          <span className="cliente-seccion-titulo">Estado del acceso</span>
          <dl className="ficha-datos-fila">
            <div>
              <dt>Último ingreso del cliente</dt>
              <dd>{acceso.ultimo_acceso ? formatearFechaHora(acceso.ultimo_acceso) : <span className="dato-vacio">Sin ingresos todavía</span>}</dd>
            </div>
            <div>
              <dt>Enlace de ingreso</dt>
              <dd>{enlace}</dd>
            </div>
          </dl>
          <div className="ficha-pie">
            <span className="cliente-hint">
              {acceso.habilitado
                ? 'Al deshabilitarlo, el cliente pierde el acceso de inmediato, incluso con la sesión abierta. Se puede volver a habilitar en cualquier momento.'
                : 'El cliente no puede ingresar al portal hasta que se vuelva a habilitar el acceso.'}
            </span>
            <button type="button" className={acceso.habilitado ? 'btn btn-peligro' : 'btn btn-primary'} disabled={guardando} onClick={alternarHabilitado}>
              {acceso.habilitado ? 'Deshabilitar acceso' : 'Habilitar acceso'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
