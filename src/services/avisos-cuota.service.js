import db from '../db/connection.js';
import { correoCeaDisponible, enviarCorreo, armarCorreoCuota } from './mail.service.js';
import { obtenerInstancia } from './instancia.service.js';

// Avisos de cuota por mail, de CEA a la empresa contratante. Un mail por cada etapa,
// una sola vez por fecha de vencimiento: al entrar en el período de aviso, el día que
// vence y cuando ya está vencida. Solo avisa: nunca suspende (eso lo hace CEA a mano).

export function tipoDeAviso(cuota) {
  if (!cuota.vence) return null;
  if (cuota.dias_restantes < 0) return 'vencida';
  if (cuota.dias_restantes === 0) return 'vence_hoy';
  if (cuota.dias_restantes <= cuota.aviso_dias) return 'por_vencer';
  return null;
}

// Lo corre un temporizador del servidor (cada hora). Devuelve el tipo enviado o null.
// Se reserva el aviso ANTES de mandarlo (la restricción única evita el doble envío si
// dos procesos corren a la vez) y, si el envío falla, se libera para reintentar en la
// próxima pasada.
export async function revisarAvisosCuota() {
  if (!correoCeaDisponible()) return null;
  const instancia = await obtenerInstancia();
  const tipo = tipoDeAviso(instancia.cuota);
  if (!tipo || !instancia.empresa_email) return null;

  const { vence, dias_restantes: diasRestantes } = instancia.cuota;
  const reserva = await db
    .prepare(
      `INSERT INTO cuota_avisos (tipo, cuota_vence, destinatario) VALUES (?, ?, ?)
       ON CONFLICT (tipo, cuota_vence) DO NOTHING RETURNING id`
    )
    .get(tipo, vence, instancia.empresa_email);
  if (!reserva) return null; // ya se avisó

  try {
    await enviarCorreo({ para: instancia.empresa_email, ...armarCorreoCuota({ tipo, vence, diasRestantes }) }, 'cea');
  } catch (err) {
    await db.prepare('DELETE FROM cuota_avisos WHERE id = ?').run(reserva.id);
    console.error('[cuota] no se pudo mandar el aviso, se reintenta en la próxima revisión:', err.message);
    return null;
  }
  console.log(`[cuota] aviso "${tipo}" enviado`);
  return tipo;
}

export function listarAvisosEnviados(limite = 10) {
  return db
    .prepare('SELECT tipo, cuota_vence, destinatario, enviado_en FROM cuota_avisos ORDER BY id DESC LIMIT ?')
    .all(limite);
}
