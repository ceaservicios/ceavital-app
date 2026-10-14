import nodemailer from 'nodemailer';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

// Envío de mails por SMTP (EST-01 §10). Dos canales: 'empresa' (SMTP_*: el correo de la empresa,
// para sus usuarios y los clientes de su portal) y 'cea' (SA_SMTP_*: avisos de cuota, alertas de
// seguridad, copias fallidas y los códigos del superadmin, remitente de CEA). Todo sale en cola
// (cola-correo.service.js), salvo el correo de prueba del panel, que es inmediato.
// La app funciona sin el correo de la empresa: la verificación del email de los empleados queda en
// pausa, el 2FA de los Administradores va por app y las contraseñas provisorias se ven en pantalla.
// Sin SA_SMTP_* no sale ningún aviso de CEA.
const CANALES = { empresa: () => config.smtp, cea: () => config.saSmtp };
const transportes = {};

const disponible = (canal) => Boolean(CANALES[canal]().host && CANALES[canal]().from);

export const correoDisponible = () => disponible('empresa');
export const correoCeaDisponible = () => disponible('cea');
export const correoDelCanalDisponible = (canal) => disponible(canal);

// Para el panel: si está configurado, desde qué dirección sale y a dónde van las respuestas
// (nunca el host, el usuario ni la clave).
export function datosDelCanal(canal) {
  const { from, replyTo } = CANALES[canal]();
  return { configurado: disponible(canal), remitente: from || null, responder_a: replyTo || null };
}

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

// Manda ya, sin cola. Los errores del SMTP salen tal cual: la cola los anota para reintentar.
export async function mandarPorSmtp(canal, { para, asunto, texto, html }) {
  if (!disponible(canal)) throw new Error('El correo no está configurado');
  const { from, replyTo } = CANALES[canal]();
  await obtenerTransporte(canal).sendMail({ from, replyTo: replyTo || undefined, to: para, subject: asunto, text: texto, html });
}

