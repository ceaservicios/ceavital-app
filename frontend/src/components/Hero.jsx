import Icono from './Icono.jsx';
import NumeroQueCuenta from './NumeroQueCuenta.jsx';
import './Hero.css';

// Panel protagonista (estilo elegido por el usuario el 2026-10-29), el mismo en todas las pantallas
// (el compacto de Caja): la cifra principal sobre el verde de marca y cifras chicas con ícono de color.
// minis: [{ etiqueta, valor, sub?, icono, tono, color? }] con tono rojo | amarillo | verde | azul |
// violeta | blanco; `color` pinta el ícono con un color propio (ej. COLOR_MEDIO_CLARO del medio de pago).
// Rediseño "más vida" (2026-11-16): las cifras cuentan desde 0 cuando llegan los datos. `animar={false}`
// donde la cifra cambia con lo que hace el usuario (el total de Caja) o no es una cifra (Configuración).
export default function Hero({ etiqueta, valor, sub, minis = [], animar = true }) {
  const cifra = (v) => (animar && (typeof v === 'string' || typeof v === 'number') ? <NumeroQueCuenta texto={String(v)} /> : v);
  return (
    <section className={`hero${minis.length ? '' : ' hero-solo'}`}>
      <div className="hero-principal">
        <div className="hero-etiqueta">{etiqueta}</div>
        <div className="hero-valor">{cifra(valor)}</div>
        {sub && (
          <div className="hero-sub" title={typeof sub === 'string' ? sub : undefined}>
            {sub}
          </div>
        )}
      </div>
      {minis.length > 0 && (
        <div className={`hero-minis hero-minis-${minis.length}`}>
          {minis.map((m) => (
            <div className="hero-mini" key={m.etiqueta}>
              <span className={`hero-mini-icono hero-tono-${m.tono ?? 'blanco'}`} style={m.color ? { background: m.color, color: '#0b3d2e' } : undefined}>
                <Icono nombre={m.icono} />
              </span>
              <span className="hero-mini-etiqueta">{m.etiqueta}</span>
              <span className="hero-mini-valor" title={String(m.valor)}>
                {cifra(m.valor)}
              </span>
              {m.sub && (
                <span className="hero-mini-sub" title={m.sub}>
                  {m.sub}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
