import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { fechaHoyISO, formatearCotizacion, formatearFecha, formatearMonto, formatearPesos, formatearUsd, usdParaCampo } from '../utils/format.js';
import { NOMBRE_MEDIO, textoDelDesglose } from './SuperadminCobro.jsx';

// Pagos de lo que CEA le cobra a la empresa (panel /sa). Se anotan a mano. Desde el 2026-10-21 cada
// pago es en dólares y paga el aviso pendiente completo (cuota de la implementación, abono y
// modificaciones con costo): guarda la foto de ese desglose y corre el vencimiento un mes, desde el
// vencimiento (no desde el día en que pagó). El monto se completa con el total del aviso hasta que se
// lo cambie a mano. Los pagos de antes siguen en pesos. Opcional (2026-10-21): lo pagado en pesos y la
// cotización del dólar blue que se usó, que se completa con la de hoy (van los dos o ninguno). Las
// acciones pasan por `ejecutar` del panel, que recarga todo.

const MEDIOS = Object.entries(NOMBRE_MEDIO);

const montoSugerido = (aviso) => (aviso?.configurado && aviso.total > 0 ? usdParaCampo(aviso.total) : '');
// "1565" o "1565,50", como se escribe en el campo.
const cotizacionSugerida = (cotizacion) => (cotizacion ? usdParaCampo(cotizacion.venta_cent) : '');

const pagoVacio = (aviso, cotizacion) => ({
  fecha_pago: fechaHoyISO(),
  monto: montoSugerido(aviso),
  pesos_pagados: '',
  cotizacion_blue: cotizacionSugerida(cotizacion),
  medio_pago: 'transferencia',
  comprobante: '',
  nota: '',
});

