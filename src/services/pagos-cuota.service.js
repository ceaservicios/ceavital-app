import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { esDiaValido, hoyNegocio } from '../utils/fecha-negocio.js';
import {
  armarAviso,
  armarAvisoImplementacion,
  centavosDe,
  fotoDelAviso,
  leerCobro,
  parsearUsd,
  pendientesDeCobro,
  sumarDias,
  sumarMeses,
  vencimientoSiguiente,
} from './cobro-cea.service.js';
import { VENTA_MAX_CENT, VENTA_MIN_CENT } from './dolar-blue.service.js';
import { aplicarReactivacion, avisarReactivacion, esFechaReal } from './instancia.service.js';

// Historial de pagos de lo que CEA le cobra a la empresa (panel /sa). Se anota a mano: no cobra ni
// se conecta con ningún medio de pago. Desde el 2026-10-21 cada pago es en dólares y guarda la foto
// de lo que pagó; los de antes siguen en pesos (moneda 'ARS', sin foto). Desde el 2026-11-09
// (migración 044) cada pago es de uno de los dos cobros (`concepto`, ver cobro-cea.service):
//  - 'implementacion': la cuota pendiente de la implementación (la primera sin pagar). No mueve el
//    vencimiento del abono;
//  - 'abono': el aviso del abono pendiente (abono y modificaciones con costo) y corre el vencimiento un
//    mes, contando SIEMPRE desde el vencimiento y no desde el día en que se pagó ("vence el 10, paga el
//    15: el próximo vence el 10"). Si el abono todavía no arrancó, pasa a la fecha del primer abono
//    (cobro-cea.vencimientoSiguiente).
// Opcional (2026-10-21, migración 027): cuánto se pagó en pesos y a qué cotización del dólar blue; van
// los dos o ninguno.

export { sumarMeses };
export const MEDIOS_PAGO = ['transferencia', 'efectivo', 'mercado_pago', 'tarjeta', 'otro'];
export const CONCEPTOS = ['abono', 'implementacion'];
const COMPROBANTE_MAX = 100;
const NOTA_MAX = 500;
const MOTIVO_MAX = 500;
const PESOS_MAX = 1_000_000_000; // el mismo tope que el resto de los montos en pesos del sistema

const vacio = (valor) => valor === undefined || valor === null || (typeof valor === 'string' && !valor.trim());
const fechaAr = (iso) => iso.split('-').reverse().join('/');
const desgloseDe = (valor) => (typeof valor === 'string' ? JSON.parse(valor) : (valor ?? null));

// Pesos enteros: un número entero o un texto ("397119", o "397.119" con puntos de miles). Vacío = null.
function pesosOpcionales(valor) {
  if (vacio(valor)) return null;
  let n = null;
  if (typeof valor === 'number') n = valor;
  else if (typeof valor === 'string') {
    const texto = valor.trim();
    if (/^\d{1,10}$/.test(texto)) n = Number(texto);
    else if (/^\d{1,3}(?:\.\d{3}){1,3}$/.test(texto)) n = Number(texto.replaceAll('.', ''));
  }
  if (!Number.isInteger(n) || n < 1 || n > PESOS_MAX) {
    throw new ApiError(400, 'Lo pagado en pesos tiene que ser un importe entero entre 1 y 1.000.000.000 (ej.: 397119)');
  }
  return n;
}

// Cotización del dólar blue que se usó ("1565", "1565,50"), en centavos de peso. Vacía = null.
function cotizacionOpcional(valor) {
  if (vacio(valor)) return null;
  const centavos = centavosDe(valor);
  if (centavos === null || centavos < VENTA_MIN_CENT || centavos > VENTA_MAX_CENT) {
    throw new ApiError(400, 'La cotización del dólar blue tiene que ser un importe en pesos entre 1 y 1.000.000, con hasta dos decimales (ej.: 1565 o 1565,50)');
  }
  return centavos;
}

function textoOpcional(valor, campo, max) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ApiError(400, `${campo} tiene que ser texto`);
  const limpio = valor.trim();
  if (limpio.length > max) throw new ApiError(400, `${campo} no puede superar los ${max} caracteres`);
  return limpio || null;
}