// Envío inmediato con el error traducido para la pantalla: solo para los correos de prueba del
// panel, que tienen que mostrar el resultado en el momento. Todo lo demás va por la cola.
export async function enviarCorreo({ para, asunto, texto, html }, canal = 'empresa') {
  if (!disponible(canal)) {
    throw new ApiError(503, 'El envío de mails no está configurado en este servidor');
  }
  try {
    await mandarPorSmtp(canal, { para, asunto, texto, html });
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

// Código de ingreso (verificar el email la primera vez, o la verificación en dos pasos). El de
// un usuario del negocio sale por el correo de la empresa; el del superadmin, por el de CEA.
export function armarCorreoCodigo({ nombre, codigo, minutos, paraCea = false }) {
  const asunto = `CEAVital: tu código de ingreso es ${codigo}`;
  const pie = paraCea
    ? 'Si no fuiste vos, alguien conoce la contraseña del superadmin: cambiala cuanto antes.'
    : 'Si no fuiste vos, avisale al administrador de tu negocio: alguien conoce tu contraseña.';
  const texto = [
    `Hola${nombre ? ` ${nombre}` : ''},`,
    '',
    `Tu código para ingresar a CEAVital es: ${codigo}`,
    `Vence en ${minutos} minutos.`,
    '',
    pie,
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
      <p style="margin:0;color:#6b7672;font-size:13px;">${escaparHtml(pie)}</p>
    </td></tr>
  </table>
</body></html>`;
  return { asunto, texto, html };
}

// Cuenta de Administrador que da de alta el superadmin (EST-01 §5), o contraseña provisoria nueva
// (restablecida = true). Sale por el correo de la empresa, si está configurado.
export function armarCorreoCuentaAdmin({ nombre, email, password, enlace, restablecida = false }) {
  const asunto = restablecida ? 'CEAVital: tu contraseña provisoria nueva' : 'CEAVital: tu cuenta de Administrador';
  const intro = restablecida
    ? 'Se generó una contraseña provisoria nueva para tu cuenta de Administrador.'
    : 'Ya tenés tu cuenta de Administrador en CEAVital.';
  const aviso =
    'Al entrar te va a pedir que elijas una contraseña nueva y que actives la verificación en dos pasos (con una app autenticadora del celular o con un código por mail).';
  const texto = [
    `Hola${nombre ? ` ${nombre}` : ''},`,
    '',
    intro,
    '',
    `Ingresá en: ${enlace}`,
    `Usuario: ${email}`,
    `Contraseña provisoria: ${password}`,
    '',
    aviso,
    '',
    'CEAVital',
  ].join('\n');
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#ebecee;font-family:Arial,Helvetica,sans-serif;color:#1b2622;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
    <tr><td style="background:#0e4b38;padding:18px 24px;color:#ffffff;font-size:20px;font-weight:bold;">CEAVital</td></tr>
    <tr><td style="padding:24px;font-size:15px;line-height:1.5;">
      <p style="margin:0 0 12px;">Hola${nombre ? ` ${escaparHtml(nombre)}` : ''},</p>
      <p style="margin:0 0 18px;">${escaparHtml(intro)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f1f3f4;border-radius:8px;width:100%;">
        <tr><td style="padding:14px 16px;font-size:14px;">
          <div style="color:#6b7672;font-size:12px;">USUARIO</div>
          <div style="font-family:Consolas,monospace;font-size:15px;font-weight:bold;margin-bottom:10px;">${escaparHtml(email)}</div>
          <div style="color:#6b7672;font-size:12px;">CONTRASEÑA PROVISORIA</div>
          <div style="font-family:Consolas,monospace;font-size:15px;font-weight:bold;">${escaparHtml(password)}</div>
        </td></tr>
      </table>
      <p style="margin:22px 0;"><a href="${escaparHtml(enlace)}" style="background:#0e4b38;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">Ingresar</a></p>
      <p style="margin:0;color:#6b7672;font-size:13px;">${escaparHtml(aviso)}</p>
    </td></tr>
  </table>
</body></html>`;
  return { asunto, texto, html };
}

// Correo de prueba de la pestaña Correo del panel: comprueba que ese correo sale.
export function armarCorreoPrueba(canal) {
  const sitio = config.publicUrl || 'CEAVital';
  const [nombre, uso] =
    canal === 'cea'
      ? ['el correo de CEA', 'los avisos de cuota a la empresa, las alertas de seguridad y los códigos de ingreso del superadmin']
      : ['el correo de la empresa', 'los mails a los usuarios del negocio y a los clientes del portal: contraseñas provisorias, códigos de ingreso y datos de acceso'];
  return {
    asunto: `CEAVital: correo de prueba (${nombre})`,
    texto: [`Este es un correo de prueba de ${nombre} de ${sitio}.`, '', `Si lo recibiste, sale bien. Por acá salen ${uso}.`].join('\n'),
  };
}

// Aviso al superadmin (correo de CEA) cuando falla la copia de seguridad automática del día.
export function armarCorreoCopiaFallida({ instalacion, error, enlace }) {
  const asunto = `[CEAVital] Falló la copia de seguridad de ${instalacion}`;
  const linea = 'La copia de seguridad automática de hoy no se pudo hacer. No se reintenta sola hasta mañana a las 3.';
  const accion = 'Revisá el error y probá con "Respaldar ahora" en la pestaña Copias del panel.';
  const texto = ['Hola,', '', linea, '', `Error: ${error}`, '', accion, enlace].join('\n');
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#ebecee;font-family:Arial,Helvetica,sans-serif;color:#1b2622;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
    <tr><td style="background:#0e4b38;padding:18px 24px;color:#ffffff;font-size:20px;font-weight:bold;">CEAVital</td></tr>
    <tr><td style="padding:24px;font-size:15px;line-height:1.5;">
      <p style="margin:0 0 12px;font-weight:bold;">${escaparHtml(linea)}</p>
      <p style="margin:0 0 12px;font-family:Consolas,monospace;font-size:13px;background:#f1f3f4;border-radius:8px;padding:12px 14px;">${escaparHtml(error)}</p>
      <p style="margin:0 0 18px;color:#3a4642;">${escaparHtml(accion)}</p>
      <p style="margin:0;"><a href="${escaparHtml(enlace)}" style="background:#0e4b38;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">Ir a Copias</a></p>
    </td></tr>
  </table>
</body></html>`;
  return { asunto, texto, html };
}

// Aviso a CEA (casilla de alertas) cuando termina o falla una restauración de una copia.
export function armarCorreoRestauracion({ instalacion, ok, copia, resguardo, detalle, enlace }) {
  const asunto = ok ? `[CEAVital] Se restauró una copia en ${instalacion}` : `[CEAVital] Falló la restauración de una copia en ${instalacion}`;
  const linea = ok
    ? `Se restauró la copia ${copia}. El sistema ya está disponible y todos tienen que volver a ingresar.`
    : `No se pudo restaurar la copia ${copia}. No se cambió nada: el sistema quedó como estaba y ya se puede usar.`;
  const extra = [resguardo && `Copia de cómo estaba todo antes: ${resguardo}`, detalle && (ok ? detalle : `Error: ${detalle}`)].filter(Boolean);
  const texto = ['Hola,', '', linea, '', ...extra, '', enlace].join('\n');
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#ebecee;font-family:Arial,Helvetica,sans-serif;color:#1b2622;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
    <tr><td style="background:#0e4b38;padding:18px 24px;color:#ffffff;font-size:20px;font-weight:bold;">CEAVital</td></tr>
    <tr><td style="padding:24px;font-size:15px;line-height:1.5;">
      <p style="margin:0 0 12px;font-weight:bold;">${escaparHtml(linea)}</p>
      ${extra.map((e) => `<p style="margin:0 0 12px;color:#3a4642;font-size:14px;">${escaparHtml(e)}</p>`).join('')}
      <p style="margin:18px 0 0;"><a href="${escaparHtml(enlace)}" style="background:#0e4b38;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">Ir a Copias</a></p>
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
