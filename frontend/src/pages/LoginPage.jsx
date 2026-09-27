import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api, ApiError } from '../api/client.js';
import './LoginPage.css';

export default function LoginPage() {
  const { usuario, cargandoSesion, login, confirmarCodigo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [usuarioLogin, setUsuarioLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  // Paso 2 del ingreso: el código que llegó por mail (email sin verificar o 2FA).
  const [desafio, setDesafio] = useState(null); // { desafio, email }
  const [codigo, setCodigo] = useState('');

  if (!cargandoSesion && usuario) {
    const destino = location.state?.from ?? '/caja';
    return <Navigate to={destino} replace />;
  }

  function mostrarError(err) {
    setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor. Probá de nuevo.');
  }

  async function ingresar(e) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const data = await login(usuarioLogin.trim(), password);
      if (data.requiere_codigo) {
        setDesafio({ desafio: data.desafio, email: data.email });
        setCodigo('');
        setAviso(null);
        return;
      }
      navigate(data.tipo === 'superadmin' ? '/sa' : location.state?.from ?? '/caja', { replace: true });
    } catch (err) {
      mostrarError(err);
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar(e) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setEnviando(true);
    try {
      await confirmarCodigo(desafio.desafio, codigo.trim());
      navigate(location.state?.from ?? '/caja', { replace: true });
    } catch (err) {
      mostrarError(err);
    } finally {
      setEnviando(false);
    }
  }

  async function reenviar() {
    setError(null);
    setAviso(null);
    setEnviando(true);
    try {
      const data = await api.post('/auth/codigo/reenviar', { desafio: desafio.desafio });
      setAviso(`Te mandamos un código nuevo a ${data.email}.`);
      setCodigo('');
    } catch (err) {
      mostrarError(err);
    } finally {
      setEnviando(false);
    }
  }

  function volver() {
    setDesafio(null);
    setCodigo('');
    setPassword('');
    setError(null);
    setAviso(null);
  }

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
              Te mandamos un código de 6 números a <strong>{desafio.email}</strong>. Vence en 10 minutos.
            </p>
            <div className="field">
              <label htmlFor="codigo">Código</label>
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
            </div>

            {error && <div className="alert alert-danger">{error}</div>}
            {aviso && <div className="alert login-aviso">{aviso}</div>}

            <button type="submit" className="btn btn-primary login-submit" disabled={enviando || codigo.length !== 6}>
              {enviando ? 'Verificando…' : 'Ingresar'}
            </button>
            <div className="login-codigo-acciones">
              <button type="button" className="login-link" onClick={reenviar} disabled={enviando}>
                Mandarme otro código
              </button>
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
