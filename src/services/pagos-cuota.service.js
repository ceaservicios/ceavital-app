import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { hoyNegocio } from '../utils/fecha-negocio.js';
import { esFechaReal } from './instancia.service.js';

// Historial de pagos de la cuota que CEA le cobra a la empresa (panel /sa). Se anota a
// mano: no cobra ni se conecta con ningún medio de pago. Anotar un pago corre el
// vencimiento de la cuota los meses que cubre, contando SIEMPRE desde el vencimiento y
// no desde el día en que se pagó ("vence el 10, paga el 15: el próximo vence el 10").

export const MEDIOS_PAGO = ['transferencia', 'efectivo', 'mercado_pago', 'tarjeta', 'otro'];
const MONTO_MAX = 1_000_000_000;
const MESES_MAX = 12;
const COMPROBANTE_MAX = 100;
const NOTA_MAX = 500;
const MOTIVO_MAX = 500;

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

  const monto = Number(datos.monto);
  if (typeof datos.monto === 'boolean' || !Number.isInteger(monto) || monto < 1 || monto > MONTO_MAX) {
    throw new ApiError(400, 'El monto tiene que ser un número entero de pesos mayor a 0');
  }

  const meses = datos.meses === undefined || datos.meses === null || datos.meses === '' ? 1 : Number(datos.meses);
  if (!Number.isInteger(meses) || meses < 1 || meses > MESES_MAX) {
    throw new ApiError(400, `Los meses que cubre tienen que ser un entero entre 1 y ${MESES_MAX}`);
  }

  if (!MEDIOS_PAGO.includes(datos.medio_pago)) throw new ApiError(400, 'Elegí un medio de pago válido');

  return {
    fechaPago,
    monto,
    meses,
    medioPago: datos.medio_pago,
    comprobante: textoOpcional(datos.comprobante, 'El comprobante', COMPROBANTE_MAX),
    nota: textoOpcional(datos.nota, 'La nota', NOTA_MAX),
  };
}

export function listarPagos() {
  return db
    .prepare(
      `SELECT id, fecha_pago, monto, meses, periodo_desde, periodo_hasta, medio_pago, comprobante, nota,
              anulado_en, anulado_motivo, creado_en
       FROM pagos_cuota ORDER BY fecha_pago DESC, id DESC`
    )
    .all();
}

// Anota el pago y corre el vencimiento en la misma transacción. Sin vencimiento cargado,
// el primer pago cuenta desde su propia fecha y ese día queda como día de vencimiento.
// No reactiva una instalación suspendida: eso sigue siendo manual.
export async function registrarPago(datos = {}) {
  const pago = validarPago(datos);

  return db.transaction(async () => {
    const instancia = await db.prepare('SELECT cuota_vence, cuota_dia_vence FROM instancia WHERE id = 1').get();
    const desde = instancia.cuota_vence ?? pago.fechaPago;
    const dia = (instancia.cuota_vence && instancia.cuota_dia_vence) || Number(desde.slice(8));
    const hasta = sumarMeses(desde, pago.meses, dia);

    const { id } = await db
      .prepare(
        `INSERT INTO pagos_cuota (fecha_pago, monto, meses, periodo_desde, periodo_hasta, medio_pago, comprobante, nota)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .get(pago.fechaPago, pago.monto, pago.meses, desde, hasta, pago.medioPago, pago.comprobante, pago.nota);
    await db
      .prepare('UPDATE instancia SET cuota_vence = ?, cuota_dia_vence = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = 1')
      .run(hasta, dia);

    return { id, cuota_vence: hasta };
  });
}

// Un pago mal cargado no se borra ni se edita: se anula con un motivo y el vencimiento
// vuelve atrás los meses que había corrido (desde el vencimiento actual, por si después
// se anotaron otros pagos o se lo cambió a mano).
export async function anularPago(id, motivo) {
  if (typeof motivo !== 'string' || !motivo.trim()) throw new ApiError(400, 'El motivo de la anulación es requerido');
  if (motivo.trim().length > MOTIVO_MAX) throw new ApiError(400, `El motivo no puede superar los ${MOTIVO_MAX} caracteres`);

  return db.transaction(async () => {
    const pago = await db.prepare('SELECT meses, anulado_en FROM pagos_cuota WHERE id = ?').get(id);
    if (!pago) throw new ApiError(404, 'Pago no encontrado');
    if (pago.anulado_en) throw new ApiError(409, 'Ese pago ya está anulado');

    await db
      .prepare('UPDATE pagos_cuota SET anulado_en = CURRENT_TIMESTAMP, anulado_motivo = ? WHERE id = ?')
      .run(motivo.trim(), id);

    const instancia = await db.prepare('SELECT cuota_vence, cuota_dia_vence FROM instancia WHERE id = 1').get();
    if (!instancia.cuota_vence) return { cuota_vence: null };
    const dia = instancia.cuota_dia_vence ?? Number(instancia.cuota_vence.slice(8));
    const vence = sumarMeses(instancia.cuota_vence, -pago.meses, dia);
    await db.prepare('UPDATE instancia SET cuota_vence = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = 1').run(vence);
    return { cuota_vence: vence };
  });
}
