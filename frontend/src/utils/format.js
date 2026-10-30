// Los montos en la base son enteros en pesos (sin decimales) -- ver
// stock.service.js/ventas.service.js: nunca dividen ni multiplican por 100.
export function formatearMonto(valor) {
  const n = Math.round(Number(valor) || 0);
  const signo = n < 0 ? '-' : '';
  return `${signo}$${Math.abs(n).toLocaleString('es-AR')}`;
}

// Lo que CEA le cobra a la empresa va en dólares, en centavos (panel /sa, 2026-10-21): "USD 1.725,00".
export function formatearUsd(centavos) {
  const n = (Number(centavos) || 0) / 100;
  return `USD ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Centavos de dólar para un campo de texto: "253,75" o, si es redondo, "110" (sin puntos de miles).
export function usdParaCampo(centavos) {
  if (centavos === null || centavos === undefined) return '';
  const c = Math.round(Number(centavos) || 0);
  return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2).replace('.', ',');
}

// Equivalente en pesos y dólar blue (2026-10-21): pesos enteros -> "$ 397.119" (con espacio, como en el
// aviso por mail); la cotización llega en centavos de peso -> "$ 1.565" o "$ 1.565,50".
export function formatearPesos(valor) {
  return `$ ${Math.round(Number(valor) || 0).toLocaleString('es-AR')}`;
}

export function formatearCotizacion(centavos) {
  const c = Math.round(Number(centavos) || 0);
  return `$ ${(c / 100).toLocaleString('es-AR', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function formatearFecha(iso) {
  if (!iso) return '';
  const [anio, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anio}`;
}

// La base guarda los timestamps en UTC como 'YYYY-MM-DD HH:MM:SS' (sin zona): se muestran en hora
// argentina, la del negocio, como "29/10/2026 09:35" (antes "29/10/26, 9:35 a. m."; rediseño 2026-10-29).
export function formatearFechaHora(datetimeUtc) {
  if (!datetimeUtc) return '';
  const fecha = new Date(`${datetimeUtc.replace(' ', 'T')}Z`);
  if (Number.isNaN(fecha.getTime())) return datetimeUtc;
  return `${formatearFecha(diaDeUtc(datetimeUtc))} ${formatearHora(datetimeUtc)}`;
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

// Lo mismo, corto, para el panel verde: "hoy, 14:05" o "15/10, 21:15" (2026-10-29: los textos del
// panel no bajan de renglón).
export function cuandoFueElCierreCorto(datetimeUtc) {
  const dia = diaDeUtc(datetimeUtc);
  const hora = formatearHora(datetimeUtc);
  return dia === fechaHoyISO() ? `hoy, ${hora}` : `${formatearFecha(dia).slice(0, 5)}, ${hora}`;
}
