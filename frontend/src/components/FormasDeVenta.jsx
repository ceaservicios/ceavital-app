import {
  esFraccionable,
  formatearCantidad,
  MEDIDAS,
  parsearCantidad,
  porMedida,
  simboloMedida,
  textoDeCantidad,
} from '../utils/presentacion.js';

// "¿Cómo se mide?" y "¿Cómo se vende?" del alta y la edición de un producto (2026-10-11,
// decisiones del usuario: "unidad y pack tienen que ser formas opcionales", "no todo se vende
// por unidad", "¿cuando es por kg cómo sería?"):
// - medida fija: por unidad, por peso (kg) o por litro;
// - formas de venta opcionales (al menos una): suelto (precio y costo por unidad/kg/litro) y
//   por caja/pack/bolsa (trae N, precio, código; si no se vende suelto, también su costo);
// - precio especial por cantidad, solo para el suelto.
// Los campos son texto (en kg se tipea "0,350"); formasParaApi los pasa a la medida chica.

export const FORMAS_VACIAS = {
  medida: 'unidad',
  suelto: { activo: true, precio: '', costo: '' },
  pack: { activo: false, nombre: 'Caja', cantidad: '', precio: '', costo: '', codigo_barras: '' },
  precioCantidad: { activo: false, desde: '', precio: '' },
};

const texto = (valor) => (valor == null ? '' : String(valor));

export function formasDesdeProducto(p) {
  const medida = p.medida ?? 'unidad';
  const suelto = p.vende_suelto !== false;
  return {
    medida,
    suelto: { activo: suelto, precio: suelto ? texto(p.precio_venta) : '', costo: suelto ? texto(p.precio_costo) : '' },
    pack: p.pack_nombre
      ? {
          activo: true,
          nombre: p.pack_nombre,
          cantidad: textoDeCantidad(p.pack_unidades, medida),
          precio: texto(p.precio_pack),
          costo: texto(p.costo_pack),
          codigo_barras: p.codigo_barras_pack ?? '',
        }
      : { ...FORMAS_VACIAS.pack, nombre: medida === 'unidad' ? 'Caja' : 'Bolsa' },
    precioCantidad:
      p.precio_cantidad_desde != null
        ? { activo: true, desde: textoDeCantidad(p.precio_cantidad_desde, medida), precio: texto(p.precio_cantidad) }
        : { ...FORMAS_VACIAS.precioCantidad },
  };
}

/** Lo que va a la API. `conCosto`: si se mandan los costos (en la edición, solo el Admin). */
export function formasParaApi(v, { conCosto = true } = {}) {
  const suelto = v.suelto.activo;
  return {
    medida: v.medida,
    vende_suelto: suelto,
    ...(suelto ? { precio_venta: Number(v.suelto.precio) } : {}),
    ...(suelto && conCosto ? { precio_costo: Number(v.suelto.costo) } : {}),
    pack: v.pack.activo
      ? {
          nombre: v.pack.nombre.trim(),
          unidades: parsearCantidad(v.pack.cantidad, v.medida),
          precio: Number(v.pack.precio),
          codigo_barras: v.pack.codigo_barras.trim() || null,
          ...(!suelto && conCosto ? { costo: Number(v.pack.costo) } : {}),
        }
      : null,
    precio_cantidad:
      suelto && v.precioCantidad.activo
        ? { desde: parsearCantidad(v.precioCantidad.desde, v.medida), precio: Number(v.precioCantidad.precio) }
        : null,
  };
}

