import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearMonto } from '../utils/format.js';
import { envaseEnNombre, plural } from '../utils/presentacion.js';

// "Pasar a unidad + caja" (2026-10-11): un producto viejo cargado con un envase como unidad de
// medida ("Caja x 12") cuenta, cobra y descuenta de a una caja. Este panel lo deja medido por
// unidad con la caja como pack, vendiéndose también suelto o solo por caja; el servidor
// (POST /productos/:id/pasar-a-pack) convierte el stock, los precios y las líneas viejas para
// que todo siga significando lo mismo.
export default function PasarAPack({ producto, onHecho, onCancelar }) {
  const envase = envaseEnNombre(producto.unidad_medida) ?? { nombre: 'Caja', unidades: null };
  const [datos, setDatos] = useState({
    pack_nombre: envase.nombre,
    pack_unidades: envase.unidades ? String(envase.unidades) : '',
    vende_suelto: true,
    precio_venta: '',
    codigo_es_del_pack: Boolean(producto.codigo_barras),
    codigo_barras_unidad: '',
  });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  const n = Number(datos.pack_unidades);
  const nValido = Number.isInteger(n) && n >= 2;
  const nombrePack = (datos.pack_nombre.trim() || 'caja').toLowerCase();
  const fijar = (cambios) => setDatos({ ...datos, ...cambios });

  async function convertir(e) {
    e.preventDefault();
    if (enviandoRef.current) return;
    if (!nValido || !datos.pack_nombre.trim() || (datos.vende_suelto && datos.precio_venta === '')) {
      setError(`Completá el nombre, cuántas unidades trae${datos.vende_suelto ? ' y el precio por unidad' : ''}.`);
      return;
    }
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    try {
      const actualizado = await api.post(`/productos/${producto.id}/pasar-a-pack`, {
        pack_nombre: datos.pack_nombre.trim(),
        pack_unidades: n,
        vende_suelto: datos.vende_suelto,
        ...(datos.vende_suelto ? { precio_venta: Number(datos.precio_venta) } : {}),
        codigo_es_del_pack: datos.codigo_es_del_pack,
        codigo_barras_unidad:
          datos.codigo_es_del_pack && datos.vende_suelto ? datos.codigo_barras_unidad.trim() || null : null,
      });
      onHecho(actualizado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo convertir el producto.');
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <form className="stock-pasar-pack" onSubmit={convertir}>
      <span className="stock-section-label">Pasar a unidad + {nombrePack}</span>
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
      <label className="stock-presentacion-check">
        <input type="checkbox" checked={datos.vende_suelto} onChange={(e) => fijar({ vende_suelto: e.target.checked })} />
        También se vende suelto, por unidad
      </label>
      {datos.vende_suelto && (
        <div className="field">
          <label>Precio de venta por unidad</label>
          <input
            type="number"
            min="0"
            placeholder={`por ${nombrePack}: ${formatearMonto(producto.precio_venta)}`}
            value={datos.precio_venta}
            onChange={(e) => fijar({ precio_venta: e.target.value })}
          />
        </div>
      )}
      {producto.codigo_barras && (
        <label className="stock-presentacion-check">
          <input
            type="checkbox"
            checked={datos.codigo_es_del_pack}
            onChange={(e) => fijar({ codigo_es_del_pack: e.target.checked })}
          />
          El código {producto.codigo_barras} es el del envase ({nombrePack})
        </label>
      )}
      {producto.codigo_barras && datos.codigo_es_del_pack && datos.vende_suelto && (
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
            <strong>{producto.stock_total * n} unidades</strong>
          </li>
          <li>
            Precio por {nombrePack}: <strong>{formatearMonto(producto.precio_venta)}</strong> (el que tenía)
          </li>
          {producto.precio_costo != null && (
            <li>
              {datos.vende_suelto
                ? `Costo por unidad: ${formatearMonto(Math.round(producto.precio_costo / n))}`
                : `Costo por ${nombrePack}: ${formatearMonto(producto.precio_costo)} (el que tenía)`}
            </li>
          )}
          <li>{datos.vende_suelto ? `Se vende suelto y por ${nombrePack}.` : `Se vende solo por ${nombrePack}.`}</li>
          <li>
            Las ventas anteriores quedan como «{datos.pack_nombre.trim() || 'Caja'} x {n}».
          </li>
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
