import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Icono from './Icono.jsx';
import { COLOR } from '../utils/colores.js';
import { formatearMonto } from '../utils/format.js';
import './OrigenEfectivo.css';

// De dónde sale un pago en efectivo: la caja del turno, Caja general o de otro lado (2026-11-06).
// Lo mismo en gastos, pagos a proveedores y Saldos pendientes.

const OPCIONES = [
  { valor: 'caja', titulo: 'Caja del turno', icono: 'caja', color: COLOR.verde },
  { valor: 'general', titulo: 'Caja general', icono: 'cofre', color: COLOR.azul },
  { valor: 'otro', titulo: 'De otro lado', icono: 'menos', color: COLOR.gris },
];

const TEXTOS = {
  caja: 'con efectivo de la caja del turno',
  general: 'con efectivo de Caja general',
  otro: 'fuera de la caja',
};
export const textoOrigen = (origen) => TEXTOS[origen] ?? TEXTOS.otro;

export const MEDIO_CON_ORIGEN = {
  caja: 'Efectivo · caja del turno',
  general: 'Efectivo · Caja general',
  otro: 'Efectivo · de otro lado',
};

const EVENTO_CAMBIO = 'efectivo-cambio';

/** Para llamar después de registrar o anular algo con el formulario todavía a la vista. */
export function avisarCambioDeEfectivo() {
  window.dispatchEvent(new Event(EVENTO_CAMBIO));
}

/** Cuánto hay en la caja del turno y en Caja general. Solo Administrador y Encargado: el resto pasa activo = false. */
export function useEfectivoDisponible(activo = true) {
  const [disponible, setDisponible] = useState(null);
  useEffect(() => {
    if (!activo) return undefined;
    let vigente = true;
    const pedir = () =>
      api
        .get('/caja-general/disponible')
        .then((data) => {
          if (vigente) setDisponible(data);
        })
        // Sin el dato, las opciones se ven sin el monto y el servidor controla igual al guardar.
        .catch(() => {});
    pedir();
    window.addEventListener(EVENTO_CAMBIO, pedir);
    return () => {
      vigente = false;
      window.removeEventListener(EVENTO_CAMBIO, pedir);
    };
  }, [activo]);
  return disponible;
}

export default function OrigenEfectivo({ valor, onCambiar, monto, ayudaCaja = 'Se descuenta del efectivo del turno.' }) {
  const disponible = useEfectivoDisponible();
  const n = Number(monto) || 0;
  const hay = (lugar) => (disponible ? `Hay ${formatearMonto(disponible[lugar])}` : '…');
  const subtitulos = { caja: hay('caja'), general: hay('general'), otro: 'No se descuenta de ningún lado' };

  return (
    <div className="origen">
      <span className="origen-titulo">¿De dónde sale el efectivo?</span>
      <div className="origen-ops" role="group" aria-label="De dónde sale el efectivo">
        {OPCIONES.map((o) => (
          <button
            key={o.valor}
            type="button"
            className={`origen-op${valor === o.valor ? ' activo' : ''}`}
            style={{ '--c': o.color }}
            aria-pressed={valor === o.valor}
            onClick={() => onCambiar(o.valor)}
          >
            <span className="origen-op-icono">
              <Icono nombre={o.icono} />
            </span>
            <span className="origen-op-texto">
              <strong>{o.titulo}</strong>
              <span>{subtitulos[o.valor]}</span>
            </span>
          </button>
        ))}
      </div>
      {disponible && valor === 'caja' && n > disponible.caja ? (
        <div className="alert alert-aviso">
          En la caja del turno hay {formatearMonto(disponible.caja)} y esto es {formatearMonto(n)}. Si sale de la plata de los cierres, elegí Caja general: así el
          cierre no da diferencia.
        </div>
      ) : disponible && valor === 'general' && n > disponible.general ? (
        <div className="alert alert-danger">
          En Caja general hay {formatearMonto(disponible.general)} y esto es {formatearMonto(n)}: no alcanza.
        </div>
      ) : (
        <span className="origen-ayuda">
          {valor === 'caja' && ayudaCaja}
          {valor === 'general' &&
            (disponible && n > 0
              ? `Caja general queda en ${formatearMonto(disponible.general - n)}. La caja del turno y el cierre no cambian.`
              : 'Se descuenta de Caja general. La caja del turno y el cierre no cambian.')}
          {valor === 'otro' && 'Queda anotado, pero no cambia la caja del turno ni Caja general.'}
        </span>
      )}
    </div>
  );
}