function validarPago(datos) {
  const fechaPago = datos.fecha_pago;
  if (!esFechaReal(fechaPago)) throw new ApiError(400, 'La fecha de pago tiene que ser una fecha real (AAAA-MM-DD)');
  if (fechaPago > hoyNegocio()) throw new ApiError(400, 'La fecha de pago no puede ser posterior a hoy');

  // Qué se paga. Sin concepto (Gestión, o una pantalla vieja), se elige por el vencimiento del aviso.
  const concepto = vacio(datos.concepto) ? null : datos.concepto;
  if (concepto !== null && !CONCEPTOS.includes(concepto)) throw new ApiError(400, 'Elegí qué se paga: el abono o la cuota de la implementación');

  // El vencimiento que la pantalla mostraba como pendiente: si cambió (otro pago, otra pestaña), no se
  // anota un pago distinto del que se vio.
  const aviso = datos.aviso === undefined || datos.aviso === null || datos.aviso === '' ? null : datos.aviso;
  if (aviso !== null && !esDiaValido(aviso)) throw new ApiError(400, 'El aviso que paga tiene que ser una fecha real (AAAA-MM-DD)');

  if (!MEDIOS_PAGO.includes(datos.medio_pago)) throw new ApiError(400, 'Elegí un medio de pago válido');

  const pesosPagados = pesosOpcionales(datos.pesos_pagados);
  const cotizacionBlue = cotizacionOpcional(datos.cotizacion_blue);
  if ((pesosPagados === null) !== (cotizacionBlue === null)) {
    throw new ApiError(400, 'Lo pagado en pesos y la cotización del dólar blue van juntos: completá los dos o dejá los dos vacíos');
  }

  return {
    fechaPago,
    concepto,
    aviso,
    monto: parsearUsd(datos.monto, 'El monto'),
    medioPago: datos.medio_pago,
    comprobante: textoOpcional(datos.comprobante, 'El comprobante', COMPROBANTE_MAX),
    nota: textoOpcional(datos.nota, 'La nota', NOTA_MAX),
    pesosPagados,
    cotizacionBlue,
  };
}

// moneda: 'USD' (monto en centavos de dólar, con la foto en desglose) o 'ARS' (pesos enteros, los
// de antes del 2026-10-21). pesos_pagados (enteros) y cotizacion_blue_cent: null si no se cargaron.
// concepto: 'abono' o 'implementacion' (los de antes del 2026-11-09, según su foto: migración 044).
export function listarPagos() {
  return db
    .prepare(
      `SELECT id, fecha_pago, monto, moneda, meses, periodo_desde, periodo_hasta, medio_pago, comprobante, nota, desglose,
              pesos_pagados, cotizacion_blue_cent, concepto, anulado_en, anulado_motivo, creado_en
       FROM pagos_cuota ORDER BY fecha_pago DESC, id DESC`
    )
    .all();
}

// Sin concepto elegido (Gestión paga el vencimiento pendiente que ve): el cobro de ese vencimiento o,
// sin vencimiento, el más viejo. Sin nada pendiente, el abono (el pago cuenta desde su propia fecha).
function conceptoSinElegir(cobro, aviso) {
  const pendientes = pendientesDeCobro(cobro);
  const elegido = aviso === null ? pendientes[0] : pendientes.find((p) => p.vence === aviso);
  if (elegido) return elegido.concepto;
  if (aviso !== null && pendientes.length) {
    throw new ApiError(409, `El vencimiento pendiente cambió (ahora es el del ${fechaAr(pendientes[0].vence)}): revisá la pantalla y volvé a anotar el pago.`);
  }
  return 'abono';
}

async function insertarPago(pago, { concepto, desde, hasta, foto, diaAnterior }) {
  const { id } = await db
    .prepare(
      `INSERT INTO pagos_cuota (fecha_pago, monto, moneda, meses, periodo_desde, periodo_hasta, medio_pago, comprobante, nota, desglose,
                                pesos_pagados, cotizacion_blue_cent, dia_vence_anterior, concepto)
       VALUES (?, ?, 'USD', 1, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?) RETURNING id`
    )
    .get(
      pago.fechaPago,
      pago.monto,
      desde,
      hasta,
      pago.medioPago,
      pago.comprobante,
      pago.nota,
      JSON.stringify(foto),
      pago.pesosPagados,
      pago.cotizacionBlue,
      diaAnterior,
      concepto
    );
  return id;
}