/** Mensaje si falta algo (el servidor también lo valida). */
export function faltaEnFormas(v, { conCosto = true } = {}) {
  const nombrePack = v.pack.nombre.trim().toLowerCase() || 'caja';
  if (!v.suelto.activo && !v.pack.activo) return 'Elegí al menos una forma de venta: suelto o por caja/pack.';
  if (v.suelto.activo && v.suelto.precio === '') return `Completá el precio de venta ${porMedida(v.medida)}.`;
  if (v.suelto.activo && conCosto && v.suelto.costo === '') return `Completá el costo ${porMedida(v.medida)}.`;
  if (v.pack.activo) {
    if (!v.pack.nombre.trim()) return 'Completá el nombre de la caja o pack.';
    const cantidad = parsearCantidad(v.pack.cantidad, v.medida);
    if (!cantidad || (!esFraccionable(v.medida) && cantidad < 2)) {
      return esFraccionable(v.medida)
        ? `Completá cuánto trae cada ${nombrePack} (en ${simboloMedida(v.medida)}).`
        : `Completá cuántas unidades trae cada ${nombrePack} (2 o más).`;
    }
    if (v.pack.precio === '') return `Completá el precio por ${nombrePack}.`;
    if (!v.suelto.activo && conCosto && v.pack.costo === '') return `Completá el costo por ${nombrePack}.`;
  }
  if (v.suelto.activo && v.precioCantidad.activo) {
    if (!parsearCantidad(v.precioCantidad.desde, v.medida) || v.precioCantidad.precio === '') {
      return 'Completá desde cuánto y el precio especial por cantidad.';
    }
  }
  return null;
}

