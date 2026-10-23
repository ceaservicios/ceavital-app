import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { fechaHoyISO, formatearCotizacion, formatearFecha, formatearPesos, formatearUsd, usdParaCampo } from '../utils/format.js';

// Lo que CEA le cobra a la empresa, en dólares (panel /sa > Cuota y pagos, decisión del usuario del
// 2026-10-21): la tabla del aviso del mes, la implementación en cuotas con recargo, el abono mensual y
// las modificaciones solicitadas. Los datos vienen de GET /sa/panel (`cobro`, montos en centavos) y
// toda acción pasa por `ejecutar` del panel (una a la vez, con la guardia contra el doble click, y
// recarga todo).

export const NOMBRE_MEDIO = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  mercado_pago: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

const porcentaje = (n) => `${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
const recargoParaCampo = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

// "Implementación cuota 4 de 12 + abono + 1 modificación": qué pagó un pago, según su foto.
export function textoDelDesglose(desglose) {
  if (!desglose) return '';
  const partes = [];
  if (desglose.implementacion) partes.push(`implementación cuota ${desglose.implementacion.numero} de ${desglose.implementacion.de}`);
  if (desglose.abono) partes.push('abono');
  const n = desglose.modificaciones?.length ?? 0;
  if (n) partes.push(n === 1 ? '1 modificación' : `${n} modificaciones`);
  const texto = partes.join(' + ');
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : 'Sin desglose';
}

// Desglose del aviso pendiente, para la tarjeta "Aviso del mes".
export function TablaAviso({ aviso }) {
  if (!aviso) return <p className="sa-ayuda">Cargá el próximo vencimiento para ver el aviso del mes.</p>;
  if (!aviso.configurado) {
    return <p className="sa-ayuda">Todavía no hay implementación ni abono cargados: el aviso sale sin desglose ni total.</p>;
  }
  const conCosto = aviso.modificaciones.con_costo;
  return (
    <table className="sa-tabla sa-total-mes">
      <tbody>
        {aviso.implementacion && (
          <tr>
            <td>
              Implementación · cuota {aviso.implementacion.numero} de {aviso.implementacion.de}
            </td>
            <td className="sa-monto">{formatearUsd(aviso.implementacion.importe)}</td>
          </tr>
        )}
        {aviso.abono && (
          <tr>
            <td>Abono mensual</td>
            <td className="sa-monto">{formatearUsd(aviso.abono.importe)}</td>
          </tr>
        )}
        {conCosto.length === 0 ? (
          <tr>
            <td>Modificaciones con costo</td>
            <td className="sa-monto">—</td>
          </tr>
        ) : (
          conCosto.map((m) => (
            <tr key={m.id}>
              <td>
                Modificación del {formatearFecha(m.fecha)} · {m.detalle}
              </td>
              <td className="sa-monto">{formatearUsd(m.importe)}</td>
            </tr>
          ))
        )}
        <tr className="sa-total-fila">
          <td>Total del aviso del {formatearFecha(aviso.vence)}</td>
          <td className="sa-monto">{formatearUsd(aviso.total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

// Dólar blue venta y el total del aviso en pesos, debajo de la tabla del aviso (2026-10-21). Viene de
// GET /sa/panel (`cotizacion`, con la caché de 30 minutos del servidor) o null si no hay cotización.
export function LineaCotizacion({ cotizacion }) {
  if (!cotizacion) return <p className="sa-ayuda">Sin cotización del dólar blue por ahora: el aviso sale solo en dólares.</p>;
  return (
    <p className="sa-detalle sa-cotizacion">
      Dólar blue venta: <span className="sa-sin-corte">{formatearCotizacion(cotizacion.venta_cent)}</span>{' '}
      <span className="sa-sin-corte">
        ({formatearFecha(cotizacion.dia)}, {cotizacion.fuente})
      </span>
      {cotizacion.total_pesos !== null && cotizacion.total_pesos !== undefined && (
        <>
          {' · '}
          <span className="sa-sin-corte">Total en pesos: {formatearPesos(cotizacion.total_pesos)}</span>
        </>
      )}
    </p>
  );
}

const ESTADO_CUOTA = {
  pagada: { texto: 'Pagada', clase: 'sa-chip-ok' },
  vencida: { texto: 'Vencida', clase: 'sa-chip-alerta' },
  pendiente: { texto: 'Pendiente', clase: 'sa-chip-neutro' },
};

const implVacia = (impl) => ({
  valor: impl ? usdParaCampo(impl.valor) : '',
  recargo: impl ? recargoParaCampo(impl.recargo) : '',
  cuotas: impl ? String(impl.cuotas) : '',
  primera_vence: impl?.primera_vence ?? '',
});

export function SeccionImplementacion({ implementacion: impl, ocupado, ejecutar }) {
  const [form, setForm] = useState(() => implVacia(impl));

  // Al guardar (o si cambió desde otra pestaña) el formulario muestra lo guardado.
  const clave = impl ? `${impl.valor}|${impl.recargo}|${impl.cuotas}|${impl.primera_vence}` : '';
  useEffect(() => {
    setForm(implVacia(impl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const campo = (nombre) => ({
    value: form[nombre],
    onChange: (e) => setForm((f) => ({ ...f, [nombre]: e.target.value })),
    disabled: ocupado,
  });

  function guardar(e) {
    e.preventDefault();
    ejecutar(() => api.put('/sa/implementacion', form), (r) => (r.cobro.implementacion ? 'Implementación guardada.' : 'Implementación quitada.'));
  }

  return (
    <section className="card sa-card">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Implementación</h2>
        <span className="sa-chip sa-chip-neutro">{impl ? `${impl.pagadas} de ${impl.cuotas} cuotas pagadas` : 'Sin cargar'}</span>
      </div>
      {impl && (
        <p className="sa-detalle">
          Total en cuotas: {formatearUsd(impl.total)} ({formatearUsd(impl.valor)} + {porcentaje(impl.recargo)}) · {impl.cuotas}{' '}
          {impl.cuotas === 1 ? 'cuota' : 'cuotas'} de {formatearUsd(impl.importe_cuota)}
          {impl.importe_ultima !== impl.importe_cuota ? ` (la última, de ${formatearUsd(impl.importe_ultima)})` : ''}.
        </p>
      )}
      <p className="sa-ayuda">
        Valor de la implementación en dólares y el recargo por pagarla en cuotas. Cada aviso mensual suma la cuota que vence ese mes; cuando se
        pagan todas, el aviso sigue solo con el abono. Los cuatro campos vacíos quitan la implementación.
      </p>
      <form className="sa-form-cuota" onSubmit={guardar}>
        <div className="field">
          <label htmlFor="sa-impl-valor">Valor (USD)</label>
          <input id="sa-impl-valor" type="text" inputMode="decimal" maxLength={15} placeholder="Ej.: 1500" {...campo('valor')} />
        </div>
        <div className="field">
          <label htmlFor="sa-impl-recargo">Recargo por cuotas (%)</label>
          <input id="sa-impl-recargo" type="text" inputMode="decimal" maxLength={6} placeholder="Ej.: 15" {...campo('recargo')} />
        </div>
        <div className="field">
          <label htmlFor="sa-impl-cuotas">Cantidad de cuotas</label>
          <input id="sa-impl-cuotas" type="number" min="1" max="120" step="1" placeholder="Ej.: 12" {...campo('cuotas')} />
        </div>
        <div className="field">
          <label htmlFor="sa-impl-primera">Primera cuota vence el</label>
          <input id="sa-impl-primera" type="date" {...campo('primera_vence')} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={ocupado}>
          Guardar implementación
        </button>
      </form>
      {impl && (
        <>
          <div className="sa-cuotas-resumen">
            <div>
              <span className="sa-cuotas-numero">{impl.pagadas}</span>
              <span className="sa-cuotas-rotulo">Pagadas</span>
            </div>
            <div>
              <span className="sa-cuotas-numero">{impl.faltan}</span>
              <span className="sa-cuotas-rotulo">Faltan</span>
            </div>
            <div>
              <span className="sa-cuotas-numero">{formatearUsd(impl.pagado)}</span>
              <span className="sa-cuotas-rotulo">Pagado de {formatearUsd(impl.total)}</span>
            </div>
            <div>
              <span className="sa-cuotas-numero">{formatearUsd(impl.resta)}</span>
              <span className="sa-cuotas-rotulo">Resta pagar</span>
            </div>
          </div>
          <div
            className="sa-barra"
            role="progressbar"
            aria-label="Cuotas pagadas"
            aria-valuemin={0}
            aria-valuemax={impl.cuotas}
            aria-valuenow={impl.pagadas}
          >
            <div className="sa-barra-relleno" style={{ width: `${Math.min(100, (impl.pagadas / impl.cuotas) * 100)}%` }} />
          </div>
          <div className="sa-tabla-scroll">
            <table className="sa-tabla sa-tabla-cuotas">
              <thead>
                <tr>
                  <th>Cuota</th>
                  <th>Vence</th>
                  <th>Importe</th>
                  <th>Estado</th>
                  <th>Pago</th>
                </tr>
              </thead>
              <tbody>
                {impl.detalle.map((c) => (
                  <tr key={c.numero} className={c.estado === 'vencida' ? 'sa-cuota-vencida' : undefined}>
                    <td className="sa-monto">
                      {c.numero} de {impl.cuotas}
                    </td>
                    <td>{formatearFecha(c.vence)}</td>
                    <td className="sa-monto">{formatearUsd(c.importe)}</td>
                    <td>
                      <span className={`sa-chip ${ESTADO_CUOTA[c.estado].clase}`}>{ESTADO_CUOTA[c.estado].texto}</span>
                    </td>
                    <td>{c.pago ? `${formatearFecha(c.pago.fecha)} · ${NOMBRE_MEDIO[c.pago.medio_pago] ?? c.pago.medio_pago}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function SeccionAbono({ abono, ocupado, ejecutar }) {
  const [detalle, setDetalle] = useState(abono?.detalle ?? '');
  const [importe, setImporte] = useState(abono ? usdParaCampo(abono.importe) : '');

  const clave = abono ? `${abono.detalle}|${abono.importe}` : '';
  useEffect(() => {
    setDetalle(abono?.detalle ?? '');
    setImporte(abono ? usdParaCampo(abono.importe) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  function guardar(e) {
    e.preventDefault();
    ejecutar(() => api.put('/sa/abono', { detalle, importe }), (r) => (r.cobro.abono ? 'Abono guardado.' : 'Abono quitado.'));
  }

  return (
    <section className="card sa-card">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Abono mensual</h2>
        <span className="sa-chip sa-chip-neutro">{abono ? `${formatearUsd(abono.importe)} por mes` : 'Sin cargar'}</span>
      </div>
      <p className="sa-ayuda">
        Se cobra todos los meses, sin fin. Lo que incluye sale tal cual en el aviso por mail, en una sola línea. Los dos campos vacíos quitan el
        abono.
      </p>
      <form className="sa-form-abono" onSubmit={guardar}>
        <div className="field">
          <label htmlFor="sa-abono-detalle">Qué incluye</label>
          <input
            id="sa-abono-detalle"
            type="text"
            maxLength={200}
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            disabled={ocupado}
            placeholder="Ej.: Mantenimiento de servidor / actualizaciones / copia de seguridad / soporte"
          />
        </div>
        <div className="field">
          <label htmlFor="sa-abono-importe">Importe por mes (USD)</label>
          <input
            id="sa-abono-importe"
            type="text"
            inputMode="decimal"
            maxLength={15}
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            disabled={ocupado}
            placeholder="Ej.: 110"
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={ocupado}>
          Guardar abono
        </button>
      </form>
    </section>
  );
}

const modificacionVacia = () => ({ fecha: fechaHoyISO(), detalle: '', importe: '' });

export function SeccionModificaciones({ modificaciones: mods, hayVencimiento, ocupado, ejecutar }) {
  const [sinCargo, setSinCargo] = useState(String(mods.sin_cargo));
  const [nueva, setNueva] = useState(modificacionVacia);
  const [anulando, setAnulando] = useState(null); // id de la modificación en confirmación
  const [motivo, setMotivo] = useState('');
  const quedan = mods.quedan > 0;

  useEffect(() => {
    setSinCargo(String(mods.sin_cargo));
  }, [mods.sin_cargo]);

  const campo = (nombre) => ({
    value: nueva[nombre],
    onChange: (e) => setNueva((m) => ({ ...m, [nombre]: e.target.value })),
    disabled: ocupado,
  });

  function guardarSinCargo(e) {
    e.preventDefault();
    ejecutar(() => api.put('/sa/modificaciones/sin-cargo', { sin_cargo: sinCargo === '' ? null : Number(sinCargo) }), 'Modificaciones sin cargo guardadas.');
  }

  function anotar(e) {
    e.preventDefault();
    ejecutar(
      async () => {
        const r = await api.post('/sa/modificaciones', { ...nueva, importe: quedan ? null : nueva.importe });
        setNueva(modificacionVacia());
        return r;
      },
      (r) =>
        r.sin_cargo
          ? `Modificación anotada sin cargo. Sale en el aviso del ${formatearFecha(r.aviso)}.`
          : `Modificación anotada: ${formatearUsd(r.importe)}, se cobra con el aviso del ${formatearFecha(r.aviso)}.`
    );
  }

  function anular(id) {
    ejecutar(async () => {
      const r = await api.post(`/sa/modificaciones/${id}/anular`, { motivo });
      setAnulando(null);
      setMotivo('');
      return r;
    }, 'Modificación anulada.');
  }

  return (
    <section className="card sa-card">
      <div className="sa-card-cabecera">
        <h2 className="sa-h2">Modificaciones solicitadas</h2>
        {mods.sin_cargo > 0 ? (
          <span className={`sa-chip ${quedan ? 'sa-chip-ok' : 'sa-chip-aviso'}`}>
            Sin cargo: {mods.usadas} de {mods.sin_cargo} usadas
          </span>
        ) : (
          <span className="sa-chip sa-chip-neutro">Sin modificaciones sin cargo</span>
        )}
      </div>
      <p className="sa-ayuda">
        Las primeras van sin cargo (son para todo el contrato, no se renuevan por mes) y salen en el aviso como &quot;Sin cargo&quot;. Cuando se
        usan todas, cada modificación nueva se anota con su importe y se cobra una sola vez, en el aviso siguiente. El aviso siempre aclara que las modificaciones que se implementen tienen un costo
        adicional.
      </p>
      <form className="sa-form-fila" onSubmit={guardarSinCargo}>
        <div className="field sa-campo-sin-cargo">
          <label htmlFor="sa-modif-sin-cargo">Modificaciones sin cargo</label>
          <input
            id="sa-modif-sin-cargo"
            type="number"
            min="0"
            max="100"
            step="1"
            value={sinCargo}
            onChange={(e) => setSinCargo(e.target.value)}
            disabled={ocupado}
            required
          />
        </div>
        <button type="submit" className="btn" disabled={ocupado}>
          Guardar
        </button>
      </form>
      {!hayVencimiento && <p className="sa-ayuda">Para anotar una modificación, cargá primero el próximo vencimiento en Aviso del mes.</p>}
      <form className="sa-form-modif" onSubmit={anotar}>
        <div className="field">
          <label htmlFor="sa-modif-fecha">Fecha</label>
          <input id="sa-modif-fecha" type="date" max={fechaHoyISO()} required {...campo('fecha')} />
        </div>
        <div className="field sa-modif-detalle">
          <label htmlFor="sa-modif-detalle">Detalle (sale en el mail)</label>
          <input id="sa-modif-detalle" type="text" maxLength={200} required placeholder="Qué se modificó" {...campo('detalle')} />
        </div>
        <div className="field">
          <label htmlFor="sa-modif-importe">Importe (USD)</label>
          <input
            id="sa-modif-importe"
            type="text"
            inputMode="decimal"
            maxLength={15}
            required={!quedan}
            placeholder={quedan ? 'Sin cargo' : 'Ej.: 80'}
            {...campo('importe')}
            value={quedan ? '' : nueva.importe}
            disabled={ocupado || quedan}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={ocupado || !hayVencimiento}>
          Anotar modificación
        </button>
      </form>
      {mods.lista.length === 0 ? (
        <p className="sa-ayuda">Todavía no hay modificaciones anotadas.</p>
      ) : (
        <div className="sa-tabla-scroll">
          <table className="sa-tabla sa-tabla-modif">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Detalle</th>
                <th>Importe</th>
                <th>Aviso</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {mods.lista.map((m) => (
                <tr key={m.id} className={m.estado === 'anulada' ? 'sa-pago-anulado' : undefined}>
                  <td>{formatearFecha(m.fecha)}</td>
                  <td className="sa-modif-texto">{m.detalle}</td>
                  <td className="sa-monto">
                    {m.sin_cargo ? <span className="sa-chip sa-chip-ok">Sin cargo</span> : formatearUsd(m.importe)}
                  </td>
                  <td className="sa-una-linea">
                    {m.estado === 'a_cobrar' ? (
                      <span className="sa-chip sa-chip-aviso">A cobrar el {formatearFecha(m.aviso)}</span>
                    ) : (
                      <>
                        {formatearFecha(m.aviso)}
                        {m.estado === 'cobrada' && <div className="sa-detalle-fila">Cobrada</div>}
                      </>
                    )}
                  </td>
                  <td className="sa-pago-accion">
                    {m.estado === 'anulada' ? (
                      <>
                        <span className="sa-chip sa-chip-neutro">Anulada</span>
                        <div className="sa-detalle-fila">{m.anulada_motivo}</div>
                      </>
                    ) : anulando === m.id ? (
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
                        <button type="button" className="btn sa-btn-peligro" disabled={ocupado || !motivo.trim()} onClick={() => anular(m.id)}>
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
                        disabled={ocupado || m.estado === 'cobrada'}
                        title={m.estado === 'cobrada' ? 'Ya se cobró: para anularla, anulá primero ese pago' : undefined}
                        onClick={() => {
                          setAnulando(m.id);
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
