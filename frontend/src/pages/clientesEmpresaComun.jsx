import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export const CLIENTE_VACIO = {
  razon_social: '',
  cuit: '',
  contacto_nombre: '',
  telefono: '',
  email: '',
  direccion: '',
  condicion_pago_id: '',
};

export function aFormulario(cliente) {
  return {
    razon_social: cliente.razon_social,
    cuit: cliente.cuit ?? '',
    contacto_nombre: cliente.contacto_nombre ?? '',
    telefono: cliente.telefono ?? '',
    email: cliente.email ?? '',
    direccion: cliente.direccion ?? '',
    condicion_pago_id: cliente.condicion_pago_id != null ? String(cliente.condicion_pago_id) : '',
  };
}

const idONull = (valor) => (valor === '' ? null : Number(valor));

export function aPayload(form) {
  return {
    razon_social: form.razon_social,
    cuit: form.cuit || null,
    contacto_nombre: form.contacto_nombre || null,
    telefono: form.telefono || null,
    email: form.email || null,
    direccion: form.direccion || null,
    condicion_pago_id: idONull(form.condicion_pago_id),
  };
}

// Convención de signo (Docs/Modelo-de-Datos.md): saldo positivo = el cliente
// le debe al negocio, negativo = tiene saldo a favor.
export function estadoSaldo(saldo) {
  if (saldo > 0) return { clave: 'debe', texto: 'Debe' };
  if (saldo < 0) return { clave: 'favor', texto: 'A favor' };
  return { clave: 'aldia', texto: 'Al día' };
}

export function useCondicionesPago() {
  const [condiciones, setCondiciones] = useState([]);
  useEffect(() => {
    api
      .get('/condiciones-pago')
      .then((data) => setCondiciones(data.items))
      .catch(() => setCondiciones([]));
  }, []);
  return condiciones;
}

// La condición de pago se elige de un catálogo que el Admin gestiona en
// Configuración. Si la condición del cliente se dio de baja después, se sigue
// mostrando (marcada) en vez de dejar el select en blanco y perderla sin
// querer al guardar.
function SelectCondicionPago({ value, onChange, condiciones, nombreActual }) {
  const idActual = idONull(value);
  const dadaDeBaja = idActual !== null && !condiciones.some((c) => c.id === idActual);
  return (
    <>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Sin condición de pago</option>
        {dadaDeBaja && (
          <option value={value}>{nombreActual ? `${nombreActual} (ya no disponible)` : `#${idActual} (ya no disponible)`}</option>
        )}
        {condiciones.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
      {condiciones.length === 0 && (
        <span className="cliente-hint">Todavía no hay opciones. El Administrador las carga en Configuración → Condiciones de pago.</span>
      )}
    </>
  );
}

// Formulario con TODOS los campos del cliente, compartido por el alta y la
// edición para que se vean y se ordenen igual en las dos páginas.
export function CamposCliente({ form, setForm, condiciones, nombreCondicionActual }) {
  const set = (campo) => (e) => setForm({ ...form, [campo]: e.target.value });
  return (
    <div className="cliente-campos">
      <div className="field cliente-campo-full">
        <label>Razón social *</label>
        <input required value={form.razon_social} onChange={set('razon_social')} />
      </div>
      <div className="field">
        <label>CUIT</label>
        <input placeholder="30-12345678-9" value={form.cuit} onChange={set('cuit')} />
      </div>
      <div className="field">
        <label>Condición de pago</label>
        <SelectCondicionPago
          value={form.condicion_pago_id}
          onChange={(v) => setForm({ ...form, condicion_pago_id: v })}
          condiciones={condiciones}
          nombreActual={nombreCondicionActual}
        />
      </div>
      <div className="field">
        <label>Persona de contacto</label>
        <input value={form.contacto_nombre} onChange={set('contacto_nombre')} />
      </div>
      <div className="field">
        <label>Teléfono</label>
        <input value={form.telefono} onChange={set('telefono')} />
      </div>
      <div className="field">
        <label>Email</label>
        <input type="email" value={form.email} onChange={set('email')} />
      </div>
      <div className="field">
        <label>Dirección</label>
        <input value={form.direccion} onChange={set('direccion')} />
      </div>
    </div>
  );
}
