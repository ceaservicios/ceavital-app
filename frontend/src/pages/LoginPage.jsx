import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ApiError } from '../api/client.js';
import './LoginPage.css';

export default function LoginPage() {
  const { usuario, cargandoSesion, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [usuarioLogin, setUsuarioLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  if (!cargandoSesion && usuario) {
    const destino = location.state?.from ?? '/caja';
    return <Navigate to={destino} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await login(usuarioLogin.trim(), password);
      navigate(location.state?.from ?? '/caja', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('No se pudo conectar con el servidor. Probá de nuevo.');
      }
    } finally {
      setEnviando(false);
    }
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

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="usuario">Usuario</label>
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
      </div>
    </div>
  );
}
