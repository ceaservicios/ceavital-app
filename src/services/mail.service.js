import nodemailer from 'nodemailer';
import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import { pesosDelTotal } from './dolar-blue.service.js';

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

// La dirección sola de "Nombre <dir@x>" o "dir@x", en minúsculas.
const direccion = (valor) => (String(valor ?? '').match(/<([^>]+)>/)?.[1] ?? String(valor ?? '')).trim().toLowerCase();

// Por qué correo sale un mail. Una casilla que se manda un mail a sí misma por SMTP no lo recibe:
// Gmail lo deja solo en Enviados. Cuando el correo de la empresa es también el mail de su
// Administrador (como en Central), lo que el sistema le manda a esa misma casilla (contraseña
// provisoria, código de dos pasos) sale por el correo de CEA (decisión del usuario, 2026-10-14). Sin
// el correo de CEA, sale igual por el de la empresa.
export function canalDeSalida(canal, para) {
  if (canal !== 'empresa' || !disponible('cea')) return canal;
  const { user, from } = CANALES.empresa();
  const propia = new Set([direccion(user), direccion(from)].filter(Boolean));
  return propia.has(direccion(para)) ? 'cea' : canal;
}

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

// ---- Mails del negocio a sus usuarios y a los clientes del portal (2026-10-14) ----
// Con la marca del negocio (logo frontend/public/logo-negocio.png y sus datos de Configuración >
// Datos del negocio al pie) y, abajo de todo, que el sistema es CEAVital, de CEA Servicios.
// negocio: { nombre, telefono, email, direccion, instagram } (negocio.service), o null si no se pudo leer.
// Única diferencia con Central (2026-10-16): la marca. Acá el negocio es CEAVital (verde "CEA" y azul
// "Vital", Book de Marca); Central usa los colores de Mayorista Central. Un clon nuevo cambia solo
// esto, el logo y los colores de resumen-cuenta-pdf.service.js.
const MARCA_NEGOCIO = { principal: '#0E4B38', secundario: '#22428C' };

const nombreNegocio = (negocio) => negocio?.nombre || 'CEAVital';

function datosDelPie(negocio) {
  if (!negocio) return [];
  return [
    negocio.telefono && ['Teléfono', negocio.telefono, null],
    negocio.email && ['Mail', negocio.email, `mailto:${negocio.email}`],
    negocio.direccion && ['Dirección', negocio.direccion, null],
    negocio.instagram && ['Instagram', `@${negocio.instagram}`, `https://www.instagram.com/${negocio.instagram}/`],
  ].filter(Boolean);
}

function textoConPie(lineas, negocio) {
  const pie = datosDelPie(negocio).map(([k, v]) => `${k}: ${v}`);
  return [...lineas, '', nombreNegocio(negocio), ...pie, '', 'Enviado con CEAVital, un producto de CEA Servicios.'].join('\n');
}

function boton(enlace, etiqueta) {
  return `<a href="${escaparHtml(enlace)}" style="display:inline-block;background:${MARCA_NEGOCIO.principal};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:bold;font-size:15px;">${escaparHtml(etiqueta)}</a>`;
}

