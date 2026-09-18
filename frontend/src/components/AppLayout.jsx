import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import './AppLayout.css';

export default function AppLayout() {
  // En pantallas angostas (celular / tablet vertical) el menú es un cajón que se
  // abre con el botón de la barra superior; en pantallas anchas este estado no
  // tiene efecto visual (el CSS deja el menú siempre a la vista).
  const [menuAbierto, setMenuAbierto] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setMenuAbierto(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuAbierto) return undefined;
    const alTeclear = (e) => {
      if (e.key === 'Escape') setMenuAbierto(false);
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [menuAbierto]);

  return (
    <div className="app-layout">
      <Sidebar abierto={menuAbierto} />
      {menuAbierto && <div className="app-layout-backdrop" onClick={() => setMenuAbierto(false)} aria-hidden="true" />}
      <div className="app-layout-main">
        <Topbar onAbrirMenu={() => setMenuAbierto(true)} />
        <div className="app-layout-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
