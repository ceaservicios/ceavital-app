import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { etiquetaRol } from '../constants/roles.js';
import './Topbar.css';

const TITULOS = {
  '/caja': 'Caja y Punto de Venta',
  '/stock': 'Stock y Lotes',
  '/vencimientos': 'Vencimientos',
  '/proveedores': 'Proveedores y Pedidos',
  '/cierre-caja': 'Cierre de Caja',
  '/costos': 'Costos y Márgenes',
  '/usuarios': 'Usuarios y Roles',
};

export default function Topbar() {
  const { pathname } = useLocation();
  const { usuario } = useAuth();
  const titulo = TITULOS[pathname] ?? 'CEAVital';

  return (
    <header className="topbar">
      <div className="topbar-title">{titulo}</div>
      <div className="topbar-pill">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
        </svg>
        {etiquetaRol(usuario?.rol)}
      </div>
    </header>
  );
}
