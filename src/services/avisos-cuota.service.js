import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { correoCeaDisponible, armarCorreoCuota } from './mail.service.js';
import { encolarCorreo, procesarCola } from './cola-correo.service.js';
import { obtenerInstancia, suspenderPorCuotaSiCorresponde } from './instancia.service.js';
import { leerCobro, pendientesDeCobro } from './cobro-cea.service.js';
import { obtenerCotizacion } from './dolar-blue.service.js';
import { registrarAccion } from './registro.service.js';

// Revisión de la cuota (a los 30 s de arrancar y cada hora, ver server.js): suspende sola la
// instalación cuando el pago más viejo sin pagar lleva los días configurados vencido, y le manda los
// avisos por mail a la empresa contratante, de CEA. Desde el 2026-11-09 cada cobro tiene sus avisos
// (cobro-cea.pendientesDeCobro): la cuota pendiente de la implementación, con su fecha, y el abono,
// con la suya. Un mail por cobro, por etapa y por vencimiento, una sola vez: al entrar en el período
// de aviso, el día que vence y cuando ya está vencido; y, del pago más viejo, unos días antes de la
// suspensión automática y al suspenderse.

export const CONCEPTOS_AVISO = ['abono', 'implementacion'];

// La etapa de un cobro pendiente hoy, o null si todavía no entró en el período de aviso.
export function tipoDeAviso(pendiente, avisoDias) {
  if (pendiente.dias_restantes < 0) return 'vencida';
  if (pendiente.dias_restantes === 0) return 'vence_hoy';
  if (pendiente.dias_restantes <= avisoDias) return 'por_vencer';
  return null;
}

// Avisos que tocan hoy: [{ concepto, tipo, vence, dias_restantes, aviso }]. Suspendida por la cuota:
// solo el de la suspensión, del pago que la causó. Activa: la etapa de cada cobro pendiente y, si
// corresponde, el previo a la suspensión automática, del pago más viejo.
export function avisosQueTocan(instancia, pendientes) {
  const { cuota } = instancia;
  if (instancia.estado === 'suspendida') {
    const causa = instancia.suspension_por_cuota ? pendientes.find((p) => p.vence === instancia.suspension_auto_vence) : null;
    return causa ? [{ ...causa, tipo: 'suspendida' }] : [];
  }
  const avisos = pendientes.map((p) => ({ ...p, tipo: tipoDeAviso(p, cuota.aviso_dias) })).filter((a) => a.tipo);
  const [masViejo] = pendientes;
  if (
    masViejo &&
    cuota.suspende_el &&
    cuota.aviso_suspension_dias > 0 &&
    cuota.dias_para_suspender > 0 &&
    cuota.dias_para_suspender <= cuota.aviso_suspension_dias
  ) {
    avisos.push({ ...masViejo, tipo: 'suspension_proxima' });
  }
  return avisos;
}

// Los que todavía no se mandaron. Solo decide si hay algo por armar (y si vale la pena buscar la
// cotización del dólar blue): el doble envío lo sigue evitando la restricción única.
async function sinAvisar(avisos) {
  if (!avisos.length) return [];
  const enviados = await db
    .prepare(`SELECT concepto, tipo, cuota_vence FROM cuota_avisos WHERE cuota_vence IN (${avisos.map(() => '?').join(', ')})`)
    .all(...avisos.map((a) => a.vence));
  const ya = new Set(enviados.map((f) => `${f.concepto}|${f.tipo}|${f.cuota_vence}`));
  return avisos.filter((a) => !ya.has(`${a.concepto}|${a.tipo}|${a.vence}`));
}

// Anota el aviso (si esa etapa de ese cobro todavía no se avisó) y encola su mail, en la transacción
// en curso. Devuelve { correoId, nuevo }: nuevo = false si ya estaba anotado (entonces, si `siempre`,
// el mail sale igual como reenvío, con otro tipo de mail para no pisar el registro del original).
async function anotarYEncolar({ concepto, tipo, vence, para, correo, siempre }) {
  const reserva = await db
    .prepare(
      `INSERT INTO cuota_avisos (concepto, tipo, cuota_vence, destinatario) VALUES (?, ?, ?, ?)
       ON CONFLICT (concepto, tipo, cuota_vence) DO NOTHING RETURNING id`
    )
    .get(concepto, tipo, vence, para);
  if (!reserva && !siempre) return { correoId: null, nuevo: false };
  const correoId = await encolarCorreo({ para, ...correo }, { canal: 'cea', tipo: reserva ? 'aviso-cuota' : 'aviso-cuota-reenvio' });
  if (reserva) await db.prepare('UPDATE cuota_avisos SET correo_id = ? WHERE id = ?').run(correoId, reserva.id);
  return { correoId, nuevo: Boolean(reserva) };
}

