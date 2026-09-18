import nodemailer from 'nodemailer';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

// Envío de mails por SMTP. Opcional: el sistema funciona 100% sin esto (regla
// "sin internet"); solo se usa para mandarle al cliente los datos de acceso.
let transporte = null;

export function correoDisponible() {
  return Boolean(config.smtp.host && config.smtp.from);
}

function obtenerTransporte() {
  if (!transporte) {
    const { host, port, secure, user, pass } = config.smtp;
    transporte = nodemailer.createTransport({
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
  return transporte;
}

export async function enviarCorreo({ para, asunto, texto, html }) {
  if (!correoDisponible()) {
    throw new ApiError(503, 'El envío de mails no está configurado en este servidor');
  }
  try {
    await obtenerTransporte().sendMail({ from: config.smtp.from, to: para, subject: asunto, text: texto, html });
  } catch (err) {
    // El detalle técnico (host, credenciales) queda en el log del servidor,
    // nunca en la respuesta al navegador.
    console.error('[mail] no se pudo enviar:', err.message);
    throw new ApiError(502, 'No se pudo enviar el mail. Revisá la configuración de correo del servidor.');
  }
}

function escaparHtml(valor) {
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
