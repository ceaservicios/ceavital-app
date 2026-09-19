import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/config -> src -> app
const appRoot = path.resolve(__dirname, '../..');
// app -> Sistema
const sistemaRoot = path.resolve(appRoot, '..');

// Versión instalada: APP_VERSION (la etiqueta de la rama `stable`, si el deploy la fija)
// o, si no, la del package.json.
const versionPaquete = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;

const config = {
  version: (process.env.APP_VERSION || '').trim() || versionPaquete,
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

  // Base de datos: PostgreSQL (desde 2026-09; antes SQLite embebida).
  // Ej.: postgres://usuario:clave@host:5432/ceavital?sslmode=disable
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  db: {
    poolMax: Number(process.env.DB_POOL_MAX) || 10,
  },
  // Ruta de un ceavital.db de SQLite a importar UNA vez al arrancar (ver db/importar-sqlite.js).
  importarSqlite: (process.env.IMPORTAR_SQLITE || '').trim(),
  certsDir: path.join(appRoot, 'certs'),

  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // Módulos por plan: cuántos segundos se cachea el plan leído de la base (0 = sin
  // caché, lo usan los tests). Cambiar el plan desde la propia app invalida la caché
  // al instante; un cambio hecho por fuera (npm run set-plan) se nota en este tiempo.
  modulos: {
    cacheSegundos: process.env.PLAN_CACHE_SEGUNDOS === undefined ? 30 : Number(process.env.PLAN_CACHE_SEGUNDOS) || 0,
  },

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

  // Cuenta del superadmin (CEA) de esta instalación. Solo se usa para CREARLA la primera
  // vez, si todavía no existe (ver superadmin.service.js > asegurarSuperadmin): después
  // manda la contraseña guardada, no esta variable. Nunca por argumento de línea de comandos.
  superadmin: {
    // Vacío = no fijado: al crear la cuenta se usa 'superadmin' y una cuenta existente no se renombra.
    usuario: (process.env.SUPERADMIN_USUARIO || '').trim(),
    password: process.env.SUPERADMIN_PASSWORD || '',
  },

  // Correo de CEA (remitente admin@ceavital.net) para los avisos de cuota del superadmin.
  // Separado a propósito de `smtp`: en un clon, `smtp` pasa a ser el correo de la empresa
  // para escribirle a sus clientes, y los avisos de CEA no pueden salir con esa identidad.
  // AVISOS_CUOTA=off apaga la revisión automática de cuotas (la usan los tests).
  avisosCuota: process.env.AVISOS_CUOTA !== 'off',
  saSmtp: {
    host: (process.env.SA_SMTP_HOST || '').trim(),
    port: Number(process.env.SA_SMTP_PORT) || 587,
    secure: process.env.SA_SMTP_SECURE === 'true' || Number(process.env.SA_SMTP_PORT) === 465,
    user: (process.env.SA_SMTP_USER || '').trim(),
    pass: process.env.SA_SMTP_PASS || '',
    from: (process.env.SA_SMTP_FROM || process.env.SA_SMTP_USER || '').trim(),
  },

  // Defensa activa por IP (services/defensa-ip.service.js): detecta sondeos de archivos, inyecciones,
  // herramientas de hacking, enumeración de rutas y fuerza bruta, y bloquea la IP.
  //  DEFENSA_IP=off               apaga todo (solo para diagnóstico)
  //  DEFENSA_IP_ALERTA_EMAIL      a dónde llega el mail de cada bloqueo (por el correo de CEA, SA_SMTP_*)
  //  DEFENSA_IP_PERMITIDAS        IPs que nunca se bloquean, separadas por coma (ej. la de la oficina de CEA)
  //  DEFENSA_IP_LOOPBACK=on       bloquea también 127.0.0.1 (lo usan los tests; en producción no hace falta)
  defensa: {
    activa: process.env.DEFENSA_IP !== 'off',
    alertaEmail: (process.env.DEFENSA_IP_ALERTA_EMAIL || '').trim(),
    permitidas: (process.env.DEFENSA_IP_PERMITIDAS || '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
    bloquearLoopback: process.env.DEFENSA_IP_LOOPBACK === 'on',
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