export default function SuperadminPagos({ pagos, aviso = null, cotizacion = null, ocupado, ejecutar }) {
  const [pago, setPago] = useState(() => pagoVacio(aviso, cotizacion));
  const [montoAMano, setMontoAMano] = useState(false); // ya no se completa solo
  const [cotizacionAMano, setCotizacionAMano] = useState(false); // ídem, la cotización
  const [anulando, setAnulando] = useState(null); // id del pago en confirmación
  const [motivo, setMotivo] = useState('');

  // Si cambia el aviso pendiente (se anotó un pago, se cargó la implementación…), el monto lo sigue.
  const sugerido = montoSugerido(aviso);
  useEffect(() => {
    if (!montoAMano) setPago((p) => ({ ...p, monto: sugerido }));
  }, [sugerido, montoAMano]);

  // Lo mismo con la cotización del día que trae el panel.
  const blueSugerido = cotizacionSugerida(cotizacion);
  useEffect(() => {
    if (!cotizacionAMano) setPago((p) => ({ ...p, cotizacion_blue: blueSugerido }));
  }, [blueSugerido, cotizacionAMano]);

  // Solo se anula el último pago sin anular (el servidor también lo exige).
  const ultimoId = pagos.reduce((max, p) => (!p.anulado_en && p.id > max ? p.id : max), 0);

  const campo = (nombre) => ({
    value: pago[nombre],
    onChange: (e) => {
      const valor = e.target.value;
      if (nombre === 'monto') setMontoAMano(true);
      if (nombre === 'cotizacion_blue') setCotizacionAMano(true);
      setPago((p) => ({ ...p, [nombre]: valor }));
    },
    disabled: ocupado,
  });

  function anotar(e) {
    e.preventDefault();
    // La cotización sugerida (sin tocar) solo viaja si se cargó lo pagado en pesos; escrita a mano,
    // viaja siempre y el servidor exige las dos.
    const sinPesos = !pago.pesos_pagados.trim();
    ejecutar(
      async () => {
        const r = await api.post('/sa/pagos', {
          ...pago,
          cotizacion_blue: sinPesos && !cotizacionAMano ? null : pago.cotizacion_blue,
          aviso: aviso?.vence ?? null,
        });
        setPago(pagoVacio(aviso, cotizacion)); // al recargar, los efectos de arriba ponen el total y la cotización nuevos
        setMontoAMano(false);
        setCotizacionAMano(false);
        return r;
      },
      (r) =>
        `Pago registrado: ${formatearUsd(r.monto)}` +
        (r.pesos_pagados ? ` (${formatearPesos(r.pesos_pagados)} al blue ${formatearCotizacion(r.cotizacion_blue_cent)})` : '') +
        ` del aviso del ${formatearFecha(r.aviso)}. El próximo vence el ${formatearFecha(r.cuota_vence)}.` +
        (r.reactivada ? ` El servicio se reactivó${r.avisado_a ? ` y se notificó por mail a ${r.avisado_a}` : ''}.` : '')
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
      (r) => (r.cuota_vence ? `Pago anulado. El aviso del ${formatearFecha(r.cuota_vence)} vuelve a quedar pendiente.` : 'Pago anulado.')
    );
  }

  return (
    <section className="card sa-card">
      <h2 className="sa-h2">Pagos</h2>
      <p className="sa-ayuda">
        Registrar el pago de un aviso marca como pagado todo lo que incluye y corre el próximo vencimiento un mes.
      </p>

      <form className="sa-aviso-form" onSubmit={anotar}>
        <div className="sa-campos sa-campos-4">
          <div className="field">
            <label htmlFor="sa-pago-fecha">Fecha de pago</label>
            <input id="sa-pago-fecha" type="date" max={fechaHoyISO()} required {...campo('fecha_pago')} />
          </div>
          <div className="field">
            <label htmlFor="sa-pago-aviso">Aviso que paga</label>
            <select id="sa-pago-aviso" disabled={ocupado} value={aviso?.vence ?? ''} onChange={() => {}}>
              <option value={aviso?.vence ?? ''}>{aviso ? `Del ${formatearFecha(aviso.vence)}` : 'Desde la fecha de pago'}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="sa-pago-monto">Monto (USD)</label>
            <input id="sa-pago-monto" type="text" inputMode="decimal" maxLength={15} required placeholder="Ej.: 253,75" {...campo('monto')} />
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
            <label htmlFor="sa-pago-pesos">Pagado en pesos ($)</label>
            <input id="sa-pago-pesos" type="text" inputMode="numeric" maxLength={15} placeholder="Opcional" {...campo('pesos_pagados')} />
          </div>
          <div className="field">
            <label htmlFor="sa-pago-blue">Cotización dólar blue ($)</label>
            <input id="sa-pago-blue" type="text" inputMode="decimal" maxLength={12} placeholder="Ej.: 1565" {...campo('cotizacion_blue')} />
          </div>
          <div className="field">
            <label htmlFor="sa-pago-comprobante">N° de comprobante</label>
            <input id="sa-pago-comprobante" type="text" maxLength={100} placeholder="Opcional" {...campo('comprobante')} />
          </div>
          <div className="field">
            <label htmlFor="sa-pago-nota">Nota</label>
            <input id="sa-pago-nota" type="text" maxLength={500} placeholder="Opcional" {...campo('nota')} />
          </div>
        </div>
        <div className="sa-form-pie">
          <button type="submit" className="btn btn-primary" disabled={ocupado}>
            Registrar pago
          </button>
        </div>
      </form>
      <details className="sa-como">
        <summary>Cómo funciona</summary>
        <ul>
          <li>
            El vencimiento se corre desde el vencimiento, no desde la fecha de pago: si vence el 10 y se paga el 15, el próximo sigue venciendo el
            10. Si el abono todavía no empezó, pasa a la fecha del primer abono cuando corresponde.
          </li>
          <li>El monto se completa con el total del aviso y se puede modificar.</li>
          <li>
            Si se pagó en pesos, cargá el importe y la cotización del dólar blue usada (se completa con la del día): se cargan los dos o
            ninguno.
          </li>
          <li>Un pago mal cargado se anula (solo el último) y su aviso vuelve a quedar pendiente.</li>
        </ul>
      </details>

      {pagos.length === 0 ? (
        <p className="sa-vacio">Todavía no hay pagos registrados.</p>
      ) : (
        <div className="sa-tabla-scroll">
          <table className="sa-tabla sa-tabla-pagos">
            <thead>
              <tr>
                <th>Fecha</th>
                <th className="sa-monto">Monto</th>
                <th>Aviso</th>
                <th>Medio</th>
                <th>Comprobante</th>
                <th>Nota</th>
                <th className="sa-accion" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.id} className={p.anulado_en ? 'sa-anulado' : undefined}>
                  <td>{formatearFecha(p.fecha_pago)}</td>
                  <td className="sa-monto">
                    <span className="sa-fuerte">{p.moneda === 'USD' ? formatearUsd(p.monto) : formatearMonto(p.monto)}</span>
                    {p.pesos_pagados !== null && p.pesos_pagados !== undefined && (
                      <div className="sa-detalle-fila">
                        {formatearPesos(p.pesos_pagados)} · blue {formatearCotizacion(p.cotizacion_blue_cent)}
                      </div>
                    )}
                  </td>
                  <td>
                    {p.moneda === 'USD' ? (
                      <>
                        Del {formatearFecha(p.periodo_desde)}
                        <div className="sa-detalle-fila sa-pago-desglose">{textoDelDesglose(p.desglose)}</div>
                      </>
                    ) : (
                      <>
                        {formatearFecha(p.periodo_desde)} al {formatearFecha(p.periodo_hasta)}
                        <div className="sa-detalle-fila">En pesos{p.meses > 1 ? ` · ${p.meses} meses` : ''}</div>
                      </>
                    )}
                  </td>
                  <td>{NOMBRE_MEDIO[p.medio_pago] ?? p.medio_pago}</td>
                  <td className={`sa-corta${p.comprobante ? '' : ' sa-faltante'}`}>{p.comprobante || '—'}</td>
                  <td className={`sa-corta${p.nota ? '' : ' sa-faltante'}`}>{p.nota || '—'}</td>
                  <td className="sa-accion">
                    {p.anulado_en ? (
                      <div className="sa-celda-estado">
                        <span className="sa-chip sa-chip-neutro">Anulado</span>
                        <span className="sa-detalle-fila">{p.anulado_motivo}</span>
                      </div>
                    ) : p.id !== ultimoId ? null : anulando === p.id ? (
                      <div className="sa-confirmar">
                        <input
                          type="text"
                          maxLength={500}
                          value={motivo}
                          onChange={(e) => setMotivo(e.target.value)}
                          disabled={ocupado}
                          placeholder="Motivo de la anulación"
                          aria-label="Motivo de la anulación"
                        />
                        <button type="button" className="btn btn-peligro" disabled={ocupado || !motivo.trim()} onClick={() => anular(p.id)}>
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
                        className="btn sa-btn-fantasma"
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
