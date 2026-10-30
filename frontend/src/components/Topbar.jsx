import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { etiquetaRol } from '../constants/roles.js';
import './Topbar.css';

const TITULOS = {
  '/caja': 'Caja',
  '/ventas-diarias': 'Ventas',
  '/stock': 'Stock',
  '/vencimientos': 'Vencimientos',
  '/proveedores': 'Proveedores',
  '/saldos': 'Saldos pendientes',
  '/cierre-caja': 'Cierre de caja',
  '/costos': 'Costos y márgenes',
  '/usuarios': 'Usuarios',
  '/configuracion': 'Configuración',
  '/clientes-empresa': 'Clientes',
  '/pedidos-cliente': 'Pedidos de clientes',
  '/cuenta': 'Mi cuenta',
};

function seccionDe(pathname) {
  return Object.keys(TITULOS).find((r) => pathname === r || pathname.startsWith(`${r}/`)) ?? null;
}

// Fichas: producto, proveedor, cliente y cuenta a pagar.
const FICHA = /^\/(stock|proveedores|clientes-empresa)\/\d+$|^\/saldos\/cuentas\/\d+$/;

// Rediseño 2026-10-29: en las pantallas de una sección (lista) el título de la barra es el h1;
// en las de adentro (ficha, alta, cargar) la barra es la miga para volver y el h1 lo pone la
// pantalla (el nombre del proveedor, del producto…). Así no hay dos títulos apilados.
// Sin la fecha (usuario, 2026-10-30): en escritorio la barra no se ve en las listas (la sección ya
// está marcada en el menú) ni en las fichas (la miga va abajo del panel, `MigaFicha`), así el panel
// verde queda arriba de todo en todas. Solo se ve en las altas, con la miga. Ver Topbar.css.
export default function Topbar({ onAbrirMenu }) {
  const { pathname } = useLocation();
  const { usuario } = useAuth();
  const seccion = seccionDe(pathname);
  const titulo = seccion ? TITULOS[seccion] : 'CEAVital';
  const anidada = seccion && pathname !== seccion;
  const escondida = !anidada || FICHA.test(pathname);

  return (
    <header className={`topbar${anidada ? ' topbar-anidada' : ''}${escondida ? ' topbar-escondida' : ''}`}>
      <button type="button" className="topbar-menu" onClick={onAbrirMenu} aria-label="Abrir menú">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {anidada ? (
        <Link to={seccion} className="topbar-volver">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {titulo}
        </Link>
      ) : (
        <h1 className="topbar-title">{titulo}</h1>
      )}
      {/* En celular el rol lleva a "Mi cuenta"; en escritorio eso ya está al pie del menú. */}
      <Link to="/cuenta" className="topbar-pill" title="Mi cuenta">
        {etiquetaRol(usuario?.rol)}
      </Link>
    </header>
  );
}

// La miga de las fichas en escritorio, abajo del panel verde y arriba del nombre. En celular no se
// ve: ahí la miga sigue en la barra de arriba.
export function MigaFicha() {
  const seccion = seccionDe(useLocation().pathname);
  if (!seccion) return null;
  return (
    <Link to={seccion} className="miga-ficha">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {TITULOS[seccion]}
    </Link>
  );
}
