import db from '../db/connection.js';
import { correoCeaDisponible, enviarCorreo, armarCorreoCuota } from './mail.service.js';
import { obtenerInstancia, suspenderPorCuotaSiCorresponde } from './instancia.service.js';

// Revisión de la cuota (a los 30 s de arrancar y cada hora, ver server.js): suspende sola la
// instalación cuando la cuota lleva los días configurados vencida, y le manda los avisos por
// mail a la empresa contratante, de CEA. Un mail por cada etapa, una sola vez por fecha de
// vencimiento: al entrar en el período de aviso, el día que vence, cuando ya está vencida,
// unos días antes de la suspensión automática y al suspenderse.

export function tipoDeAviso(cuota) {
  if (!cuota.vence) return null;
  if (cuota.dias_restantes < 0) return 'vencida';
  if (cuota.dias_restantes === 0) return 'vence_hoy';
  if (cuota.dias_restantes <= cuota.aviso_dias) return 'por_vencer';
  return null;
}

// Avisos que tocan hoy. Suspendida por la cuota: solo el de la suspensión. Activa: el de la
// etapa de la cuota y, si corresponde, el previo a la suspensión automática.
export function avisosQueTocan(instancia) {
  const { cuota } = instancia;
  if (instancia.estado === 'suspendida') {
    return instancia.suspension_por_cuota && instancia.suspension_auto_vence === cuota.vence ? ['suspendida'] : [];
  }
  const tipos = [tipoDeAviso(cuota)];
  if (
    cuota.suspende_el &&
    cuota.aviso_suspension_dias > 0 &&
    cuota.dias_para_suspender > 0 &&
    cuota.dias_para_suspender <= cuota.aviso_suspension_dias
  ) {
    tipos.push('suspension_proxima');
  }
  return tipos.filter(Boolean);
}

// Se reserva cada aviso ANTES de mandarlo (la restricción única evita el doble envío si dos
// procesos corren a la vez) y, si el envío falla, se libera para reintentar en la próxima
// pasada. La suspensión no depende del correo: se hace aunque no haya SMTP configurado.
// Devuelve { suspendida, avisos } (los tipos de aviso enviados).
export async function revisarCuota() {
  const suspendida = await suspenderPorCuotaSiCorresponde();
  if (suspendida) console.log('[cuota] instalación suspendida automáticamente por cuota impaga');

  const avisos = [];
  if (!correoCeaDisponible()) return { suspendida, avisos };
  const instancia = await obtenerInstancia();
  if (!instancia.empresa_email) return { suspendida, avisos };

  const { vence, dias_restantes: diasRestantes, suspende_el: suspendeEl } = instancia.cuota;
  for (const tipo of avisosQueTocan(instancia)) {
    const reserva = await db
      .prepare(
        `INSERT INTO cuota_avisos (tipo, cuota_vence, destinatario) VALUES (?, ?, ?)
         ON CONFLICT (tipo, cuota_vence) DO NOTHING RETURNING id`
      )
      .get(tipo, vence, instancia.empresa_email);
    if (!reserva) continue; // ya se avisó

    try {
      await enviarCorreo({ para: instancia.empresa_email, ...armarCorreoCuota({ tipo, vence, diasRestantes, suspendeEl }) }, 'cea');
    } catch (err) {
      await db.prepare('DELETE FROM cuota_avisos WHERE id = ?').run(reserva.id);
      console.error(`[cuota] no se pudo mandar el aviso "${tipo}", se reintenta en la próxima revisión:`, err.message);
      continue;
    }
    console.log(`[cuota] aviso "${tipo}" enviado`);
    avisos.push(tipo);
  }
  return { suspendida, avisos };
}

export function listarAvisosEnviados(limite = 10) {
  return db
    .prepare('SELECT tipo, cuota_vence, destinatario, enviado_en FROM cuota_avisos ORDER BY id DESC LIMIT ?')
    .all(limite);
}
