// Los montos en la base son enteros en pesos (sin decimales) -- ver
// stock.service.js/ventas.service.js: nunca dividen ni multiplican por 100.
export function formatearMonto(valor) {
  const n = Math.round(Number(valor) || 0);
  const signo = n < 0 ? '-' : '';
  return `${signo}$${Math.abs(n).toLocaleString('es-AR')}`;
}

export function formatearFecha(iso) {
  if (!iso) return '';
  const [anio, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anio}`;
}

// La base guarda los timestamps en UTC como 'YYYY-MM-DD HH:MM:SS' (sin zona)
// -- se marca explícitamente como UTC para que el navegador lo muestre en la
// hora local real del usuario, no como si ya fuera hora local.
export function formatearFechaHora(datetimeUtc) {
  if (!datetimeUtc) return '';
  const fecha = new Date(`${datetimeUtc.replace(' ', 'T')}Z`);
  if (Number.isNaN(fecha.getTime())) return datetimeUtc;
  return fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

// Hoy en hora argentina (el negocio funciona siempre en esa zona, esté donde esté
// el navegador o el servidor). toISOString() daba el día UTC: desde las 21:00
// argentinas ya devolvía el día siguiente.
export function fechaHoyISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}
