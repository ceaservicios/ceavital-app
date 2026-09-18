import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { puedeVerModulo } from '../constants/roles.js';

// Se usa envolviendo una pantalla (children) o como ruta padre con rutas
// hijas (sin children, renderiza el <Outlet />).
export default function RequireRole({ modulo, children }) {
  const { usuario } = useAuth();

  if (!puedeVerModulo(modulo, usuario?.rol)) {
    return <Navigate to="/caja" replace />;
  }

  return children ?? <Outlet />;
}
