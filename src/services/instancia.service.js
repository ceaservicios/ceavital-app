import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
import { cambiarPlan } from './modulos.service.js';
import { armarCorreoCuota, correoCeaDisponible, enviarCorreo } from './mail.service.js';

// Estado de la instalación que gestiona el superadmin: suspensión (manual o automática por
// cuota impaga) y cuota. (El plan vive en `configuracion` y lo cambia modulos.service.cambiarPlan.)

const MOTIVO_MAX = 500;
const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

// true si es 'AAAA-MM-DD' y además una fecha que existe (no 2026-02-30).
export function esFechaReal(valor) {
  const m = typeof valor === 'string' ? FECHA_ISO.exec(valor) : null;
  if (!m) return false;
  const real = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return real.getUTCFullYear() === +m[1] && real.getUTCMonth() === +m[2] - 1 && real.getUTCDate() === +m[3];
}

export async function obtenerInstancia() {
  const fila = await db
    .prepare(
      `SELECT estado, motivo_suspension, suspendida_en, suspension_por_cuota, suspension_auto_vence, empresa_email,
              cuota_vence, cuota_aviso_dias, cuota_suspender_dias, cuota_aviso_suspension_dias,
              (cuota_vence - ${SQL_HOY_NEGOCIO}) AS cuota_dias_restantes,
              (cuota_vence + cuota_suspender_dias) AS cuota_suspende_el,
              (cuota_vence + cuota_suspender_dias) - ${SQL_HOY_NEGOCIO} AS cuota_dias_para_suspender
       FROM instancia WHERE id = 1`
    )
    .get();

  const dias = fila.cuota_dias_restantes;
  let cuotaEstado = 'sin_definir';
  if (fila.cuota_vence) {
    cuotaEstado = dias < 0 ? 'vencida' : dias <= fila.cuota_aviso_dias ? 'por_vencer' : 'vigente';
  }
  return {
    estado: fila.estado,
    motivo_suspension: fila.motivo_suspension ?? null,
    suspendida_en: fila.suspendida_en ?? null,
    suspension_por_cuota: Boolean(fila.suspension_por_cuota),
    suspension_auto_vence: fila.suspension_auto_vence ?? null,
    empresa_email: fila.empresa_email ?? null,
    cuota: {
      vence: fila.cuota_vence ?? null,
      aviso_dias: fila.cuota_aviso_dias,
      dias_restantes: fila.cuota_vence ? dias : null,
      estado: cuotaEstado,
      // Suspensión automática (null = no se suspende sola). suspende_el: la fecha en que se
      // suspendería con el vencimiento actual.
      suspender_dias: fila.cuota_suspender_dias ?? null,
      aviso_suspension_dias: fila.cuota_aviso_suspension_dias,
      suspende_el: fila.cuota_suspende_el ?? null,
      dias_para_suspender: fila.cuota_suspende_el ? fila.cuota_dias_para_suspender : null,
    },
  };
}

// Lo llaman los logins del negocio y del portal: una instalación suspendida no deja
// ingresar (los datos se conservan). El motivo interno no se muestra al usuario final.
export async function asegurarInstanciaActiva() {
  const fila = await db.prepare('SELECT estado FROM instancia WHERE id = 1').get();
  if (fila?.estado === 'suspendida') {
    throw new ApiError(403, 'El servicio está suspendido. Comunicate con CEA Servicios.');
  }
}

// Suspende dentro de la transacción en curso. porCuota = la hizo el sistema por la cuota
// impaga del vencimiento `vence` (queda anotado para no repetirla por el mismo vencimiento).
async function aplicarSuspension(motivo, { porCuota = false, vence = null } = {}) {
  await db
    .prepare(
      `UPDATE instancia SET estado = 'suspendida', motivo_suspension = ?, suspendida_en = CURRENT_TIMESTAMP,
              suspension_por_cuota = ?, suspension_auto_vence = COALESCE(?, suspension_auto_vence),
              actualizado_en = CURRENT_TIMESTAMP WHERE id = 1`
    )
    .run(motivo, porCuota, vence);
  // Corta en el acto a quien ya estaba adentro (negocio y clientes); al reactivar hay
  // que volver a ingresar.
  await db
    .prepare(
      `UPDATE sesiones_activas SET estado = 'cerrada', motivo_cierre = 'expulsada', cerrada_en = CURRENT_TIMESTAMP
       WHERE estado = 'activa'`
    )
    .run();
  await db
    .prepare(
      `UPDATE sesiones_cliente SET estado = 'cerrada', motivo_cierre = 'instancia_suspendida', cerrada_en = CURRENT_TIMESTAMP
       WHERE estado = 'activa'`
    )
    .run();
}

