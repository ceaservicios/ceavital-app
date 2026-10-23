import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { esDiaValido, hoyNegocio, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
import { armarAviso, centavosDe, fotoDelAviso, leerCobro, parsearUsd, sumarMeses } from './cobro-cea.service.js';
import { VENTA_MAX_CENT, VENTA_MIN_CENT } from './dolar-blue.service.js';
import { aplicarReactivacion, avisarReactivacion, esFechaReal } from './instancia.service.js';

// Historial de pagos de lo que CEA le cobra a la empresa (panel /sa). Se anota a mano: no cobra ni
// se conecta con ningún medio de pago. Desde el 2026-10-21 cada pago es en dólares y paga el aviso
// pendiente completo (cuota de la implementación, abono y modificaciones con costo: ver
// cobro-cea.service), guarda la foto de ese desglose y corre el vencimiento un mes, contando
// SIEMPRE desde el vencimiento y no desde el día en que se pagó ("vence el 10, paga el 15: el
// próximo vence el 10"). Los pagos de antes siguen en pesos (moneda 'ARS', sin foto).
// Opcional (2026-10-21, migración 027): cuánto se pagó en pesos y a qué cotización del dólar blue; van
// los dos o ninguno.

export { sumarMeses };
export const MEDIOS_PAGO = ['transferencia', 'efectivo', 'mercado_pago', 'tarjeta', 'otro'];
const COMPROBANTE_MAX = 100;
const NOTA_MAX = 500;
const MOTIVO_MAX = 500;
const PESOS_MAX = 1_000_000_000; // el mismo tope que el resto de los montos en pesos del sistema

const vacio = (valor) => valor === undefined || valor === null || (typeof valor === 'string' && !valor.trim());

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

  // El aviso que la pantalla mostraba como pendiente: si cambió (otro pago, otra pestaña), no se
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
export function listarPagos() {
  return db
    .prepare(
      `SELECT id, fecha_pago, monto, moneda, meses, periodo_desde, periodo_hasta, medio_pago, comprobante, nota, desglose,
              pesos_pagados, cotizacion_blue_cent, anulado_en, anulado_motivo, creado_en
       FROM pagos_cuota ORDER BY fecha_pago DESC, id DESC`
    )
    .all();
}

// Anota el pago del aviso pendiente y corre el vencimiento un mes, en la misma transacción. Sin
// vencimiento cargado, el pago cuenta desde su propia fecha y ese día queda como día de vencimiento.
// Si la instalación estaba suspendida POR LA CUOTA (la suspendió el sistema) y con el vencimiento
// nuevo ya no correspondería suspenderla, se reactiva sola y se le avisa a la empresa por mail. Una
// suspensión manual no se toca.
export async function registrarPago(datos = {}) {
  const pago = validarPago(datos);

  const resultado = await db.transaction(async () => {
    const cobro = await leerCobro();
    const desde = cobro.vence ?? pago.fechaPago;
    if (pago.aviso !== null && pago.aviso !== desde) {
      const ahora = desde.split('-').reverse().join('/');
      throw new ApiError(409, `El aviso pendiente cambió (ahora es el del ${ahora}): revisá la pantalla y volvé a anotar el pago.`);
    }
    const dia = (cobro.vence && cobro.dia) || Number(desde.slice(8));
    const hasta = sumarMeses(desde, 1, dia);
    const foto = fotoDelAviso(armarAviso(desde, cobro));

    const { id } = await db
      .prepare(
        `INSERT INTO pagos_cuota (fecha_pago, monto, moneda, meses, periodo_desde, periodo_hasta, medio_pago, comprobante, nota, desglose,
                                  pesos_pagados, cotizacion_blue_cent)
         VALUES (?, ?, 'USD', 1, ?, ?, ?, ?, ?, ?::jsonb, ?, ?) RETURNING id`
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
        pago.cotizacionBlue
      );
    await db
      .prepare('UPDATE instancia SET cuota_vence = ?, cuota_dia_vence = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = 1')
      .run(hasta, dia);

    const estado = await db
      .prepare(
        `SELECT estado, suspension_por_cuota, (?::date + cuota_suspender_dias) <= ${SQL_HOY_NEGOCIO} AS sigue_para_suspender
         FROM instancia WHERE id = 1`
      )
      .get(hasta);
    const reactivada = estado.estado === 'suspendida' && estado.suspension_por_cuota && !estado.sigue_para_suspender;
    if (reactivada) await aplicarReactivacion();

    return {
      id,
      aviso: desde,
      cuota_vence: hasta,
      reactivada,
      monto: pago.monto,
      moneda: 'USD',
      total: foto.total,
      desglose: foto,
      pesos_pagados: pago.pesosPagados,
      cotizacion_blue_cent: pago.cotizacionBlue,
    };
  });

  return { ...resultado, avisado_a: resultado.reactivada ? await avisarReactivacion() : null };
}

// Un pago mal cargado no se borra ni se edita: se anula con un motivo y el vencimiento vuelve atrás
// los meses que había corrido (desde el vencimiento actual, por si después se lo cambió a mano), así
// su aviso vuelve a quedar pendiente (lo que tenía su foto deja de contar como pagado). Solo se
// anula el último pago sin anular: anular uno del medio dejaría su aviso fuera de la cadena de
// vencimientos (2026-10-21). Como ese pago no existió, se olvida la marca de "ya se suspendió sola
// por este vencimiento": si con el vencimiento de vuelta corresponde, la próxima revisión horaria la
// suspende de nuevo.
export async function anularPago(id, motivo) {
  if (typeof motivo !== 'string' || !motivo.trim()) throw new ApiError(400, 'El motivo de la anulación es requerido');
  if (motivo.trim().length > MOTIVO_MAX) throw new ApiError(400, `El motivo no puede superar los ${MOTIVO_MAX} caracteres`);

  return db.transaction(async () => {
    const pago = await db.prepare('SELECT meses, anulado_en FROM pagos_cuota WHERE id = ?').get(id);
    if (!pago) throw new ApiError(404, 'Pago no encontrado');
    if (pago.anulado_en) throw new ApiError(409, 'Ese pago ya está anulado');
    const { ultimo } = await db.prepare('SELECT MAX(id) AS ultimo FROM pagos_cuota WHERE anulado_en IS NULL').get();
    if (Number(ultimo) !== id) throw new ApiError(409, 'Solo se puede anular el último pago anotado: anulá primero los posteriores.');

    await db
      .prepare('UPDATE pagos_cuota SET anulado_en = CURRENT_TIMESTAMP, anulado_motivo = ? WHERE id = ?')
      .run(motivo.trim(), id);

    const instancia = await db.prepare('SELECT cuota_vence, cuota_dia_vence FROM instancia WHERE id = 1').get();
    if (!instancia.cuota_vence) return { cuota_vence: null };
    const dia = instancia.cuota_dia_vence ?? Number(instancia.cuota_vence.slice(8));
    const vence = sumarMeses(instancia.cuota_vence, -pago.meses, dia);
    await db
      .prepare(
        `UPDATE instancia SET cuota_vence = ?, suspension_auto_vence = NULL, actualizado_en = CURRENT_TIMESTAMP
         WHERE id = 1`
      )
      .run(vence);
    return { cuota_vence: vence };
  });
}
