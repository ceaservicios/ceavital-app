import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import Icono from '../components/Icono.jsx';
import { iniciales } from '../constants/roles.js';
import { COLOR, colorDe } from '../utils/colores.js';
import { formatearFecha, formatearMonto } from '../utils/format.js';
import { CorregirBoleta, textoComprobante } from './proveedoresComun.jsx';
import { EstadoVence, IconoTipo, TagRepeticion, TagTipo, estadoVence } from './saldosComun.jsx';
import './SaldosPage.css';

// Saldos pendientes (pedido del usuario, 2026-10-29): lo que falta pagar, en una sola lista ("no me
// gusta que esté dividido en proveedor e impuesto"). Las cuentas de impuestos y servicios y las
// boletas de proveedores van juntas en Vencidas, Esta semana y Más adelante, la que vence antes
// primero, así al entrar se ve lo vencido. Arriba, el panel verde con el total.

const FILTROS = [
  { clave: 'todas', texto: 'Todas' },
  { clave: 'vencida', texto: 'Vencidas' },
  { clave: 'semana', texto: 'Esta semana' },
  { clave: 'mes', texto: 'Este mes' },
];
const GRUPOS = [
  { clave: 'vencida', texto: 'Vencidas', tono: 'rojo', icono: 'alerta' },
  { clave: 'semana', texto: 'Esta semana', tono: 'amarillo', icono: 'reloj' },
  { clave: 'adelante', texto: 'Más adelante', tono: 'verde', icono: 'calendario' },
];

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const sumaFalta = (lista) => lista.reduce((a, x) => a + x.falta, 0);

function abrirConTeclado(e, accion) {
  if (e.key === 'Enter' && e.target === e.currentTarget) accion();
}

