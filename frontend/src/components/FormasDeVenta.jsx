import {
  esFraccionable,
  formatearCantidad,
  MEDIDAS,
  parsearCantidad,
  plural,
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
// - precio por cantidad dentro de cada forma de venta (pedido del usuario: "+10 pack puede tener
//   oferta"): el del suelto, desde N unidades/kg; el del pack, desde N packs (migración 020).
// Los campos son texto (en kg se tipea "0,350"); formasParaApi los pasa a la medida chica.

export const FORMAS_VACIAS = {
  medida: 'unidad',
  suelto: { activo: true, precio: '', costo: '' },
  pack: { activo: false, nombre: 'Caja', cantidad: '', precio: '', costo: '', codigo_barras: '' },
  precioCantidad: { activo: false, desde: '', precio: '' },
  packCantidad: { activo: false, desde: '', precio: '' },
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
    packCantidad:
      p.pack_cantidad_desde != null
        ? { activo: true, desde: texto(p.pack_cantidad_desde), precio: texto(p.precio_pack_cantidad) }
        : { ...FORMAS_VACIAS.packCantidad },
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
          precio_cantidad: v.packCantidad.activo
            ? { desde: parsearCantidad(v.packCantidad.desde, 'unidad'), precio: Number(v.packCantidad.precio) }
            : null,
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
  if (!v.suelto.activo && !v.pack.activo) return 'Elegí al menos una forma de venta: suelto o por caja o pack.';
  if (v.suelto.activo && v.suelto.precio === '') return `Completá el precio de venta ${porMedida(v.medida)}.`;
  if (v.suelto.activo && conCosto && v.suelto.costo === '') return `Completá el costo ${porMedida(v.medida)}.`;
  if (v.suelto.activo && v.precioCantidad.activo) {
    const desde = parsearCantidad(v.precioCantidad.desde, v.medida);
    if (!desde || (!esFraccionable(v.medida) && desde < 2) || v.precioCantidad.precio === '') {
      return `Completá la cantidad mínima y el precio por cantidad de la venta suelta.`;
    }
  }
  if (v.pack.activo) {
    if (!v.pack.nombre.trim()) return 'Completá el nombre de la caja o pack.';
    const cantidad = parsearCantidad(v.pack.cantidad, v.medida);
    if (!cantidad || (!esFraccionable(v.medida) && cantidad < 2)) {
      return esFraccionable(v.medida)
        ? `Completá el contenido por ${nombrePack} (en ${simboloMedida(v.medida)}).`
        : `Completá las unidades por ${nombrePack} (2 o más).`;
    }
    if (v.pack.precio === '') return `Completá el precio por ${nombrePack}.`;
    if (!v.suelto.activo && conCosto && v.pack.costo === '') return `Completá el costo por ${nombrePack}.`;
    if (v.packCantidad.activo) {
      const desde = parsearCantidad(v.packCantidad.desde, 'unidad');
      if (!desde || desde < 2 || v.packCantidad.precio === '') {
        return `Completá la cantidad mínima (2 o más) y el precio por cantidad de la venta por ${nombrePack}.`;
      }
    }
  }
  return null;
}

/**
 * Campo con su unidad dentro del recuadro: "$" adelante y "por unidad", "kg", "unidades" o
 * "días" atrás (rediseño 2026-10-29: la unidad ya no va en un segundo renglón del título, así
 * los campos de una fila quedan a la misma altura). Lo usan también el alta y la ficha.
 */
export function ConUnidad({ prefijo, sufijo, children }) {
  return (
    <div className="stock-input">
      {prefijo && <span className="stock-input-prefijo">{prefijo}</span>}
      {children}
      {sufijo && <span className="stock-input-sufijo">{sufijo}</span>}
    </div>
  );
}

function Campo({ label, prefijo, sufijo, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {prefijo || sufijo ? (
        <ConUnidad prefijo={prefijo} sufijo={sufijo}>
          {children}
        </ConUnidad>
      ) : (
        children
      )}
    </div>
  );
}

// Precio por cantidad de una forma de venta: cantidad mínima y precio desde ahí (toda la línea).
function PrecioPorCantidad({ valor, onFijar, editable, unidadCantidad, porQue, decimal }) {
  return (
    <div className="stock-precio-cantidad">
      <label className="stock-presentacion-check">
        <input
          type="checkbox"
          disabled={!editable}
          checked={valor.activo}
          onChange={(e) => onFijar({ activo: e.target.checked })}
        />
        <span>
          Precio por cantidad
          <span className="stock-label-unidad">Precio diferencial a partir de una cantidad mínima</span>
        </span>
      </label>
      {valor.activo && (
        <div className="formas-campos">
          <Campo label="Cantidad mínima" sufijo={unidadCantidad}>
            <input
              type="text"
              inputMode={decimal ? 'decimal' : 'numeric'}
              disabled={!editable}
              placeholder="Ej.: 10"
              value={valor.desde}
              onChange={(e) => onFijar({ desde: e.target.value })}
            />
          </Campo>
          <Campo label="Precio" prefijo="$" sufijo={porQue}>
            <input
              type="number"
              min="0"
              disabled={!editable}
              value={valor.precio}
              onChange={(e) => onFijar({ precio: e.target.value })}
            />
          </Campo>
        </div>
      )}
    </div>
  );
}

/**
 * `editablePrecios`: alta, o edición del Admin. `verCosto`: alta, o Admin.
 * `medidaBloqueada`: texto del motivo si la medida no se puede cambiar (ya tiene stock o ventas).
 */
export default function FormasDeVenta({ valor, onChange, editablePrecios, verCosto, medidaBloqueada = null }) {
  const { medida, suelto, pack, precioCantidad, packCantidad } = valor;
  const fijar = (parte, cambios) => onChange({ ...valor, [parte]: { ...valor[parte], ...cambios } });
  const fraccion = esFraccionable(medida);
  const nombrePack = pack.nombre.trim().toLowerCase() || (fraccion ? 'bolsa' : 'caja');
  const cantidadPack = parsearCantidad(pack.cantidad, medida);

  function cambiarMedida(nueva) {
    if (nueva === medida) return;
    // Lo que trae el pack y el "desde" del suelto cambian de sentido con la medida: se vacían.
    onChange({
      ...valor,
      medida: nueva,
      pack: { ...pack, cantidad: '', nombre: pack.activo ? pack.nombre : esFraccionable(nueva) ? 'Bolsa' : 'Caja' },
      precioCantidad: { ...precioCantidad, desde: '' },
    });
  }

  const costoOculto = (
    <Campo label="Costo">
      <div className="stock-campo-oculto">No disponible para tu rol</div>
    </Campo>
  );

  return (
    <div className="formas-venta">
      {/* Arriba, lado a lado: cómo se mide (selector segmentado) y cómo se vende (una o las
          dos); abajo, solo los campos de lo elegido (rediseño 2026-10-29). */}
      <div className="formas-eleccion">
        <div className="field">
          <label>Unidad de medida</label>
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
          <label>Formas de venta</label>
          <div className="formas-opciones" role="group" aria-label="Cómo se vende">
            <label className={`formas-opcion${suelto.activo ? ' activo' : ''}`}>
              <input
                type="checkbox"
                disabled={!editablePrecios}
                checked={suelto.activo}
                onChange={(e) => fijar('suelto', { activo: e.target.checked })}
              />
              Suelto ({porMedida(medida)})
            </label>
            <label className={`formas-opcion${pack.activo ? ' activo' : ''}`}>
              <input
                type="checkbox"
                disabled={!editablePrecios}
                checked={pack.activo}
                onChange={(e) => fijar('pack', { activo: e.target.checked })}
              />
              Por {fraccion ? 'bolsa o envase cerrado' : 'caja o pack'}
            </label>
          </div>
          <span className="stock-hint">{!suelto.activo && !pack.activo ? 'Elegí al menos una.' : 'Una o las dos.'}</span>
        </div>
      </div>

      {suelto.activo && (
        <div className="stock-presentacion">
          <span className="formas-seccion-titulo">Venta suelta</span>
          <div className="formas-campos">
            <Campo label="Precio de venta" prefijo="$" sufijo={porMedida(medida)}>
              <input
                type="number"
                min="0"
                disabled={!editablePrecios}
                value={suelto.precio}
                onChange={(e) => fijar('suelto', { precio: e.target.value })}
              />
            </Campo>
            {verCosto ? (
              <Campo label="Costo" prefijo="$" sufijo={porMedida(medida)}>
                <input
                  type="number"
                  min="0"
                  disabled={!editablePrecios}
                  value={suelto.costo}
                  onChange={(e) => fijar('suelto', { costo: e.target.value })}
                />
              </Campo>
            ) : (
              costoOculto
            )}
          </div>
          <PrecioPorCantidad
            valor={precioCantidad}
            onFijar={(c) => fijar('precioCantidad', c)}
            editable={editablePrecios}
            unidadCantidad={fraccion ? simboloMedida(medida) : 'unidades'}
            porQue={porMedida(medida)}
            decimal={fraccion}
          />
        </div>
      )}

      {pack.activo && (
        <div className="stock-presentacion">
          <span className="formas-seccion-titulo">Venta por {nombrePack}</span>
          <div className="formas-campos">
            <Campo label="Nombre del envase">
              <input
                maxLength={20}
                disabled={!editablePrecios}
                placeholder={fraccion ? 'Bolsa, Horma…' : 'Caja, Pack, Bulto…'}
                value={pack.nombre}
                onChange={(e) => fijar('pack', { nombre: e.target.value })}
              />
            </Campo>
            <Campo
              label={fraccion ? `Contenido por ${nombrePack}` : `Unidades por ${nombrePack}`}
              sufijo={fraccion ? simboloMedida(medida) : 'unidades'}
            >
              <input
                type="text"
                inputMode={fraccion ? 'decimal' : 'numeric'}
                disabled={!editablePrecios}
                placeholder={fraccion ? 'Ej.: 15' : 'Ej.: 12'}
                value={pack.cantidad}
                onChange={(e) => fijar('pack', { cantidad: e.target.value })}
              />
            </Campo>
            <Campo label="Precio de venta" prefijo="$" sufijo={`por ${nombrePack}`}>
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
                <Campo label="Costo" prefijo="$" sufijo={`por ${nombrePack}`}>
                  <input
                    type="number"
                    min="0"
                    disabled={!editablePrecios}
                    value={pack.costo}
                    onChange={(e) => fijar('pack', { costo: e.target.value })}
                  />
                </Campo>
              ) : (
                costoOculto
              ))}
            <Campo label="Código de barras del envase">
              <input
                disabled={!editablePrecios}
                placeholder="Opcional"
                value={pack.codigo_barras}
                onChange={(e) => fijar('pack', { codigo_barras: e.target.value })}
              />
            </Campo>
          </div>
          {cantidadPack && (
            <span className="stock-cuenta">
              1 {nombrePack} = <strong>{formatearCantidad(cantidadPack, medida)}</strong>. Cada venta por {nombrePack} descuenta esa
              cantidad del stock.
            </span>
          )}
          <PrecioPorCantidad
            valor={packCantidad}
            onFijar={(c) => fijar('packCantidad', c)}
            editable={editablePrecios}
            unidadCantidad={plural(nombrePack, 2)}
            porQue={`por ${nombrePack}`}
            decimal={false}
          />
        </div>
      )}
      {!editablePrecios && <span className="stock-hint">Solo el Administrador puede modificar precios y formas de venta.</span>}
    </div>
  );
}