// La cuota pendiente de la implementación. periodo_desde y periodo_hasta: su vencimiento.
async function pagarCuota(cobro, pago) {
  const aviso = armarAvisoImplementacion(cobro);
  if (!aviso) throw new ApiError(409, 'No hay cuotas de la implementación sin pagar.');
  if (pago.aviso !== null && pago.aviso !== aviso.vence) {
    const { numero, de } = aviso.implementacion;
    throw new ApiError(409, `La cuota pendiente cambió (ahora es la ${numero} de ${de}, del ${fechaAr(aviso.vence)}): revisá la pantalla y volvé a anotar el pago.`);
  }
  const foto = fotoDelAviso(aviso);
  const id = await insertarPago(pago, { concepto: 'implementacion', desde: aviso.vence, hasta: aviso.vence, foto, diaAnterior: null });
  return { id, aviso: aviso.vence, cuota_vence: cobro.vence, desglose: foto };
}

// El aviso del abono pendiente, y el vencimiento del abono pasa al siguiente. Sin vencimiento cargado,
// el pago cuenta desde su propia fecha y ese día queda como día de vencimiento.
async function pagarAbono(cobro, pago) {
  const desde = cobro.vence ?? pago.fechaPago;
  if (pago.aviso !== null && pago.aviso !== desde) {
    throw new ApiError(409, `El aviso del abono pendiente cambió (ahora es el del ${fechaAr(desde)}): revisá la pantalla y volvé a anotar el pago.`);
  }
  // Un aviso del abono sin nada para cobrar no se paga (lo de antes, sin desglose ni implementación, sí).
  const aviso = armarAviso(desde, cobro);
  if (aviso.total === 0 && (aviso.configurado || cobro.impl)) {
    throw new ApiError(409, 'El aviso del abono no tiene nada para cobrar (ni abono ni modificaciones con costo): si es de la implementación, elegí la cuota.');
  }
  const dia = (cobro.vence && cobro.dia) || Number(desde.slice(8));
  const { vence: hasta, dia: diaNuevo } = vencimientoSiguiente(desde, dia, cobro.abono);
  const foto = fotoDelAviso(aviso);
  const id = await insertarPago(pago, { concepto: 'abono', desde, hasta, foto, diaAnterior: cobro.vence ? cobro.dia : null });
  await db
    .prepare('UPDATE instancia SET cuota_vence = ?, cuota_dia_vence = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = 1')
    .run(hasta, diaNuevo);
  return { id, aviso: desde, cuota_vence: hasta, desglose: foto };
}

// Si la instalación estaba suspendida POR LA CUOTA (la suspendió el sistema) y con lo que queda
// pendiente (`masViejo`, el vencimiento sin pagar más viejo) ya no correspondería suspenderla, se
// reactiva en la transacción en curso. Una suspensión manual no se toca.
async function reactivarSiYaNoCorresponde(masViejo) {
  const fila = await db.prepare('SELECT estado, suspension_por_cuota, cuota_suspender_dias FROM instancia WHERE id = 1').get();
  if (fila.estado !== 'suspendida' || !fila.suspension_por_cuota) return false;
  if (masViejo && fila.cuota_suspender_dias && sumarDias(masViejo.vence, fila.cuota_suspender_dias) <= hoyNegocio()) return false;
  await aplicarReactivacion();
  return true;
}

