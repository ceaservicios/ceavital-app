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

  // Portal del cliente-empresa (login propio del cliente para ver su cuenta).
  // Activo por defecto; PORTAL_CLIENTES=off lo apaga por completo (las rutas
  // del portal responden 404 y la ficha lo avisa), por ejemplo en una
  // instalación LAN donde no se quiere ofrecer.
  portalClientes: process.env.PORTAL_CLIENTES !== 'off',

  // URL pública del sistema, para armar el enlace del portal en los mails que
  // se le mandan al cliente. Vacío = se deduce de la request (funciona detrás
  // del proxy de Easypanel, donde el Host es el dominio real).
  publicUrl: (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),

  // Envío de mails (datos de acceso al portal). Es OPCIONAL y usa internet: sin
  // SMTP_HOST el sistema funciona igual y la ficha ofrece abrir el mail en el
  // programa de correo del usuario. Puerto 465 = conexión segura desde el inicio.
  smtp: {
    host: (process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    user: (process.env.SMTP_USER || '').trim(),
    pass: process.env.SMTP_PASS || '',
    from: (process.env.SMTP_FROM || process.env.SMTP_USER || '').trim(),
  },

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
