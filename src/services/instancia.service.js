import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
import { cambiarPlan, invalidarCachePlan } from './modulos.service.js';
import { registrarAccion } from './superadmin.service.js';
import { correoCeaDisponible, enviarCorreo } from './mail.service.js';

// Estado de la instalación que gestiona el superadmin: suspensión y cuota. (El plan
// vive en `configuracion` y lo cambia modulos.service.cambiarPlan.)

const MOTIVO_MAX = 500;
const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export async function obtenerInstancia() {
  const fila = await db
    .prepare(
      `SELECT estado, motivo_suspension, suspendida_en, empresa_email, cuota_vence, cuota_aviso_dias,
              (cuota_vence - ${SQL_HOY_NEGOCIO}) AS cuota_dias_restantes
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
    empresa_email: fila.empresa_email ?? null,
    cuota: {
      vence: fila.cuota_vence ?? null,
      aviso_dias: fila.cuota_aviso_dias,
      dias_restantes: fila.cuota_vence ? dias : null,
      estado: cuotaEstado, // la cuota vencida solo avisa: la suspensión es manual
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

export async function suspenderInstancia(superadminId, motivo, ip) {
  if (typeof motivo !== 'string' || !motivo.trim()) throw new ApiError(400, 'El motivo de la suspensión es requerido');
  if (motivo.trim().length > MOTIVO_MAX) throw new ApiError(400, `El motivo no puede superar los ${MOTIVO_MAX} caracteres`);

  await db.transaction(async () => {
    const { estado } = await db.prepare('SELECT estado FROM instancia WHERE id = 1').get();
    if (estado === 'suspendida') throw new ApiError(409, 'La instalación ya está suspendida');

    await db
      .prepare(
        `UPDATE instancia SET estado = 'suspendida', motivo_suspension = ?, suspendida_en = CURRENT_TIMESTAMP,
                actualizado_en = CURRENT_TIMESTAMP WHERE id = 1`
      )
      .run(motivo.trim());
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
    await registrarAccion(superadminId, 'suspender', motivo.trim(), ip);
  });
}

export async function reactivarInstancia(superadminId, ip) {
  await db.transaction(async () => {
    const { estado } = await db.prepare('SELECT estado FROM instancia WHERE id = 1').get();
    if (estado !== 'suspendida') throw new ApiError(409, 'La instalación no está suspendida');
    await db
      .prepare(
        `UPDATE instancia SET estado = 'activa', motivo_suspension = NULL, suspendida_en = NULL,
                actualizado_en = CURRENT_TIMESTAMP WHERE id = 1`
      )
      .run();
    await registrarAccion(superadminId, 'reactivar', null, ip);
  });
}

// vence: 'AAAA-MM-DD' o null (sin cuota definida). avisoDias: cuántos días antes del
// vencimiento la cuota pasa a "por vencer".
export async function fijarCuota(superadminId, { vence, aviso_dias: avisoDias }, ip) {
  let fecha = null;
  if (vence !== null && vence !== undefined && vence !== '') {
    const m = typeof vence === 'string' ? FECHA_ISO.exec(vence) : null;
    const real = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!m || real.getUTCFullYear() !== +m[1] || real.getUTCMonth() !== +m[2] - 1 || real.getUTCDate() !== +m[3]) {
      throw new ApiError(400, 'La fecha de vencimiento tiene que ser una fecha real con formato AAAA-MM-DD');
    }
    fecha = vence;
  }
  let aviso = 15;
  if (avisoDias !== undefined && avisoDias !== null && avisoDias !== '') {
    aviso = Number(avisoDias);
    if (!Number.isInteger(aviso) || aviso < 0 || aviso > 365) {
      throw new ApiError(400, 'Los días de aviso tienen que ser un entero entre 0 y 365');
    }
  } else {
    aviso = (await db.prepare('SELECT cuota_aviso_dias FROM instancia WHERE id = 1').get()).cuota_aviso_dias;
  }

  await db.transaction(async () => {
    await db
      .prepare('UPDATE instancia SET cuota_vence = ?, cuota_aviso_dias = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = 1')
      .run(fecha, aviso);
    await registrarAccion(superadminId, 'cuota', `vence: ${fecha ?? 'sin definir'}; aviso: ${aviso} días`, ip);
  });
}

// Cambio de plan hecho por el superadmin: el mismo cambiarPlan de siempre (bloquea si
// hay pedidos pendientes, cierra sesiones del portal) más el registro de la acción.
export async function cambiarPlanComoSuperadmin(superadminId, plan, ip) {
  await db.transaction(async () => {
    await cambiarPlan(plan);
    await registrarAccion(superadminId, 'plan', `plan: ${plan}`, ip);
  });
  // cambiarPlan ya invalidó la caché, pero antes de que esta transacción confirmara: otro
  // pedido pudo volver a cachear el plan viejo en el medio.
  invalidarCachePlan();
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mail de la empresa contratante, a quien van los avisos de cuota. Vacío = no se manda nada.
export async function fijarEmpresaEmail(superadminId, email, ip) {
  let valor = null;
  if (email !== null && email !== undefined && email !== '') {
    if (typeof email !== 'string' || email.trim().length > 200 || !EMAIL_VALIDO.test(email.trim())) {
      throw new ApiError(400, 'El email no tiene un formato válido');
    }
    valor = email.trim();
  }
  await db.transaction(async () => {
    await db.prepare('UPDATE instancia SET empresa_email = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = 1').run(valor);
    await registrarAccion(superadminId, 'empresa_email', valor ?? 'quitado', ip);
  });
}

// Manda un mail de prueba al email de la empresa para comprobar que el correo de CEA sale.
export async function enviarCorreoDePrueba(superadminId, ip) {
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
  await registrarAccion(superadminId, 'correo_prueba', `enviado a ${para}`, ip);
  return { enviado_a: para };
}