function marcoNegocio(negocio, contenido) {
  const base = config.publicUrl ? config.publicUrl.replace(/\/+$/, '') : '';
  const nombre = nombreNegocio(negocio);
  const fuente = "'Segoe UI',Arial,Helvetica,sans-serif";
  const datos = datosDelPie(negocio);
  const filaDato = ([k, v, enlace]) => `
          <div style="font-size:13px;line-height:1.6;color:#3a4642;"><span style="color:#6b7672;">${escaparHtml(k)}:</span> ${
            enlace
              ? `<a href="${escaparHtml(enlace)}" style="color:${MARCA_NEGOCIO.principal};font-weight:bold;text-decoration:none;">${escaparHtml(v)}</a>`
              : `<strong style="color:#1b2622;">${escaparHtml(v)}</strong>`
          }</div>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#eef0f3;font-family:${fuente};color:#1b2622;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;">
    <tr><td style="font-size:0;line-height:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="background:${MARCA_NEGOCIO.principal};height:6px;width:70%;">&nbsp;</td>
        <td style="background:${MARCA_NEGOCIO.secundario};height:6px;width:30%;">&nbsp;</td>
      </tr></table>
    </td></tr>
    <tr><td align="center" style="padding:26px 28px 6px;text-align:center;">${
      base
        ? `
      <img src="${escaparHtml(base)}/logo-negocio.png" width="240" height="90" alt="${escaparHtml(nombre)}" style="display:block;margin:0 auto;border:0;width:240px;height:auto;font-size:22px;font-weight:bold;color:${MARCA_NEGOCIO.principal};">`
        : `
      <div style="font-size:24px;font-weight:bold;color:${MARCA_NEGOCIO.principal};">${escaparHtml(nombre)}</div>`
    }
    </td></tr>
    <tr><td style="padding:18px 28px 0;"><div style="border-top:1px solid #eef0f3;font-size:0;line-height:0;">&nbsp;</div></td></tr>
    <tr><td style="padding:18px 28px 0;font-size:15px;line-height:1.55;color:#3a4642;">${contenido}
    </td></tr>
    <tr><td style="padding:26px 28px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border-radius:12px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:15px;font-weight:bold;color:${MARCA_NEGOCIO.principal};margin-bottom:${datos.length ? '6px' : '0'};">${escaparHtml(nombre)}</div>${datos.map(filaDato).join('')}
        </td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding:16px 28px 24px;text-align:center;font-size:12px;line-height:1.5;color:#8a948f;">
      Enviado con <strong style="color:#0E4B38;">CEA</strong><strong style="color:#22428C;">Vital</strong>, un producto de <strong style="color:#3a4642;">CEA Servicios</strong>
    </td></tr>
  </table>
</body></html>`;
}

// Mail con los datos de acceso al portal, con la marca del negocio.
export function armarCorreoAcceso({ razonSocial, enlace, usuario, password, negocio = null }) {
  const nombre = nombreNegocio(negocio);
  const asunto = `${nombre}: acceso a tu cuenta corriente`;
  const intro = `Ya podés ver tu cuenta corriente con ${nombre}: tu saldo, tus movimientos y tu resumen en PDF, y hacer pedidos desde el catálogo.`;
  const cuidado = 'Guardá estos datos en un lugar seguro. Si los perdés, pedinos una contraseña nueva.';
  const texto = textoConPie(
    [`Hola${razonSocial ? `, ${razonSocial}` : ''},`, '', intro, '', `Ingresá en: ${enlace}`, `Usuario: ${usuario}`, `Contraseña: ${password}`, '', cuidado],
    negocio
  );
  const html = marcoNegocio(
    negocio,
    `
      <p style="margin:0 0 12px;color:#1b2622;">Hola${razonSocial ? `, <strong>${escaparHtml(razonSocial)}</strong>` : ''}:</p>
      <p style="margin:0 0 18px;">${escaparHtml(intro)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e6ea;border-radius:12px;">
        <tr><td style="padding:14px 18px;">
          <div style="font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#6b7672;">Usuario</div>
          <div style="font-family:Consolas,Menlo,monospace;font-size:17px;font-weight:bold;color:#1b2622;margin:2px 0 12px;">${escaparHtml(usuario)}</div>
          <div style="font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#6b7672;">Contraseña</div>
          <div style="font-family:Consolas,Menlo,monospace;font-size:17px;font-weight:bold;color:#1b2622;margin-top:2px;">${escaparHtml(password)}</div>
        </td></tr>
      </table>
      <p style="margin:22px 0 14px;">${boton(enlace, 'Ingresar a mi cuenta')}</p>
      <p style="margin:0;font-size:13px;color:#6b7672;">${escaparHtml(cuidado)}</p>`
  );
  return { asunto, texto, html };
}

