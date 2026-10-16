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

const ZONA_NEGOCIO = 'America/Argentina/Buenos_Aires';

// Día argentino ('AAAA-MM-DD') de un 'AAAA-MM-DD HH:MM:SS' guardado en UTC en la base.
export function diaDeUtc(datetimeUtc) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_NEGOCIO }).format(new Date(`${datetimeUtc.replace(' ', 'T')}Z`));
}

// Hora argentina ('14:05', 24 h) de un 'AAAA-MM-DD HH:MM:SS' guardado en UTC en la base.
export function formatearHora(datetimeUtc) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: ZONA_NEGOCIO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(`${datetimeUtc.replace(' ', 'T')}Z`)
  );
}

// Cuándo fue un cierre de caja: "de hoy a las 14:05" o "del 15/10/2026 a las 21:15" (cierre por turno, 2026-10-16).
export function cuandoFueElCierre(datetimeUtc) {
  const dia = diaDeUtc(datetimeUtc);
  return dia === fechaHoyISO() ? `de hoy a las ${formatearHora(datetimeUtc)}` : `del ${formatearFecha(dia)} a las ${formatearHora(datetimeUtc)}`;
}
