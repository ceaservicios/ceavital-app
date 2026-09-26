import { useState } from 'react';
import { api } from '../api/client.js';
import { fechaHoyISO, formatearFecha, formatearMonto } from '../utils/format.js';

// Historial de pagos de la cuota (panel /sa). Se anota a mano; anotar un pago corre el
// vencimiento de la cuota los meses que cubre, desde el vencimiento (no desde el día en
// que pagó). Las acciones pasan por `ejecutar` del panel, que recarga todo (la tarjeta
// Cuota muestra el vencimiento nuevo).

const MEDIOS = [
  ['transferencia', 'Transferencia'],
  ['efectivo', 'Efectivo'],
  ['mercado_pago', 'Mercado Pago'],
  ['tarjeta', 'Tarjeta'],
  ['otro', 'Otro'],
];
const NOMBRE_MEDIO = Object.fromEntries(MEDIOS);

const pagoVacio = () => ({
  fecha_pago: fechaHoyISO(),
  monto: '',
  meses: '1',
  medio_pago: 'transferencia',
  comprobante: '',
  nota: '',
});

export default function SuperadminPagos({ pagos, ocupado, ejecutar }) {
  const [pago, setPago] = useState(pagoVacio);
  const [anulando, setAnulando] = useState(null); // id del pago en confirmación
  const [motivo, setMotivo] = useState('');

  const campo = (nombre) => ({
    value: pago[nombre],
    onChange: (e) => setPago({ ...pago, [nombre]: e.target.value }),
    disabled: ocupado,
  });

  function anotar(e) {
    e.preventDefault();
    ejecutar(
      async () => {
        const r = await api.post('/sa/pagos', { ...pago, monto: Number(pago.monto), meses: Number(pago.meses) });
        setPago(pagoVacio());
        return r;
      },
      (r) => `Pago anotado. La cuota ahora vence el ${formatearFecha(r.cuota_vence)}.`
    );
  }

  function anular(id) {
    ejecutar(
      async () => {
        const r = await api.post(`/sa/pagos/${id}/anular`, { motivo });
        setAnulando(null);
        setMotivo('');
        return r;
      },
      (r) => (r.cuota_vence ? `Pago anulado. La cuota vuelve a vencer el ${formatearFecha(r.cuota_vence)}.` : 'Pago anulado.')
    );
  }

  return (
    <section className="card sa-card">
      <h2 className="sa-h2">Pagos de la cuota</h2>
      <p className="sa-ayuda">
        Anotar un pago corre el vencimiento de la cuota los meses que cubre, siempre desde el día de vencimiento: si vence el
        10 y paga el 15, el próximo vencimiento sigue siendo el 10. Un pago mal cargado se anula (el vencimiento vuelve atrás).
      </p>

      <form className="sa-form-pago" onSubmit={anotar}>
        <div className="field">
          <label htmlFor="sa-pago-fecha">Fecha de pago</label>
          <input id="sa-pago-fecha" type="date" max={fechaHoyISO()} required {...campo('fecha_pago')} />
        </div>
        <div className="field">
          <label htmlFor="sa-pago-monto">Monto ($)</label>
          <input id="sa-pago-monto" type="number" min="1" step="1" required placeholder="150000" {...campo('monto')} />
        </div>
        <div className="field">
          <label htmlFor="sa-pago-meses">Meses que cubre</label>
          <input id="sa-pago-meses" type="number" min="1" max="12" step="1" required {...campo('meses')} />
        </div>
        <div className="field">
          <label htmlFor="sa-pago-medio">Medio de pago</label>
          <select id="sa-pago-medio" {...campo('medio_pago')}>
            {MEDIOS.map(([id, nombre]) => (
              <option key={id} value={id}>
                {nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sa-pago-comprobante">N° de comprobante</label>
          <input id="sa-pago-comprobante" type="text" maxLength={100} placeholder="Opcional" {...campo('comprobante')} />
        </div>
        <div className="field sa-pago-nota">
          <label htmlFor="sa-pago-nota">Nota</label>
          <input id="sa-pago-nota" type="text" maxLength={500} placeholder="Opcional" {...campo('nota')} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={ocupado}>
          Anotar pago
        </button>
      </form>

      {pagos.length === 0 ? (
        <p className="sa-ayuda">Todavía no hay pagos anotados.</p>
      ) : (
        <div className="sa-tabla-scroll">
          <table className="sa-tabla sa-tabla-pagos">
            <thead>
              <tr>
                <th>Pagó</th>
                <th>Monto</th>
                <th>Cubre</th>
                <th>Medio</th>
                <th>Comprobante</th>
                <th>Nota</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.id} className={p.anulado_en ? 'sa-pago-anulado' : undefined}>
                  <td>{formatearFecha(p.fecha_pago)}</td>
                  <td className="sa-monto">{formatearMonto(p.monto)}</td>
                  <td>
                    {formatearFecha(p.periodo_desde)} al {formatearFecha(p.periodo_hasta)}
                    {p.meses > 1 && <span className="sa-detalle-fila"> ({p.meses} meses)</span>}
                  </td>
                  <td>{NOMBRE_MEDIO[p.medio_pago] ?? p.medio_pago}</td>
                  <td className="sa-corta">{p.comprobante || '—'}</td>
                  <td className="sa-corta">{p.nota || '—'}</td>
                  <td className="sa-pago-accion">
                    {p.anulado_en ? (
                      <>
                        <span className="sa-chip sa-chip-neutro">Anulado</span>
                        <div className="sa-detalle-fila">{p.anulado_motivo}</div>
                      </>
                    ) : anulando === p.id ? (
                      <div className="sa-confirmar">
                        <input
                          type="text"
                          maxLength={500}
                          value={motivo}
                          onChange={(e) => setMotivo(e.target.value)}
                          disabled={ocupado}
                          placeholder="Motivo"
                          aria-label="Motivo de la anulación"
                        />
                        <button type="button" className="btn sa-btn-peligro" disabled={ocupado || !motivo.trim()} onClick={() => anular(p.id)}>
                          Anular
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={ocupado}
                          onClick={() => {
                            setAnulando(null);
                            setMotivo('');
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        disabled={ocupado}
                        onClick={() => {
                          setAnulando(p.id);
                          setMotivo('');
                        }}
                      >
                        Anular…
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