// Para qué es el código (codigos_ingreso.proposito): cambia el asunto y la frase del mail. 'ingreso'
// (ingresar o verificar el email), 'configurar' (activar la verificación en dos pasos por mail) y
// 'restaurar' (confirmar la restauración de una copia, solo el superadmin). `a` y `en`: dónde
// ("al sistema de X" / "en el sistema de X", o "a CEAVital" / "en CEAVital").
function motivoDelCodigo(proposito, { a, en }) {
  if (proposito === 'configurar') {
    return {
      asunto: 'tu código para activar la verificación en dos pasos',
      frase: `Tu código para activar la verificación en dos pasos ${en} es`,
    };
  }
  if (proposito === 'restaurar') {
    return { asunto: 'tu código para restaurar una copia', frase: `Tu código para restaurar una copia de seguridad ${en} es` };
  }
  return { asunto: 'tu código de ingreso', frase: `Tu código para ingresar ${a} es` };
}

// Código por mail (ingresar o verificar el email la primera vez, activar la verificación en dos
// pasos, restaurar una copia: `proposito`). El de un usuario del negocio lleva la marca del
// negocio; el del superadmin (paraCea), la de CEAVital.
export function armarCorreoCodigo({ nombre, codigo, minutos, paraCea = false, negocio = null, proposito = 'ingreso' }) {
  if (paraCea) return armarCorreoCodigoCea({ nombre, codigo, minutos, proposito });
  const sistema = nombreNegocio(negocio);
  const motivo = motivoDelCodigo(proposito, { a: `al sistema de ${sistema}`, en: `en el sistema de ${sistema}` });
  const asunto = `${sistema}: ${motivo.asunto} es ${codigo}`;
  const pie = 'Si no fuiste vos, avisale al administrador: alguien conoce tu contraseña.';
  const texto = textoConPie(
    [`Hola${nombre ? ` ${nombre}` : ''},`, '', `${motivo.frase}: ${codigo}`, `Vence en ${minutos} minutos.`, '', pie],
    negocio
  );
  const html = marcoNegocio(
    negocio,
    `
      <p style="margin:0 0 12px;color:#1b2622;">Hola${nombre ? ` <strong>${escaparHtml(nombre)}</strong>` : ''}:</p>
      <p style="margin:0 0 14px;">${escaparHtml(motivo.frase)}:</p>
      <div style="display:inline-block;background:#f6f7f9;border:2px dashed #c9d0d8;border-radius:12px;padding:12px 20px;font-family:Consolas,Menlo,monospace;font-size:32px;font-weight:bold;letter-spacing:8px;color:${MARCA_NEGOCIO.principal};">${escaparHtml(codigo)}</div>
      <p style="margin:14px 0 16px;color:#3a4642;">Vence en ${minutos} minutos.</p>
      <p style="margin:0;font-size:13px;color:#6b7672;">${escaparHtml(pie)}</p>`
  );
  return { asunto, texto, html };
}

// Código del superadmin (sale por el correo de CEA, con la marca de CEAVital).
function armarCorreoCodigoCea({ nombre, codigo, minutos, proposito }) {
  const motivo = motivoDelCodigo(proposito, { a: 'a CEAVital', en: 'en CEAVital' });
  const asunto = `CEAVital: ${motivo.asunto} es ${codigo}`;
  const pie = 'Si no fuiste vos, alguien conoce la contraseña del superadmin: cambiala cuanto antes.';
  const texto = [
    `Hola${nombre ? ` ${nombre}` : ''},`,
    '',
    `${motivo.frase}: ${codigo}`,
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
      <p style="margin:0 0 12px;">${escaparHtml(motivo.frase)}:</p>
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

// A dónde se paga: el Mercado Pago de CEA Servicios (el mismo para todas las instalaciones).
export const ALIAS_MERCADO_PAGO = 'ceaservicios.mp';

// Importes en dólares, que llegan en centavos: "USD 1.725,00"; el corto, sin decimales si es
// redondo ("USD 1.725"), va en la línea que explica el total de la implementación.
const numeroAr = (n, decimales) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: 2 });
export const usd = (centavos) => `USD ${numeroAr(centavos / 100, 2)}`;
const usdCorto = (centavos) => `USD ${numeroAr(centavos / 100, centavos % 100 ? 2 : 0)}`;
const porcentaje = (n) => `${numeroAr(n, 0)} %`;
// Pesos enteros: "$ 397.119". La cotización del dólar blue llega en centavos: "$ 1.565" o "$ 1.565,50".
export const pesos = (n) => `$ ${numeroAr(n, 0)}`;
const pesosCotizacion = (centavos) => `$ ${numeroAr(centavos / 100, centavos % 100 ? 2 : 0)}`;

