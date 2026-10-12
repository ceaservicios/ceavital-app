import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearMonto } from '../utils/format.js';
import { envaseEnNombre, nombreUnidadSuelta, plural } from '../utils/presentacion.js';

// "Pasar a unidad + caja" (2026-10-11): un producto cargado con un envase como unidad de
// medida ("Caja x 12") cuenta, cobra y descuenta de a una caja. Este panel lo deja con una
// unidad suelta y la caja como pack; el servidor (POST /productos/:id/pasar-a-pack) convierte
// el stock, los precios y las líneas viejas para que todo siga significando lo mismo.
export default function PasarAPack({ producto, unidades, onHecho, onCancelar }) {
  const envase = envaseEnNombre(producto.unidad_medida) ?? { nombre: 'Caja', unidades: null };
  const sueltas = unidades.filter((u) => !envaseEnNombre(u.nombre));
  const preferida = sueltas.find((u) => /^(1\s+)?unidad(es)?$/i.test(u.nombre.trim())) ?? sueltas[0];

  const [datos, setDatos] = useState({
    unidad_medida_id: preferida ? String(preferida.id) : '',
    pack_nombre: envase.nombre,
    pack_unidades: envase.unidades ? String(envase.unidades) : '',
    precio_venta: '',
    codigo_es_del_pack: Boolean(producto.codigo_barras),
    codigo_barras_unidad: '',
  });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  const n = Number(datos.pack_unidades);
  const nValido = Number.isInteger(n) && n >= 2;
  const nombrePack = datos.pack_nombre.trim() || 'caja';
  const unidadElegida = sueltas.find((u) => String(u.id) === datos.unidad_medida_id)?.nombre;
  const fijar = (cambios) => setDatos({ ...datos, ...cambios });

  async function convertir(e) {
    e.preventDefault();
    if (enviandoRef.current) return;
    if (!datos.unidad_medida_id || !nValido || datos.precio_venta === '' || !datos.pack_nombre.trim()) {
      setError('Completá la unidad suelta, cuántas trae, el nombre y el precio por unidad.');
      return;
    }
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    try {
      const actualizado = await api.post(`/productos/${producto.id}/pasar-a-pack`, {
        unidad_medida_id: Number(datos.unidad_medida_id),
        pack_nombre: datos.pack_nombre.trim(),
        pack_unidades: n,
        precio_venta: Number(datos.precio_venta),
        codigo_es_del_pack: datos.codigo_es_del_pack,
        codigo_barras_unidad: datos.codigo_es_del_pack ? datos.codigo_barras_unidad.trim() || null : null,
      });
      onHecho(actualizado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo convertir el producto.');
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  if (sueltas.length === 0) {
    return (
      <div className="stock-aviso-envase">
        <strong>Falta una unidad suelta.</strong> Creá la unidad «Unidad» en Configuración → Unidades de medida y volvé acá.
        <div>
          <button type="button" className="btn" onClick={onCancelar}>
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="stock-pasar-pack" onSubmit={convertir}>
      <span className="stock-section-label">Pasar a unidad + {nombrePack.toLowerCase()}</span>
      <div className="field">
        <label>Unidad suelta (lo más chico que se vende)</label>
        <div className="stock-unidades" role="group" aria-label="Unidad suelta">
          {sueltas.map((u) => (
            <button
              key={u.id}
              type="button"
              className={String(u.id) === datos.unidad_medida_id ? 'activo' : ''}
              aria-pressed={String(u.id) === datos.unidad_medida_id}
              onClick={() => fijar({ unidad_medida_id: String(u.id) })}
            >
              {u.nombre}
            </button>
          ))}
        </div>
      </div>
      <div className="stock-form-grid2">
        <div className="field">
          <label>Nombre del envase</label>
          <input maxLength={20} value={datos.pack_nombre} onChange={(e) => fijar({ pack_nombre: e.target.value })} />
        </div>
        <div className="field">
          <label>Unidades que trae</label>
          <input
            type="number"
            min="2"
            step="1"
            placeholder="ej: 12"
            value={datos.pack_unidades}
            onChange={(e) => fijar({ pack_unidades: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label>Precio de venta por {nombreUnidadSuelta(unidadElegida, 1)}</label>
        <input
          type="number"
          min="0"
          placeholder={nValido ? `la ${nombrePack.toLowerCase()} sale ${formatearMonto(producto.precio_venta)}` : ''}
          value={datos.precio_venta}
          onChange={(e) => fijar({ precio_venta: e.target.value })}
        />
      </div>
      {producto.codigo_barras && (
        <label className="stock-presentacion-check">
          <input
            type="checkbox"
            checked={datos.codigo_es_del_pack}
            onChange={(e) => fijar({ codigo_es_del_pack: e.target.checked })}
          />
          El código {producto.codigo_barras} es el de la {nombrePack.toLowerCase()}
        </label>
      )}
      {producto.codigo_barras && datos.codigo_es_del_pack && (
        <div className="field">
          <label>Código de la unidad suelta</label>
          <input
            placeholder="Opcional"
            value={datos.codigo_barras_unidad}
            onChange={(e) => fijar({ codigo_barras_unidad: e.target.value })}
          />
        </div>
      )}
      {nValido && (
        <ul className="stock-pasar-resumen">
          <li>
            Stock: {producto.stock_total} {plural(nombrePack, producto.stock_total)} →{' '}
            <strong>
              {producto.stock_total * n} {nombreUnidadSuelta(unidadElegida, producto.stock_total * n)}
            </strong>
          </li>
          <li>
            Precio de la {nombrePack.toLowerCase()}: <strong>{formatearMonto(producto.precio_venta)}</strong> (el que tenía)
          </li>
          {producto.precio_costo != null && (
            <li>
              Costo por {nombreUnidadSuelta(unidadElegida, 1)}: {formatearMonto(Math.round(producto.precio_costo / n))}
            </li>
          )}
          <li>Las ventas anteriores quedan como «{nombrePack} x {n}».</li>
        </ul>
      )}
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="stock-pasar-acciones">
        <button type="button" className="btn" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? 'Convirtiendo…' : 'Convertir'}
        </button>
      </div>
    </form>
  );
}
