import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, setCsrfSuperadmin } from '../api/client.js';
import './LoginPage.css';

// Ingreso de CEA al panel de esta instalación (/sa). Cuenta y sesión propias, aparte de
// las del negocio y las de los clientes (ver src/services/superadmin.service.js).
export default function SuperadminLoginPage() {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const data = await api.post('/sa/login', { usuario: usuario.trim(), password });
      setCsrfSuperadmin(data.csrf_token);
      navigate('/sa', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor. Probá de nuevo.');
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
            <span className="login-brand-title">Administración CEA</span>
            <span className="login-brand-subtitle">Acceso exclusivo de CEA Servicios a esta instalación</span>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="sa-usuario">Usuario</label>
            <input
              id="sa-usuario"
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
            <label htmlFor="sa-password">Contraseña</label>
            <input
              id="sa-password"
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