export default function SaldosPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState('todas');
  const [busqueda, setBusqueda] = useState('');
  const [exito, setExito] = useState(location.state?.exito ?? null);
  // Boleta de proveedor que se está corrigiendo (se abre abajo de su fila).
  const [corrigiendo, setCorrigiendo] = useState(null);

  const cargar = useCallback(
    () =>
      api
        .get('/saldos')
        .then(setDatos)
        .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los saldos pendientes.')),
    []
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  function correccionGuardada() {
    setCorrigiendo(null);
    setExito('Boleta corregida.');
    cargar();
    // El contador de vencidas del menú (Sidebar) se vuelve a pedir.
    window.dispatchEvent(new Event('saldos-cambiaron'));
  }

  // Cuentas y boletas en una sola lista por vencimiento (el orden es estable: a igual fecha, primero
  // las cuentas).
  const r = useMemo(() => {
    if (!datos) return null;
    const cuentas = datos.cuentas.map((c) => ({ ...c, clave: `cuenta-${c.id}`, nombre: c.concepto, falta: c.monto - c.pagado }));
    const compras = datos.compras.map((c) => ({ ...c, clave: `compra-${c.id}`, nombre: c.proveedor_nombre, esBoleta: true, falta: c.total - c.pagado }));
    const todas = [...cuentas, ...compras]
      .map((x) => ({ ...x, estado: estadoVence(x.vence, datos.hoy) }))
      .sort((a, b) => a.vence.localeCompare(b.vence));
    const de = (clave) => todas.filter((x) => x.estado.clave === clave);
    return { todas, totalCuentas: sumaFalta(cuentas), totalCompras: sumaFalta(compras), vencidas: de('vencida'), semana: de('semana') };
  }, [datos]);

  if (!r) {
    return <div className="saldos-page">{error ? <div className="alert alert-danger">{error}</div> : <div className="cliente-vacio">Cargando…</div>}</div>;
  }

  const mes = new Date(`${datos.hoy}T12:00:00`).toLocaleDateString('es-AR', { month: 'long' });
  const texto = busqueda.trim().toLocaleLowerCase('es');
  const filtradas = r.todas.filter((x) => {
    if (texto && !x.nombre.toLocaleLowerCase('es').includes(texto)) return false;
    if (filtro === 'todas') return true;
    if (filtro === 'mes') return x.vence.slice(0, 7) === datos.hoy.slice(0, 7);
    return x.estado.clave === filtro;
  });

  function filaCuenta(c) {
    const abrir = () => navigate(`/saldos/cuentas/${c.id}`);
    return (
      <div key={c.clave} className="saldos-fila" role="listitem" tabIndex={0} onClick={abrir} onKeyDown={(e) => abrirConTeclado(e, abrir)}>
        <IconoTipo tipo={c.tipo} />
        <div className="saldos-fila-info">
          <div className="saldos-fila-nombre">{c.concepto}</div>
          <div className="saldos-fila-tags">
            <TagTipo tipo={c.tipo} />
            <TagRepeticion repeticion={c.repeticion} />
            {c.pagado > 0 && (
              <span className="saldos-fila-nota">
                Pagado {formatearMonto(c.pagado)} de {formatearMonto(c.monto)}
              </span>
            )}
          </div>
        </div>
        <div className="saldos-fila-vence">
          <strong>{formatearFecha(c.vence)}</strong>
          <EstadoVence estado={c.estado} />
        </div>
        <div className="saldos-fila-monto">{formatearMonto(c.falta)}</div>
        <button
          type="button"
          className={`btn-fila saldos-fila-btn${c.estado.clave === 'vencida' ? ' btn-fila-rojo' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/saldos/cuentas/${c.id}`, { state: { pagar: true } });
          }}
        >
          Pagar
        </button>
      </div>
    );
  }

  function filaBoleta(c) {
    const abrir = () => navigate(`/proveedores/${c.proveedor_id}`);
    const nota = [`Compra del ${formatearFecha(c.fecha)}`, c.pagado > 0 && `Pagado ${formatearMonto(c.pagado)} de ${formatearMonto(c.total)}`, c.nota]
      .filter(Boolean)
      .join(' · ');
    return (
      <Fragment key={c.clave}>
        <div className={`saldos-fila${corrigiendo === c.id ? ' saldos-fila-abierta' : ''}`} role="listitem" tabIndex={0} onClick={abrir} onKeyDown={(e) => abrirConTeclado(e, abrir)}>
          <span className="icono-cat" style={{ '--c': colorDe(c.proveedor_id) }}>
            {iniciales(c.proveedor_nombre)}
          </span>
          <div className="saldos-fila-info">
            <div className="saldos-fila-nombre">{c.proveedor_nombre}</div>
            <div className="saldos-fila-tags">
              <span className="tag" style={{ '--c': COLOR.naranja }}>
                Proveedor
              </span>
              <span className="tag">{textoComprobante(c)}</span>
              {c.cargada_a_mano && <span className="tag tag-mano">Cargada a mano</span>}
              {c.corregida && <span className="tag tag-corregido">Corregida</span>}
              <span className="saldos-fila-nota">{nota}</span>
            </div>
          </div>
          <div className="saldos-fila-vence">
            <strong>{formatearFecha(c.vence)}</strong>
            <EstadoVence estado={c.estado} />
          </div>
          <div className="saldos-fila-monto">{formatearMonto(c.falta)}</div>
          <div className="saldos-fila-acciones saldos-fila-btn">
            <button
              type="button"
              className="btn-fila btn-fila-sec"
              aria-expanded={corrigiendo === c.id}
              onClick={(e) => {
                e.stopPropagation();
                setExito(null);
                setCorrigiendo(corrigiendo === c.id ? null : c.id);
              }}
            >
              Corregir
            </button>
            <button
              type="button"
              className={`btn-fila${c.estado.clave === 'vencida' ? ' btn-fila-rojo' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/proveedores/${c.proveedor_id}`, { state: { pagarCompra: c.id } });
              }}
            >
              Pagar
            </button>
          </div>
        </div>
        {corrigiendo === c.id && <CorregirBoleta compra={c} onCancelar={() => setCorrigiendo(null)} onGuardada={correccionGuardada} />}
      </Fragment>
    );
  }

  return (
    <div className="saldos-page">
      <Hero
        etiqueta="Total a pagar"
        valor={formatearMonto(r.totalCuentas + r.totalCompras)}
        sub={`Proveedores ${formatearMonto(r.totalCompras)} · Impuestos ${formatearMonto(r.totalCuentas)}`}
        minis={[
          { etiqueta: 'Vencido', valor: formatearMonto(sumaFalta(r.vencidas)), sub: plural(r.vencidas.length, 'deuda', 'deudas'), icono: 'alerta', tono: 'rojo' },
          { etiqueta: 'Esta semana', valor: formatearMonto(sumaFalta(r.semana)), sub: plural(r.semana.length, 'deuda', 'deudas'), icono: 'reloj', tono: 'amarillo' },
          { etiqueta: 'Pagado', valor: formatearMonto(datos.pagado_mes.monto), sub: `${plural(datos.pagado_mes.cantidad, 'pago', 'pagos')} en ${mes}`, icono: 'check', tono: 'verde' },
        ]}
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <div className="card saldos-panel">
        <div className="saldos-toolbar">
          <div className="chips" role="group" aria-label="Filtrar por vencimiento">
            {FILTROS.map((f) => (
              <button key={f.clave} type="button" className={`chip${filtro === f.clave ? ' chip-activo' : ''}`} aria-pressed={filtro === f.clave} onClick={() => setFiltro(f.clave)}>
                {f.texto}
              </button>
            ))}
          </div>
          <div className="saldos-toolbar-der">
            <input
              className="saldos-buscar"
              type="search"
              placeholder="Buscar por nombre…"
              aria-label="Buscar proveedor o concepto"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <button type="button" className="btn btn-primary" onClick={() => navigate('/saldos/nueva')}>
              <Icono nombre="mas" tam={16} />
              Cargar deuda
            </button>
          </div>
        </div>

        {r.todas.length === 0 ? (
          <div className="saldos-vacio">No hay nada pendiente de pago. Con «Cargar deuda» sumás un impuesto, un servicio o una deuda con un proveedor.</div>
        ) : filtradas.length === 0 ? (
          <div className="saldos-vacio">{texto ? 'Ninguna deuda coincide con la búsqueda.' : 'No hay deudas para este filtro.'}</div>
        ) : (
          GRUPOS.map((g) => {
            const items = filtradas.filter((x) => x.estado.clave === g.clave);
            if (items.length === 0) return null;
            return (
              <div key={g.clave} role="list" aria-label={g.texto}>
                <div className={`grupo-h grupo-h-${g.tono}`}>
                  <Icono nombre={g.icono} tam={16} />
                  {g.texto} · {formatearMonto(sumaFalta(items))}
                </div>
                {items.map((x) => (x.esBoleta ? filaBoleta(x) : filaCuenta(x)))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
