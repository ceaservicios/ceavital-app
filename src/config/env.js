import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/config -> src -> app
const appRoot = path.resolve(__dirname, '../..');

// Versión instalada: APP_VERSION (si el deploy la fija) o, si no, la del package.json.
const versionPaquete = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;

const config = {
  version: (process.env.APP_VERSION || '').trim() || versionPaquete,
  port: Number(process.env.PORT) || 8443,
  nodeEnv: process.env.NODE_ENV || 'development',
  appRoot,

  // 'selfsigned' (default, solo para desarrollo en la propia PC): certificado propio
  // generado al primer arranque, ver server.js > asegurarCertificado. 'proxy' (VPS detras
  // de un reverse proxy tipo Traefik/Easypanel que ya termina TLS con un
  // dominio real): el server escucha HTTP plano y confia en los headers
  // X-Forwarded-* del proxy (necesario para que rate-limit/req.ip reflejen
  // el cliente real, no la IP interna del proxy).
  httpsMode: process.env.HTTPS_MODE === 'proxy' ? 'proxy' : 'selfsigned',

  // Base de datos: PostgreSQL (desde 2026-09; antes SQLite embebida).
  // Ej.: postgres://usuario:clave@host:5432/ceavital?sslmode=disable
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  db: {
    poolMax: Number(process.env.DB_POOL_MAX) || 10,
  },
  certsDir: path.join(appRoot, 'certs'),

  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // Módulos por plan: cuántos segundos se cachea el plan leído de la base (0 = sin
  // caché). Cambiar el plan desde la propia app invalida la caché
  // al instante; un cambio hecho por fuera (npm run set-plan) se nota en este tiempo.
  modulos: {
    cacheSegundos: process.env.PLAN_CACHE_SEGUNDOS === undefined ? 30 : Number(process.env.PLAN_CACHE_SEGUNDOS) || 0,
  },

  // URL pública del sistema, para armar el enlace del portal en los mails que
  // se le mandan al cliente. Vacío = se deduce de la request (funciona detrás
  // del proxy de Easypanel, donde el Host es el dominio real).
  publicUrl: (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),

  // Correo de la empresa: códigos de ingreso de los usuarios del negocio, contraseñas provisorias
  // de los Administradores y datos de acceso al portal. La app funciona sin él (EST-01 §10.2): la
  // verificación del email de los empleados queda en pausa, el 2FA de los Administradores va por
  // app, la contraseña provisoria se ve en pantalla y el acceso al portal cae a abrir el mail en el
  // programa de correo del usuario. Lo que no se puede es activar el 2FA por mail.
  // Puerto 465 = conexión segura desde el inicio.
  smtp: {
    host: (process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    user: (process.env.SMTP_USER || '').trim(),
    pass: process.env.SMTP_PASS || '',
    from: (process.env.SMTP_FROM || process.env.SMTP_USER || '').trim(),
    // A dónde van las respuestas a esos mails (la casilla propia de la empresa). El envío sale por
    // la cuenta de CEA, que la empresa no maneja: así no puede cortarlo (ni borrar su clave de app).
    replyTo: (process.env.SMTP_REPLY_TO || '').trim(),
  },

  // Cuenta del superadmin (CEA) de esta instalación (EST-01 §1: entra con su mail). La contraseña
  // solo se usa para CREARLA la primera vez, si todavía no existe (ver superadmin.service.js >
  // asegurarSuperadmin): después manda la guardada. Nunca por argumento de línea de comandos.
  superadmin: {
    // Vacío = sin cuenta nueva y una cuenta existente no se renombra.
    email: (process.env.SUPERADMIN_EMAIL || '').trim(),
    password: process.env.SUPERADMIN_PASSWORD || '',
  },

  // Verificación en dos pasos (EST-01 §4). DOSFA_CLAVE cifra los secretos de las apps
  // autenticadoras (mínimo 32 caracteres; si cambia, los que usan la app la tienen que volver a
  // configurar). Sin ella solo se puede elegir el código por mail. DOSFA_EMISOR es el nombre que
  // muestra la app autenticadora (distingue esta instalación de otras de CEAVital).
  dosfa: {
    clave: process.env.DOSFA_CLAVE || '',
    emisor: (process.env.DOSFA_EMISOR || '').replaceAll(':', '').trim().slice(0, 40) || 'CEAVital',
  },

  // Correo de CEA (remitente admin@ceaservicios.com.ar desde el 2026-10-21) para los avisos de pago del superadmin.
  // Separado a propósito de `smtp`: en un clon, `smtp` pasa a ser el correo de la empresa
  // para escribirle a sus clientes, y los avisos de CEA no pueden salir con esa identidad.
  // AVISOS_CUOTA=off apaga la revisión automática de cuotas.
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
  // herramientas de hacking, enumeración de rutas y ráfagas, y bloquea la IP. Los intentos fallidos
  // de ingreso no bloquean la IP (los frena middleware/ingreso-limiter.middleware.js).
  //  DEFENSA_IP=off               apaga todo (solo para diagnóstico)
  //  DEFENSA_IP_ALERTA_EMAIL      a dónde llega el mail de cada bloqueo (por el correo de CEA, SA_SMTP_*)
  //  DEFENSA_IP_PERMITIDAS        IPs que nunca se bloquean, separadas por coma (ej. la de la oficina de CEA)
  defensa: {
    activa: process.env.DEFENSA_IP !== 'off',
    alertaEmail: (process.env.DEFENSA_IP_ALERTA_EMAIL || '').trim(),
    permitidas: (process.env.DEFENSA_IP_PERMITIDAS || '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
  },

  // Copias de seguridad (services/copias.service.js): Google Drive de CEA (admin@ceaservicios.com.ar)
  // con el cliente OAuth de IntelDrive y DaleFit. Sin las tres (o sin PUBLIC_URL) no hay copias.
  gdrive: {
    clientId: (process.env.GDRIVE_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GDRIVE_CLIENT_SECRET || '').trim(),
    refreshToken: (process.env.GDRIVE_REFRESH_TOKEN || '').trim(),
  },

  session: {
    // EST-01 §3 (SEG-POL-001 §1.1): la sesión vence a las 8 h sin uso. Las del Admin del negocio
    // y del superadmin no se extienden solas: vencen a las 8 h de haber ingresado aunque se usen.
    timeoutMinutes: 480,
  },

  login: {
    // EST-01 §9.6: 10 intentos fallidos seguidos bloquean la cuenta 15 min (negocio, portal y superadmin).
    maxIntentos: 10,
    bloqueoMinutos: 15,
  },
};

export default config;
