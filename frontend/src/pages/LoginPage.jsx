import { useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api, ApiError } from '../api/client.js';
import './LoginPage.css';

// Formato de un código de recuperación de la app (XXXXX-XXXXX): se arma mientras se escribe.
function formatearRecuperacion(valor) {
  const limpio = valor.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 10);
  return limpio.length > 5 ? `${limpio.slice(0, 5)}-${limpio.slice(5)}` : limpio;
}

export default function LoginPage() {
  const { usuario, cargandoSesion, login, confirmarCodigo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [usuarioLogin, setUsuarioLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  // Paso 2 del ingreso: { desafio, metodo: 'app' | 'mail', email }.
  const [desafio, setDesafio] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [usarRecuperacion, setUsarRecuperacion] = useState(false);
  // Guardia sincrónica de Ingresar / Confirmar código / Mandarme otro código: `disabled={enviando}`
  // no alcanza contra dos clicks en el mismo tick (mandaba 2 mails con códigos distintos o abría
  // 2 sesiones). Mismo patrón que UsuariosPage.
  const enviandoRef = useRef(false);

  if (!cargandoSesion && usuario) {
    const destino = usuario.pendiente ? '/cuenta' : location.state?.from ?? '/caja';
    return <Navigate to={destino} replace />;
  }

  function mostrarError(err) {
    setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor. Probá de nuevo.');
  }

  // Sesión abierta: el superadmin va a su panel; un usuario con algo pendiente, a "Mi cuenta".
  function entrar(data) {
    if (data.tipo === 'superadmin') {
      navigate('/sa', { replace: true, state: { sesionAnteriorCerrada: Boolean(data.expulso_sesion_anterior) } });
      return;
    }
    navigate(data.usuario?.pendiente ? '/cuenta' : location.state?.from ?? '/caja', { replace: true });
  }

  async function conGuardia(accion) {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setError(null);
    setEnviando(true);
    try {
      await accion();
    } catch (err) {
      mostrarError(err);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  function ingresar(e) {
    e.preventDefault();
    conGuardia(async () => {
      const data = await login(usuarioLogin.trim(), password);
      if (data.requiere_codigo) {
        setDesafio({ desafio: data.desafio, metodo: data.metodo, email: data.email });
        setCodigo('');
        setUsarRecuperacion(false);
        setAviso(null);
        return;
      }
      entrar(data);
    });
  }

  function confirmar(e) {
    e.preventDefault();
    setAviso(null);
    conGuardia(async () => entrar(await confirmarCodigo(desafio.desafio, codigo.trim())));
  }

  function reenviar() {
    setAviso(null);
    conGuardia(async () => {
      const data = await api.post('/auth/codigo/reenviar', { desafio: desafio.desafio });
      setAviso(`Te mandamos un código nuevo a ${data.email}.`);
      setCodigo('');
    });
  }

  function volver() {
    setDesafio(null);
    setCodigo('');
    setPassword('');
    setError(null);
    setAviso(null);
  }

  function cambiarModoRecuperacion() {
    setUsarRecuperacion(!usarRecuperacion);
    setCodigo('');
    setError(null);
  }

  const codigoCompleto = usarRecuperacion ? /^[0-9A-F]{5}-[0-9A-F]{5}$/.test(codigo) : codigo.length === 6;

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-brand">
          <img src="/logo-icon.png" alt="CEAVital" className="login-logo" />
          <div className="login-brand-text">
            <span className="login-brand-title">CEAVital</span>
            <span className="login-brand-subtitle">Sistema de gestión para tu comercio</span>
          </div>
        </div>

        {desafio ? (
          <form className="login-form" onSubmit={confirmar}>
            <p className="login-codigo-texto">
              {desafio.metodo === 'app' ? (
                usarRecuperacion ? (
                  'Escribí uno de tus códigos de recuperación (cada uno sirve una sola vez).'
                ) : (
                  'Abrí tu app autenticadora y escribí el código de 6 números de CEAVital.'
                )
              ) : (
                <>
                  Te mandamos un código de 6 números a <strong>{desafio.email}</strong>. Vence en 10 minutos.
                </>
              )}
            </p>
            <div className="field">
              <label htmlFor="codigo">{usarRecuperacion ? 'Código de recuperación' : 'Código'}</label>
              {usarRecuperacion ? (
                <input
                  id="codigo"
                  className="login-codigo-input login-codigo-recuperacion"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={11}
                  autoFocus
                  value={codigo}
                  onChange={(e) => setCodigo(formatearRecuperacion(e.target.value))}
                  disabled={enviando}
                  required
                />
              ) : (
                <input
                  id="codigo"
                  className="login-codigo-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  autoFocus
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                  disabled={enviando}
                  required
                />
              )}
            </div>

            {error && <div className="alert alert-danger">{error}</div>}
            {aviso && <div className="alert login-aviso">{aviso}</div>}

            <button type="submit" className="btn btn-primary login-submit" disabled={enviando || !codigoCompleto}>
              {enviando ? 'Verificando…' : 'Ingresar'}
            </button>
            <div className="login-codigo-acciones">
              {desafio.metodo === 'mail' ? (
                <button type="button" className="login-link" onClick={reenviar} disabled={enviando}>
                  Mandarme otro código
                </button>
              ) : (
                <button type="button" className="login-link" onClick={cambiarModoRecuperacion} disabled={enviando}>
                  {usarRecuperacion ? 'Usar el código de la app' : 'No tengo el celular'}
                </button>
              )}
              <button type="button" className="login-link" onClick={volver} disabled={enviando}>
                Volver
              </button>
            </div>
          </form>
        ) : (
          <form className="login-form" onSubmit={ingresar}>
            <div className="field">
              <label htmlFor="usuario">Email o usuario</label>
              <input
                id="usuario"
                type="text"
                autoComplete="username"
                autoFocus
                value={usuarioLogin}
                onChange={(e) => setUsuarioLogin(e.target.value)}
                disabled={enviando}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={enviando}
                required
              />
            </div>

            {error && <div className="alert alert-danger">{error}</div>}

            <button type="submit" className="btn btn-primary login-submit" disabled={enviando}>
              {enviando ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
