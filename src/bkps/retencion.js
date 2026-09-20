// Retención de los backups automáticos: 7 diarios + 4 semanales. Sirve igual para la carpeta
// del servidor y para la de Google Drive (se le pasan los nombres y devuelve qué borrar).
//
// Nombre esperado: ceavital-backup-AAAAMMDD-HHMMSS.ceavbak (la hora es UTC, la pone producción).
// Un archivo con otro nombre NUNCA se toca: no es nuestro.

const PATRON = /^ceavital-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.ceavbak$/;

export function fechaDeArchivo(nombre) {
  const m = PATRON.exec(nombre);
  if (!m) return null;
  const fecha = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  // Date.UTC "arregla" fechas imposibles (mes 13 = enero del año siguiente): se rechazan.
  const coincide = fecha.getUTCMonth() === +m[2] - 1 && fecha.getUTCDate() === +m[3] && fecha.getUTCHours() === +m[4];
  return coincide ? fecha : null;
}

// Lunes (UTC) de la semana de esa fecha, como 'AAAA-MM-DD'.
function semanaDe(fecha) {
  const lunes = new Date(fecha);
  lunes.setUTCDate(lunes.getUTCDate() - ((lunes.getUTCDay() + 6) % 7));
  return lunes.toISOString().slice(0, 10);
}

/**
 * Devuelve { conservar: [nombres], borrar: [nombres] }.
 *  - diarios: el backup más nuevo de cada uno de los últimos N días que tengan backup.
 *  - semanales: el backup más nuevo de cada una de las últimas N semanas que tengan backup.
 * El más nuevo de todos siempre se conserva.
 */
export function planDeRetencion(nombres, { diarios = 7, semanales = 4 } = {}) {
  const propios = nombres
    .map((nombre) => ({ nombre, fecha: fechaDeArchivo(nombre) }))
    .filter((a) => a.fecha)
    .sort((a, b) => b.fecha - a.fecha || (a.nombre < b.nombre ? 1 : -1)); // del más nuevo al más viejo

  const conservar = new Set();
  const porDia = new Set();
  const porSemana = new Set();
  for (const { nombre, fecha } of propios) {
    const dia = fecha.toISOString().slice(0, 10);
    if (!porDia.has(dia) && porDia.size < diarios) {
      porDia.add(dia);
      conservar.add(nombre);
    }
    const semana = semanaDe(fecha);
    if (!porSemana.has(semana) && porSemana.size < semanales) {
      porSemana.add(semana);
      conservar.add(nombre);
    }
  }
  return {
    conservar: propios.filter((a) => conservar.has(a.nombre)).map((a) => a.nombre),
    borrar: propios.filter((a) => !conservar.has(a.nombre)).map((a) => a.nombre),
  };
}
