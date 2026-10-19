import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { etiquetaRol } from '../constants/roles.js';
import ConfigurarDosfa from '../components/ConfigurarDosfa.jsx';
import './CuentaPage.css';

// "Mi cuenta": contraseña propia y, para el Admin, la verificación en dos pasos (obligatoria, EST-01
// §4, salvo que CEA se la desactive). Con algo pendiente (contraseña provisoria o Admin sin 2FA) es
// la única pantalla a la que se puede entrar hasta resolverlo (RequireAuth).

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
      setAviso(data.pendiente ? 'Contraseña cambiada. Ahora activá la verificación en dos pasos.' : 'Listo, tu contraseña quedó cambiada.');
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
    setAviso(antes === 'dosfa' && !data.pendiente ? 'Listo: la verificación en dos pasos quedó activa y ya podés usar el sistema.' : mensaje);
  }

  if (!cuenta) {
    return <div className="cuenta-page">{error ? <div className="alert alert-danger">{error}</div> : <div className="card cuenta-card">Cargando…</div>}</div>;
  }

  const provisoria = cuenta.pendiente === 'password';
  const faltaDosfa = cuenta.pendiente === 'dosfa';

  const tarjetaPassword = (
    <section className="card cuenta-card">
      <h2 className="cuenta-h2">{provisoria ? 'Elegí tu contraseña' : 'Cambiar contraseña'}</h2>
      {provisoria && (
        <p className="cuenta-ayuda">
          Entraste con una contraseña provisoria. Elegí una nueva (al menos 8 caracteres) para empezar a usar el sistema.
        </p>
      )}
      <form className="cuenta-form" onSubmit={cambiarPassword}>
        {!provisoria && (
          <div className="field">
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
          <label htmlFor="cuenta-repetida">Repetila</label>
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
        {errorPassword && <div className="alert alert-danger">{errorPassword}</div>}
        <div>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </div>
      </form>
    </section>
  );

  // Si CEA se la desactivó (desde /sa), entra solo con la contraseña y no la puede activar desde acá.
  const tarjetaDosfa = cuenta.dosfa_desactivada ? (
    <section className="card cuenta-card">
      <h2 className="cuenta-h2">Verificación en dos pasos</h2>
      <p className="cuenta-ayuda">
        La verificación en dos pasos está desactivada para tu cuenta. Si querés activarla, pedíselo a CEA Servicios.
      </p>
    </section>
  ) : (
    cuenta.dosfa && (
      <section className="card cuenta-card">
        <h2 className="cuenta-h2">Verificación en dos pasos</h2>
        {faltaDosfa && (
          <p className="cuenta-ayuda">
            Como Administrador tenés que activarla para seguir: además de la contraseña, se pide una vez por semana en cada navegador.
          </p>
        )}
        <ConfigurarDosfa key={cuenta.dosfa.metodo ?? 'sin-metodo'} base="/cuenta/2fa" estado={cuenta.dosfa} onCambio={alCambiarDosfa} />
      </section>
    )
  );

  return (
    <div className="cuenta-page">
      <section className="card cuenta-card cuenta-datos">
        <div>
          <div className="cuenta-nombre">{cuenta.nombre}</div>
          <div className="cuenta-detalle">
            {cuenta.email ?? cuenta.usuario} · {etiquetaRol(cuenta.rol)}
          </div>
        </div>
        {!cuenta.pendiente && (
          <Link to="/caja" className="btn">
            Ir a Caja
          </Link>
        )}
      </section>

      {aviso && <div className="alert cuenta-aviso">{aviso}</div>}

      {provisoria ? (
        tarjetaPassword
      ) : faltaDosfa ? (
        tarjetaDosfa
      ) : (
        // Lado a lado en pantallas anchas: así entran las dos en una ventana de notebook.
        <div className="cuenta-grilla">
          {tarjetaPassword}
          {tarjetaDosfa}
        </div>
      )}
    </div>
  );
}
