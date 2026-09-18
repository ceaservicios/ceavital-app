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

  return children;
}
