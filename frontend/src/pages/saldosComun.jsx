import Icono from '../components/Icono.jsx';
import { fechaHoyISO } from '../utils/format.js';

// Piezas compartidas por Saldos pendientes, el alta de una cuenta y su ficha (pedido del usuario,
// 2026-10-29: impuestos y servicios con vencimiento).

// Cada tipo con su color e ícono (estilo "panel protagonista").
export const TIPOS_CUENTA = [
  { valor: 'impuestos', texto: 'Impuestos', color: '#6b4bd8', icono: 'banco' },
  { valor: 'alquiler', texto: 'Alquiler', color: '#0f8b7d', icono: 'casa' },
  { valor: 'luz', texto: 'Luz', color: '#e09a00', icono: 'rayo' },
  { valor: 'agua', texto: 'Agua', color: '#2d6cdf', icono: 'gota' },
  { valor: 'gas', texto: 'Gas', color: '#e4662c', icono: 'llama' },
  { valor: 'internet', texto: 'Internet', color: '#0891b2', icono: 'wifi' },
  { valor: 'honorarios', texto: 'Honorarios', color: '#c03d86', icono: 'maletin' },
  { valor: 'otro', texto: 'Otro', color: '#6b7570', icono: 'menos' },
];

export function tipoCuenta(valor) {
  return TIPOS_CUENTA.find((t) => t.valor === valor) ?? TIPOS_CUENTA[TIPOS_CUENTA.length - 1];
}

export const REPETICIONES = [
  { valor: 'no', texto: 'No se repite' },
  { valor: 'semanal', texto: 'Semanal' },
  { valor: 'quincenal', texto: 'Quincenal' },
  { valor: 'mensual', texto: 'Mensual' },
  { valor: 'bimestral', texto: 'Bimestral' },
  { valor: 'anual', texto: 'Anual' },
];

export function etiquetaRepeticion(valor) {
  return REPETICIONES.find((r) => r.valor === valor)?.texto ?? valor;
}

export const MEDIOS_PAGO_CUENTA = [
  { valor: 'efectivo', texto: 'Efectivo' },
  { valor: 'transferencia', texto: 'Transferencia' },
  { valor: 'mercado_pago', texto: 'Mercado Pago' },
  { valor: 'debito', texto: 'Débito automático' },
  { valor: 'tarjeta', texto: 'Tarjeta' },
];

export function etiquetaMedioCuenta(valor) {
  return MEDIOS_PAGO_CUENTA.find((m) => m.valor === valor)?.texto ?? valor;
}

export const AYUDA_CAJA_CUENTA = 'Se descuenta del efectivo del turno y figura en Ventas, en gastos y pagos.';

const DIA = 86_400_000;
const aUtc = (iso) => {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
};

/** Días de hoy al vencimiento (negativo: ya venció). */
export function diasHasta(vence, hoy) {
  return Math.round((aUtc(vence) - aUtc(hoy)) / DIA);
}

/** Vencida, esta semana (hasta 7 días) o más adelante, con el texto de la píldora. */
export function estadoVence(vence, hoy) {
  const dias = diasHasta(vence, hoy);
  if (dias < 0) return { clave: 'vencida', tono: 'rojo', icono: 'alerta', texto: dias === -1 ? 'Venció ayer' : `Venció hace ${-dias} días` };
  if (dias === 0) return { clave: 'semana', tono: 'amarillo', icono: 'reloj', texto: 'Vence hoy' };
  if (dias <= 7) return { clave: 'semana', tono: 'amarillo', icono: 'reloj', texto: dias === 1 ? 'Mañana' : `En ${dias} días` };
  return { clave: 'adelante', tono: 'verde', icono: 'check', texto: `En ${dias} días` };
}

export function IconoTipo({ tipo }) {
  const t = tipoCuenta(tipo);
  return (
    <span className="icono-cat" style={{ '--c': t.color }}>
      <Icono nombre={t.icono} />
    </span>
  );
}

export function TagTipo({ tipo }) {
  const t = tipoCuenta(tipo);
  return (
    <span className="tag" style={{ '--c': t.color }}>
      {t.texto}
    </span>
  );
}

export function TagRepeticion({ repeticion }) {
  if (repeticion === 'no') return null;
  return (
    <span className="tag">
      <Icono nombre="repetir" tam={12} />
      {etiquetaRepeticion(repeticion)}
    </span>
  );
}

export function EstadoVence({ estado }) {
  return (
    <span className={`estado estado-${estado.tono}`}>
      <Icono nombre={estado.icono} tam={13} />
      {estado.texto}
    </span>
  );
}

export const CUENTA_VACIA = () => ({ tipo: '', concepto: '', monto: '', vence: fechaHoyISO(), nota: '' });

export function aFormularioCuenta(c) {
  return { tipo: c.tipo, concepto: c.concepto, monto: String(c.monto), vence: c.vence, nota: c.nota ?? '' };
}

/** { error } o { payload } listo para la API. */
export function cuentaParaApi(form) {
  if (!form.tipo) return { error: 'Elegí el tipo de cuenta.' };
  if (!form.concepto.trim()) return { error: 'Escribí el concepto.' };
  const monto = Number(form.monto);
  if (!Number.isInteger(monto) || monto < 1) return { error: 'El monto debe ser un número entero mayor que cero.' };
  if (!form.vence) return { error: 'Elegí la fecha de vencimiento.' };
  return {
    payload: { tipo: form.tipo, concepto: form.concepto.trim(), monto, vence: form.vence, nota: form.nota.trim() || null },
  };
}

// Campos de una cuenta: el tipo en botones de color, concepto, monto, vencimiento y nota. Lo que se
// repite se carga en Fijos.
export function CamposCuenta({ form, setForm }) {
  const set = (campo) => (e) => setForm({ ...form, [campo]: e.target.value });
  return (
    <div className="cpagar-campos">
      <div className="field">
        <span className="cpagar-label">Tipo</span>
        <div className="cpagar-tipos" role="group" aria-label="Tipo de cuenta">
          {TIPOS_CUENTA.map((t) => (
            <button
              key={t.valor}
              type="button"
              className={`cpagar-tipo${form.tipo === t.valor ? ' activo' : ''}`}
              style={{ '--c': t.color }}
              aria-pressed={form.tipo === t.valor}
              onClick={() => setForm({ ...form, tipo: t.valor })}
            >
              <span className="cpagar-tipo-icono">
                <Icono nombre={t.icono} tam={16} />
              </span>
              {t.texto}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="cuenta-concepto">Concepto</label>
        <input id="cuenta-concepto" required maxLength={200} placeholder="Ej.: Alquiler del local" value={form.concepto} onChange={set('concepto')} />
      </div>
      <div className="cpagar-fila">
        <div className="field">
          <label htmlFor="cuenta-monto">Monto</label>
          <input id="cuenta-monto" required type="number" min="1" step="1" placeholder="0" value={form.monto} onChange={set('monto')} />
        </div>
        <div className="field">
          <label htmlFor="cuenta-vence">Vence</label>
          <input id="cuenta-vence" required type="date" value={form.vence} onChange={set('vence')} />
        </div>
        <div className="field">
          <label htmlFor="cuenta-nota">Nota (opcional)</label>
          <input id="cuenta-nota" maxLength={200} placeholder="Ej.: contrato hasta 2027" value={form.nota} onChange={set('nota')} />
        </div>
      </div>
    </div>
  );
}
