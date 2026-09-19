import 'express-async-errors';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import selfsigned from 'selfsigned';

import config from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { importarDesdeSqlite } from './db/importar-sqlite.js';
import { errorHandler } from './middleware/error.middleware.js';
import { buildCorsMiddleware, helmetMiddleware } from './middleware/security.middleware.js';
import routes from './routes/index.js';
import { cerrarSesionesInactivas } from './services/session.service.js';
import { cerrarSesionesClienteInactivas } from './services/clientes-portal.service.js';
import { asegurarSuperadmin, cerrarSesionesSuperadminInactivas } from './services/superadmin.service.js';

function asegurarCertificado() {
  const certPath = path.join(config.certsDir, 'cert.pem');
  const keyPath = path.join(config.certsDir, 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  }

  // Certificado autofirmado (ver CLAUDE.md > Seguridad: "HTTPS con
  // certificado propio"). Se genera una sola vez, al primer arranque, y
  // queda en certs/ -- una actualizacion futura (que solo reemplaza app/)
  // no lo regenera si ya existe.
  fs.mkdirSync(config.certsDir, { recursive: true });
  const pems = selfsigned.generate([{ name: 'commonName', value: 'ceavital.local' }], {
    days: 3650,
    keySize: 2048,
  });
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(keyPath, pems.private);
  console.log('[https] certificado autofirmado generado en', config.certsDir);

  return { cert: pems.cert, key: pems.private };
}

// Un rechazo de promesa sin capturar no tiene que tumbar el servidor entero:
// se registra y el proceso sigue atendiendo (los errores de un request ya
// llegan a errorHandler por express-async-errors).
process.on('unhandledRejection', (motivo) => {
  console.error('[server] promesa rechazada sin capturar:', motivo);
});

await runMigrations();
await asegurarSuperadmin();

// Pase a produccion desde SQLite: una sola vez, solo si PostgreSQL esta vacio.
// Si falla, el servidor NO arranca (no se sirve una base vacia con datos sin migrar).
if (config.importarSqlite) {
  const resultado = await importarDesdeSqlite(config.importarSqlite);
  if (resultado.importado) console.log('[importar] datos importados desde SQLite:', resultado.filas);
  else console.log(`[importar] omitido: ${resultado.motivo}`);
}

const app = express();

// Modo proxy (VPS detras de Traefik/Easypanel): confiar en el primer hop
// para que X-Forwarded-For/Proto determinen req.ip/req.secure -- sin esto,
// express-rate-limit (login) ve la IP interna del proxy para todo el mundo
// y bloquea a todos los usuarios juntos en vez de por IP real.
if (config.httpsMode === 'proxy') {
  app.set('trust proxy', 1);
}

app.use(helmetMiddleware);
app.use(buildCorsMiddleware());
app.use(express.json());
app.use(cookieParser());
app.use('/api', routes);

// Build de produccion del frontend (`npm run build` en frontend/), servido
// por el mismo Express -- mismo origen, sin CORS. Si no existe (desarrollo,
// con el frontend en su propio Vite dev server), se omite sin romper nada.
const frontendDistDir = path.join(config.appRoot, 'frontend', 'dist');
if (fs.existsSync(frontendDistDir)) {
  app.use(express.static(frontendDistDir));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDistDir, 'index.html'));
  });
}

app.use(errorHandler);

if (config.httpsMode === 'proxy') {
  http.createServer(app).listen(config.port, () => {
    console.log(`[server] CEAVital backend (modo proxy) escuchando en http://0.0.0.0:${config.port}`);
  });
} else {
  const { cert, key } = asegurarCertificado();
  https.createServer({ cert, key }, app).listen(config.port, () => {
    console.log(`[server] CEAVital backend escuchando en https://localhost:${config.port}`);
  });
}

// Housekeeping de sesiones vencidas por inactividad (30 min) -- ver
// session.service.cerrarSesionesInactivas para el porque de este barrido
// ademas del chequeo en tiempo real que ya hace el middleware de auth.
setInterval(async () => {
  try {
    const cerradas = await cerrarSesionesInactivas();
    if (cerradas > 0) {
      console.log(`[sesiones] ${cerradas} sesión(es) cerrada(s) por timeout`);
    }
    const cerradasCliente = await cerrarSesionesClienteInactivas();
    if (cerradasCliente > 0) {
      console.log(`[sesiones] ${cerradasCliente} sesión(es) de cliente cerrada(s) por timeout`);
    }
    await cerrarSesionesSuperadminInactivas();
  } catch (err) {
    console.error('[sesiones] no se pudo cerrar sesiones inactivas:', err.message);
  }
}, 5 * 60 * 1000);
