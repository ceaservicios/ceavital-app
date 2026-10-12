// Casillas "También se vende en pack o caja" y "Precio especial por cantidad"
// del alta y la edición de un producto (2026-10-11, modelo de ProductoForm de Somnia, con
// los precios en el producto porque CEAVital no tiene listas de precios).

export const PRESENTACION_VACIA = {
  pack: { activo: false, nombre: 'Pack', unidades: '', precio: '', codigo_barras: '' },
  precioCantidad: { activo: false, desde: '', precio: '' },
};

export function presentacionDesdeProducto(p) {
  return {
    pack: p.pack_nombre
      ? {
          activo: true,
          nombre: p.pack_nombre,
          unidades: String(p.pack_unidades),
          precio: String(p.precio_pack),
          codigo_barras: p.codigo_barras_pack ?? '',
        }
      : { ...PRESENTACION_VACIA.pack },
    precioCantidad:
      p.precio_cantidad_desde != null
        ? { activo: true, desde: String(p.precio_cantidad_desde), precio: String(p.precio_cantidad) }
        : { ...PRESENTACION_VACIA.precioCantidad },
  };
}

/** Lo que se manda a la API: { pack, precio_cantidad }, cada uno null o un objeto. */
export function presentacionParaApi(valor) {
  return {
    pack: valor.pack.activo
      ? {
          nombre: valor.pack.nombre.trim(),
          unidades: Number(valor.pack.unidades),
          precio: Number(valor.pack.precio),
          codigo_barras: valor.pack.codigo_barras.trim() || null,
        }
      : null,
    precio_cantidad: valor.precioCantidad.activo
      ? { desde: Number(valor.precioCantidad.desde), precio: Number(valor.precioCantidad.precio) }
      : null,
  };
}

/** Mensaje si falta algo obligatorio de una casilla marcada (el servidor también lo valida). */
export function faltaEnPresentacion(valor) {
  if (valor.pack.activo && (!valor.pack.nombre.trim() || valor.pack.unidades === '' || valor.pack.precio === '')) {
    return 'Completá el nombre, las unidades que trae y el precio del pack.';
  }
  if (valor.precioCantidad.activo && (valor.precioCantidad.desde === '' || valor.precioCantidad.precio === '')) {
    return 'Completá desde cuántas unidades y el precio por cantidad.';
  }
  return null;
}

export default function PresentacionCampos({ valor, onChange, editable, unidadNombre }) {
  const { pack, precioCantidad } = valor;
  const unidad = (unidadNombre || 'unidad').toLowerCase();
  const fijarPack = (cambios) => onChange({ ...valor, pack: { ...pack, ...cambios } });
  const fijarPc = (cambios) => onChange({ ...valor, precioCantidad: { ...precioCantidad, ...cambios } });

  return (
    <>
      <div className="stock-presentacion">
        {/* La cantidad que trae va en la misma frase, para que se lea como una presentación
            extra del producto y no como otra unidad de medida. */}
        <div className="stock-presentacion-fila">
          <label className="stock-presentacion-check">
            <input
              type="checkbox"
              disabled={!editable}
              checked={pack.activo}
              onChange={(e) => fijarPack({ activo: e.target.checked })}
            />
            {pack.activo
              ? `También se vende en ${(pack.nombre.trim() || 'pack').toLowerCase()}`
              : 'También se vende en pack o caja'}
          </label>
          {pack.activo && (
            <span className="stock-presentacion-check">
              de
              <input
                className="stock-presentacion-cantidad"
                required
                type="number"
                min="2"
                step="1"
                disabled={!editable}
                placeholder="24"
                aria-label="Unidades que trae el pack"
                value={pack.unidades}
                onChange={(e) => fijarPack({ unidades: e.target.value })}
              />
              unidades
            </span>
          )}
        </div>
        {pack.activo && (
          <>
            <div className="stock-form-grid2">
              <div className="field">
                <label>Nombre</label>
                <input
                  required
                  maxLength={20}
                  disabled={!editable}
                  placeholder="Pack, Caja, Bulto…"
                  value={pack.nombre}
                  onChange={(e) => fijarPack({ nombre: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Precio del pack</label>
                <input
                  required
                  type="number"
                  min="0"
                  disabled={!editable}
                  value={pack.precio}
                  onChange={(e) => fijarPack({ precio: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Código del pack</label>
                <input
                  disabled={!editable}
                  placeholder="Opcional"
                  value={pack.codigo_barras}
                  onChange={(e) => fijarPack({ codigo_barras: e.target.value })}
                />
              </div>
            </div>
            <span className="stock-hint">
              En Caja se elige si va por {unidad} o por pack; escaneando el código del pack entra un pack. Vender un pack
              descuenta del stock las unidades que trae.
            </span>
          </>
        )}
      </div>

      <div className="stock-presentacion">
        <label className="stock-presentacion-check">
          <input
            type="checkbox"
            disabled={!editable}
            checked={precioCantidad.activo}
            onChange={(e) => fijarPc({ activo: e.target.checked })}
          />
          Precio especial por cantidad (ej: desde 3, $500 c/u)
        </label>
        {precioCantidad.activo && (
          <>
            <div className="stock-form-grid2">
              <div className="field">
                <label>A partir de</label>
                <input
                  required
                  type="number"
                  min="2"
                  step="1"
                  disabled={!editable}
                  value={precioCantidad.desde}
                  onChange={(e) => fijarPc({ desde: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Precio por {unidad}</label>
                <input
                  required
                  type="number"
                  min="0"
                  disabled={!editable}
                  value={precioCantidad.precio}
                  onChange={(e) => fijarPc({ precio: e.target.value })}
                />
              </div>
            </div>
            <span className="stock-hint">
              Si en una venta lleva {Number(precioCantidad.desde) || 'esa cantidad'} o más de este producto, cada uno sale
              a este precio. Otros productos no suman para llegar.{pack.activo ? ' Vale para la venta por unidad, no por pack.' : ''}
            </span>
          </>
        )}
      </div>
      {!editable && (pack.activo || precioCantidad.activo) && (
        <span className="stock-hint">Solo el Admin puede cambiar el pack y los precios ya cargados.</span>
      )}
    </>
  );
}
