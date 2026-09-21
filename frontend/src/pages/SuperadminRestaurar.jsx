import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';

// Sección "Restaurar un backup" del panel del superadmin: sube un .ceavbak descargado del
// panel y REEMPLAZA los datos del negocio con los del archivo (todo o nada). Es lo opuesto a
// "Backup completo": por eso pide dos contraseñas (la del archivo y la del superadmin) y una
// confirmación aparte antes de mandar nada.

const LIMITE_MB = 300;

export default function SuperadminRestaurar({ irAlLogin }) {
  const [archivo, setArchivo] = useState(null);
  const [passwordBackup, setPasswordBackup] = useState('');
  const [passwordSuperadmin, setPasswordSuperadmin] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);
  const guardia = useRef(false); // sincrónica: un doble click no restaura dos veces
  const inputArchivo = useRef(null);

  const grande = archivo && archivo.size > LIMITE_MB * 1024 * 1024;
  const listo = archivo && !grande && passwordBackup.length > 0 && passwordSuperadmin.length > 0;

  function elegirArchivo(e) {
    setArchivo(e.target.files?.[0] ?? null);
    setConfirmando(false);
    setError(null);
    setResultado(null);
  }

  async function restaurar() {
    if (!listo || guardia.current) return;
    guardia.current = true;
    setOcupado(true);
    setError(null);
    setResultado(null);
    try {
      const { archivo_id: archivoId } = await api.subir('/sa/restaurar/archivo', archivo);
      const r = await api.post('/sa/restaurar', {
        archivo_id: archivoId,
        password_backup: passwordBackup,
        password_superadmin: passwordSuperadmin,
      });
      setResultado(r);
      setArchivo(null);
      if (inputArchivo.current) inputArchivo.current.value = '';
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return irAlLogin();
      setError(err instanceof ApiError ? err.message : 'No se pudo restaurar el backup. No se cambió ningún dato.');
    } finally {
      // Las contraseñas no quedan en pantalla pase lo que pase.
      setPasswordBackup('');
      setPasswordSuperadmin('');
      setConfirmando(false);
      guardia.current = false;
      setOcupado(false);
    }
  }

  return (
    <section className="card sa-card">
      <h2 className="sa-h2">Restaurar un backup</h2>
      <p className="sa-ayuda">
        Sube un archivo <code>.ceavbak</code> (el que se descarga arriba, en "Backup completo") y <strong>reemplaza todos los datos del negocio</strong>{' '}
        (productos, stock, ventas, caja, clientes, pedidos, usuarios, configuración, plan y cuota) por los del archivo. Es todo o nada: si algo falla, no se toca nada.
        Los usuarios del negocio con sesión abierta salen de inmediato. <strong>No se puede deshacer</strong>: si dudás, bajá primero un backup del estado actual.
        No cambia tu cuenta de superadmin ni la defensa por IP.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}
      {resultado && (
        <div className="alert sa-alert-ok">
          Backup restaurado: el del {new Date(resultado.creado_en).toLocaleString('es-AR')} (app {resultado.version}), {resultado.tablas} tablas y {resultado.filas}{' '}
          filas. Los datos ya son los del archivo.
        </div>
      )}

      <form
        className="sa-form-email"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (listo) setConfirmando(true);
        }}
      >
        <div className="field">
          <label htmlFor="sa-rs-archivo">Archivo de backup (.ceavbak)</label>
          <input id="sa-rs-archivo" ref={inputArchivo} type="file" accept=".ceavbak" onChange={elegirArchivo} disabled={ocupado} />
        </div>
        <div className="field">
          <label htmlFor="sa-rs-pass">Contraseña del backup</label>
          <input id="sa-rs-pass" type="password" autoComplete="new-password" value={passwordBackup} onChange={(e) => setPasswordBackup(e.target.value)} disabled={ocupado} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="sa-rs-pass-sa">Tu contraseña de superadmin</label>
          <input id="sa-rs-pass-sa" type="password" autoComplete="current-password" value={passwordSuperadmin} onChange={(e) => setPasswordSuperadmin(e.target.value)} disabled={ocupado} maxLength={200} />
        </div>
        {!confirmando && (
          <button type="submit" className="btn btn-primary" disabled={ocupado || !listo}>
            Restaurar…
          </button>
        )}
      </form>
      {grande && <p className="sa-ayuda sa-problema">El archivo pesa más de {LIMITE_MB} MB: es más que lo que acepta el panel.</p>}

      {confirmando && (
        <div className="sa-confirmar">
          <span>¿Reemplazar todos los datos actuales por los de {archivo?.name}? Esto no se puede deshacer.</span>
          <button type="button" className="btn sa-btn-peligro" onClick={restaurar} disabled={ocupado}>
            {ocupado ? 'Restaurando…' : 'Sí, restaurar'}
          </button>
          <button type="button" className="btn" onClick={() => setConfirmando(false)} disabled={ocupado}>
            Cancelar
          </button>
        </div>
      )}
    </section>
  );
}
