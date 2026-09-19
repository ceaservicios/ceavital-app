import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { etiquetaRol, iniciales, moduloDisponible, puedeVerModulo } from '../constants/roles.js';
import './Sidebar.css';

const ICONOS = {
  caja: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a4 4 0 0 0-8 0v2" />
      <path d="M2 11h20" />
    </svg>
  ),
  stock: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  ),
  vencimientos: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="M12 14v3M12 17.5h.01" />
    </svg>
  ),
  proveedores: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="7" width="15" height="11" />
      <path d="M16 10h3l3 3v5h-6" />
      <circle cx="5.5" cy="18.5" r="1.8" />
      <circle cx="17.5" cy="18.5" r="1.8" />
    </svg>
  ),
  'clientes-empresa': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  ),
  'pedidos-cliente': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  ),
  cierre: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4" />
      <rect x="4" y="6" width="16" height="15" rx="2" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  ),
  costos: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </svg>
  ),
  usuarios: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  configuracion: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

const CANDADO = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="9" rx="1.5" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const SECCIONES = [
  {
    titulo: 'OPERACIÓN',
    items: [
      { modulo: 'caja', to: '/caja', label: 'Caja y Punto de Venta' },
      { modulo: 'stock', to: '/stock', label: 'Stock y Lotes' },
      { modulo: 'vencimientos', to: '/vencimientos', label: 'Vencimientos' },
      { modulo: 'proveedores', to: '/proveedores', label: 'Proveedores y Pedidos' },
      { modulo: 'clientes-empresa', to: '/clientes-empresa', label: 'Clientes y Cta. Cte.' },
      { modulo: 'pedidos-cliente', to: '/pedidos-cliente', label: 'Pedidos de Clientes' },
      { modulo: 'cierre', to: '/cierre-caja', label: 'Cierre de Caja' },
    ],
  },
  {
    titulo: 'ADMINISTRACIÓN',
    items: [
      { modulo: 'costos', to: '/costos', label: 'Costos y Márgenes' },
      { modulo: 'usuarios', to: '/usuarios', label: 'Usuarios y Roles' },
      { modulo: 'configuracion', to: '/configuracion', label: 'Configuración' },
    ],
  },
];

export default function Sidebar({ abierto = false }) {
  const { usuario, logout, modulos } = useAuth();
  const rol = usuario?.rol;

  return (
    <aside className={`sidebar${abierto ? ' sidebar-abierto' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-title">CEAVital</div>
        <div className="sidebar-brand-subtitle">POS Management</div>
      </div>

      <nav className="sidebar-nav">
        {SECCIONES.map((seccion) => (
          <div className="sidebar-section" key={seccion.titulo}>
            <div className="sidebar-section-title">{seccion.titulo}</div>
            {seccion.items.filter((item) => moduloDisponible(item.modulo, modulos)).map((item) => {
              const habilitado = puedeVerModulo(item.modulo, rol);
              if (!habilitado) {
                return (
                  <div className="sidebar-item sidebar-item-disabled" key={item.modulo} title="No disponible para tu rol">
                    {ICONOS[item.modulo]}
                    <span className="sidebar-item-label">{item.label}</span>
                    {CANDADO}
                  </div>
                );
              }
              return (
                <NavLink
                  to={item.to}
                  key={item.modulo}
                  className={({ isActive }) => `sidebar-item${isActive ? ' sidebar-item-active' : ''}`}
                >
                  {ICONOS[item.modulo]}
                  <span className="sidebar-item-label">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-avatar">{iniciales(usuario?.nombre)}</div>
        <div className="sidebar-user">
          <span className="sidebar-user-name">{usuario?.nombre}</span>
          <span className="sidebar-user-role">{etiquetaRol(rol)}</span>
        </div>
        <button type="button" className="sidebar-logout" title="Cerrar sesión" onClick={logout}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
