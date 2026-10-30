import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { etiquetaRol, iniciales } from '../constants/roles.js';
import ConfigurarDosfa from '../components/ConfigurarDosfa.jsx';
import './CuentaPage.css';

// "Mi cuenta": contraseña propia y, para el Admin, la verificación en dos pasos (obligatoria, EST-01
// §4, salvo que CEA se la desactive). Con algo pendiente (contraseña provisoria o Admin sin 2FA) es
// la única pantalla a la que se puede entrar hasta resolverlo (RequireAuth).
// Rediseño 2026-10-29: encabezado con los datos de la persona y, debajo, una tarjeta por tema con el
// título y la explicación a la izquierda y el formulario a la derecha (igual que Configuración).

export default function CuentaPage() {
  const { actualizarPendiente } = useAuth();
  const [cuenta, setCuenta] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [errorPassword, setErrorPassword] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);

  const cargar = useCallback(async () => {
    const data = await api.get('/cuenta');
    setCuenta(data);
    actualizarPendiente(data.pendiente);
    return data;
  }, [actualizarPendiente]);

  useEffect(() => {
    cargar().catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar tu cuenta.'));
  }, [cargar]);

  async function cambiarPassword(e) {
    e.preventDefault();
    if (guardandoRef.current) return;
    if (nueva !== repetida) {
      setErrorPassword('Las dos contraseñas nuevas no coinciden.');
      return;
    }
    guardandoRef.current = true;
    setGuardando(true);
    setErrorPassword(null);
    setAviso(null);
    try {
      await api.post('/cuenta/password', { actual: cuenta.pendiente === 'password' ? undefined : actual, nueva });
      setActual('');
      setNueva('');
      setRepetida('');
      const data = await cargar();
      setAviso(data.pendiente ? 'Contraseña actualizada. Ahora activá la verificación en dos pasos.' : 'Contraseña actualizada.');
    } catch (err) {
      setErrorPassword(err instanceof ApiError ? err.message : 'No se pudo cambiar la contraseña.');
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }

  async function alCambiarDosfa(mensaje) {
    const antes = cuenta.pendiente;
    const data = await cargar();
    setAviso(antes === 'dosfa' && !data.pendiente ? 'Verificación en dos pasos activada. Ya podés usar el sistema.' : mensaje);
  }

  if (!cuenta) {
    return <div className="cuenta-page">{error ? <div className="alert alert-danger">{error}</div> : <div className="card cuenta-cargando">Cargando…</div>}</div>;
  }

  const provisoria = cuenta.pendiente === 'password';
  const faltaDosfa = cuenta.pendiente === 'dosfa';

  const tarjetaPassword = (
    <section className="card cuenta-seccion">
      <div className="cuenta-seccion-info">
        <h2 className="cuenta-h2">{provisoria ? 'Definí tu contraseña' : 'Contraseña'}</h2>
        <p className="cuenta-ayuda">
          {provisoria
            ? 'Ingresaste con una contraseña provisoria. Definí una nueva, de al menos 8 caracteres, para empezar a usar el sistema.'
            : 'Mínimo 8 caracteres. Para cambiarla se pide la contraseña actual.'}
        </p>
      </div>
      <form className="cuenta-form" onSubmit={cambiarPassword}>
        {!provisoria && (
          <div className="field cuenta-campo-full">
            <label htmlFor="cuenta-actual">Contraseña actual</label>
            <input
              id="cuenta-actual"
              type="password"
              autoComplete="current-password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              disabled={guardando}
              required
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="cuenta-nueva">Contraseña nueva</label>
          <input
            id="cuenta-nueva"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            disabled={guardando}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="cuenta-repetida">Repetir contraseña nueva</label>
          <input
            id="cuenta-repetida"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            disabled={guardando}
            required
          />
        </div>
        {errorPassword && <div className="alert alert-danger cuenta-campo-full">{errorPassword}</div>}
        <div className="cuenta-acciones cuenta-campo-full">
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </div>
      </form>
    </section>
  );

  // Si CEA se la desactivó (desde /sa), entra solo con la contraseña y no la puede activar desde acá.
  const tarjetaDosfa = cuenta.dosfa_desactivada ? (
    <section className="card cuenta-seccion">
      <div className="cuenta-seccion-info">
        <h2 className="cuenta-h2">Verificación en dos pasos</h2>
        <p className="cuenta-ayuda">Un código al ingresar, además de la contraseña, para proteger tu cuenta.</p>
      </div>
      <div className="cuenta-seccion-cuerpo">
        <div className="cuenta-estado">
          <span className="cuenta-estado-pill">Desactivada</span>
          <span className="cuenta-estado-texto">Está desactivada para tu cuenta. Para activarla, contactá a CEA Servicios.</span>
        </div>
      </div>
    </section>
  ) : (
    cuenta.dosfa && (
      <section className="card cuenta-seccion">
        <div className="cuenta-seccion-info">
          <h2 className="cuenta-h2">Verificación en dos pasos</h2>
          <p className="cuenta-ayuda">
            {faltaDosfa
              ? 'Es obligatoria para los Administradores. Activala para continuar.'
              : 'Un código al ingresar, además de la contraseña, para proteger tu cuenta.'}
          </p>
        </div>
        <div className="cuenta-seccion-cuerpo">
          <ConfigurarDosfa key={cuenta.dosfa.metodo ?? 'sin-metodo'} base="/cuenta/2fa" estado={cuenta.dosfa} onCambio={alCambiarDosfa} />
        </div>
      </section>
    )
  );

  return (
    <div className="cuenta-page">
      <section className="card cuenta-perfil">
        <span className="cuenta-avatar" aria-hidden="true">
          {iniciales(cuenta.nombre)}
        </span>
        <div className="cuenta-perfil-textos">
          <h2 className="cuenta-nombre">{cuenta.nombre}</h2>
          <span className="cuenta-detalle">{cuenta.email ?? cuenta.usuario}</span>
        </div>
        <span className="cuenta-rol">{etiquetaRol(cuenta.rol)}</span>
        {!cuenta.pendiente && (
          <Link to="/caja" className="btn cuenta-ir">
            Ir a Caja
          </Link>
        )}
      </section>

      {aviso && <div className="alert alert-exito">{aviso}</div>}

      {provisoria ? (
        tarjetaPassword
      ) : faltaDosfa ? (
        tarjetaDosfa
      ) : (
        <>
          {tarjetaPassword}
          {tarjetaDosfa}
        </>
      )}
    </div>
  );
}
