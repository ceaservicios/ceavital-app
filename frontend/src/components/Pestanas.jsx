import Icono from './Icono.jsx';
import './Pestanas.css';

// Pestañas en segmento con ícono y color propio en cada una (pedido del usuario, 2026-10-29:
// "agregale algún color e ícono"). items: [{ clave, texto, icono, color, n? }].
export default function Pestanas({ items, activa, onCambiar, etiqueta, className = '' }) {
  return (
    <div className={`pestanas ${className}`.trim()} role="tablist" aria-label={etiqueta}>
      {items.map((t) => (
        <button
          key={t.clave}
          type="button"
          role="tab"
          aria-selected={activa === t.clave}
          className={`pestana${activa === t.clave ? ' pestana-activa' : ''}`}
          style={{ '--c': t.color }}
          onClick={() => onCambiar(t.clave)}
        >
          <span className="pestana-icono">
            <Icono nombre={t.icono} tam={15} />
          </span>
          {t.texto}
          {t.n != null && <span className="pestana-n">{t.n}</span>}
        </button>
      ))}
    </div>
  );
}
