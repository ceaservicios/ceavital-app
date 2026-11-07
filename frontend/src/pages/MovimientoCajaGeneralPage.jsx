import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Icono from '../components/Icono.jsx';
import { useEfectivoDisponible } from '../components/OrigenEfectivo.jsx';
import { COLOR } from '../utils/colores.js';
import { fechaHoyISO, formatearMonto } from '../utils/format.js';
import './SaldosPage.css';
import './CajaGeneralPage.css';

// Anotar a mano lo que no viene de un cierre ni de un pago (2026-11-06). Página propia, como "Cargar deuda".
const QUE = [
  { valor: 'inicial', titulo: 'Saldo inicial', sub: 'Lo que hay en Caja general hoy, para arrancar.', icono: 'cofre', color: COLOR.teal, entra: true },
  { valor: 'ingreso', titulo: 'Entró plata', sub: 'Plata que se suma y no viene de un cierre.', icono: 'mas', color: COLOR.verde, entra: true },
  { valor: 'banco', titulo: 'Depósito en el banco', sub: 'Plata de Caja general que se llevó al banco.', icono: 'banco', color: COLOR.azul, entra: false },
  { valor: 'dueno', titulo: 'Retiro del dueño', sub: 'Plata de Caja general que se llevó el dueño.', icono: 'usuarios', color: COLOR.rosa, entra: false },
];

export default function MovimientoCajaGeneralPage() {
  const navigate = useNavigate();
  const disponible = useEfectivoDisponible();
  const hoy = fechaHoyISO();
  const [que, setQue] = useState('banco');
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [detalle, setDetalle] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const guardaRef = useRef(false);

  useEffect(() => setError(null), [que]);

  const opcion = QUE.find((q) => q.valor === que);
  const n = Number(monto) || 0;
  const saldo = disponible?.general ?? 0;
  const queda = opcion.entra ? saldo + n : saldo - n;

  async function guardar(e) {
    e.preventDefault();
    if (guardaRef.current) return;
    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      await api.post('/caja-general/movimientos', { tipo: que, monto: n, fecha, detalle: detalle.trim() || null });
      navigate('/caja-general', { replace: true, state: { exito: `${opcion.titulo} anotado.` } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anotar el movimiento.');
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <div className="cpagar-page">
      <h1 className="cliente-h1">Anotar movimiento</h1>
      <form className="card cpagar-tarjeta" onSubmit={guardar}>
        <div className="cpagar-cabecera">
          <span className="cpagar-cabecera-icono">
            <Icono nombre="cofre" />
          </span>
          <div>
            <strong>Caja general</strong>
            <span>Lo que no viene de un cierre de caja ni de un pago.</span>
          </div>
        </div>
        <div className="cpagar-cuerpo">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="field">
            <span className="cpagar-label">¿Qué pasó?</span>
            <div className="cargar-que" role="group" aria-label="Qué pasó">
              {QUE.map((q) => (
                <button key={q.valor} type="button" className={`cargar-op${que === q.valor ? ' activo' : ''}`} style={{ '--c': q.color }} aria-pressed={que === q.valor} onClick={() => setQue(q.valor)}>
                  <span className="cargar-op-icono">
                    <Icono nombre={q.icono} />
                  </span>
                  <span className="cargar-op-texto">
                    <strong>{q.titulo}</strong>
                    <span>{q.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="cpagar-fila">
            <div className="field">
              <label htmlFor="cg-monto">Monto</label>
              <input id="cg-monto" type="number" min="1" step="1" required placeholder="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cg-fecha">Fecha</label>
              <input id="cg-fecha" type="date" required max={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="cg-detalle">Detalle (opcional)</label>
            <input id="cg-detalle" maxLength={200} placeholder="Ej.: Banco Patagonia" value={detalle} onChange={(e) => setDetalle(e.target.value)} />
          </div>
          {disponible && n > 0 && (
            <div className="cg-cuenta">
              <span>Caja general pasa de {formatearMonto(saldo)} a</span>
              <strong>{formatearMonto(queda)}</strong>
            </div>
          )}
          <div className="cpagar-acciones">
            <button type="button" className="btn" onClick={() => navigate('/caja-general')}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Anotar movimiento'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
