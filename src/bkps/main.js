import http from 'node:http';
import config from '../config/env.js';
import { runMigrations } from '../db/migrate.js';
import { corridasDeHoy, ultimasCorridas } from '../services/backup-corridas.service.js';
import { horaNegocio } from '../utils/fecha-negocio.js';
import { asegurarBaseDeVerificacion } from './base-verificacion.js';
import { driveConfigurado } from './drive.js';
import { ejecutarBackupDiario, hayCorridaEnCurso } from './ejecutar.js';

// Punto de entrada de la app de backups (ceavital-app-bkps): el mismo código que la app, con
// MODO_BKPS=on y DATABASE_URL apuntando a ceavital-bd-bkps. Una vez por día, de madrugada (hora
// argentina, BKPS_HORA=03:00 por defecto), corre ejecutarBackupDiario. Si esa corrida falla,
// reintenta pasada una hora, hasta 3 veces por día. Si el servicio estuvo apagado a la hora
// programada, corre apenas arranca. No tiene dominio público: solo /health, por la red interna.

const cfg = config.bkps;
const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;
const REINTENTO_SEGUNDOS = 3600;
const MAX_CORRIDAS_POR_DIA = 3;

function validarConfiguracion() {
  const faltas = [];
  if (!/^https?:\/\//.test(cfg.instanciaUrl)) faltas.push('BKPS_INSTANCIA_URL (ej. http://ceavital_ceavital-app:3000)');
  if (cfg.token.length < 32) faltas.push('BKPS_TOKEN (32+ caracteres, igual a BACKUP_SYNC_TOKEN de producción)');
  if (cfg.password.length < 12) faltas.push('BKPS_BACKUP_PASSWORD (12+ caracteres)');
  if (!HORA_VALIDA.test(cfg.hora)) faltas.push('BKPS_HORA (formato HH:MM, ej. 03:00)');
  if (faltas.length) {
    console.error(`[bkps] falta configurar: ${faltas.join('; ')}`);
    process.exit(1);
  }
}

async function tick() {
  if (hayCorridaEnCurso() || horaNegocio() < cfg.hora) return;
  const hoy = await corridasDeHoy();
  const primera = hoy.cantidad === 0;
  const reintento = hoy.ultimoResultado === 'error' && hoy.cantidad < MAX_CORRIDAS_POR_DIA && hoy.segundosDesdeLaUltima > REINTENTO_SEGUNDOS;
  if (primera || reintento) await ejecutarBackupDiario();
}

validarConfiguracion();
await runMigrations();
await asegurarBaseDeVerificacion();

http
  .createServer(async (req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const [ultima] = await ultimasCorridas(1).catch(() => []);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, modo: 'bkps', ultima: ultima ? { resultado: ultima.resultado, iniciada_en: ultima.iniciada_en } : null }));
  })
  .listen(config.port, () => console.log(`[bkps] escuchando en :${config.port} (solo /health)`));

const vuelta = () => tick().catch((err) => console.error('[bkps] error en la revisión diaria:', err.message));
setInterval(vuelta, 60_000);
setTimeout(vuelta, 5_000);
console.log(`[bkps] listo: backup diario a las ${cfg.hora} (hora argentina) de ${cfg.instanciaUrl}; Google Drive ${driveConfigurado(cfg.drive) ? 'configurado' : 'SIN configurar'}`);
