import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/config -> src -> app
const appRoot = path.resolve(__dirname, '../..');
// app -> Sistema
const sistemaRoot = path.resolve(appRoot, '..');

const config = {
  port: Number(process.env.PORT) || 8443,
  nodeEnv: process.env.NODE_ENV || 'development',
  appRoot,

  // 'selfsigned' (default, instalacion LAN): certificado propio generado al
  // primer arranque, ver server.js > asegurarCertificado. 'proxy' (VPS detras
  // de un reverse proxy tipo Traefik/Easypanel que ya termina TLS con un
  // dominio real): el server escucha HTTP plano y confia en los headers
  // X-Forwarded-* del proxy (necesario para que rate-limit/req.ip reflejen
  // el cliente real, no la IP interna del proxy).
  httpsMode: process.env.HTTPS_MODE === 'proxy' ? 'proxy' : 'selfsigned',

  // Codigo (app) y datos (data) separados desde el dia uno: una actualizacion
  // futura solo reemplaza app/, nunca toca data/ (ver CLAUDE.md > "Actualizaciones en produccion").
  dataDir: path.join(sistemaRoot, 'data'),
  dbPath: path.join(sistemaRoot, 'data', 'ceavital.db'),
  certsDir: path.join(appRoot, 'certs'),

  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  session: {
    // Sesion inactiva se cierra sola a los 30 min (Instructivo-Funcional > Requisitos transversales).
    timeoutMinutes: 30,
  },

  login: {
    // Bloqueo tras 5 intentos fallidos, 15 min (Instructivo-Funcional > Configuracion y Seguridad).
    maxIntentos: 5,
    bloqueoMinutos: 15,
  },
};

export default config;
