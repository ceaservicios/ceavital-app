import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Hero from '../components/Hero.jsx';
import Icono from '../components/Icono.jsx';
import { formatearFecha, formatearMonto } from '../utils/format.js';
import { EstadoVence, estadoVence, etiquetaRepeticion, IconoTipo, REPETICIONES, TagTipo, tipoCuenta, TIPOS_CUENTA } from './saldosComun.jsx';
import './SaldosPage.css';
import './FijosPage.css';

// Fijos (2026-11-06, maqueta aprobada por el usuario): lo que se paga siempre. Acá se carga qué se
// repite, cada cuánto y por cuánto. Cada vencimiento aparece solo en Saldos pendientes y ahí se paga, en
// la misma lista que el resto de las deudas. Administrador y Encargado.

export const FRECUENCIAS = REPETICIONES.filter((r) => r.valor !== 'no');

// Cuántas veces por mes vence cada frecuencia: un anual de $ 120.000 son $ 10.000 por mes.
const VECES_POR_MES = { semanal: 52 / 12, quincenal: 2, mensual: 1, bimestral: 1 / 2, anual: 1 / 12 };

const DIAS = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

/** "Mensual, el 10", "Quincenal, el 5 y el 20", "Anual, el 15/03", "Semanal, los lunes". */
export function textoCadaCuanto({ frecuencia, desde }) {
  const dia = Number(desde.slice(8, 10));
  if (frecuencia === 'semanal') return `Semanal, los ${DIAS[new Date(`${desde}T12:00:00Z`).getUTCDay()]}`;
  if (frecuencia === 'quincenal') {
    const primero = dia > 15 ? dia - 15 : dia;
    return `Quincenal, el ${primero} y el ${primero + 15}`;
  }
  if (frecuencia === 'anual') return `Anual, el ${formatearFecha(desde).slice(0, 5)}`;
  return `${etiquetaRepeticion(frecuencia)}, el ${dia}`;
}

const porMes = (f) => Math.round((f.monto ?? 0) * VECES_POR_MES[f.frecuencia]);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

const ESTADOS = [
  { clave: 'activos', texto: 'Activos' },
  { clave: 'pausados', texto: 'Pausados' },
  { clave: 'todos', texto: 'Todos' },
];
const ORDENES = [
  { valor: 'proximo', texto: 'Próximo vencimiento' },
  { valor: 'nombre', texto: 'Nombre' },
  { valor: 'mayor', texto: 'Mayor monto' },
];

const COMPARAR = {
  proximo: (a, b) => (a.proximo ?? '9999').localeCompare(b.proximo ?? '9999'),
  nombre: (a, b) => a.concepto.localeCompare(b.concepto, 'es'),
  mayor: (a, b) => porMes(b) - porMes(a),
};

// Lo que suma por mes cada tipo, de mayor a menor. Al tocar una tarjeta, filtra la lista.
function resumenPorTipo(fijos) {
  const total = fijos.reduce((a, f) => a + porMes(f), 0);
  return TIPOS_CUENTA.map((t) => {
    const suyos = fijos.filter((f) => f.tipo === t.valor);
    const monto = suyos.reduce((a, f) => a + porMes(f), 0);
    return { ...t, monto, cantidad: suyos.length, sinMonto: suyos.filter((f) => f.monto == null).length, parte: total ? monto / total : 0 };
  })
    .filter((t) => t.cantidad > 0)
    .sort((a, b) => b.monto - a.monto);
}

