import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { moduloDisponible, puedeVerModulo } from '../constants/roles.js';

// Se usa envolviendo una pantalla (children) o como ruta padre con rutas
// hijas (sin children, renderiza el <Outlet />).
export default function RequireRole({ modulo, children }) {
  const { usuario, modulos } = useAuth();

  if (!moduloDisponible(modulo, modulos) || !puedeVerModulo(modulo, usuario?.rol)) {
    return <Navigate to="/caja" replace />;
  }

  return children ?? <Outlet />;
}
