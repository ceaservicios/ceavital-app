import nodemailer from 'nodemailer';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

// Envío de mails por SMTP. Opcional: el sistema funciona 100% sin esto (regla
// "sin internet"); solo se usa para mandarle al cliente los datos de acceso.
// Dos canales: 'empresa' (SMTP_*: la empresa a sus clientes) y 'cea' (SA_SMTP_*: los
// avisos del superadmin, remitente de CEA).
const CANALES = { empresa: () => config.smtp, cea: () => config.saSmtp };
const transportes = {};

const disponible = (canal) => Boolean(CANALES[canal]().host && CANALES[canal]().from);

export const correoDisponible = () => disponible('empresa');
export const correoCeaDisponible = () => disponible('cea');

function obtenerTransporte(canal) {
  if (!transportes[canal]) {
    const { host, port, secure, user, pass } = CANALES[canal]();
    transportes[canal] = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      // Que un servidor de mail caído no deje colgada la pantalla del usuario.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transportes[canal];
}

export async function enviarCorreo({ para, asunto, texto, html }, canal = 'empresa') {
  if (!disponible(canal)) {
    throw new ApiError(503, 'El envío de mails no está configurado en este servidor');
  }
  try {
    await obtenerTransporte(canal).sendMail({ from: CANALES[canal]().from, to: para, subject: asunto, text: texto, html });
  } catch (err) {
    // El detalle técnico (host, credenciales) queda en el log del servidor,
    // nunca en la respuesta al navegador.
    console.error('[mail] no se pudo enviar:', err.message);
    throw new ApiError(502, 'No se pudo enviar el mail. Revisá la configuración de correo del servidor.');
  }
}

export function escaparHtml(valor) {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Mail con los datos de acceso al portal. Texto plano + HTML simple (los
// clientes de correo que no muestran HTML ven el texto).
export function armarCorreoAcceso({ razonSocial, enlace, usuario, password }) {
  const asunto = `Acceso a tu cuenta corriente - ${razonSocial}`;
  const texto = [
    `Hola,`,
    ``,
    `Ya podés ver tu cuenta corriente con nosotros: tu saldo, tus movimientos y descargar tu resumen en PDF.`,
    ``,
    `Ingresá en: ${enlace}`,
    `Usuario: ${usuario}`,
    `Contraseña: ${password}`,
    ``,
    `Guardá estos datos en un lugar seguro. Si los perdés, pedinos una contraseña nueva.`,
    ``,
    `CEAVital`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#ebecee;font-family:Arial,Helvetica,sans-serif;color:#1b2622;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
    <tr><td style="background:#0e4b38;padding:18px 24px;color:#ffffff;font-size:20px;font-weight:bold;">CEAVital</td></tr>
    <tr><td style="padding:24px;font-size:15px;line-height:1.5;">
      <p style="margin:0 0 12px;">Hola,</p>
      <p style="margin:0 0 18px;">Ya podés ver tu cuenta corriente con nosotros: tu saldo, tus movimientos y descargar tu resumen en PDF.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f1f3f4;border-radius:8px;width:100%;">
        <tr><td style="padding:14px 16px;font-size:14px;">
          <div style="color:#6b7672;font-size:12px;">USUARIO</div>
          <div style="font-family:Consolas,monospace;font-size:15px;font-weight:bold;margin-bottom:10px;">${escaparHtml(usuario)}</div>
          <div style="color:#6b7672;font-size:12px;">CONTRASEÑA</div>
          <div style="font-family:Consolas,monospace;font-size:15px;font-weight:bold;">${escaparHtml(password)}</div>
        </td></tr>
      </table>
      <p style="margin:22px 0;"><a href="${escaparHtml(enlace)}" style="background:#0e4b38;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">Ingresar a mi cuenta</a></p>
      <p style="margin:0;color:#6b7672;font-size:13px;">Guardá estos datos en un lugar seguro. Si los perdés, pedinos una contraseña nueva.</p>
    </td></tr>
  </table>
</body></html>`;

  return { asunto, texto, html };
}

// Código de ingreso de un usuario del negocio (verificar su email la primera vez, o 2FA).
// Sale por el correo de la empresa.
export function armarCorreoCodigo({ nombre, codigo, minutos }) {
  const asunto = `CEAVital: tu código de ingreso es ${codigo}`;
  const texto = [
    `Hola${nombre ? ` ${nombre}` : ''},`,
    '',
    `Tu código para ingresar a CEAVital es: ${codigo}`,
    `Vence en ${minutos} minutos.`,
    '',
    'Si no fuiste vos, avisale al administrador de tu negocio: alguien conoce tu contraseña.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#ebecee;font-family:Arial,Helvetica,sans-serif;color:#1b2622;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
    <tr><td style="background:#0e4b38;padding:18px 24px;color:#ffffff;font-size:20px;font-weight:bold;">CEAVital</td></tr>
    <tr><td style="padding:24px;font-size:15px;line-height:1.5;">
      <p style="margin:0 0 12px;">Hola${nombre ? ` ${escaparHtml(nombre)}` : ''},</p>
      <p style="margin:0 0 12px;">Tu código para ingresar a CEAVital es:</p>
      <p style="margin:0 0 12px;font-family:Consolas,monospace;font-size:30px;font-weight:bold;letter-spacing:6px;">${escaparHtml(codigo)}</p>
      <p style="margin:0 0 18px;color:#3a4642;">Vence en ${minutos} minutos.</p>
      <p style="margin:0;color:#6b7672;font-size:13px;">Si no fuiste vos, avisale al administrador de tu negocio: alguien conoce tu contraseña.</p>
    </td></tr>
  </table>
</body></html>`;
  return { asunto, texto, html };
}

const fechaLegible = (iso) => iso.split('-').reverse().join('/');
const plural = (n) => `${n} día${n === 1 ? '' : 's'}`;

// Aviso de cuota de CEA a la empresa contratante. tipo: por_vencer | vence_hoy | vencida |
// suspension_proxima (necesita suspendeEl) | suspendida | reactivada.
export function armarCorreoCuota({ tipo, vence, diasRestantes, suspendeEl }) {
  const fecha = vence ? fechaLegible(vence) : '';
  const casos = {
    por_vencer: () => ({
      asunto: `CEAVital: tu cuota vence el ${fecha}`,
      linea: `Tu cuota de CEAVital vence el ${fecha} (faltan ${plural(diasRestantes)}).`,
    }),
    vence_hoy: () => ({
      asunto: 'CEAVital: tu cuota vence hoy',
      linea: `Tu cuota de CEAVital vence hoy, ${fecha}.`,
    }),
    vencida: () => ({
      asunto: `CEAVital: tu cuota está vencida desde el ${fecha}`,
      linea: `Tu cuota de CEAVital venció el ${fecha} (hace ${plural(-diasRestantes)}).`,
    }),
    suspension_proxima: () => ({
      asunto: `CEAVital: tu servicio se suspende el ${fechaLegible(suspendeEl)}`,
      linea: `Tu cuota de CEAVital venció el ${fecha}. Si no se registra el pago, el servicio se suspende el ${fechaLegible(suspendeEl)}.`,
    }),
    suspendida: () => ({
      asunto: 'CEAVital: tu servicio fue suspendido',
      linea: `Tu servicio de CEAVital fue suspendido por falta de pago de la cuota vencida el ${fecha}. Tus datos se conservan y el servicio se reactiva cuando se registre el pago.`,
    }),
    reactivada: () => ({
      asunto: 'CEAVital: tu servicio está activo de nuevo',
      linea: 'Tu servicio de CEAVital ya está activo de nuevo: podés ingresar como siempre.',
    }),
  };
  const { asunto, linea } = casos[tipo]();
  const cierre =
    tipo === 'reactivada'
      ? 'Cualquier duda, respondé este mail o escribinos por WhatsApp.'
      : 'Para regularizarla o consultar cualquier duda, respondé este mail o escribinos por WhatsApp.';

  const texto = ['Hola,', '', linea, cierre, '', 'CEA Servicios - CEAVital'].join('\n');
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#ebecee;font-family:Arial,Helvetica,sans-serif;color:#1b2622;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
    <tr><td style="background:#0e4b38;padding:18px 24px;color:#ffffff;font-size:20px;font-weight:bold;">CEAVital</td></tr>
    <tr><td style="padding:24px;font-size:15px;line-height:1.5;">
      <p style="margin:0 0 12px;">Hola,</p>
      <p style="margin:0 0 12px;font-weight:bold;">${escaparHtml(linea)}</p>
      <p style="margin:0;color:#3a4642;">${escaparHtml(cierre)}</p>
    </td></tr>
  </table>
</body></html>`;
  return { asunto, texto, html };
}
