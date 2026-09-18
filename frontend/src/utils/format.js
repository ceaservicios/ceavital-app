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

export function fechaHoyISO() {
  return new Date().toISOString().slice(0, 10);
}