// Cada aviso se anota y se encola en una sola transacción (la restricción única evita el doble
// envío si dos procesos corren a la vez); los reintentos del envío los hace la cola. El aviso guarda
// el id de su mail (correo_id), de donde sale si salió o falló (vinculo.service). La
// suspensión no depende del correo: se hace aunque no haya SMTP configurado.
// Devuelve { suspendida, avisos } (los avisos encolados, "concepto:tipo").
export async function revisarCuota() {
  const suspendida = await suspenderPorCuotaSiCorresponde();
  if (suspendida) await registrarAccion('instalacion-suspendida', { detalle: { automatica: true, motivo: 'Cuota impaga' } });
  if (suspendida) console.log('[cuota] instalación suspendida automáticamente por cuota impaga');

  const encolados = [];
  if (!correoCeaDisponible()) return { suspendida, avisos: encolados };
  const instancia = await obtenerInstancia();
  if (!instancia.empresa_email) return { suspendida, avisos: encolados };

  const faltan = await sinAvisar(avisosQueTocan(instancia, pendientesDeCobro(await leerCobro())));
  // El dólar blue venta del día para el equivalente en pesos (fuera de la transacción: es un pedido a
  // internet; si no hay cotización, null y el mail sale solo en dólares).
  const cotizacion = faltan.length ? await obtenerCotizacion() : null;
  const { suspende_el: suspendeEl } = instancia.cuota;
  for (const a of faltan) {
    const correo = armarCorreoCuota({ tipo: a.tipo, vence: a.vence, diasRestantes: a.dias_restantes, suspendeEl, aviso: a.aviso, cotizacion });
    const { nuevo } = await db.transaction(() =>
      anotarYEncolar({ concepto: a.concepto, tipo: a.tipo, vence: a.vence, para: instancia.empresa_email, correo, siempre: false })
    );
    if (!nuevo) continue; // ya se avisó
    console.log(`[cuota] aviso "${a.tipo}" de ${a.concepto} encolado`);
    encolados.push(`${a.concepto}:${a.tipo}`);
  }
  return { suspendida, avisos: encolados };
}

const ESPERA_ENVIO_MS = 12_000;

// Lo que hizo la cola con el mail `id` en los primeros segundos: 'enviado', 'fallido' o 'descartado',
// o 'pendiente' si todavía no salió (con el error si ya probó y falló: se reintenta sola).
async function esperarEnvio(id, hasta = Date.now() + ESPERA_ENVIO_MS) {
  for (;;) {
    const c = await db.prepare('SELECT estado, intentos, ultimo_error FROM correos WHERE id = ?').get(id);
    if (c.estado !== 'pendiente' || c.intentos > 0 || Date.now() >= hasta) return { estado: c.estado, error: c.ultimo_error ?? null };
    await new Promise((listo) => setTimeout(listo, 500));
    // La cola toma un mail cuando llega su proximo_intento, que se guarda redondeado al segundo (puede
    // quedar hasta medio segundo adelante): si la pasada de recién lo encontró antes de hora, esta lo toma.
    await procesarCola();
  }
}

// "Enviar aviso ahora" (/sa > Cuota y pagos, pedido del usuario del 2026-10-26: los automáticos salen
// en la revisión horaria y no se veía si salían). Manda en el momento, al email de la empresa, el aviso
// de un cobro pendiente con la etapa que corresponde hoy: `concepto` 'implementacion' (la cuota
// pendiente) o 'abono' (botones de Implementación y de Abono mensual, 2026-11-09); sin concepto
// (Gestión), el pago más viejo. Si esa etapa todavía no se avisó, queda anotada como la automática (la
// revisión horaria no la repite y Gestión la ve con su etapa); si ya se avisó, sale igual como reenvío.
// Espera unos segundos a que la cola lo mande y devuelve cómo quedó.
export async function mandarAvisoAhora(concepto = null) {
  if (concepto !== null && !CONCEPTOS_AVISO.includes(concepto)) throw new ApiError(400, 'Elegí qué aviso mandar: el del abono o el de la implementación');
  if (!correoCeaDisponible()) throw new ApiError(503, 'El correo de CEA no está configurado en este servidor (variables SA_SMTP_*)');
  const instancia = await obtenerInstancia();
  if (!instancia.empresa_email) throw new ApiError(400, 'Cargá primero el email de la empresa');

  const pendientes = pendientesDeCobro(await leerCobro());
  const p = concepto ? pendientes.find((x) => x.concepto === concepto) : pendientes[0];
  if (!p) {
    const falta = {
      implementacion: 'No hay cuotas de la implementación sin pagar',
      abono: 'No hay aviso del abono para mandar: cargá el abono y el próximo vencimiento',
    };
    throw new ApiError(409, concepto ? falta[concepto] : 'Cargá primero el próximo vencimiento');
  }

  const porEstePago = instancia.estado === 'suspendida' && instancia.suspension_por_cuota && instancia.suspension_auto_vence === p.vence;
  const tipo = porEstePago ? 'suspendida' : p.dias_restantes > 0 ? 'por_vencer' : p.dias_restantes === 0 ? 'vence_hoy' : 'vencida';
  const cotizacion = await obtenerCotizacion();
  const { suspende_el: suspendeEl } = instancia.cuota;
  const correo = armarCorreoCuota({ tipo, vence: p.vence, diasRestantes: p.dias_restantes, suspendeEl, aviso: p.aviso, cotizacion });

  const { correoId, nuevo } = await db.transaction(() =>
    anotarYEncolar({ concepto: p.concepto, tipo, vence: p.vence, para: instancia.empresa_email, correo, siempre: true })
  );
  const reenvio = !nuevo;
  console.log(`[cuota] aviso "${tipo}" de ${p.concepto} encolado a mano${reenvio ? ' (reenvío)' : ''}`);
  const numero = p.aviso.implementacion?.numero ?? null;
  return { enviado_a: instancia.empresa_email, concepto: p.concepto, numero, tipo, vence: p.vence, reenvio, ...(await esperarEnvio(correoId)) };
}

export function listarAvisosEnviados(limite = 10) {
  return db
    .prepare('SELECT concepto, tipo, cuota_vence, destinatario, enviado_en FROM cuota_avisos ORDER BY id DESC LIMIT ?')
    .all(limite);
}