// Identidad de CEA Servicios para los avisos de pago (diseño aprobado por el usuario el 2026-10-21).
// La paleta de CEA no tiene color de alerta: la etiqueta de estado es la misma para todos los avisos.
const CEA = {
  franja: '#2C3E50', // franja superior, banda del total, títulos y montos
  fondo: '#F0F4F8', // alrededor de la hoja, Cómo pagar y la nota de costo adicional
  borde: '#E7EEF4', // borde de la hoja, filetes y etiquetas
  texto: '#495F73', // detalle, fechas y líneas chicas
  acento: '#496B88', // títulos de bloque, texto de la etiqueta y "Sin cargo"
  filete: '#6D8DA7', // filete de la nota y borde del alias
  sobreFranja: '#CACFD3', // blanco al 75 % sobre la franja, en sólido (Outlook no entiende rgba): el equivalente en pesos
};
const FUENTE_CEA = "'Montserrat','Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";
// Eslogan y contacto de CEA Servicios en el pie (usuario, 2026-10-21). El aviso sigue saliendo por SA_SMTP_*.
const ESLOGAN_CEA = 'Soluciones Digitales';
const SITIO_CEA = 'ceaservicios.com.ar';
const CORREO_CEA = 'ventas@ceaservicios.com.ar';
const WHATSAPP_CEA = '298 439-7094';
const WHATSAPP_CEA_URL = 'https://wa.me/5492984397094';
const CUIT_CEA = '27-31968097-2';

function textosDelAviso(tipo, { fecha, diasRestantes, suspendeEl }) {
  const casos = {
    por_vencer: () => ({
      etiqueta: 'Por vencer',
      asunto: `tu pago vence el ${fecha}`,
      titulo: `Tu pago vence el ${fecha}`,
      detalle: `Faltan ${plural(diasRestantes)}. Pagalo antes de esa fecha y seguí usando el sistema sin cortes.`,
    }),
    vence_hoy: () => ({
      etiqueta: 'Vence hoy',
      asunto: 'tu pago vence hoy',
      titulo: 'Tu pago vence hoy',
      detalle: `Hoy, ${fecha}, es el último día para pagarlo.`,
    }),
    vencida: () => ({
      etiqueta: 'Pago vencido',
      asunto: `tu pago está vencido desde el ${fecha}`,
      titulo: 'Tu pago está vencido',
      detalle: `Venció el ${fecha}, hace ${plural(-diasRestantes)}. Regularizalo para evitar la suspensión del servicio.`,
    }),
    suspension_proxima: () => ({
      etiqueta: 'Aviso de suspensión',
      asunto: `tu servicio se suspende el ${fechaLegible(suspendeEl)}`,
      titulo: `Tu servicio se suspende el ${fechaLegible(suspendeEl)}`,
      detalle: `Tu pago venció el ${fecha}. Si no lo registramos antes de esa fecha, el servicio se suspende. Tus datos no se pierden.`,
    }),
    suspendida: () => ({
      etiqueta: 'Servicio suspendido',
      asunto: 'tu servicio fue suspendido',
      titulo: 'Tu servicio está suspendido',
      detalle: `Por falta del pago vencido el ${fecha}. Tus datos están guardados: apenas registremos el pago, el servicio se reactiva.`,
    }),
    reactivada: () => ({
      etiqueta: 'Servicio activo',
      asunto: 'tu servicio está activo de nuevo',
      titulo: 'Tu servicio está activo de nuevo',
      detalle: 'Ya podés ingresar a CEAVital como siempre. ¡Gracias!',
    }),
  };
  return casos[tipo]();
}