// Anota el pago de uno de los dos cobros (`concepto`) en una transacción. Si eso levanta la causa de una
// suspensión automática, la instalación se reactiva sola y se le avisa a la empresa por mail.
// Devuelve, además del pago, `proximo`: el vencimiento sin pagar más viejo que queda ({ concepto, vence } o null).
export async function registrarPago(datos = {}) {
  const pago = validarPago(datos);

  const resultado = await db.transaction(async () => {
    const cobro = await leerCobro();
    const concepto = pago.concepto ?? conceptoSinElegir(cobro, pago.aviso);
    const r = concepto === 'implementacion' ? await pagarCuota(cobro, pago) : await pagarAbono(cobro, pago);
    // Lo que queda pendiente (leído en la misma transacción: ya cuenta este pago).
    const [masViejo] = pendientesDeCobro(await leerCobro());
    const reactivada = await reactivarSiYaNoCorresponde(masViejo);

    return {
      ...r,
      concepto,
      proximo: masViejo ? { concepto: masViejo.concepto, vence: masViejo.vence } : null,
      reactivada,
      monto: pago.monto,
      moneda: 'USD',
      total: r.desglose.total,
      pesos_pagados: pago.pesosPagados,
      cotizacion_blue_cent: pago.cotizacionBlue,
    };
  });

  return { ...resultado, avisado_a: resultado.reactivada ? await avisarReactivacion() : null };
}

// Un pago mal cargado no se borra ni se edita: se anula con un motivo y lo que pagó vuelve a quedar
// pendiente (lo que tenía su foto deja de contar como pagado). Solo se anula el último pago sin anular
// de su cobro: anular uno del medio dejaría su aviso fuera de la cadena (2026-10-21; por cobro desde el
// 2026-11-09). Uno del abono además devuelve el vencimiento al aviso que pagó, con el día fijo de antes
// (el pago pudo haberlo pasado a la fecha del primer abono); si después se lo cambió a mano, vuelve
// atrás los meses que había corrido desde el actual. Como ese pago no existió, se olvida la marca de
// "ya se suspendió sola por este vencimiento": si corresponde, la próxima revisión horaria la suspende de nuevo.
export async function anularPago(id, motivo) {
  if (typeof motivo !== 'string' || !motivo.trim()) throw new ApiError(400, 'El motivo de la anulación es requerido');
  if (motivo.trim().length > MOTIVO_MAX) throw new ApiError(400, `El motivo no puede superar los ${MOTIVO_MAX} caracteres`);

  return db.transaction(async () => {
    const pago = await db
      .prepare('SELECT meses, periodo_desde, periodo_hasta, dia_vence_anterior, desglose, concepto, anulado_en FROM pagos_cuota WHERE id = ?')
      .get(id);
    if (!pago) throw new ApiError(404, 'Pago no encontrado');
    if (pago.anulado_en) throw new ApiError(409, 'Ese pago ya está anulado');
    const deLaCuota = pago.concepto === 'implementacion';
    const { ultimo } = await db.prepare('SELECT MAX(id) AS ultimo FROM pagos_cuota WHERE anulado_en IS NULL AND concepto = ?').get(pago.concepto);
    if (Number(ultimo) !== id) {
      throw new ApiError(409, `Solo se puede anular el último pago ${deLaCuota ? 'de la implementación' : 'del abono'}: anulá primero los posteriores.`);
    }

    await db
      .prepare('UPDATE pagos_cuota SET anulado_en = CURRENT_TIMESTAMP, anulado_motivo = ? WHERE id = ?')
      .run(motivo.trim(), id);

    if (deLaCuota) {
      await db.prepare('UPDATE instancia SET suspension_auto_vence = NULL, actualizado_en = CURRENT_TIMESTAMP WHERE id = 1').run();
      return { concepto: 'implementacion', aviso: pago.periodo_desde, numero: desgloseDe(pago.desglose)?.implementacion?.numero ?? null };
    }

    const instancia = await db.prepare('SELECT cuota_vence, cuota_dia_vence FROM instancia WHERE id = 1').get();
    if (!instancia.cuota_vence) return { concepto: 'abono', cuota_vence: null };
    let dia = instancia.cuota_dia_vence ?? Number(instancia.cuota_vence.slice(8));
    let vence;
    if (instancia.cuota_vence === pago.periodo_hasta) {
      vence = pago.periodo_desde;
      dia = pago.dia_vence_anterior ?? dia;
    } else {
      vence = sumarMeses(instancia.cuota_vence, -pago.meses, dia);
    }
    await db
      .prepare(
        `UPDATE instancia SET cuota_vence = ?, cuota_dia_vence = ?, suspension_auto_vence = NULL, actualizado_en = CURRENT_TIMESTAMP
         WHERE id = 1`
      )
      .run(vence, dia);
    return { concepto: 'abono', cuota_vence: vence };
  });
}
