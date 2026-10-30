import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, tomarAvisoPortal } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import AvisoEmergente from '../components/AvisoEmergente.jsx';
import './LoginPage.css';

// Al entrar un tercer equipo con el mismo usuario (hasta 2 a la vez, decisión del usuario del
// 2026-10-16), el que entra lo ve en el portal.
const AVISO_CERRO_OTRO = 'Este usuario ya tenía una sesión abierta en 2 equipos: se cerró la más antigua.';

// Ingreso del cliente-empresa a su propia cuenta. Sesión aparte de la de los
// usuarios del negocio (ver src/services/clientes-portal.service.js).
// Rediseño 2026-10-29: la marca es la del negocio (sus clientes no conocen CEAVital), en una
// tarjeta centrada; CEAVital queda como firma al pie.
export default function PortalLoginPage() {
  const navigate = useNavigate();
  const { cargandoSesion, moduloActivo } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  // Guardia sincrónica de Ingresar: `disabled={enviando}` no alcanza contra dos envíos en el
  // mismo tick (abría 2 sesiones). Mismo patrón que LoginPage.
  const enviandoRef = useRef(false);
  // El equipo que quedó afuera porque entró otro: llega acá con el texto guardado (api/client.js).
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    const texto = tomarAvisoPortal();
    if (texto) setAviso(texto);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setError(null);
    setEnviando(true);
    try {
      const resultado = await api.post('/portal/login', { usuario: usuario.trim(), password });
      navigate('/portal', { replace: true, state: resultado?.sesion_cerrada_otro_equipo ? { aviso: AVISO_CERRO_OTRO } : null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor. Intentá nuevamente.');
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  if (cargandoSesion) return null;

  // Plan sin el módulo de portal: no hay ingreso de clientes en esta instalación.
  if (!moduloActivo('portal')) {
    return (
      <div className="login-portal">
        <div className="login-portal-card">
          <img src="/logo-negocio.png" alt="Logo del negocio" className="login-portal-logo" />
          <div className="login-encabezado login-encabezado-centro">
            <h1 className="login-h1">Portal no disponible</h1>
            <p className="login-sub">El acceso de clientes no está habilitado para este negocio.</p>
          </div>
        </div>
        <p className="login-portal-pie">Con CEAVital, un producto de CEA Servicios</p>
      </div>
    );
  }

  return (
    <div className="login-portal">
      <div className="login-portal-card">
        {/* Portal del cliente del negocio: con el logo del negocio (2026-10-14). */}
        <img src="/logo-negocio.png" alt="Logo del negocio" className="login-portal-logo" />
        <div className="login-encabezado login-encabezado-centro">
          <h1 className="login-h1">Portal de clientes</h1>
          <p className="login-sub">Ingresá con el usuario y la contraseña que te asignó el negocio.</p>
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
      <p className="login-portal-pie">Con CEAVital, un producto de CEA Servicios</p>
      {aviso && (
        <AvisoEmergente titulo="Se cerró tu sesión" onCerrar={() => setAviso(null)}>
          {aviso}
        </AvisoEmergente>
      )}
    </div>
  );
}