// Bloques del desglose (los mismos para el HTML y el texto plano). aviso: cobro-cea.armarAviso.
function bloquesDelAviso(aviso) {
  const bloques = [];
  const impl = aviso.implementacion;
  if (impl) {
    bloques.push({
      titulo: 'Implementación del sistema',
      nota: `${usdCorto(impl.valor)} + ${porcentaje(impl.recargo)} por pagarla en ${impl.de} cuotas = ${usdCorto(impl.total)}`,
      lineas: [{ concepto: `Cuota ${impl.numero} de ${impl.de}`, importe: usd(impl.importe) }],
    });
  }
  if (aviso.abono) bloques.push({ titulo: 'Abono mensual', lineas: [{ concepto: aviso.abono.detalle, importe: usd(aviso.abono.importe) }] });

  // Mientras queden sin cargo: cuántas se usaron y cuáles. Sin quedar: las con costo de este aviso
  // (y la sin cargo que tenga su aviso justo en este mes, esa única vez). La nota sale siempre.
  const m = aviso.modificaciones;
  const lineas = [
    ...m.sin_cargo_listadas.map((x) => ({ ...x, importe: 'Sin cargo', sinCargo: true })),
    ...m.con_costo.map((x) => ({ ...x, importe: usd(x.importe) })),
  ]
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
    .map((x) => ({ fecha: fechaLegible(x.fecha), concepto: x.detalle, importe: x.importe, sinCargo: Boolean(x.sinCargo) }));
  bloques.push({
    titulo: 'Modificaciones solicitadas',
    chip: m.quedan > 0 ? `Sin cargo: ${m.usadas} de ${m.sin_cargo} usadas` : null,
    lineas,
    aclaracion:
      m.quedan > 0
        ? 'Una vez usadas las modificaciones sin cargo, cada modificación que se implemente tiene un costo adicional.'
        : 'Las modificaciones que se implementen tienen un costo adicional.',
  });
  return bloques;
}

