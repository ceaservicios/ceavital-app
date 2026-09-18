import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { puedeVerModulo } from '../constants/roles.js';

export default function RequireRole({ modulo, children }) {
  const { usuario } = useAuth();

  if (!puedeVerModulo(modulo, usuario?.rol)) {
    return <Navigate to="/caja" replace />;
  }

  return children;
}
