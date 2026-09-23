import db from '../db/connection.js';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import { MEDIOS_PAGO_BASE, PLANES, PLAN_POR_DEFECTO } from '../config/modulos.js';

// Plan de la instalación y, derivados de él, los módulos activos. Se guarda solo
// el plan (configuracion.clave = 'plan'). Se lee con una caché corta para no
// consultar la base en cada request; al cambiar el plan la caché se invalida, así
// que en esta instancia el cambio es inmediato y sin reiniciar.
const TTL_MS = config.modulos.cacheSegundos * 1000;
let cache = null;

export function invalidarCachePlan() {
  cache = null;
}

export async function planActual() {
  if (cache && cache.hasta > Date.now()) return cache.plan;

  const fila = await db.prepare(`SELECT valor FROM configuracion WHERE clave = 'plan'`).get();
  let plan = PLAN_POR_DEFECTO;
  if (fila) {
    if (Object.hasOwn(PLANES, fila.valor)) {
      plan = fila.valor;
    } else {
      // Valor corrupto: el mínimo privilegio, nunca abrir módulos que no se pagaron.
      console.error(`[modulos] plan desconocido "${fila.valor}" en configuracion; se usa el más chico`);
      plan = Object.keys(PLANES)[0];
    }
  }
  cache = { plan, hasta: Date.now() + TTL_MS };
  return plan;
}

export async function modulosActivos() {
  return PLANES[await planActual()].modulos;
}

export async function moduloActivo(modulo) {
  return (await modulosActivos()).includes(modulo);
}

// 'cta_cte' solo existe como medio de pago si el módulo de clientes-empresa está activo.
export async function mediosPagoPermitidos() {
  return (await moduloActivo('clientes_empresa')) ? [...MEDIOS_PAGO_BASE, 'cta_cte'] : MEDIOS_PAGO_BASE;
}

// Cambia el plan de la instalación (lo llama el superadmin / npm run set-plan).
// Nunca borra datos. Si el plan nuevo no incluye Pedidos, se rechaza mientras haya
// pedidos pendientes: reservan stock y nadie podría aprobarlos ni cancelarlos. Si no
// incluye el portal, cierra las sesiones de clientes abiertas (si no, una cookie
// vieja volvería a andar al reactivarlo).
export async function cambiarPlan(plan) {
  // hasOwn y no PLANES[plan]: "constructor" o "__proto__" existen en el prototipo y pasaban como plan válido.
  if (typeof plan !== 'string' || !Object.hasOwn(PLANES, plan)) {
    throw new ApiError(400, `plan tiene que ser uno de: ${Object.keys(PLANES).join(', ')}`);
  }

  await db.transaction(async () => {
    if (!PLANES[plan].modulos.includes('pedidos')) {
      const { pendientes } = await db
        .prepare(`SELECT COUNT(*) AS pendientes FROM pedidos_cliente WHERE estado = 'pendiente'`)
        .get();
      if (pendientes > 0) {
        throw new ApiError(
          409,
          `No se puede pasar al plan "${PLANES[plan].nombre}": hay ${pendientes} pedido(s) de clientes pendiente(s). Aprobalos o rechazalos antes.`
        );
      }
    }
    await db
      .prepare(
        `INSERT INTO configuracion (clave, valor) VALUES ('plan', ?)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = CURRENT_TIMESTAMP`
      )
      .run(plan);
    if (!PLANES[plan].modulos.includes('portal')) {
      await db
        .prepare(
          `UPDATE sesiones_cliente SET estado = 'cerrada', motivo_cierre = 'portal_deshabilitado', cerrada_en = CURRENT_TIMESTAMP
           WHERE estado = 'activa'`
        )
        .run();
    }
  });
  invalidarCachePlan();
  return plan;
}
