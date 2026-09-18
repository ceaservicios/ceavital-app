import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { CLIENTE_VACIO, CamposCliente, aPayload, useCondicionesPago } from './clientesEmpresaComun.jsx';
import './ClientesEmpresaPage.css';

// Alta de cliente-empresa en una página propia, con todos los campos a la
// vista (pedido del usuario 2026-09-18).
export default function ClienteEmpresaNuevoPage() {
  const navigate = useNavigate();
  const condiciones = useCondicionesPago();
  const [form, setForm] = useState(CLIENTE_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  // Guardia sincrónica contra doble submit (mismo criterio que el resto de las pantallas).
  const guardaRef = useRef(false);

  async function crear(e) {
    e.preventDefault();
    if (guardaRef.current) return;
    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      const creado = await api.post('/clientes-empresa', aPayload(form));
      navigate(`/clientes-empresa/${creado.id}`, { replace: true, state: { exito: 'Cliente creado.' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el cliente.');
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <div className="cliente-page">
      <div className="cliente-encabezado">
        <Link to="/clientes-empresa" className="cliente-volver">
          ← Volver a clientes
        </Link>
        <h1 className="cliente-h1">Nuevo cliente-empresa</h1>
      </div>

      <form className="card cliente-card cliente-form-card" onSubmit={crear}>
        {error && <div className="alert alert-danger">{error}</div>}
        <span className="cliente-seccion-titulo">Datos del cliente</span>
        <CamposCliente form={form} setForm={setForm} condiciones={condiciones} />
        <div className="cliente-acciones">
          <button type="button" className="btn" onClick={() => navigate('/clientes-empresa')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear cliente'}
          </button>
        </div>
      </form>
    </div>
  );
}
