import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import Icono from '../components/Icono.jsx';
import { ConIcono } from '../components/ConAvatar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { colorDe } from '../utils/colores.js';
import { formatearFecha } from '../utils/format.js';
import { describirStock, describirStockLargo, formatearCantidad } from '../utils/presentacion.js';
import './ClientesEmpresaPage.css';
import './VencimientosPage.css';

const PUEDE_RETIRAR = new Set(['admin', 'encargado']);

function etiquetaDias(n, sufijoSingular, sufijoPlural) {
  if (n === 1) return `1 ${sufijoSingular}`;
  return `${n} ${sufijoPlural}`;
}

// Rediseño 2026-10-29: tabla real (producto con su lote abajo, vencimiento, estado, cantidad y
// acción en una columna fija); la confirmación de "Retirar" va en un renglón propio debajo del
// lote, con la pregunta y lo que pasa. Coral (vencido) y Dorado (por vencer) solo como alerta.
export default function VencimientosPage() {
  const { usuario, stockEnPacks } = useAuth();
  const navigate = useNavigate();
  const puedeRetirar = PUEDE_RETIRAR.has(usuario?.rol);

  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [confirmandoLoteId, setConfirmandoLoteId] = useState(null);
  const [retirando, setRetirando] = useState(false);
  // Guardia sincrónica de "Sí" (retirar): `disabled={retirando}` no alcanza contra dos clicks en el
  // mismo tick (el segundo DELETE volvía con "Lote no encontrado").
  const retirandoRef = useRef(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const data = await api.get('/vencimientos');
      setDatos(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los vencimientos.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function retirarLote(loteVencido) {
    if (retirandoRef.current) return;
    retirandoRef.current = true;
    setRetirando(true);
    try {
      await api.delete(`/productos/${loteVencido.producto_id}/lotes/${loteVencido.lote_id}`);
      setConfirmandoLoteId(null);
      cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo retirar el lote.');
      setConfirmandoLoteId(null);
    } finally {
      retirandoRef.current = false;
      setRetirando(false);
    }
  }

  if (cargando) {
    return <div className="cliente-vacio">Cargando…</div>;
  }

  if (error && !datos) {
    return <div className="alert alert-danger">{error}</div>;
  }

  const vencidos = datos?.vencidos ?? [];
  const porVencer = datos?.por_vencer ?? [];
  // En riesgo, separado por medida (2026-10-11): unidades y kg/litros no se suman entre sí.
  const enRiesgoPorMedida = [...vencidos, ...porVencer].reduce(
    (mapa, l) => mapa.set(l.medida ?? 'unidad', (mapa.get(l.medida ?? 'unidad') ?? 0) + l.cantidad),
    new Map()
  );
  const unidadesEnRiesgo =
    enRiesgoPorMedida.size === 0
      ? 0
      : [...enRiesgoPorMedida].map(([medida, cantidad]) => formatearCantidad(cantidad, medida)).join(' · ');

  // Un renglón de la tabla: producto (y su lote abajo), vencimiento, estado, cantidad y acción.
  function fila(lote, vencido) {
    const confirmando = vencido && confirmandoLoteId === lote.lote_id;
    return (
      <Fragment key={`${vencido ? 'v' : 'p'}-${lote.lote_id}`}>
        <tr className={`sin-click vencimientos-fila${confirmando ? ' vencimientos-fila-confirmando' : ''}`}>
          <td className="vencimientos-td-producto">
            <ConIcono icono="paquete" color={colorDe(lote.producto_id)}>
              <div className="cliente-td-nombre">{lote.producto_nombre}</div>
              <div className="cliente-td-sub">
                Lote #{lote.lote_id}
                <span className="vencimientos-sub-fecha"> · Vence {formatearFecha(lote.fecha_vencimiento)}</span>
              </div>
            </ConIcono>
          </td>
          <td className="vencimientos-td-fecha">{formatearFecha(lote.fecha_vencimiento)}</td>
          <td className="vencimientos-td-estado">
            {vencido ? (
              <span className="estado estado-rojo">
                <Icono nombre="alerta" />
                Vencido hace {etiquetaDias(lote.dias_vencido, 'día', 'días')}
              </span>
            ) : (
              <span className="estado estado-amarillo">
                <Icono nombre="reloj" />
                {lote.dias_restantes === 0 ? 'Vence hoy' : `Vence en ${etiquetaDias(lote.dias_restantes, 'día', 'días')}`}
              </span>
            )}
          </td>
          <td className="num vencimientos-td-cantidad">{describirStock(lote.cantidad, lote, stockEnPacks)}</td>
          <td className="accion vencimientos-td-accion">
            {vencido
              ? puedeRetirar &&
                !confirmando && (
                  <button type="button" className="btn vencimientos-btn" onClick={() => setConfirmandoLoteId(lote.lote_id)}>
                    Retirar
                  </button>
                )
              : (
                <button type="button" className="btn vencimientos-btn" onClick={() => navigate(`/stock/${lote.producto_id}`)}>
                  Ver producto
                </button>
              )}
          </td>
        </tr>
        {confirmando && (
          <tr className="sin-click vencimientos-confirm-fila">
            <td colSpan={5}>
              <div className="vencimientos-confirm">
                <span>
                  ¿Retirar el lote #{lote.lote_id} de {lote.producto_nombre}? Se descuentan{' '}
                  <strong>{describirStockLargo(lote.cantidad, lote, stockEnPacks)}</strong> del stock.
                </span>
                <div className="vencimientos-confirm-acciones">
                  <button type="button" className="btn" onClick={() => setConfirmandoLoteId(null)}>
                    Cancelar
                  </button>
                  <button type="button" className="btn btn-peligro" disabled={retirando} onClick={() => retirarLote(lote)}>
                    Retirar lote
                  </button>
                </div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  return (
    <div className="cliente-page vencimientos-page">
      <Hero
        etiqueta="Cantidad en riesgo"
        valor={unidadesEnRiesgo}
        sub="Mercadería de lotes vencidos o por vencer."
        minis={[
          {
            etiqueta: 'Lotes vencidos',
            valor: vencidos.length,
            sub: vencidos.length > 0 ? 'Retirarlos' : 'Ninguno',
            icono: vencidos.length > 0 ? 'alerta' : 'check',
            tono: vencidos.length > 0 ? 'rojo' : 'verde',
          },
          { etiqueta: 'Por vencer', valor: porVencer.length, icono: 'reloj', tono: porVencer.length > 0 ? 'amarillo' : 'verde' },
        ]}
      />

      {vencidos.length > 0 && (
        <div className="alert alert-danger vencimientos-alerta" role="status">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.3 3.9L2.5 17a1.5 1.5 0 0 0 1.3 2.2h16.4a1.5 1.5 0 0 0 1.3-2.2L13.7 3.9a1.5 1.5 0 0 0-2.6 0z" />
          </svg>
          <span>
            {vencidos.length === 1 ? 'Hay 1 lote vencido en stock.' : `Hay ${vencidos.length} lotes vencidos en stock.`} Retiralos para que no se
            vendan.
          </span>
        </div>
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card cliente-card vencimientos-card">
        <div className="cliente-seccion-cabecera">
          <span className="cliente-seccion-titulo">Lotes vencidos y por vencer</span>
        </div>
        {vencidos.length === 0 && porVencer.length === 0 ? (
          <div className="cliente-vacio">No hay lotes vencidos ni por vencer.</div>
        ) : (
          <div className="cliente-tabla-wrap">
            <table className="cliente-tabla vencimientos-tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="vencimientos-td-fecha">Vencimiento</th>
                  <th>Estado</th>
                  <th className="num">Cantidad</th>
                  <th className="accion" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {vencidos.length > 0 && (
                  <tr className="grupo-fila">
                    <td colSpan={5}>
                      <div className="grupo-h grupo-h-rojo">
                        <Icono nombre="alerta" tam={16} />
                        {vencidos.length === 1 ? '1 lote vencido' : `${vencidos.length} lotes vencidos`}
                      </div>
                    </td>
                  </tr>
                )}
                {vencidos.map((lote) => fila(lote, true))}
                {porVencer.length > 0 && (
                  <tr className="grupo-fila">
                    <td colSpan={5}>
                      <div className="grupo-h grupo-h-amarillo">
                        <Icono nombre="reloj" tam={16} />
                        {porVencer.length === 1 ? '1 lote por vencer' : `${porVencer.length} lotes por vencer`}
                      </div>
                    </td>
                  </tr>
                )}
                {porVencer.map((lote) => fila(lote, false))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
