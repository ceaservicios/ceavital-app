import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { aPayloadProveedor, CamposProveedor, PROVEEDOR_VACIO } from './proveedoresComun.jsx';
import './ClientesEmpresaPage.css';
import './ProveedoresPage.css';

// Alta de proveedor en una página propia (2026-10-28; antes un panel al costado de la lista).
export default function ProveedorNuevoPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(PROVEEDOR_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  // Guardia sincrónica contra doble submit (con dos clicks se creaba el proveedor duplicado).
  const guardaRef = useRef(false);

  async function crear(e) {
    e.preventDefault();
    if (guardaRef.current) return;
    guardaRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      const creado = await api.post('/proveedores', aPayloadProveedor(form));
      navigate(`/proveedores/${creado.id}`, { replace: true, state: { exito: 'Proveedor creado.' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el proveedor.');
      guardaRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <div className="cliente-page">
      <div className="cliente-encabezado">
        <Link to="/proveedores" className="cliente-volver">
          ← Volver a proveedores
        </Link>
        <h1 className="cliente-h1">Nuevo proveedor</h1>
      </div>

      <form className="card cliente-card cliente-form-card" onSubmit={crear}>
        {error && <div className="alert alert-danger">{error}</div>}
        <span className="cliente-seccion-titulo">Datos del proveedor</span>
        <CamposProveedor form={form} setForm={setForm} />
        <div className="cliente-acciones">
          <button type="button" className="btn" onClick={() => navigate('/proveedores')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear proveedor'}
          </button>
        </div>
      </form>
    </div>
  );
}