export async function suspenderInstancia(motivo) {
  if (typeof motivo !== 'string' || !motivo.trim()) throw new ApiError(400, 'El motivo de la suspensión es requerido');
  if (motivo.trim().length > MOTIVO_MAX) throw new ApiError(400, `El motivo no puede superar los ${MOTIVO_MAX} caracteres`);

  await db.transaction(async () => {
    const { estado } = await db.prepare('SELECT estado FROM instancia WHERE id = 1').get();
    if (estado === 'suspendida') throw new ApiError(409, 'La instalación ya está suspendida');
    await aplicarSuspension(motivo.trim());
  });
}

// Suspensión automática (la llama la revisión horaria de la cuota): si la cuota lleva los
// días configurados vencida y todavía no se suspendió sola por este vencimiento (si CEA la
// reactivó a mano sin el pago, es una prórroga y no se repite). Devuelve true si suspendió.
export async function suspenderPorCuotaSiCorresponde() {
  return db.transaction(async () => {
    const fila = await db
      .prepare(
        `SELECT estado, cuota_vence, suspension_auto_vence,
                (cuota_vence + cuota_suspender_dias) <= ${SQL_HOY_NEGOCIO} AS toca
         FROM instancia WHERE id = 1`
      )
      .get();
    if (fila.estado !== 'activa' || !fila.toca || fila.suspension_auto_vence === fila.cuota_vence) return false;
    const vence = fila.cuota_vence.split('-').reverse().join('/');
    await aplicarSuspension(`Cuota impaga (venció el ${vence})`, { porCuota: true, vence: fila.cuota_vence });
    return true;
  });
}

// Reactiva dentro de la transacción en curso.
export async function aplicarReactivacion() {
  await db
    .prepare(
      `UPDATE instancia SET estado = 'activa', motivo_suspension = NULL, suspendida_en = NULL,
              suspension_por_cuota = FALSE, actualizado_en = CURRENT_TIMESTAMP WHERE id = 1`
    )
    .run();
}

// Mail a la empresa avisando que el servicio está activo de nuevo. Va después de la
// transacción y nunca hace fallar la reactivación: sin correo configurado o sin email de
// la empresa no se manda, y un error del SMTP queda en el log. Devuelve a quién se mandó.
export async function avisarReactivacion() {
  if (!correoCeaDisponible()) return null;
  const { empresa_email: para } = await db.prepare('SELECT empresa_email FROM instancia WHERE id = 1').get();
  if (!para) return null;
  try {
    await enviarCorreo({ para, ...armarCorreoCuota({ tipo: 'reactivada' }) }, 'cea');
    return para;
  } catch (err) {
    console.error('[cuota] no se pudo mandar el aviso de reactivación:', err.message);
    return null;
  }
}

export async function reactivarInstancia() {
  await db.transaction(async () => {
    const { estado } = await db.prepare('SELECT estado FROM instancia WHERE id = 1').get();
    if (estado !== 'suspendida') throw new ApiError(409, 'La instalación no está suspendida');
    await aplicarReactivacion();
  });
  return { avisado_a: await avisarReactivacion() };
}

const vacio = (valor) => valor === undefined || valor === null || valor === '';

function enteroEntre(valor, minimo, maximo, mensaje) {
  const n = Number(valor);
  if (typeof valor === 'boolean' || !Number.isInteger(n) || n < minimo || n > maximo) throw new ApiError(400, mensaje);
  return n;
}

// vence: 'AAAA-MM-DD', o vacío/null para quitar la cuota (sin cuota definida). aviso_dias:
// cuántos días antes del vencimiento la cuota pasa a "por vencer". El día de la fecha
// elegida pasa a ser el día fijo de vencimiento con el que los pagos corren la cuota
// (pagos-cuota.service). suspender_dias: a los cuántos días de vencida se suspende sola
// (vacío = nunca); aviso_suspension_dias: cuántos días antes de esa suspensión sale el
// mail de aviso (0 = sin aviso previo; tiene que ser menor que suspender_dias, así cae
// con la cuota ya vencida). Un campo que no viene en el pedido conserva su valor
// (también vence: antes un pedido sin vence borraba el vencimiento y apagaba la
// suspensión automática).
export async function fijarCuota(datos) {
  const { vence, aviso_dias: avisoDias, suspender_dias: suspenderDias, aviso_suspension_dias: avisoSuspension } = datos;
  const cambiaVence = 'vence' in datos;
  let fecha = null;
  if (cambiaVence && !vacio(vence)) {
    if (!esFechaReal(vence)) {
      throw new ApiError(400, 'La fecha de vencimiento tiene que ser una fecha real con formato AAAA-MM-DD');
    }
    fecha = vence;
  }

  await db.transaction(async () => {
    const actual = await db
      .prepare('SELECT cuota_vence, cuota_aviso_dias, cuota_suspender_dias, cuota_aviso_suspension_dias FROM instancia WHERE id = 1')
      .get();
    if (!cambiaVence) fecha = actual.cuota_vence;

    const aviso = vacio(avisoDias)
      ? actual.cuota_aviso_dias
      : enteroEntre(avisoDias, 0, 365, 'Los días de aviso tienen que ser un entero entre 0 y 365');

    let suspender = actual.cuota_suspender_dias;
    if ('suspender_dias' in datos) {
      suspender = vacio(suspenderDias)
        ? null
        : enteroEntre(suspenderDias, 1, 365, 'Los días para suspender tienen que ser un entero entre 1 y 365');
    }
    let avisoPrevio = actual.cuota_aviso_suspension_dias;
    if ('aviso_suspension_dias' in datos) {
      avisoPrevio = vacio(avisoSuspension)
        ? 0
        : enteroEntre(avisoSuspension, 0, 365, 'Los días de aviso antes de suspender tienen que ser un entero entre 0 y 365');
    }
    if (suspender !== null && avisoPrevio >= suspender) {
      throw new ApiError(400, 'El aviso antes de suspender tiene que ser menor que los días para suspender');
    }

    await db
      .prepare(
        `UPDATE instancia SET cuota_vence = ?, cuota_dia_vence = COALESCE(?, cuota_dia_vence), cuota_aviso_dias = ?,
                cuota_suspender_dias = ?, cuota_aviso_suspension_dias = ?, actualizado_en = CURRENT_TIMESTAMP
         WHERE id = 1`
      )
      // Si vence no cambió, el día fijo tampoco (puede no coincidir con el día de cuota_vence:
      // un día 31 vence el 30 en los meses de 30 días).
      .run(fecha, cambiaVence && fecha ? Number(fecha.slice(8)) : null, aviso, suspender, avisoPrevio);
  });
}

