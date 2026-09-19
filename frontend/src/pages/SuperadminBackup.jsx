import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';

// Sección "Backup completo" del panel del superadmin: baja toda la base de datos en un
// archivo cifrado (.ceavbak) que se puede restaurar entera en esta u otra instalación.

const MIN = 12;

export default function SuperadminBackup({ irAlLogin }) {
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);
  const guardia = useRef(false);

  const problema =
    password.length > 0 && password.length < MIN
      ? `La contraseña tiene que tener al menos ${MIN} caracteres.`
      : repetida.length > 0 && repetida !== password
        ? 'Las contraseñas no coinciden.'
        : null;
  const listo = password.length >= MIN && repetida === password;

  async function descargar(e) {
    e.preventDefault();
    if (!listo || guardia.current) return;
    guardia.current = true;
    setOcupado(true);
    setError(null);
    setResultado(null);
    try {
      const { blob, nombre } = await api.descargar('/sa/backup', { method: 'POST', body: { password } });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setResultado({ nombre, kb: Math.max(1, Math.round(blob.size / 1024)) });
      setPassword('');
      setRepetida('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return irAlLogin();
      setError(err instanceof ApiError ? err.message : 'No se pudo generar el backup. Probá de nuevo.');
    } finally {
      guardia.current = false;
      setOcupado(false);
    }
  }

  return (
    <section className="card sa-card">
      <h2 className="sa-h2">Backup completo de la base de datos</h2>
      <p className="sa-ayuda">
        Descarga toda la información del negocio (productos, stock, ventas, caja, clientes, usuarios, configuración…) en un solo archivo,
        listo para restaurarse entero en esta instalación o en otra. Es una foto consistente aunque se esté vendiendo mientras se genera.
        El archivo va <strong>cifrado</strong> con la contraseña que elijas acá: <strong>sin ella no se puede abrir y no hay forma de
        recuperarla</strong>. No incluye las sesiones abiertas ni la cuenta del superadmin.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}
      {resultado && (
        <div className="alert sa-alert-ok">
          Backup descargado: {resultado.nombre} ({resultado.kb} KB). Guardalo junto con su contraseña en un lugar seguro, fuera de este servidor.
        </div>
      )}

      <form className="sa-form-email" onSubmit={descargar} autoComplete="off">
        <div className="field">
          <label htmlFor="sa-bk-pass">Contraseña del backup</label>
          <input id="sa-bk-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={ocupado} minLength={MIN} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="sa-bk-pass2">Repetila</label>
          <input id="sa-bk-pass2" type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} disabled={ocupado} maxLength={200} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={ocupado || !listo}>
          {ocupado ? 'Generando…' : 'Descargar backup'}
        </button>
      </form>
      {problema && <p className="sa-ayuda sa-problema">{problema}</p>}

      <details className="sa-eventos">
        <summary>Cómo restaurarlo (en esta u otra instalación)</summary>
        <ol className="sa-pasos">
          <li>En la instalación destino, con la app ya desplegada (arrancó una vez y creó el esquema), abrí la terminal del servicio en Easypanel.</li>
          <li>
            Subí el archivo <code>.ceavbak</code> al contenedor y corré:
            <pre className="sa-codigo">BACKUP_PASSWORD='la-contraseña' npm run restaurar-backup -- /ruta/backup.ceavbak --confirmar</pre>
          </li>
          <li>
            Reemplaza los datos del negocio por los del backup (todo o nada: si algo falla, no toca nada) y comprueba que cada tabla quedó con
            las mismas filas. La instalación destino tiene que ser de la misma versión o más nueva.
          </li>
        </ol>
      </details>
    </section>
  );
}