function Campo({ label, ayuda, children }) {
  return (
    <div className="field">
      <label>
        {label}
        {ayuda && <span className="stock-label-unidad">{ayuda}</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * `editablePrecios`: alta, o edición del Admin. `verCosto`: alta, o Admin.
 * `medidaBloqueada`: texto del motivo si la medida no se puede cambiar (ya tiene stock o ventas).
 */
export default function FormasDeVenta({ valor, onChange, editablePrecios, verCosto, medidaBloqueada = null }) {
  const { medida, suelto, pack, precioCantidad } = valor;
  const fijar = (parte, cambios) => onChange({ ...valor, [parte]: { ...valor[parte], ...cambios } });
  const fraccion = esFraccionable(medida);
  const nombrePack = pack.nombre.trim().toLowerCase() || (fraccion ? 'bolsa' : 'caja');
  const cantidadPack = parsearCantidad(pack.cantidad, medida);

  function cambiarMedida(nueva) {
    if (nueva === medida) return;
    // Lo que trae el pack y el "desde" cambian de sentido con la medida: se vacían.
    onChange({
      ...valor,
      medida: nueva,
      pack: { ...pack, cantidad: '', nombre: pack.activo ? pack.nombre : esFraccionable(nueva) ? 'Bolsa' : 'Caja' },
      precioCantidad: { ...precioCantidad, desde: '' },
    });
  }

  return (
    <div className="formas-venta">
      <div className="field">
        <label>¿Cómo se mide?</label>
        <div className="stock-unidades" role="group" aria-label="Cómo se mide">
          {MEDIDAS.map((m) => (
            <button
              key={m.valor}
              type="button"
              className={m.valor === medida ? 'activo' : ''}
              aria-pressed={m.valor === medida}
              disabled={Boolean(medidaBloqueada) || !editablePrecios}
              onClick={() => cambiarMedida(m.valor)}
            >
              {m.texto}
            </button>
          ))}
        </div>
        <span className="stock-hint">{medidaBloqueada ?? MEDIDAS.find((m) => m.valor === medida)?.ayuda}</span>
      </div>

      <div className="field">
        <label>¿Cómo se vende? (una o las dos)</label>
      </div>

      <div className={`stock-presentacion${suelto.activo ? ' stock-presentacion-activa' : ''}`}>
        <label className="stock-presentacion-check">
          <input
            type="checkbox"
            disabled={!editablePrecios}
            checked={suelto.activo}
            onChange={(e) => fijar('suelto', { activo: e.target.checked })}
          />
          Suelto, {porMedida(medida)}
        </label>
        {suelto.activo && (
          <div className="stock-form-grid2">
            <Campo label="Precio de venta" ayuda={porMedida(medida)}>
              <input
                type="number"
                min="0"
                disabled={!editablePrecios}
                value={suelto.precio}
                onChange={(e) => fijar('suelto', { precio: e.target.value })}
              />
            </Campo>
            {verCosto ? (
              <Campo label="Costo" ayuda={porMedida(medida)}>
                <input
                  type="number"
                  min="0"
                  disabled={!editablePrecios}
                  value={suelto.costo}
                  onChange={(e) => fijar('suelto', { costo: e.target.value })}
                />
              </Campo>
            ) : (
              <Campo label="Costo">
                <div className="stock-campo-oculto">No disponible para tu rol</div>
              </Campo>
            )}
          </div>
        )}
      </div>

      <div className={`stock-presentacion${pack.activo ? ' stock-presentacion-activa' : ''}`}>
        <label className="stock-presentacion-check">
          <input
            type="checkbox"
            disabled={!editablePrecios}
            checked={pack.activo}
            onChange={(e) => fijar('pack', { activo: e.target.checked })}
          />
          Por {fraccion ? 'bolsa, caja o envase cerrado' : 'caja o pack'}
        </label>
        {pack.activo && (
          <>
            <div className="stock-form-grid2">
              <Campo label="Nombre">
                <input
                  maxLength={20}
                  disabled={!editablePrecios}
                  placeholder={fraccion ? 'Bolsa, Horma…' : 'Caja, Pack, Bulto…'}
                  value={pack.nombre}
                  onChange={(e) => fijar('pack', { nombre: e.target.value })}
                />
              </Campo>
              <Campo label="Trae" ayuda={fraccion ? simboloMedida(medida) : 'unidades'}>
                <input
                  type="text"
                  inputMode={fraccion ? 'decimal' : 'numeric'}
                  disabled={!editablePrecios}
                  placeholder={fraccion ? 'ej: 15' : 'ej: 12'}
                  value={pack.cantidad}
                  onChange={(e) => fijar('pack', { cantidad: e.target.value })}
                />
              </Campo>
            </div>
            <div className="stock-form-grid2">
              <Campo label="Precio de venta" ayuda={`por ${nombrePack}`}>
                <input
                  type="number"
                  min="0"
                  disabled={!editablePrecios}
                  value={pack.precio}
                  onChange={(e) => fijar('pack', { precio: e.target.value })}
                />
              </Campo>
              {!suelto.activo &&
                (verCosto ? (
                  <Campo label="Costo" ayuda={`por ${nombrePack}`}>
                    <input
                      type="number"
                      min="0"
                      disabled={!editablePrecios}
                      value={pack.costo}
                      onChange={(e) => fijar('pack', { costo: e.target.value })}
                    />
                  </Campo>
                ) : (
                  <Campo label="Costo">
                    <div className="stock-campo-oculto">No disponible para tu rol</div>
                  </Campo>
                ))}
            </div>
            <Campo label="Código de barras" ayuda={`de cada ${nombrePack} (opcional)`}>
              <input
                disabled={!editablePrecios}
                placeholder="Opcional"
                value={pack.codigo_barras}
                onChange={(e) => fijar('pack', { codigo_barras: e.target.value })}
              />
            </Campo>
            {cantidadPack && (
              <span className="stock-cuenta">
                1 {nombrePack} = <strong>{formatearCantidad(cantidadPack, medida)}</strong>. Cada venta por {nombrePack} descuenta eso
                del stock.
              </span>
            )}
          </>
        )}
      </div>

      {suelto.activo && (
        <div className={`stock-presentacion${precioCantidad.activo ? ' stock-presentacion-activa' : ''}`}>
          <label className="stock-presentacion-check">
            <input
              type="checkbox"
              disabled={!editablePrecios}
              checked={precioCantidad.activo}
              onChange={(e) => fijar('precioCantidad', { activo: e.target.checked })}
            />
            Precio especial por cantidad (ej: desde {fraccion ? `3 ${simboloMedida(medida)}` : '3'}, más barato)
          </label>
          {precioCantidad.activo && (
            <div className="stock-form-grid2">
              <Campo label="A partir de" ayuda={fraccion ? simboloMedida(medida) : 'unidades'}>
                <input
                  type="text"
                  inputMode={fraccion ? 'decimal' : 'numeric'}
                  disabled={!editablePrecios}
                  value={precioCantidad.desde}
                  onChange={(e) => fijar('precioCantidad', { desde: e.target.value })}
                />
              </Campo>
              <Campo label="Precio" ayuda={porMedida(medida)}>
                <input
                  type="number"
                  min="0"
                  disabled={!editablePrecios}
                  value={precioCantidad.precio}
                  onChange={(e) => fijar('precioCantidad', { precio: e.target.value })}
                />
              </Campo>
            </div>
          )}
        </div>
      )}
      {!editablePrecios && <span className="stock-hint">Solo el Admin puede cambiar los precios y las formas de venta.</span>}
    </div>
  );
}
