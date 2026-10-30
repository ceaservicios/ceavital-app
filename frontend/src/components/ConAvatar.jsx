import Icono from './Icono.jsx';
import { iniciales } from '../constants/roles.js';
import { colorDe } from '../utils/colores.js';

// Nombre con sus iniciales en un ícono de color fijo (estilo del 2026-10-29), para las listas de
// proveedores, clientes y usuarios. children: el nombre y lo que va debajo.
export default function ConAvatar({ id, nombre, children }) {
  return (
    <div className="con-avatar">
      <span className="icono-cat icono-cat-chico" style={{ '--c': colorDe(id) }} aria-hidden="true">
        {iniciales(nombre)}
      </span>
      <div className="con-avatar-texto">{children}</div>
    </div>
  );
}

// El cuadrito de color con un ícono, suelto (para filas que ya son flex).
export function IconoFila({ icono, color }) {
  return (
    <span className="icono-cat icono-cat-chico" style={{ '--c': color }} aria-hidden="true">
      <Icono nombre={icono} />
    </span>
  );
}

// Lo mismo con un ícono en lugar de iniciales: producto, tipo de movimiento, medio de pago, estado.
export function ConIcono({ icono, color, children }) {
  return (
    <div className="con-avatar">
      <IconoFila icono={icono} color={color} />
      <div className="con-avatar-texto">{children}</div>
    </div>
  );
}
