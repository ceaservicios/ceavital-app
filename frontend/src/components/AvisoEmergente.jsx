import { useEffect, useRef } from 'react';
import './AvisoEmergente.css';

// Cartel emergente con un solo botón ("Entendido"), para avisos que el usuario tiene que ver sí o
// sí (2026-10-16: la sesión del portal se cerró porque entró otro equipo). Se cierra con el botón
// o con Escape; el foco va al botón al abrirse.
export default function AvisoEmergente({ titulo, children, onCerrar }) {
  const botonRef = useRef(null);
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;

  useEffect(() => {
    botonRef.current?.focus();
    const tecla = (e) => {
      if (e.key === 'Escape') cerrarRef.current();
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, []);

  return (
    <div className="aviso-fondo">
      <div className="aviso-emergente card" role="alertdialog" aria-modal="true" aria-labelledby="aviso-titulo" aria-describedby="aviso-texto">
        <h2 id="aviso-titulo" className="aviso-titulo">
          {titulo}
        </h2>
        <p id="aviso-texto" className="aviso-texto">
          {children}
        </p>
        <button ref={botonRef} type="button" className="btn btn-primary aviso-boton" onClick={() => cerrarRef.current()}>
          Entendido
        </button>
      </div>
    </div>
  );
}
