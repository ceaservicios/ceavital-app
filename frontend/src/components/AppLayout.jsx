import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import './AppLayout.css';

export default function AppLayout() {
  // En pantallas angostas (celular / tablet vertical) el menú es un cajón que se
  // abre con el botón de la barra superior; en pantallas anchas este estado no
  // tiene efecto visual (el CSS deja el menú siempre a la vista).
  const [menuAbierto, setMenuAbierto] = useState(false);
  const { pathname } = useLocation();
  const { avisoIngreso, descartarAvisoIngreso } = useAuth();

  // El aviso del ingreso (sesión cerrada en otro dispositivo) flota arriba y se va solo: si
  // empujara el contenido, las pantallas que encajan justo en la ventana pasarían a scrollear.
  useEffect(() => {
    if (!avisoIngreso) return undefined;
    const t = setTimeout(descartarAvisoIngreso, 10_000);
    return () => clearTimeout(t);
  }, [avisoIngreso, descartarAvisoIngreso]);

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
        {avisoIngreso && (
          <div className="app-aviso" role="status">
            <span>{avisoIngreso}</span>
            <button type="button" className="app-aviso-cerrar" onClick={descartarAvisoIngreso} aria-label="Cerrar aviso">
              ✕
            </button>
          </div>
        )}
        <div className="app-layout-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
