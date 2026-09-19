import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import './LoginPage.css';

// Ingreso del cliente-empresa a su propia cuenta. Sesión aparte de la de los
// usuarios del negocio (ver src/services/clientes-portal.service.js).
export default function PortalLoginPage() {
  const navigate = useNavigate();
  const { cargandoSesion, moduloActivo } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await api.post('/portal/login', { usuario: usuario.trim(), password });
      navigate('/portal', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor. Probá de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  if (cargandoSesion) return null;

  // Plan sin el módulo de portal: no hay ingreso de clientes en esta instalación.
  if (!moduloActivo('portal')) {
    return (
      <div className="login-page">
        <div className="login-card card">
          <div className="login-brand">
            <img src="/logo-icon.png" alt="CEAVital" className="login-logo" />
            <div className="login-brand-text">
              <span className="login-brand-title">Portal no disponible</span>
              <span className="login-brand-subtitle">Este negocio no tiene habilitado el acceso de clientes.</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-brand">
          <img src="/logo-icon.png" alt="CEAVital" className="login-logo" />
          <div className="login-brand-text">
            <span className="login-brand-title">Tu cuenta corriente</span>
            <span className="login-brand-subtitle">Ingresá con el usuario y la contraseña que te dio el negocio</span>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="portal-usuario">Usuario</label>
            <input
              id="portal-usuario"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              disabled={enviando}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="portal-password">Contraseña</label>
            <input
              id="portal-password"
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