// Topes de usuarios por rol que carga el superadmin al armar la empresa (sin cargar = no se
// pueden crear usuarios de ese rol). Devuelve, por rol, el tope, los usuarios activos y los
// lugares libres. Bajar un tope por debajo de lo que ya hay no borra a nadie: solo impide
// crear más.
export const ROLES_CON_TOPE = ['admin', 'encargado', 'cajero'];

export async function cuposPorRol() {
  const topes = await db.prepare('SELECT cupo_admin, cupo_encargado, cupo_cajero FROM instancia WHERE id = 1').get();
  const filas = await db.prepare('SELECT rol, COUNT(*) AS n FROM usuarios WHERE eliminado_en IS NULL GROUP BY rol').all();
  const usados = Object.fromEntries(filas.map((f) => [f.rol, f.n]));
  return ROLES_CON_TOPE.map((rol) => {
    const tope = topes[`cupo_${rol}`] ?? null;
    const enUso = usados[rol] ?? 0;
    return { rol, tope, usados: enUso, libres: Math.max(0, (tope ?? 0) - enUso) };
  });
}

// datos: { admin, encargado, cajero }, cada uno un entero de 0 a 999 o vacío (sin cargar).
export async function fijarCupos(datos) {
  const valores = ROLES_CON_TOPE.map((rol) =>
    vacio(datos[rol]) ? null : enteroEntre(datos[rol], 0, 999, 'Cada tope tiene que ser un número entero entre 0 y 999')
  );
  await db
    .prepare(
      `UPDATE instancia SET cupo_admin = ?, cupo_encargado = ?, cupo_cajero = ?, actualizado_en = CURRENT_TIMESTAMP
       WHERE id = 1`
    )
    .run(...valores);
}

// Cambio de plan hecho por el superadmin: el mismo cambiarPlan de siempre (bloquea si
// hay pedidos pendientes, cierra sesiones del portal).
export async function cambiarPlanComoSuperadmin(plan) {
  await cambiarPlan(plan);
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mail de la empresa contratante, a quien van los avisos de cuota. Vacío = no se manda nada.
export async function fijarEmpresaEmail(email) {
  let valor = null;
  if (email !== null && email !== undefined && email !== '') {
    if (typeof email !== 'string' || email.trim().length > 200 || !EMAIL_VALIDO.test(email.trim())) {
      throw new ApiError(400, 'El email no tiene un formato válido');
    }
    valor = email.trim();
  }
  await db.prepare('UPDATE instancia SET empresa_email = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = 1').run(valor);
}

// Manda un mail de prueba al email de la empresa para comprobar que el correo de CEA sale.
export async function enviarCorreoDePrueba() {
  if (!correoCeaDisponible()) throw new ApiError(503, 'El correo de CEA no está configurado en este servidor (variables SA_SMTP_*)');
  const { empresa_email: para } = await obtenerInstancia();
  if (!para) throw new ApiError(400, 'Cargá primero el email de la empresa');
  await enviarCorreo(
    {
      para,
      asunto: 'CEAVital: mail de prueba',
      texto: 'Este es un mail de prueba de CEAVital. Si lo recibiste, los avisos de cuota van a llegar a esta dirección.',
    },
    'cea'
  );
  return { enviado_a: para };
}
