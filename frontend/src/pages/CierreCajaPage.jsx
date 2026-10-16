import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { cuandoFueElCierre, fechaHoyISO, formatearFecha, formatearHora, formatearMonto } from '../utils/format.js';
import './ClientesEmpresaPage.css';
import './CierreCajaPage.css';

// Cierre de Caja por turno (rediseño aprobado por el usuario sobre una maqueta, 2026-10-16): cada
// cierre cuenta lo que pasó desde el cierre anterior, aunque sea del mismo día. A la izquierda,
// las ventas del turno agrupadas por dónde está la plata; a la derecha, el arqueo como una cuenta
// a la vista (fondo + ventas en efectivo − gastos = lo que tiene que haber en la caja).

const PUEDE_CERRAR = new Set(['admin', 'encargado']);

const ICONOS = {
  cash: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  tarjeta: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  ),
  qr: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  mp: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1" />
      <path d="M21 12a1.5 1.5 0 0 1 0 3h-3a3 3 0 0 1 0-6h3a1.5 1.5 0 0 1 0 3z" />
    </svg>
  ),
  fiado: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  ctacte: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  ),
};

// Las ventas del turno, agrupadas por dónde está la plata. "Efectivo" es lo vendido en efectivo
// (antes la fila mostraba lo esperado en caja, que ya incluía el fondo, y no sumaba con el total).
const GRUPOS = [
  { titulo: 'Entró a la caja', nota: 'Billetes en el cajón', medios: [{ campo: 'total_efectivo', label: 'Efectivo', icono: 'cash' }] },
  {
    titulo: 'Banco y billeteras',
    nota: 'No se cuenta en el cajón',
    medios: [
      { campo: 'total_tarjeta', label: 'Tarjeta (débito / crédito)', icono: 'tarjeta' },
      { campo: 'total_transferencia_qr', label: 'Transferencia / QR', icono: 'qr' },
      { campo: 'total_mercado_pago', label: 'Mercado Pago', icono: 'mp' },
    ],
  },
  {
    titulo: 'A cobrar',
    nota: 'Todavía no entró',
    medios: [
      { campo: 'total_fiado', label: 'Pago pendiente', icono: 'fiado' },
      { campo: 'total_cta_cte', label: 'Cuenta Corriente', icono: 'ctacte', modulo: 'clientes_empresa' },
    ],
  },
];

