import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { formatearFechaHora } from '../utils/format.js';

// "Backups automáticos" del panel del superadmin: cómo le fue al último backup diario que hace la
// app de backups (ceavital-app-bkps) y el historial. Solo lectura: lo informa la propia app de backups.

const DRIVE = {
  subido: { texto: 'Copia en Drive', clase: 'sa-chip-ok' },
  no_configurado: { texto: 'Drive sin configurar', clase: 'sa-chip-aviso' },
  error: { texto: 'Drive falló', clase: 'sa-chip-alerta' },
};

function haceCuanto(datetimeUtc) {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(`${datetimeUtc.replace(' ', 'T')}Z`).getTime()) / 60000));
  if (minutos < 60) return `hace ${minutos} min`;
  if (minutos < 48 * 60) return `hace ${Math.round(minutos / 60)} h`;
  return `hace ${Math.round(minutos / 1440)} días`;
}

function tamano(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function SuperadminBackupsAuto({ irAlLogin }) {
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setEstado(await api.get('/sa/backup-estado'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return irAlLogin();
      setError(err instanceof ApiError ? err.message : 'No se pudo leer el estado de los backups.');
    }
  }, [irAlLogin]);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 5 * 60_000);
    return () => clearInterval(t);
  }, [cargar]);

  if (!estado) {
    return (
      <section className="card sa-card">
        <h2 className="sa-h2">Backups automáticos</h2>
        {error ? <div className="alert alert-danger">{error}</div> : <p className="sa-cargando">Cargando…</p>}
      </section>
    );
  }

  const { configurado, atrasado, ultimo_ok: ultimoOk, corridas } = estado;
  const ultima = corridas[0] ?? null;

  let chip;
  if (!configurado) chip = { texto: 'Sin configurar', clase: 'sa-chip-aviso' };
  else if (!ultima) chip = { texto: 'Todavía no hubo ninguno', clase: 'sa-chip-aviso' };
  else if (atrasado) chip = { texto: 'Atrasado: el último bueno tiene más de 36 h', clase: 'sa-chip-alerta' };
  else if (ultima.resultado === 'error') chip = { texto: 'El último intento falló (se reintenta)', clase: 'sa-chip-alerta' };
  else chip = { texto: `Último bueno ${haceCuanto(ultimoOk.iniciada_en)}`, clase: 'sa-chip-ok' };

  return (
    <section className="card sa-card">
      <h2 className="sa-h2">Backups automáticos</h2>
      <p>
        <span className={`sa-chip ${chip.clase}`}>{chip.texto}</span>
        {ultimoOk && (
          <>
            {' '}
            <span className={`sa-chip ${ultimoOk.verificado ? 'sa-chip-ok' : 'sa-chip-aviso'}`}>{ultimoOk.verificado ? 'Restauración verificada' : 'Sin verificar'}</span>{' '}
            <span className={`sa-chip ${(DRIVE[ultimoOk.drive] ?? DRIVE.error).clase}`}>{(DRIVE[ultimoOk.drive] ?? DRIVE.error).texto}</span>
          </>
        )}
      </p>
      <p className="sa-ayuda">
        {configurado ? (
          <>
            Todos los días de madrugada la app de backups (<strong>ceavital-app-bkps</strong>) trae una copia cifrada de toda la base, la restaura en su propia
            base para comprobar que se puede recuperar, se queda con los últimos 7 días y 4 semanas, y la copia a Google Drive.
            {ultimoOk && (
              <>
                {' '}
                Último bueno: {formatearFechaHora(ultimoOk.iniciada_en)} (UTC) · {tamano(ultimoOk.bytes)} · {ultimoOk.filas ?? '—'} filas.
              </>
            )}
          </>
        ) : (
          'Falta BACKUP_SYNC_TOKEN (32+ caracteres) en el servidor de producción y el servicio ceavital-app-bkps con el mismo valor en BKPS_TOKEN.'
        )}
      </p>
      {error && <div className="alert alert-danger">{error}</div>}
      {ultima && ultima.resultado === 'error' && ultima.detalle && <div className="alert alert-danger">Último intento: {ultima.detalle}</div>}

      {corridas.length > 0 && (
        <details className="sa-eventos">
          <summary>Historial de backups automáticos ({corridas.length})</summary>
          <div className="sa-tabla-scroll">
            <table className="sa-tabla sa-tabla-seg">
              <thead>
                <tr>
                  <th>Cuándo (UTC)</th>
                  <th>Resultado</th>
                  <th>Tamaño</th>
                  <th>Verificado</th>
                  <th>Drive</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {corridas.map((c) => (
                  <tr key={c.id}>
                    <td>{formatearFechaHora(c.iniciada_en)}</td>
                    <td>{c.resultado === 'ok' ? 'Bien' : 'Falló'}</td>
                    <td>{tamano(c.bytes)}</td>
                    <td>{c.verificado ? 'Sí' : 'No'}</td>
                    <td>{(DRIVE[c.drive] ?? DRIVE.error).texto}</td>
                    <td className="sa-corta">{c.detalle ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
