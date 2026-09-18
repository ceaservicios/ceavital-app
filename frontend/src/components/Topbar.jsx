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
  '/configuracion': 'Configuración',
  '/clientes-empresa': 'Clientes y Cuenta Corriente',
};

function tituloDe(pathname) {
  const ruta = Object.keys(TITULOS).find((r) => pathname === r || pathname.startsWith(`${r}/`));
  return ruta ? TITULOS[ruta] : 'CEAVital';
}

export default function Topbar({ onAbrirMenu }) {
  const { pathname } = useLocation();
  const { usuario } = useAuth();
  const titulo = tituloDe(pathname);

  return (
    <header className="topbar">
      <button type="button" className="topbar-menu" onClick={onAbrirMenu} aria-label="Abrir menú">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
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
