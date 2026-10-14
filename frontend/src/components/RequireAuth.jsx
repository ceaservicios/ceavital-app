import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function RequireAuth({ children }) {
  const { usuario, cargandoSesion } = useAuth();
  const location = useLocation();

  if (cargandoSesion) {
    return null;
  }

  if (!usuario) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Contraseña provisoria o Admin sin verificación en dos pasos: primero "Mi cuenta" (EST-01).
  if (usuario.pendiente && location.pathname !== '/cuenta') {
    return <Navigate to="/cuenta" replace />;
  }

  return children;
}
