import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import config from '../config/env.js';
import { restaurarBackup } from '../services/backup-completo.service.js';
import { registrarCorrida } from '../services/backup-corridas.service.js';
import { correoCeaDisponible, enviarCorreo } from '../services/mail.service.js';
import { asegurarBaseDeVerificacion } from './base-verificacion.js';
import { crearDrive, driveConfigurado } from './drive.js';
import { planDeRetencion } from './retencion.js';

// Una corrida de backup automático (la dispara main.js una vez por día de madrugada):
//   1. le pide el backup cifrado a producción (con el token)      -> falla = corrida con error
//   2. lo guarda en el volumen y calcula su huella
//   3. lo RESTAURA en ceavital-bd-bkps y comprueba las filas      -> falla = corrida con error
//   4. aplica la retención (7 diarios + 4 semanales) al volumen
//   5. lo sube a Google Drive y aplica la misma retención allá    -> falla = se avisa, el local queda
//   6. lo registra y le informa el resultado a producción (panel del superadmin)
// Cualquier error manda un mail (BKPS_ALERTA_EMAIL, por el correo de CEA).

const NOMBRE_VALIDO = /^ceavital-backup-\d{8}-\d{6}\.ceavbak$/;
const TAMANO_MINIMO = 64; // un backup real pesa mucho más que la cabecera

let enCurso = false;
export const hayCorridaEnCurso = () => enCurso;

const mensaje = (err) => (err instanceof Error ? err.message : String(err)).slice(0, 900);

async function pedirBackup(cfg, tmp) {
  const res = await fetch(`${cfg.instanciaUrl}/api/backup-sync/export`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ password: cfg.password }),
    signal: AbortSignal.timeout(30 * 60_000),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`La instalación respondió ${res.status}${data.error ? `: ${data.error}` : ''}`);
  }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp, { mode: 0o600 }));
  const propuesto = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] ?? '';
  return NOMBRE_VALIDO.test(propuesto) ? propuesto : `ceavital-backup-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}.ceavbak`;
}

async function huella(ruta) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(ruta), h);
  return h.digest('hex');
}

async function aplicarRetencionLocal(dir) {
  const { borrar } = planDeRetencion(await fs.promises.readdir(dir));
  for (const nombre of borrar) await fs.promises.rm(path.join(dir, nombre), { force: true });
  return borrar.length;
}

async function aplicarRetencionDrive(drive) {
  const archivos = await drive.listar();
  const { borrar } = planDeRetencion(archivos.map((a) => a.name));
  const sobran = new Set(borrar);
  for (const a of archivos) if (sobran.has(a.name)) await drive.borrar(a.id);
  return sobran.size;
}

async function informarAProduccion(cfg, corrida) {
  try {
    const res = await fetch(`${cfg.instanciaUrl}/api/backup-sync/estado`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(corrida),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) console.error(`[bkps] producción no aceptó el estado (${res.status})`);
  } catch (err) {
    console.error('[bkps] no se pudo informar el estado a producción:', mensaje(err));
  }
}

async function avisarPorMail(cfg, corrida) {
  if (!cfg.alertaEmail || !correoCeaDisponible()) return;
  try {
    await enviarCorreo(
      {
        para: cfg.alertaEmail,
        asunto: `[CEAVital] Backup automático con problemas (${corrida.resultado === 'error' ? 'FALLÓ' : 'sin copia en Drive'})`,
        texto: [
          `Backup automático de ${cfg.instanciaUrl}`,
          `Resultado: ${corrida.resultado}`,
          `Verificado (restaurado y comparado): ${corrida.verificado ? 'sí' : 'no'}`,
          `Copia en Google Drive: ${corrida.drive}`,
          `Detalle: ${corrida.detalle ?? '-'}`,
          '',
          corrida.resultado === 'error' ? 'Si es la primera falla del día, se reintenta sola (hasta 3 veces).' : 'El backup local está bien; revisá las credenciales de Drive.',
        ].join('\n'),
      },
      'cea'
    );
  } catch (err) {
    console.error('[bkps] no se pudo mandar el aviso por mail:', mensaje(err));
  }
}

export async function ejecutarBackupDiario({ cfg = config.bkps, drive = driveConfigurado(cfg.drive) ? crearDrive(cfg.drive) : null } = {}) {
  if (enCurso) throw new Error('Ya hay una corrida en marcha');
  enCurso = true;
  const iniciada = new Date();
  const corrida = { iniciada_en: iniciada.toISOString(), resultado: 'error', archivo: null, bytes: null, filas: null, verificado: false, drive: 'no_configurado', detalle: null };
  const detalles = [];
  const tmp = path.join(cfg.dir, `.descarga-${crypto.randomBytes(6).toString('hex')}.tmp`);

  try {
    await fs.promises.mkdir(cfg.dir, { recursive: true, mode: 0o700 });
    await asegurarBaseDeVerificacion();

    // 1 y 2. Traerlo y guardarlo.
    const nombre = await pedirBackup(cfg, tmp);
    const { size } = await fs.promises.stat(tmp);
    if (size < TAMANO_MINIMO) throw new Error(`El archivo descargado es demasiado chico (${size} bytes)`);
    const ruta = path.join(cfg.dir, nombre);
    await fs.promises.rename(tmp, ruta);
    corrida.archivo = nombre;
    corrida.bytes = size;
    detalles.push(`sha256 ${(await huella(ruta)).slice(0, 16)}…`);

    // 3. Verificarlo: restaurarlo en la base de verificación (compara las filas de cada tabla).
    const restaurado = await restaurarBackup(ruta, cfg.password);
    corrida.filas = Object.values(restaurado.tablas).reduce((a, b) => a + b, 0);
    corrida.verificado = true;
    corrida.resultado = 'ok';

    // 4. Retención local.
    const borradosLocal = await aplicarRetencionLocal(cfg.dir);
    if (borradosLocal) detalles.push(`${borradosLocal} archivo(s) viejo(s) borrado(s) del servidor`);

    // 5. Google Drive (si falla, el backup local sigue siendo bueno: se avisa y listo).
    if (drive) {
      try {
        await drive.subir(ruta, nombre);
        corrida.drive = 'subido';
        const borradosDrive = await aplicarRetencionDrive(drive);
        if (borradosDrive) detalles.push(`${borradosDrive} archivo(s) viejo(s) borrado(s) de Drive`);
      } catch (err) {
        corrida.drive = 'error';
        detalles.push(`Drive: ${mensaje(err)}`);
      }
    }
  } catch (err) {
    corrida.resultado = 'error';
    detalles.unshift(mensaje(err));
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
  } finally {
    enCurso = false;
  }

  corrida.terminada_en = new Date().toISOString();
  corrida.detalle = detalles.join(' · ') || null;
  await registrarCorrida(corrida, 'local').catch((err) => console.error('[bkps] no se pudo registrar la corrida:', mensaje(err)));
  await informarAProduccion(cfg, corrida);
  if (corrida.resultado === 'error' || corrida.drive === 'error') await avisarPorMail(cfg, corrida);
  console.log(`[bkps] corrida ${corrida.resultado}: ${corrida.archivo ?? '-'} (verificado: ${corrida.verificado}, drive: ${corrida.drive})${corrida.detalle ? ` — ${corrida.detalle}` : ''}`);
  return corrida;
}