function diaConNombre(dia) {
  const nombre = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${dia}T12:00:00Z`));
  return `${nombre} ${formatearFecha(dia)}`;
}

export default function CierreCajaPage() {
  const { usuario, moduloActivo } = useAuth();
  const puedeCerrar = PUEDE_CERRAR.has(usuario?.rol);

  const [resumen, setResumen] = useState(null);
  const [cierres, setCierres] = useState([]);
  const [montoContado, setMontoContado] = useState('');
  const [fondoDejado, setFondoDejado] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);
  const [enviando, setEnviando] = useState(false);
  // Guardia real contra doble-click: un ref se muta de forma sincrónica (no depende de que React
  // ya haya re-renderizado el botón deshabilitado). Ver hallazgo Media (verificador-funcional
  // 2026-09-10): "Confirmar Cierre de Caja" creaba 2 registros con un doble click.
  const enviandoRef = useRef(false);

  async function cargar() {
    setError(null);
    try {
      const [dataResumen, dataCierres] = await Promise.all([api.get('/caja/resumen'), api.get('/caja/cierres')]);
      setResumen(dataResumen);
      setCierres(dataCierres.cierres.slice(0, 10));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar el cierre de caja.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const fondo = resumen?.fondo_heredado ?? 0;
  const ventasEfectivo = resumen?.total_efectivo ?? 0;
  const gastos = resumen?.total_gastos ?? 0;
  const esperado = resumen?.total_efectivo_esperado ?? 0;
  const contado = montoContado === '' ? null : Number(montoContado);
  const diferencia = contado === null ? null : contado - esperado;
  const fondoNuevo = fondoDejado === '' ? 0 : Number(fondoDejado);
  const fondoDeMas = contado !== null && fondoNuevo > contado;
  const seRetira = contado === null ? null : contado - fondoNuevo;

  async function confirmarCierre() {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      const cierre = await api.post('/caja/cierres', { total_efectivo_contado: contado, fondo_dejado: fondoNuevo });
      setExito(`Cierre #${cierre.id} registrado. Quedan ${formatearMonto(cierre.fondo_dejado)} de fondo y arranca un turno nuevo.`);
      setMontoContado('');
      setFondoDejado('');
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar el cierre.');
    } finally {
      setEnviando(false);
      enviandoRef.current = false;
    }
  }

  if (cargando) return <div className="card cierre-vacio">Cargando…</div>;

  const claseDiferencia = diferencia === null ? '' : diferencia === 0 ? 'cierre-dif-exacta' : diferencia > 0 ? 'cierre-dif-sobra' : 'cierre-dif-falta';

  return (
    <div className="cierre-page">
      <div className="cierre-cabecera">
        <span className="cierre-turno">Turno abierto · {diaConNombre(resumen?.fecha ?? fechaHoyISO())}</span>
        <span className="cierre-sub">
          {resumen?.desde ? `Desde el cierre ${cuandoFueElCierre(resumen.desde)}.` : 'Desde el inicio del día (todavía no hay cierres anteriores).'}
        </span>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <div className="cierre-body">
        <div className="card cierre-ventas">
          <span className="cierre-titulo">Ventas del turno por medio de pago</span>
          {GRUPOS.map((g) => {
            const medios = g.medios.filter((m) => !m.modulo || moduloActivo(m.modulo) || (resumen?.[m.campo] ?? 0) > 0);
            return (
              <div className="cierre-grupo" key={g.titulo}>
                <div className="cierre-grupo-cab">
                  <span>{g.titulo}</span>
                  <span>{g.nota}</span>
                </div>
                {medios.map((m) => (
                  <div className="cierre-medio" key={m.campo}>
                    <span className="cierre-medio-label">
                      {ICONOS[m.icono]}
                      {m.label}
                    </span>
                    <span className="cierre-medio-valor">{formatearMonto(resumen?.[m.campo] ?? 0)}</span>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="cierre-total">
            <span>Total vendido en el turno</span>
            <span>{formatearMonto(resumen?.total_general ?? 0)}</span>
          </div>
        </div>

        <div className="card cierre-arqueo">
          <span className="cierre-titulo">Arqueo del efectivo</span>
          <div className="cierre-cuenta">
            <div className="cierre-cuenta-fila">
              <span>
                Fondo con que arrancó el turno
                <small>{resumen?.desde ? `Dejado en el cierre ${cuandoFueElCierre(resumen.desde)}` : 'No hay cierres anteriores'}</small>
              </span>
              <span>{formatearMonto(fondo)}</span>
            </div>
            <div className="cierre-cuenta-fila">
              <span>+ Ventas en efectivo</span>
              <span>{formatearMonto(ventasEfectivo)}</span>
            </div>
            <div className="cierre-cuenta-fila">
              <span>− Gastos y pagos a proveedores</span>
              <span>{gastos > 0 ? `− ${formatearMonto(gastos)}` : formatearMonto(0)}</span>
            </div>
            <div className="cierre-cuenta-total">
              <span>Tiene que haber en la caja</span>
              <span>{formatearMonto(esperado)}</span>
            </div>
          </div>

          {puedeCerrar ? (
            <>
              <div className="field">
                <label htmlFor="cierre-contado">¿Cuánto hay en la caja? (lo que contaste)</label>
                <input id="cierre-contado" type="number" min="0" value={montoContado} onChange={(e) => setMontoContado(e.target.value)} placeholder="0" />
              </div>
              {diferencia !== null && (
                <div className={`cierre-diferencia ${claseDiferencia}`}>
                  <span>{diferencia === 0 ? 'Caja exacta' : diferencia > 0 ? 'Sobra' : 'Falta'}</span>
                  <span>{diferencia === 0 ? '✓' : formatearMonto(Math.abs(diferencia))}</span>
                </div>
              )}
              <div className="field">
                <label htmlFor="cierre-fondo">Fondo para el próximo turno (queda en el cajón)</label>
                <input id="cierre-fondo" type="number" min="0" value={fondoDejado} onChange={(e) => setFondoDejado(e.target.value)} placeholder="0" />
              </div>
              {fondoDeMas ? (
                <div className="alert alert-danger">El fondo no puede ser mayor que lo que contaste.</div>
              ) : (
                seRetira !== null && (
                  <div className="cierre-retiro">
                    <span>Se retira de la caja</span>
                    <strong>{formatearMonto(seRetira)}</strong>
                  </div>
                )
              )}
              <button
                type="button"
                className="btn btn-primary cierre-boton"
                disabled={contado === null || fondoDeMas || enviando}
                onClick={confirmarCierre}
              >
                {enviando ? 'Registrando…' : 'Confirmar cierre del turno'}
              </button>
            </>
          ) : (
            <div className="cierre-hint">El cierre lo confirma el Administrador o el Encargado. Vos podés ver los totales.</div>
          )}
        </div>
      </div>

      <div className="card cierre-historial">
        <span className="cierre-titulo">Cierres anteriores</span>
        {cierres.length === 0 ? (
          <div className="cierre-vacio">Todavía no se registró ningún cierre.</div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla cierre-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="cierre-opcional">Cerró</th>
                  <th className="num cierre-opcional">Tenía que haber</th>
                  <th className="num">Contado</th>
                  <th className="num">Diferencia</th>
                  <th className="num">Fondo dejado</th>
                  <th className="num cierre-opcional">Total vendido</th>
                </tr>
              </thead>
              <tbody>
                {cierres.map((c) => (
                  <tr key={c.id} className="sin-click">
                    <td>
                      {formatearFecha(c.fecha)}
                      <span className="cierre-hora">{formatearHora(c.creado_en)}</span>
                    </td>
                    <td className="cierre-opcional">{c.usuario_nombre}</td>
                    <td className="num cierre-opcional">{formatearMonto(c.total_efectivo_esperado)}</td>
                    <td className="num">{formatearMonto(c.total_efectivo_contado)}</td>
                    <td className={`num cierre-dif ${c.diferencia_efectivo < 0 ? 'cierre-txt-falta' : c.diferencia_efectivo > 0 ? 'cierre-txt-sobra' : ''}`}>
                      {c.diferencia_efectivo === 0 ? 'Exacta' : `${c.diferencia_efectivo > 0 ? 'Sobró' : 'Faltó'} ${formatearMonto(Math.abs(c.diferencia_efectivo))}`}
                    </td>
                    <td className="num">{c.fondo_dejado > 0 ? formatearMonto(c.fondo_dejado) : '—'}</td>
                    <td className="num cierre-opcional">{formatearMonto(c.total_general)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
