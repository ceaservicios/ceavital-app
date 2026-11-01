import { IconoFila } from '../components/ConAvatar.jsx';
import { colorDe } from '../utils/colores.js';

// Configuración → Promociones (2026-11-01): combos y grupos de promoción se ven igual. Cada uno es una
// tarjeta desplegable (pedido del usuario: "que sea desplegable y muestre lo que hay"): cerrada,
// muestra el nombre, el precio y un resumen; abierta, lo que lleva, en un recuadro aparte del nombre.

function Flecha() {
  return (
    <svg className="promo-flecha" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * `reemplazo`: lo que va en la cabecera mientras se edita o se confirma una baja (en vez del nombre y
 * las acciones). `precio`: a la derecha del nombre, si tiene.
 */
export function TarjetaPromo({ id, icono, abierta, onAlternar, titulo, precio, resumen, aviso, acciones, reemplazo, children }) {
  return (
    <div className={`promo-tarjeta${abierta ? ' abierta' : ''}`}>
      <div className="promo-cabeza">
        {reemplazo ?? (
          <>
            <button type="button" className="promo-desplegar" aria-expanded={abierta} onClick={onAlternar}>
              <Flecha />
              <IconoFila icono={icono} color={colorDe(id)} />
              <span className="promo-titulo">
                <strong>{titulo}</strong>
                <span className="promo-resumen">{resumen}</span>
                {aviso && <span className="promo-aviso">{aviso}</span>}
              </span>
              {precio && <span className="promo-precio">{precio}</span>}
            </button>
            <div className="config-catalogo-acciones">{acciones}</div>
          </>
        )}
      </div>
      {abierta && <div className="promo-cuerpo">{children}</div>}
    </div>
  );
}

/** Qué tarjetas están abiertas: alternar una, y abrir la recién creada. */
export function alternarEn(conjunto, id) {
  const nuevo = new Set(conjunto);
  if (nuevo.has(id)) nuevo.delete(id);
  else nuevo.add(id);
  return nuevo;
}
