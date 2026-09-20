// Punto de entrada del contenedor. El mismo código y la misma imagen sirven a dos servicios de
// Easypanel: la app (ceavital-app) y la app de backups (ceavital-app-bkps, con MODO_BKPS=on).
// Así el esquema de la base de verificación siempre coincide con el de producción.
if (process.env.MODO_BKPS === 'on') {
  await import('./bkps/main.js');
} else {
  await import('./server.js');
}