// Aviso de pago de CEA a la empresa contratante (sale por el correo de CEA, SA_SMTP_*), con la
// identidad de CEA Servicios (2026-10-21). tipo: por_vencer | vence_hoy | vencida |
// suspension_proxima (necesita suspendeEl) | suspendida | reactivada. aviso: el desglose del
// vencimiento en dólares (cobro-cea.armarAviso): implementación, abono, modificaciones y total; sin
// nada configurado, el aviso sale sin desglose ni total. reactivada no lleva desglose ni Cómo pagar.
// cotizacion: el dólar blue venta (dolar-blue.obtenerCotizacion, ya resuelta por quien llama) o null;
// con ella y un total, el mail suma el equivalente en pesos (2026-10-21); sin ella, sale solo en dólares.
// prueba: el "Enviar mail de prueba" del panel (mismo diseño, marcado como prueba).
export function armarCorreoCuota({ tipo, vence, diasRestantes, suspendeEl, aviso = null, cotizacion = null, prueba = false }) {
  const fecha = vence ? fechaLegible(vence) : '';
  const textos = textosDelAviso(tipo, { fecha, diasRestantes, suspendeEl });
  const asunto = `${prueba ? '[Prueba] ' : ''}CEA Servicios: ${textos.asunto}`;
  const pagar = tipo !== 'reactivada';
  const desglose = pagar && aviso?.configurado ? aviso : null;
  const bloques = desglose ? bloquesDelAviso(desglose) : [];
  const total = desglose ? usd(desglose.total) : null;
  const montoPesos = desglose?.total > 0 && typeof cotizacion?.dia === 'string' ? pesosDelTotal(desglose.total, cotizacion.venta_cent) : null;
  const enPesos = montoPesos === null ? null : pesos(montoPesos);
  const diaBlue = enPesos ? fechaLegible(cotizacion.dia) : '';
  const venta = enPesos ? pesosCotizacion(cotizacion.venta_cent) : '';
  const otroDia = 'Si pagás otro día, el importe en pesos se calcula con el dólar blue de ese día.';
  const base = config.publicUrl ? config.publicUrl.replace(/\/+$/, '') : '';
  let instalacion = '';
  try {
    instalacion = base ? new URL(base).hostname : '';
  } catch {
    instalacion = '';
  }
  const servicio = `CEAVital${instalacion ? ` · ${instalacion}` : ''}`;
  const avisoPrueba = 'Prueba: así se ven los avisos de pago que le llegan a la empresa.';
  const comoPagar = enPesos
    ? `Transferí ${total}, o su equivalente de ${enPesos}, por Mercado Pago al alias`
    : `Transferí ${total ? `${total} ` : ''}por Mercado Pago al alias`;
  const despues = 'Después respondé este mail con el comprobante. Si ya lo mandaste, ignorá este aviso.';

  const texto = [
    ...(prueba ? [`(${avisoPrueba})`, ''] : []),
    'Hola,',
    '',
    `${textos.titulo}.`,
    textos.detalle,
    '',
    `Servicio: ${servicio}`,
    ...bloques.flatMap((b) => [
      '',
      b.titulo.toUpperCase(),
      ...(b.nota ? [b.nota] : []),
      ...(b.chip ? [b.chip] : []),
      ...b.lineas.map((l) => `${l.fecha ? `${l.fecha} · ` : ''}${l.concepto}: ${l.importe}`),
      ...(b.aclaracion ? [b.aclaracion] : []),
    ]),
    ...(total ? ['', `TOTAL A PAGAR: ${total}`, ...(enPesos ? [`≈ ${enPesos} al dólar blue venta del ${diaBlue} (${venta})`] : [])] : []),
    ...(pagar
      ? ['', `Cómo pagar: ${comoPagar.charAt(0).toLowerCase()}${comoPagar.slice(1)} ${ALIAS_MERCADO_PAGO}.`, despues, ...(enPesos ? [otroDia] : [])]
      : base
        ? ['', `Ingresá en: ${base}/login`]
        : []),
    '',
    `CEA Servicios – ${ESLOGAN_CEA}`,
    `${SITIO_CEA} · ${CORREO_CEA}`,
    `WhatsApp ${WHATSAPP_CEA} · CUIT ${CUIT_CEA}`,
  ].join('\n');

  const e = escaparHtml;
  const separador = (arriba) =>
    `<tr><td class="cea-pad" style="padding:${arriba}px 32px 0;"><div style="border-top:1px solid ${CEA.borde};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
  const rotulo = (t) =>
    `<div style="font-size:11px;line-height:1.5;letter-spacing:.18em;text-transform:uppercase;color:${CEA.acento};">+ ${e(t)}</div>`;
  const fila = (l) => `
              <tr>
                <td valign="top" style="padding:7px 12px 0 0;font-size:15px;line-height:1.45;color:${CEA.franja};">${l.fecha ? `<span style="color:${CEA.texto};">${e(l.fecha)}</span> &middot; ` : ''}${e(l.concepto)}</td>
                <td align="right" valign="top" style="padding:7px 0 0;font-size:15px;line-height:1.45;white-space:nowrap;text-align:right;color:${l.sinCargo ? CEA.acento : CEA.franja};">${e(l.importe)}</td>
              </tr>`;
  const bloqueHtml = (b) => `
        <tr><td class="cea-pad-in" style="padding:0 24px;"><div style="border-top:1px solid ${CEA.borde};font-size:0;line-height:0;">&nbsp;</div></td></tr>
        <tr><td class="cea-pad-in" style="padding:16px 24px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td class="cea-bloque" valign="middle">${rotulo(b.titulo)}</td>${
              b.chip
                ? `
            <td class="cea-apila" align="right" valign="middle" style="text-align:right;white-space:nowrap;padding-left:8px;"><span style="display:inline-block;background:${CEA.borde};color:${CEA.franja};border-radius:999px;padding:3px 10px;font-size:12px;line-height:1.5;">${e(b.chip)}</span></td>`
                : ''
            }
          </tr></table>${b.nota ? `
          <div style="margin-top:6px;font-size:13px;line-height:1.45;color:${CEA.texto};">${e(b.nota)}</div>` : ''}${
            b.lineas.length
              ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:2px;">${b.lineas.map(fila).join('')}
          </table>`
              : ''
          }${
            b.aclaracion
              ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>
            <td style="background:${CEA.fondo};border-left:3px solid ${CEA.filete};border-radius:0 8px 8px 0;padding:12px 16px;font-size:14px;line-height:1.5;color:${CEA.franja};">${e(b.aclaracion)}</td>
          </tr></table>`
              : ''
          }
        </td></tr>`;

  let cuerpo = '';
  if (pagar) {
    cuerpo = `
    <tr><td class="cea-pad" style="padding:26px 32px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${CEA.borde};border-radius:12px;border-collapse:separate;">
        <tr><td class="cea-pad-in" style="padding:16px 24px;font-size:14px;line-height:1.45;color:${CEA.texto};">Servicio: <span style="color:${CEA.franja};">${e(servicio)}</span></td></tr>${bloques.map(bloqueHtml).join('')}${
          total
            ? `
        <tr><td class="cea-pad-in" style="background:${CEA.franja};border-radius:0 0 11px 11px;padding:20px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td valign="middle" style="font-size:12px;line-height:1.4;letter-spacing:.18em;text-transform:uppercase;color:#ffffff;">Total a pagar</td>
            <td class="cea-total" align="right" valign="middle" style="font-size:34px;line-height:1.1;font-weight:300;color:#ffffff;white-space:nowrap;text-align:right;">${e(total)}</td>
          </tr>${
            enPesos
              ? `
          <tr><td colspan="2" align="right" style="padding-top:6px;font-size:13px;line-height:1.45;color:${CEA.sobreFranja};text-align:right;"><span style="white-space:nowrap;">&asymp; ${e(enPesos)}</span> <span style="white-space:nowrap;">al dólar blue venta</span> <span style="white-space:nowrap;">del ${e(diaBlue)} (${e(venta)})</span></td></tr>`
              : ''
          }</table>
        </td></tr>`
            : ''
        }
      </table>
    </td></tr>
    <tr><td class="cea-pad" style="padding:20px 32px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CEA.fondo};border-radius:12px;">
        <tr><td class="cea-pad-in" style="padding:20px 24px 22px;">
          ${rotulo('Cómo pagar')}
          <div style="margin:8px 0 14px;font-size:16px;line-height:1.5;color:${CEA.franja};">${
            enPesos
              ? `Transferí <span style="white-space:nowrap;">${e(total)}</span>, o su equivalente de <span style="white-space:nowrap;">${e(enPesos)}</span>, por Mercado Pago al alias`
              : e(comoPagar)
          }:</div>
          <div style="background:#ffffff;border:1.5px solid ${CEA.filete};border-radius:10px;padding:14px 16px;text-align:center;font-size:30px;line-height:1.2;font-weight:300;color:${CEA.franja};">${e(ALIAS_MERCADO_PAGO)}</div>
          <div style="margin-top:14px;font-size:14px;line-height:1.55;color:${CEA.texto};">${e(despues)}</div>${
            enPesos
              ? `
          <div style="margin-top:8px;font-size:13px;line-height:1.5;color:${CEA.texto};">${e(otroDia)}</div>`
              : ''
          }
        </td></tr>
      </table>
    </td></tr>`;
  } else {
    cuerpo = `
    <tr><td class="cea-pad" align="center" style="padding:22px 32px 0;text-align:center;font-size:14px;line-height:1.45;color:${CEA.texto};">Servicio: <span style="color:${CEA.franja};">${e(servicio)}</span></td></tr>${
      base
        ? `
    <tr><td class="cea-pad" align="center" style="padding:18px 32px 0;text-align:center;">
      <a href="${e(base)}/login" style="display:inline-block;background:${CEA.franja};color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:10px;font-size:15px;">Ingresar al sistema</a>
    </td></tr>`
        : ''
    }`;
  }

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(asunto)}</title>
<style>@media only screen and (max-width:520px){.cea-pad{padding-left:20px!important;padding-right:20px!important}.cea-pad-in{padding-left:18px!important;padding-right:18px!important}.cea-bloque,.cea-apila{display:block!important;width:auto!important;text-align:left!important}.cea-apila{padding:6px 0 0!important}.cea-total{font-size:28px!important}}</style></head>
<body style="margin:0;padding:24px 12px;background:${CEA.fondo};font-family:${FUENTE_CEA};font-weight:400;color:${CEA.franja};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid ${CEA.borde};border-radius:14px;border-collapse:separate;overflow:hidden;">
    <tr><td style="background:${CEA.franja};height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>${
      prueba
        ? `
    <tr><td style="background:${CEA.borde};color:${CEA.franja};font-size:13px;line-height:1.4;padding:10px 32px;">${e(avisoPrueba)}</td></tr>`
        : ''
    }
    <tr><td class="cea-pad" style="padding:22px 32px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle" style="font-size:24px;line-height:1.2;font-weight:300;color:${CEA.franja};">CEA Servicios</td>
        <td align="right" valign="middle" style="font-size:11px;line-height:1.4;letter-spacing:.18em;text-transform:uppercase;color:${CEA.texto};white-space:nowrap;text-align:right;">+ Aviso de pago</td>
      </tr></table>
    </td></tr>
    ${separador(18)}
    <tr><td class="cea-pad" align="center" style="padding:28px 32px 0;text-align:center;">
      <span style="display:inline-block;background:${CEA.borde};color:${CEA.acento};border-radius:999px;padding:6px 16px;font-size:12px;line-height:1.4;letter-spacing:.16em;text-transform:uppercase;">&#9679;&nbsp;${e(textos.etiqueta)}</span>
      <h1 style="margin:18px 0 10px;font-size:30px;line-height:1.25;font-weight:300;color:${CEA.franja};">${e(textos.titulo)}</h1>
      <p style="margin:0 auto;max-width:440px;font-size:16px;line-height:1.55;color:${CEA.texto};">${e(textos.detalle)}</p>
    </td></tr>${cuerpo}
    ${separador(28)}
    <tr><td class="cea-pad" align="center" style="padding:20px 32px 28px;text-align:center;">
      <div style="font-size:18px;line-height:1.4;font-weight:300;color:${CEA.franja};">CEA Servicios &ndash; <span style="white-space:nowrap;">${ESLOGAN_CEA}</span></div>
      <div style="margin-top:6px;font-size:13px;line-height:1.5;color:${CEA.texto};"><a href="https://${SITIO_CEA}" style="color:${CEA.texto};text-decoration:none;">${SITIO_CEA}</a> &middot; <a href="mailto:${CORREO_CEA}" style="color:${CEA.texto};text-decoration:none;">${CORREO_CEA}</a></div>
      <div style="font-size:13px;line-height:1.5;color:${CEA.texto};"><a href="${WHATSAPP_CEA_URL}" style="color:${CEA.texto};text-decoration:none;white-space:nowrap;">WhatsApp ${WHATSAPP_CEA}</a> &middot; <span style="white-space:nowrap;">CUIT ${CUIT_CEA}</span></div>
    </td></tr>
  </table>
</body></html>`;
  return { asunto, texto, html };
}
