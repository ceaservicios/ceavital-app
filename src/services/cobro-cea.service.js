import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { esDiaValido, hoyNegocio } from '../utils/fecha-negocio.js';

// Lo que CEA le cobra a la empresa, en dólares (decisión del usuario, 2026-10-21; panel /sa >
// Cuota y pagos, migración 026): la implementación en cuotas con recargo, el abono mensual y las
// modificaciones solicitadas (las primeras, sin cargo). Cada mes hay un aviso, el del vencimiento
// pendiente (instancia.cuota_vence): la cuota de la implementación de ese mes, el abono, las
// modificaciones con costo que tocan y el total. Un pago paga el aviso completo y guarda la foto del
// desglose (pagos-cuota.service). Los montos van en centavos de dólar.

export const USD_MAX = 100_000_000; // centavos: USD 1.000.000
export const CUOTAS_MAX = 120;
export const SIN_CARGO_MAX = 100;
const TEXTO_MAX = 200;
const MOTIVO_MAX = 500;

const vacio = (valor) => valor === undefined || valor === null || valor === '';
const anioMes = (iso) => String(iso).slice(0, 7);
const suma = (lista, campo) => lista.reduce((total, x) => total + x[campo], 0);

// 'AAAA-MM-DD' + meses (también negativos), cayendo siempre en el día fijo de vencimiento;
// si ese mes no lo tiene (31 en abril, 30 en febrero), en el último día del mes. Como el
// día sale de `dia` y no de la fecha anterior, un vencimiento el 31 no se va corriendo.
export function sumarMeses(fechaIso, meses, dia) {
  const [anio, mes] = fechaIso.split('-').map(Number);
  const indice = anio * 12 + (mes - 1) + meses;
  const anioNuevo = Math.floor(indice / 12);
  const mesNuevo = indice - anioNuevo * 12; // 0 a 11
  const ultimoDia = new Date(Date.UTC(anioNuevo, mesNuevo + 1, 0)).getUTCDate();
  const d = Math.min(dia, ultimoDia);
  return `${anioNuevo}-${String(mesNuevo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---- Validaciones ----

// Importe con hasta dos decimales -> centavos, o null si no tiene esa forma (sin topes: los pone quien
// la usa). Acepta un número (253.75) o un texto con coma o punto decimal ("253,75", "253.75") y también
// con puntos de miles ("1.725,50"). La usan los dólares y la cotización del dólar blue de un pago.
export function centavosDe(valor) {
  let centavos = null;
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    const redondo = Math.round(valor * 100);
    if (Math.abs(valor * 100 - redondo) < 1e-6) centavos = redondo;
  } else if (typeof valor === 'string') {
    const texto = valor.trim();
    const simple = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(texto);
    const conMiles = simple ? null : /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(texto);
    const partes = simple ?? (conMiles && [conMiles[0], conMiles[1].replaceAll('.', ''), conMiles[2]]);
    if (partes) centavos = Number(partes[1]) * 100 + Number((partes[2] ?? '').padEnd(2, '0'));
  }
  return centavos;
}

// Importe en dólares -> centavos, de 0,01 a 1.000.000.
export function parsearUsd(valor, campo = 'El importe') {
  const centavos = centavosDe(valor);
  if (centavos === null || centavos < 1 || centavos > USD_MAX) {
    throw new ApiError(400, `${campo} tiene que ser un importe en dólares entre 0,01 y 1.000.000 (ej.: 253,75)`);
  }
  return centavos;
}

// Porcentaje de 0 a 100 con hasta dos decimales ("15", "12,5", 7.25).
function parsearRecargo(valor) {
  let numero = null;
  if (typeof valor === 'number' && Number.isFinite(valor)) numero = valor;
  else if (typeof valor === 'string' && /^\d{1,3}(?:[.,]\d{1,2})?$/.test(valor.trim())) numero = Number(valor.trim().replace(',', '.'));
  const centesimas = numero === null ? NaN : Math.round(numero * 100);
  if (!Number.isInteger(centesimas) || Math.abs(numero * 100 - centesimas) > 1e-6 || centesimas < 0 || centesimas > 10_000) {
    throw new ApiError(400, 'El recargo tiene que ser un porcentaje entre 0 y 100, con hasta dos decimales');
  }
  return centesimas / 100;
}

function enteroEntre(valor, minimo, maximo, mensaje) {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < minimo || n > maximo) throw new ApiError(400, mensaje);
  return n;
}

// Texto que sale en el mail: obligatorio, con tope y en una sola línea.
function textoDeUnaLinea(valor, campo) {
  const limpio = typeof valor === 'string' ? valor.trim() : '';
  if (!limpio) throw new ApiError(400, `${campo} es requerido`);
  if (limpio.length > TEXTO_MAX) throw new ApiError(400, `${campo} no puede superar los ${TEXTO_MAX} caracteres`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(limpio)) throw new ApiError(400, `${campo} va en una sola línea, sin saltos`);
  return limpio;
}

function motivoValido(motivo) {
  if (typeof motivo !== 'string' || !motivo.trim()) throw new ApiError(400, 'El motivo de la anulación es requerido');
  if (motivo.trim().length > MOTIVO_MAX) throw new ApiError(400, `El motivo no puede superar los ${MOTIVO_MAX} caracteres`);
  return motivo.trim();
}

// ---- Reglas puras ----

// Cuotas de la implementación. Total = valor × (1 + recargo/100), redondeado al centavo; cada cuota
// es el total dividido la cantidad, redondeado al centavo, y la última se ajusta para que la suma
// cierre exacta. La cuota k vence k−1 meses después de la primera, en el día fijo de la primera.
export function planDeCuotas({ valor, recargo, cuotas, primera_vence: primera }) {
  const total = Math.round((valor * (10_000 + Math.round(recargo * 100))) / 10_000);
  const importe = Math.round(total / cuotas);
  const ultima = total - importe * (cuotas - 1);
  const dia = Number(primera.slice(8));
  return {
    total,
    importe,
    ultima,
    cuotas: Array.from({ length: cuotas }, (_, i) => ({
      numero: i + 1,
      vence: sumarMeses(primera, i, dia),
      importe: i === cuotas - 1 ? ultima : importe,
    })),
  };
}

// En qué aviso se cobra (o sale por primera vez) una modificación de la fecha `fecha`: el primer
// vencimiento de la serie (día fijo `dia`) posterior a esa fecha y no anterior al pendiente `vence`.
export function avisoDeModificacion(fecha, vence, dia) {
  let aviso = vence;
  for (let n = 1; aviso <= fecha; n++) aviso = sumarMeses(vence, n, dia);
  return aviso;
}

// El aviso del vencimiento `vence`. `cobro` es lo que devuelve leerCobro(). Por mes del calendario
// (así un cambio del día de vencimiento no deja nada afuera):
//  - la cuota de la implementación que vence en ese mes, si no está pagada;
//  - el abono;
//  - las modificaciones con costo sin cobrar cuyo aviso es de ese mes o anterior (si se corrió el
//    vencimiento a mano, una que quedó atrás se suma al pendiente: nunca se pierde);
//  - para el mail: el uso de las sin cargo y cuáles se listan (mientras queden, todas las usadas;
//    sin quedar, solo la que tiene su aviso justo en ese mes).
export function armarAviso(vence, cobro) {
  const { impl, abono, sinCargo, cuotasPagadas, modificacionesCobradas } = cobro;
  const activas = cobro.modificaciones.filter((m) => !m.anulada_en);
  const plan = impl ? planDeCuotas(impl) : null;
  const cuota = plan?.cuotas.find((c) => anioMes(c.vence) === anioMes(vence) && !cuotasPagadas.has(c.numero)) ?? null;
  const porFecha = (a, b) => (a.fecha === b.fecha ? a.id - b.id : a.fecha < b.fecha ? -1 : 1);
  const conCosto = activas
    .filter((m) => !m.sin_cargo && !modificacionesCobradas.has(m.id) && anioMes(m.aviso) <= anioMes(vence))
    .sort(porFecha)
    .map((m) => ({ id: m.id, fecha: m.fecha, detalle: m.detalle, importe: m.importe }));
  const sinCargoUsadas = activas.filter((m) => m.sin_cargo);
  const quedan = Math.max(0, sinCargo - sinCargoUsadas.length);
  const listadas = (quedan > 0 ? sinCargoUsadas : sinCargoUsadas.filter((m) => anioMes(m.aviso) === anioMes(vence)))
    .sort(porFecha)
    .map((m) => ({ fecha: m.fecha, detalle: m.detalle }));
  const total = (cuota?.importe ?? 0) + (abono?.importe ?? 0) + suma(conCosto, 'importe');
  return {
    vence,
    // Sin implementación ni abono (ni modificaciones con costo), el aviso sale sin desglose ni total.
    configurado: Boolean(impl || abono || conCosto.length),
    implementacion: cuota
      ? { numero: cuota.numero, de: impl.cuotas, importe: cuota.importe, valor: impl.valor, recargo: impl.recargo, total: plan.total }
      : null,
    abono: abono ? { detalle: abono.detalle, importe: abono.importe } : null,
    modificaciones: { sin_cargo: sinCargo, usadas: sinCargoUsadas.length, quedan, sin_cargo_listadas: listadas, con_costo: conCosto },
    total,
  };
}

// Lo que guarda un pago: qué pagó y cuánto era, para que el historial no cambie si después se edita
// la configuración.
export function fotoDelAviso(aviso) {
  return {
    aviso: aviso.vence,
    moneda: 'USD',
    implementacion: aviso.implementacion
      ? { numero: aviso.implementacion.numero, de: aviso.implementacion.de, importe: aviso.implementacion.importe }
      : null,
    abono: aviso.abono,
    modificaciones: aviso.modificaciones.con_costo,
    total: aviso.total,
  };
}

// ---- Lectura ----

const desgloseDe = (valor) => (typeof valor === 'string' ? JSON.parse(valor) : (valor ?? {}));

// Configuración, modificaciones y qué ya se pagó (por la foto de los pagos en dólares no anulados).
// Dentro de una transacción, lee con ella.
export async function leerCobro() {
  const fila = await db
    .prepare(
      `SELECT cuota_vence, cuota_dia_vence, impl_valor_usd, impl_recargo, impl_cuotas, impl_primera_vence,
              abono_detalle, abono_usd, modif_sin_cargo
       FROM instancia WHERE id = 1`
    )
    .get();
  const modificaciones = await db
    .prepare(
      `SELECT id, fecha, detalle, sin_cargo, importe_usd, aviso, anulada_en, anulada_motivo
       FROM modificaciones_cuota ORDER BY fecha DESC, id DESC`
    )
    .all();
  const pagos = await db
    .prepare(
      `SELECT id, fecha_pago, medio_pago, periodo_desde, desglose FROM pagos_cuota
       WHERE anulado_en IS NULL AND desglose IS NOT NULL ORDER BY id`
    )
    .all();

  const cuotasPagadas = new Map();
  const modificacionesCobradas = new Map();
  for (const p of pagos) {
    const foto = desgloseDe(p.desglose);
    const pago = { pago_id: p.id, fecha_pago: p.fecha_pago, medio_pago: p.medio_pago, aviso: p.periodo_desde };
    if (foto.implementacion?.numero) cuotasPagadas.set(Number(foto.implementacion.numero), pago);
    for (const m of foto.modificaciones ?? []) modificacionesCobradas.set(Number(m.id), pago);
  }

  return {
    vence: fila.cuota_vence ?? null,
    dia: fila.cuota_dia_vence ?? null,
    impl:
      fila.impl_valor_usd === null || fila.impl_valor_usd === undefined
        ? null
        : {
            valor: Number(fila.impl_valor_usd),
            recargo: Number(fila.impl_recargo),
            cuotas: Number(fila.impl_cuotas),
            primera_vence: fila.impl_primera_vence,
          },
    abono:
      fila.abono_usd === null || fila.abono_usd === undefined ? null : { detalle: fila.abono_detalle, importe: Number(fila.abono_usd) },
    sinCargo: Number(fila.modif_sin_cargo ?? 0),
    modificaciones: modificaciones.map((m) => ({
      id: m.id,
      fecha: m.fecha,
      detalle: m.detalle,
      sin_cargo: Boolean(m.sin_cargo),
      importe: m.importe_usd === null || m.importe_usd === undefined ? null : Number(m.importe_usd),
      aviso: m.aviso,
      anulada_en: m.anulada_en ?? null,
      anulada_motivo: m.anulada_motivo ?? null,
    })),
    cuotasPagadas,
    modificacionesCobradas,
  };
}

// El aviso de un vencimiento cualquiera (el mail de prueba usa uno de ejemplo si no hay vencimiento).
export async function avisoDelVencimiento(vence) {
  return vence ? armarAviso(vence, await leerCobro()) : null;
}

// Para el panel: implementación con sus cuotas, abono, modificaciones y el aviso pendiente.
export async function estadoCobro() {
  const cobro = await leerCobro();
  const hoy = hoyNegocio();

  let implementacion = null;
  if (cobro.impl) {
    const plan = planDeCuotas(cobro.impl);
    const detalle = plan.cuotas.map((c) => {
      const pago = cobro.cuotasPagadas.get(c.numero) ?? null;
      return {
        ...c,
        estado: pago ? 'pagada' : c.vence < hoy ? 'vencida' : 'pendiente',
        pago: pago ? { id: pago.pago_id, fecha: pago.fecha_pago, medio_pago: pago.medio_pago } : null,
      };
    });
    const pagadas = detalle.filter((c) => c.estado === 'pagada');
    const pagado = suma(pagadas, 'importe');
    implementacion = {
      ...cobro.impl,
      total: plan.total,
      importe_cuota: plan.importe,
      importe_ultima: plan.ultima,
      detalle,
      pagadas: pagadas.length,
      faltan: cobro.impl.cuotas - pagadas.length,
      pagado,
      resta: plan.total - pagado,
    };
  }

  const usadas = cobro.modificaciones.filter((m) => m.sin_cargo && !m.anulada_en).length;
  const lista = cobro.modificaciones.map((m) => {
    let estado = 'a_cobrar';
    let aviso = m.aviso;
    if (m.anulada_en) estado = 'anulada';
    else if (m.sin_cargo) estado = 'sin_cargo';
    else if (cobro.modificacionesCobradas.has(m.id)) {
      estado = 'cobrada';
      aviso = cobro.modificacionesCobradas.get(m.id).aviso;
    } else if (cobro.vence && anioMes(m.aviso) <= anioMes(cobro.vence)) {
      aviso = cobro.vence; // va en el aviso pendiente
    }
    return { ...m, estado, aviso };
  });

  return {
    implementacion,
    abono: cobro.abono,
    modificaciones: { sin_cargo: cobro.sinCargo, usadas, quedan: Math.max(0, cobro.sinCargo - usadas), lista },
    aviso: cobro.vence ? armarAviso(cobro.vence, cobro) : null,
  };
}

// ---- Escritura ----

// Implementación: los cuatro datos, o los cuatro vacíos para quitarla. No se puede bajar la cantidad
// de cuotas por debajo de una ya pagada.
export async function fijarImplementacion(datos = {}) {
  const { valor, recargo, cuotas, primera_vence: primera } = datos;
  const vacios = [valor, recargo, cuotas, primera].filter(vacio).length;
  if (vacios > 0 && vacios < 4) throw new ApiError(400, 'Completá los cuatro datos de la implementación (o dejalos todos vacíos para quitarla)');

  let impl = null;
  if (vacios === 0) {
    impl = {
      valor: parsearUsd(valor, 'El valor de la implementación'),
      recargo: parsearRecargo(recargo),
      cuotas: enteroEntre(cuotas, 1, CUOTAS_MAX, `La cantidad de cuotas tiene que ser un entero entre 1 y ${CUOTAS_MAX}`),
      primera_vence: primera,
    };
    if (!esDiaValido(primera)) throw new ApiError(400, 'La fecha de la primera cuota tiene que ser una fecha real (AAAA-MM-DD)');
    const plan = planDeCuotas(impl);
    if (plan.importe < 1 || plan.ultima < 1) throw new ApiError(400, 'El total no alcanza para esa cantidad de cuotas');
  }

  await db.transaction(async () => {
    const { cuotasPagadas } = await leerCobro();
    const mayorPagada = Math.max(0, ...cuotasPagadas.keys());
    if (mayorPagada > (impl?.cuotas ?? 0)) {
      throw new ApiError(409, `Ya está pagada la cuota ${mayorPagada}: la implementación no puede tener menos cuotas. Si un pago se anotó mal, anulalo primero.`);
    }
    await db
      .prepare(
        `UPDATE instancia SET impl_valor_usd = ?, impl_recargo = ?, impl_cuotas = ?, impl_primera_vence = ?,
                actualizado_en = CURRENT_TIMESTAMP
         WHERE id = 1`
      )
      .run(impl?.valor ?? null, impl?.recargo ?? null, impl?.cuotas ?? null, impl?.primera_vence ?? null);
  });
  return impl;
}

// Abono mensual: qué incluye (una línea) y el importe por mes; los dos vacíos lo quitan.
export async function fijarAbono(datos = {}) {
  const { detalle, importe } = datos;
  const sinDetalle = vacio(typeof detalle === 'string' ? detalle.trim() : detalle);
  if (sinDetalle !== vacio(importe)) throw new ApiError(400, 'Completá qué incluye y el importe por mes (o dejá los dos vacíos para quitar el abono)');
  const abono = sinDetalle ? null : { detalle: textoDeUnaLinea(detalle, 'Qué incluye'), importe: parsearUsd(importe, 'El importe por mes') };
  await db
    .prepare('UPDATE instancia SET abono_detalle = ?, abono_usd = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = 1')
    .run(abono?.detalle ?? null, abono?.importe ?? null);
  return abono;
}

const SQL_SIN_CARGO_USADAS = 'SELECT COUNT(*) FROM modificaciones_cuota WHERE sin_cargo AND anulada_en IS NULL';

// Cuántas modificaciones son sin cargo en todo el contrato. No puede quedar por debajo de las ya
// usadas (el tope va en el WHERE del mismo UPDATE).
export async function fijarModificacionesSinCargo(cantidad) {
  const n = enteroEntre(cantidad, 0, SIN_CARGO_MAX, `Las modificaciones sin cargo tienen que ser un entero entre 0 y ${SIN_CARGO_MAX}`);
  return db.transaction(async () => {
    const r = await db
      .prepare(`UPDATE instancia SET modif_sin_cargo = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = 1 AND ? >= (${SQL_SIN_CARGO_USADAS})`)
      .run(n, n);
    if (!r.changes) {
      const { usadas } = await db.prepare(`SELECT (${SQL_SIN_CARGO_USADAS}) AS usadas`).get();
      throw new ApiError(409, `Ya se usaron ${usadas} modificaciones sin cargo: no pueden ser menos. Si alguna se anotó por error, anulala primero.`);
    }
    return { sin_cargo: n };
  });
}

// Anota una modificación. Mientras queden sin cargo va sin importe ("Sin cargo"); usadas todas, va
// con su importe y se cobra una sola vez, en el aviso siguiente. Lo decide el servidor: si la
// pantalla quedó vieja, responde 409 en vez de anotarla distinta de lo que se vio.
export async function anotarModificacion(datos = {}) {
  const { fecha } = datos;
  if (!esDiaValido(fecha)) throw new ApiError(400, 'La fecha tiene que ser una fecha real (AAAA-MM-DD)');
  if (fecha > hoyNegocio()) throw new ApiError(400, 'La fecha no puede ser posterior a hoy');
  const detalle = textoDeUnaLinea(datos.detalle, 'El detalle');
  const importe = vacio(datos.importe) ? null : parsearUsd(datos.importe, 'El importe de la modificación');

  return db.transaction(async () => {
    const instancia = await db.prepare('SELECT cuota_vence, cuota_dia_vence, modif_sin_cargo FROM instancia WHERE id = 1').get();
    if (!instancia.cuota_vence) {
      throw new ApiError(409, 'Cargá primero el próximo vencimiento (tarjeta Aviso del mes): de ahí sale en qué aviso va la modificación');
    }
    const dia = instancia.cuota_dia_vence ?? Number(instancia.cuota_vence.slice(8));
    const aviso = avisoDeModificacion(fecha, instancia.cuota_vence, dia);

    if (importe === null) {
      const fila = await db
        .prepare(
          `INSERT INTO modificaciones_cuota (fecha, detalle, sin_cargo, importe_usd, aviso)
           SELECT ?::date, ?::text, TRUE, NULL::bigint, ?::date
           WHERE (${SQL_SIN_CARGO_USADAS}) < (SELECT modif_sin_cargo FROM instancia WHERE id = 1)
           RETURNING id`
        )
        .get(fecha, detalle, aviso);
      if (!fila) {
        throw new ApiError(409, `Ya se usaron las ${instancia.modif_sin_cargo} modificaciones sin cargo: cargá el importe de esta.`);
      }
      return { id: fila.id, fecha, detalle, sin_cargo: true, importe: null, aviso };
    }

    const { usadas } = await db.prepare(`SELECT (${SQL_SIN_CARGO_USADAS}) AS usadas`).get();
    if (Number(usadas) < instancia.modif_sin_cargo) {
      throw new ApiError(409, `Todavía quedan modificaciones sin cargo (${usadas} de ${instancia.modif_sin_cargo} usadas): anotala sin importe.`);
    }
    const fila = await db
      .prepare(
        `INSERT INTO modificaciones_cuota (fecha, detalle, sin_cargo, importe_usd, aviso)
         VALUES (?, ?, FALSE, ?, ?) RETURNING id`
      )
      .get(fecha, detalle, importe, aviso);
    return { id: fila.id, fecha, detalle, sin_cargo: false, importe, aviso };
  });
}

// Anular = baja lógica con motivo (nunca se borra). Una con costo que ya se cobró en un pago no se
// anula: primero hay que anular ese pago (si no, la foto del pago quedaría mintiendo).
export async function anularModificacion(id, motivo) {
  const limpio = motivoValido(motivo);
  return db.transaction(async () => {
    const m = await db.prepare('SELECT id, sin_cargo, anulada_en FROM modificaciones_cuota WHERE id = ?').get(id);
    if (!m) throw new ApiError(404, 'Modificación no encontrada');
    if (m.anulada_en) throw new ApiError(409, 'Esa modificación ya está anulada');
    if (!m.sin_cargo) {
      const pago = await db
        .prepare(
          `SELECT id, periodo_desde FROM pagos_cuota
           WHERE anulado_en IS NULL AND desglose -> 'modificaciones' @> ?::jsonb LIMIT 1`
        )
        .get(JSON.stringify([{ id }]));
      if (pago) {
        const aviso = pago.periodo_desde.split('-').reverse().join('/');
        throw new ApiError(409, `Esa modificación ya se cobró con el aviso del ${aviso}: para anularla, anulá primero ese pago.`);
      }
    }
    await db
      .prepare('UPDATE modificaciones_cuota SET anulada_en = CURRENT_TIMESTAMP, anulada_motivo = ? WHERE id = ? AND anulada_en IS NULL')
      .run(limpio, id);
    return { id, sin_cargo: Boolean(m.sin_cargo), motivo: limpio };
  });
}
