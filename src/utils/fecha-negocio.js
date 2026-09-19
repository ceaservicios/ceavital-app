// El negocio funciona SIEMPRE en hora argentina, sin importar dónde corra el
// servidor (la VPS está en UTC): "hoy", el día de una venta, del cierre de caja
// o de un gasto, y la hora del backup programado se resuelven acá. La base
// guarda CURRENT_TIMESTAMP en UTC; Argentina no tiene horario de verano, así
// que la diferencia es siempre de 3 horas.
export const ZONA_NEGOCIO = 'America/Argentina/Buenos_Aires';

// Fragmento SQL (PostgreSQL): el día argentino de una columna TIMESTAMP guardada en UTC.
// Ej.: WHERE ${sqlDiaNegocio('creado_en')} = ?
export function sqlDiaNegocio(columna) {
  return `((${columna} AT TIME ZONE 'UTC') AT TIME ZONE '${ZONA_NEGOCIO}')::date`;
}

// Fragmento SQL (PostgreSQL): la fecha de hoy en Argentina, calculada en la base.
export const SQL_HOY_NEGOCIO = `(NOW() AT TIME ZONE '${ZONA_NEGOCIO}')::date`;

function partes(fecha) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA_NEGOCIO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(fecha)
      .map((p) => [p.type, p.value])
  );
}

// 'AAAA-MM-DD' de hoy en Argentina.
export function hoyNegocio(ahora = new Date()) {
  const p = partes(ahora);
  return `${p.year}-${p.month}-${p.day}`;
}

// 'HH:MM' de ahora en Argentina.
export function horaNegocio(ahora = new Date()) {
  const p = partes(ahora);
  return `${p.hour}:${p.minute}`;
}

// Día argentino de un 'AAAA-MM-DD HH:MM:SS' guardado en UTC en la base.
export function diaNegocioDeUtc(datetimeUtc) {
  return hoyNegocio(new Date(`${datetimeUtc.replace(' ', 'T')}Z`));
}
