import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import { MigaFicha } from '../components/Topbar.jsx';
import Icono from '../components/Icono.jsx';
import { fechaHoyISO, formatearFecha, formatearMonto } from '../utils/format.js';
import { CamposPago, PAGO_VACIO, pagoParaApi } from './proveedoresComun.jsx';
import {
  AYUDA_CAJA_CUENTA,
  aFormularioCuenta,
  CamposCuenta,
  cuentaParaApi,
  EstadoVence,
  estadoVence,
  etiquetaMedioCuenta,
  etiquetaRepeticion,
  IconoTipo,
  MEDIOS_PAGO_CUENTA,
  TagRepeticion,
  TagTipo,
} from './saldosComun.jsx';
import './ProveedoresPage.css';
import './SaldosPage.css';

// Ficha de una cuenta a pagar (2026-10-29): cuánto falta, registrar un pago (todo o una parte), los
// pagos con su anulación y los datos para corregirla o darla de baja.
export default function CuentaPagarDetallePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [cuenta, setCuenta] = useState(null);
  const [edicion, setEdicion] = useState(null);
  const [pago, setPago] = useState(PAGO_VACIO());
  const [cargando, setCargando] = useState(true);
  const [confirmando, setConfirmando] = useState(null); // { tipo: 'pago' | 'cuenta', id }
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);
  // Guardia sincrónica: un pago duplicado altera lo que figura como pagado.
  const guardaRef = useRef(false);
  const pagoRef = useRef(null);

  const aplicar = useCallback((data) => {
    setCuenta(data);
    setEdicion(aFormularioCuenta(data));
    setPago(PAGO_VACIO(data.monto - data.pagado > 0 ? data.monto - data.pagado : ''));
  }, []);

  useEffect(() => {
    setCargando(true);
    api
      .get(`/saldos/cuentas/${id}`)
      .then(aplicar)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar la cuenta.'))
      .finally(() => setCargando(false));
  }, [id, aplicar]);

  // "Pagar" en la lista lleva directo al formulario de pago.
  const quierePagar = location.state?.pagar === true;
  useEffect(() => {
    if (quierePagar && cuenta && pagoRef.current) {
      pagoRef.current.scrollIntoView({ block: 'start' });
      pagoRef.current.querySelector('input')?.focus({ preventScroll: true });
    }
  }, [quierePagar, cuenta]);

  async function conGuardia(accion, mensajeError) {
    if (guardaRef.current) return;
    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    setExito(null);
    try {
      await accion();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : mensajeError);
    } finally {
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  function registrarPago(e) {
    e.preventDefault();
    const { error: falta, payload } = pagoParaApi(pago);
    if (falta) return setError(falta);
    return conGuardia(async () => {
      const data = await api.post(`/saldos/cuentas/${id}/pagos`, payload);
      const nueva = data.siguiente && !cuenta.siguiente ? ` La siguiente ya quedó cargada: vence el ${formatearFecha(data.siguiente.vence)}.` : '';
      aplicar(data);
      setExito(`${payload.sale_de_caja ? 'Pago registrado. Se descontó del efectivo de la caja.' : 'Pago registrado.'}${nueva}`);
    }, 'No se pudo registrar el pago.');
  }

  function anularPago(pagoId) {
    return conGuardia(async () => {
      try {
        aplicar(await api.post(`/saldos/cuentas/${id}/pagos/${pagoId}/anular`, {}));
        setExito('Pago anulado.');
      } finally {
        setConfirmando(null);
      }
    }, 'No se pudo anular el pago.');
  }

  function guardarDatos(e) {
    e.preventDefault();
    const { error: falta, payload } = cuentaParaApi(edicion);
    if (falta) return setError(falta);
    return conGuardia(async () => {
      aplicar(await api.patch(`/saldos/cuentas/${id}`, payload));
      setExito('Cambios guardados.');
    }, 'No se pudieron guardar los cambios.');
  }

  function eliminarCuenta() {
    return conGuardia(async () => {
      try {
        await api.delete(`/saldos/cuentas/${id}`);
        navigate('/saldos', { replace: true, state: { exito: `Cuenta «${cuenta.concepto}» eliminada.` } });
      } catch (err) {
        setConfirmando(null);
        throw err;
      }
    }, 'No se pudo eliminar la cuenta.');
  }

  if (cargando) return <div className="cliente-vacio">Cargando…</div>;
  if (!cuenta) {
    return (
      <div className="cpagar-page">
        <MigaFicha />
        {error && <div className="alert alert-danger">{error}</div>}
      </div>
    );
  }

  const falta = cuenta.monto - cuenta.pagado;
  const estado = falta > 0 ? estadoVence(cuenta.vence, fechaHoyISO()) : { tono: 'verde', icono: 'check', texto: 'Pagada' };

  return (
    <div className="cpagar-page">
      {/* El panel va primero, en el mismo lugar que en las demás pantallas; el nombre, debajo. */}
      <Hero
        etiqueta={falta > 0 ? 'Falta pagar' : 'Cuenta pagada'}
        valor={formatearMonto(falta)}
        sub={`Pagado ${formatearMonto(cuenta.pagado)} de ${formatearMonto(cuenta.monto)}`}
        minis={[
          { etiqueta: 'Monto', valor: formatearMonto(cuenta.monto), icono: 'billetera', tono: 'blanco' },
          { etiqueta: 'Vence', valor: formatearFecha(cuenta.vence), sub: estado.texto, icono: 'calendario', tono: estado.tono },
          {
            etiqueta: 'Se repite',
            valor: etiquetaRepeticion(cuenta.repeticion),
            sub: cuenta.siguiente ? `Siguiente: ${formatearFecha(cuenta.siguiente.vence)}` : null,
            icono: 'repetir',
            tono: 'azul',
          },
        ]}
      />

      <MigaFicha />
      <div>
        <div className="cpagar-titulo">
          <IconoTipo tipo={cuenta.tipo} />
          <h1>{cuenta.concepto}</h1>
          <EstadoVence estado={estado} />
        </div>
        <div className="cpagar-subtitulo">
          <TagTipo tipo={cuenta.tipo} />
          <TagRepeticion repeticion={cuenta.repeticion} />
          <span>Vence el {formatearFecha(cuenta.vence)}</span>
          {cuenta.nota && <span>· {cuenta.nota}</span>}
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      {cuenta.siguiente && (
        <div className="alert alert-exito">
          La siguiente ya está cargada: vence el {formatearFecha(cuenta.siguiente.vence)}. <Link to={`/saldos/cuentas/${cuenta.siguiente.id}`}>Ver la siguiente</Link>
        </div>
      )}

      {falta > 0 && (
        <form ref={pagoRef} className="card cpagar-tarjeta" onSubmit={registrarPago}>
          <div className="cpagar-cabecera">
            <span className="cpagar-cabecera-icono">
              <Icono nombre="billete" />
            </span>
            <div>
              <strong>Registrar pago</strong>
              <span>Todo o una parte: si la pagás en partes, sigue en Saldos pendientes hasta completarla.</span>
            </div>
          </div>
          <div className="cpagar-cuerpo">
            <CamposPago pago={pago} setPago={setPago} medios={MEDIOS_PAGO_CUENTA} ayudaCaja={AYUDA_CAJA_CUENTA} />
            <div className="cpagar-acciones">
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? 'Registrando…' : 'Registrar pago'}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="card cpagar-tarjeta">
        <div className="cpagar-seccion-h">Pagos ({cuenta.pagos.length})</div>
        {cuenta.pagos.length === 0 ? (
          <div className="saldos-vacio">Todavía no tiene pagos.</div>
        ) : (
          cuenta.pagos.map((p) => (
            <div key={p.id} className={`cpagar-pago${p.anulado ? ' cpagar-pago-anulado' : ''}`}>
              <span>{formatearFecha(p.fecha)}</span>
              <span>
                <span className="cpagar-pago-medio">{etiquetaMedioCuenta(p.medio)}</span>
                <span className="saldos-fila-nota">
                  {' · '}
                  {p.anulado
                    ? `Anulado por ${p.anulado_por_nombre}`
                    : [p.sale_de_caja ? 'con efectivo de la caja' : null, p.detalle, `cargó ${p.usuario_nombre}`].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="cpagar-pago-monto">{formatearMonto(p.monto)}</span>
              {p.anulado ? (
                <span />
              ) : confirmando?.tipo === 'pago' && confirmando.id === p.id ? (
                <span className="cpagar-confirmar">
                  <button type="button" className="btn" onClick={() => setConfirmando(null)}>
                    Cancelar
                  </button>
                  <button type="button" className="btn btn-peligro" disabled={guardando} onClick={() => anularPago(p.id)}>
                    Anular pago
                  </button>
                </span>
              ) : (
                <button type="button" className="btn" onClick={() => setConfirmando({ tipo: 'pago', id: p.id })}>
                  Anular
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <form className="card cpagar-tarjeta" onSubmit={guardarDatos}>
        <div className="cpagar-seccion-h">Datos de la cuenta</div>
        <div className="cpagar-cuerpo">
          <CamposCuenta form={edicion} setForm={setEdicion} />
          <div className="cpagar-acciones">
            {confirmando?.tipo === 'cuenta' ? (
              <span className="cpagar-confirmar">
                ¿Eliminar la cuenta?
                <button type="button" className="btn" onClick={() => setConfirmando(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn btn-peligro" disabled={guardando} onClick={eliminarCuenta}>
                  Eliminar
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-peligro" onClick={() => setConfirmando({ tipo: 'cuenta', id: cuenta.id })}>
                Eliminar cuenta
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              Guardar cambios
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