export default function FijosPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [exito] = useState(location.state?.exito ?? null);
  const [estado, setEstado] = useState('activos');
  const [tipo, setTipo] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState('proximo');

  useEffect(() => {
    api
      .get('/fijos')
      .then(setDatos)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los fijos.'));
  }, []);

  const activos = useMemo(() => datos?.fijos.filter((f) => f.activo) ?? [], [datos]);
  const tipos = useMemo(() => resumenPorTipo(activos), [activos]);

  if (!datos) {
    return <div className="saldos-page">{error ? <div className="alert alert-danger">{error}</div> : <div className="cliente-vacio">Cargando…</div>}</div>;
  }

  const total = activos.reduce((a, f) => a + porMes(f), 0);
  const sinMonto = activos.filter((f) => f.monto == null).length;
  const pausados = datos.fijos.length - activos.length;
  const texto = busqueda.trim().toLocaleLowerCase('es');
  const lista = datos.fijos
    .filter((f) => (estado === 'todos' || (estado === 'activos' ? f.activo : !f.activo)) && (!tipo || f.tipo === tipo))
    .filter((f) => !texto || `${f.concepto} ${tipoCuenta(f.tipo).texto}`.toLocaleLowerCase('es').includes(texto))
    .sort(COMPARAR[orden]);

  return (
    <div className="saldos-page">
      <Hero
        etiqueta="Fijos por mes"
        valor={formatearMonto(total)}
        sub={sinMonto ? `Sin contar ${sinMonto} según factura` : 'Lo que se paga siempre'}
        minis={[
          { etiqueta: 'Vencido', valor: formatearMonto(datos.vencido.monto), sub: plural(datos.vencido.cantidad, 'sin pagar', 'sin pagar'), icono: 'alerta', tono: 'rojo' },
          { etiqueta: 'Falta este mes', valor: formatearMonto(datos.mes.monto), sub: plural(datos.mes.cantidad, 'vencimiento', 'vencimientos'), icono: 'calendario', tono: 'amarillo' },
          { etiqueta: 'Activos', valor: String(activos.length), sub: pausados ? plural(pausados, 'pausado', 'pausados') : 'Ninguno pausado', icono: 'repetir', tono: 'azul' },
        ]}
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {exito && <div className="alert alert-exito">{exito}</div>}

      <div className="fijos-tipos" role="group" aria-label="Lo que suma cada tipo por mes">
        {tipos.map((t) => (
          <button key={t.valor} type="button" className="fijos-tipo" style={{ '--c': t.color }} aria-pressed={tipo === t.valor} onClick={() => setTipo(tipo === t.valor ? '' : t.valor)}>
            <span className="fijos-tipo-nombre">
              <Icono nombre={t.icono} tam={14} />
              {t.texto}
            </span>
            <strong>{t.monto > 0 ? formatearMonto(t.monto) : 'Según factura'}</strong>
            <span className="fijos-tipo-barra" aria-hidden="true">
              <span style={{ width: `${Math.max(Math.round(t.parte * 100), 3)}%` }} />
            </span>
          </button>
        ))}
      </div>

      <div className="card saldos-panel">
        <div className="saldos-toolbar">
          <div className="chips" role="group" aria-label="Filtrar por estado">
            {ESTADOS.map((e) => (
              <button key={e.clave} type="button" className={`chip${estado === e.clave ? ' chip-activo' : ''}`} aria-pressed={estado === e.clave} onClick={() => setEstado(e.clave)}>
                {e.texto}
              </button>
            ))}
          </div>
          <div className="saldos-toolbar-der">
            <select className="fijos-orden" aria-label="Ordenar" value={orden} onChange={(e) => setOrden(e.target.value)}>
              {ORDENES.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.texto}
                </option>
              ))}
            </select>
            <input className="saldos-buscar" type="search" placeholder="Buscar por nombre…" aria-label="Buscar un fijo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            <button type="button" className="btn btn-primary" onClick={() => navigate('/fijos/nuevo')}>
              <Icono nombre="mas" tam={16} />
              Nuevo fijo
            </button>
          </div>
        </div>

        {lista.length === 0 ? (
          <div className="saldos-vacio">No hay fijos para estos filtros.</div>
        ) : (
          <div role="list" aria-label="Fijos">
            {lista.map((f) => {
              const abrir = () => navigate(`/fijos/${f.id}`);
              return (
                <div
                  key={f.id}
                  className={`saldos-fila${f.activo ? '' : ' fijos-pausado'}`}
                  role="listitem"
                  tabIndex={0}
                  onClick={abrir}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) abrir();
                  }}
                >
                  <IconoTipo tipo={f.tipo} />
                  <div className="saldos-fila-info">
                    <div className="saldos-fila-nombre">{f.concepto}</div>
                    <div className="saldos-fila-tags">
                      <TagTipo tipo={f.tipo} />
                      <span className="tag">
                        <Icono nombre="repetir" tam={12} />
                        {textoCadaCuanto(f)}
                      </span>
                      {!f.activo && <span className="tag tag-mano">Pausado</span>}
                    </div>
                  </div>
                  <div className="saldos-fila-vence">
                    {f.activo && f.proximo ? (
                      <>
                        <strong>{formatearFecha(f.proximo)}</strong>
                        <EstadoVence estado={estadoVence(f.proximo, datos.hoy)} />
                      </>
                    ) : (
                      <span className="saldos-fila-nota">Sin vencimientos</span>
                    )}
                  </div>
                  <div className="saldos-fila-monto">{f.monto == null ? <span className="saldos-fila-sin-monto">Según factura</span> : formatearMonto(f.monto)}</div>
                  <button
                    type="button"
                    className="btn-fila btn-fila-sec saldos-fila-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      abrir();
                    }}
                  >
                    Editar
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
