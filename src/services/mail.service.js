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
// $ 45.000 (pesos enteros, como todos los montos).
const pesos = (n) => `$ ${Number(n).toLocaleString('es-AR')}`;
const plural = (n) => `${n} día${n === 1 ? '' : 's'}`;

// A dónde se paga la cuota: el Mercado Pago de CEA Servicios (el mismo para todas las instalaciones).
export const ALIAS_MERCADO_PAGO = 'ceaservicios.mp';

// Colores de la marca para el estado del aviso: dorado = atención, coral = urgente, verde = todo bien.
const TONOS = {
  atencion: { fondo: '#FDF3DD', borde: '#F3C043', texto: '#6B4E00' },
  urgente: { fondo: '#FBEAEC', borde: '#E05A65', texto: '#9E2F39' },
  ok: { fondo: '#E3F1EB', borde: '#0E4B38', texto: '#0E4B38' },
};

// Aviso de cuota de CEA a la empresa contratante (sale por el correo de CEA). Diseño del
// 2026-10-14, pedido por el usuario: logo, estado en color, fechas y cómo pagar por Mercado Pago.
// tipo: por_vencer | vence_hoy | vencida | suspension_proxima (necesita suspendeEl) | suspendida |
// reactivada. monto: importe por mes que cargó el superadmin (null = no se muestra). prueba: el
// "Enviar mail de prueba" del panel (mismo diseño, marcado como prueba).
export function armarCorreoCuota({ tipo, vence, diasRestantes, suspendeEl, monto = null, prueba = false }) {
  const fecha = vence ? fechaLegible(vence) : '';
  const importe = monto ? pesos(monto) : null;
  const casos = {
    por_vencer: () => ({
      tono: 'atencion',
      etiqueta: 'Por vencer',
      asunto: `CEAVital: tu cuota vence el ${fecha}`,
      titulo: `Tu cuota vence el ${fecha}`,
      detalle: `Faltan ${plural(diasRestantes)}. Pagala antes de esa fecha y seguí usando CEAVital sin cortes.`,
    }),
    vence_hoy: () => ({
      tono: 'atencion',
      etiqueta: 'Vence hoy',
      asunto: 'CEAVital: tu cuota vence hoy',
      titulo: 'Tu cuota vence hoy',
      detalle: `Hoy, ${fecha}, es el último día para pagarla.`,
    }),
    vencida: () => ({
      tono: 'urgente',
      etiqueta: 'Cuota vencida',
      asunto: `CEAVital: tu cuota está vencida desde el ${fecha}`,
      titulo: 'Tu cuota está vencida',
      detalle: `Venció el ${fecha}, hace ${plural(-diasRestantes)}. Regularizala para evitar la suspensión del servicio.`,
    }),
    suspension_proxima: () => ({
      tono: 'urgente',
      etiqueta: 'Aviso de suspensión',
      asunto: `CEAVital: tu servicio se suspende el ${fechaLegible(suspendeEl)}`,
      titulo: `Tu servicio se suspende el ${fechaLegible(suspendeEl)}`,
      detalle: `La cuota venció el ${fecha}. Si no registramos el pago antes de esa fecha, el servicio se suspende. Tus datos no se pierden.`,
    }),
    suspendida: () => ({
      tono: 'urgente',
      etiqueta: 'Servicio suspendido',
      asunto: 'CEAVital: tu servicio fue suspendido',
      titulo: 'Tu servicio está suspendido',
      detalle: `Por falta de pago de la cuota vencida el ${fecha}. Tus datos están guardados: apenas registremos el pago, el servicio se reactiva.`,
    }),
    reactivada: () => ({
      tono: 'ok',
      etiqueta: 'Servicio activo',
      asunto: 'CEAVital: tu servicio está activo de nuevo',
      titulo: 'Tu servicio está activo de nuevo',
      detalle: 'Ya podés ingresar a CEAVital como siempre. ¡Gracias!',
    }),
  };
  const aviso = casos[tipo]();
  const tono = TONOS[aviso.tono];
  const asunto = `${prueba ? '[Prueba] ' : ''}${aviso.asunto}`;
  const pagar = tipo !== 'reactivada';
  const base = config.publicUrl ? config.publicUrl.replace(/\/+$/, '') : '';
  let instalacion = '';
  try {
    instalacion = base ? new URL(base).hostname : '';
  } catch {
    instalacion = '';
  }
  const datos = [
    importe && tipo !== 'reactivada' && ['Importe', importe],
    fecha && tipo !== 'reactivada' && ['Vencimiento', fecha],
    tipo === 'suspension_proxima' && ['Se suspende el', fechaLegible(suspendeEl)],
    instalacion && ['Sistema', `CEAVital · ${instalacion}`],
  ].filter(Boolean);

  const texto = [
    ...(prueba ? ['(Prueba: así se ven los avisos de cuota que le llegan a la empresa.)', ''] : []),
    'Hola,',
    '',
    `${aviso.titulo}.`,
    aviso.detalle,
    '',
    ...datos.map(([k, v]) => `${k}: ${v}`),
    ...(pagar
      ? ['', `Cómo pagar: transferí ${importe ? `${importe} ` : ''}por Mercado Pago (o desde tu banco) al alias ${ALIAS_MERCADO_PAGO}.`, 'Después respondé este mail con el comprobante. Si ya lo mandaste, ignorá este aviso.']
      : base
        ? ['', `Ingresá en: ${base}/login`]
        : []),
    '',
    'CEAVital es un producto de CEA Servicios - Tu aliado digital',
  ].join('\n');

  const fuente = "'Segoe UI',Arial,Helvetica,sans-serif";
  const filaDato = ([k, v]) => `
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7672;">${escaparHtml(k)}</td>
                <td style="padding:6px 0;font-size:14px;font-weight:bold;color:#1b2622;text-align:right;">${escaparHtml(v)}</td>
              </tr>`;
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#ebecee;font-family:${fuente};color:#1b2622;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;">
    <tr><td style="background:#0E4B38;height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>${
      prueba
        ? `
    <tr><td style="background:#22428C;color:#ffffff;font-size:13px;padding:10px 28px;">Prueba: así se ven los avisos de cuota que le llegan a la empresa.</td></tr>`
        : ''
    }
    <tr><td align="center" style="padding:24px 28px 0;text-align:center;">${
      base
        ? `
      <img src="${escaparHtml(base)}/logo-correo.png" width="180" height="154" alt="CEAVital · Sistema de gestión para negocios" style="display:block;margin:0 auto;border:0;width:180px;height:auto;font-size:22px;font-weight:bold;color:#0E4B38;">`
        : `
      <div style="font-size:28px;font-weight:bold;line-height:1.1;"><span style="color:#0E4B38;">CEA</span><span style="color:#22428C;">Vital</span></div>
      <div style="font-size:12px;color:#6b7672;margin-top:2px;">Sistema de gestión para negocios</div>`
    }
      <div style="margin-top:12px;font-size:12px;color:#6b7672;letter-spacing:.02em;">Un producto de <strong style="color:#0E4B38;">CEA Servicios</strong></div>
    </td></tr>
    <tr><td style="padding:22px 28px 0;"><div style="border-top:1px solid #ebecee;font-size:0;line-height:0;">&nbsp;</div></td></tr>
    <tr><td style="padding:18px 28px 0;">
      <span style="display:inline-block;background:${tono.fondo};color:${tono.texto};border:1px solid ${tono.borde};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:bold;letter-spacing:.04em;text-transform:uppercase;">${escaparHtml(aviso.etiqueta)}</span>
      <h1 style="margin:14px 0 8px;font-size:22px;line-height:1.3;color:#1b2622;">${escaparHtml(aviso.titulo)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.55;color:#3a4642;">${escaparHtml(aviso.detalle)}</p>
    </td></tr>${
      datos.length
        ? `
    <tr><td style="padding:18px 28px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ebecee;border-bottom:1px solid #ebecee;">${datos.map(filaDato).join('')}
      </table>
    </td></tr>`
        : ''
    }${
      pagar
        ? `
    <tr><td style="padding:20px 28px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2FAFE;border:1px solid #CDEBFA;border-radius:12px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#0077B5;">Cómo pagar</div>
          <div style="font-size:15px;line-height:1.5;margin:6px 0 12px;color:#1b2622;">Transferí ${importe ? `<strong>${escaparHtml(importe)}</strong> ` : ''}por <strong>Mercado Pago</strong> (o desde tu banco) al alias:</div>
          <div style="display:inline-block;background:#ffffff;border:2px dashed #9FD3EE;border-radius:10px;padding:10px 16px;font-family:Consolas,Menlo,monospace;font-size:24px;font-weight:bold;color:#0E4B38;letter-spacing:.02em;">${ALIAS_MERCADO_PAGO}</div>
          <div style="font-size:13px;line-height:1.5;color:#3a4642;margin-top:12px;">Después <strong>respondé este mail con el comprobante</strong>. Si ya lo mandaste, ignorá este aviso.</div>
        </td></tr>
      </table>
    </td></tr>`
        : base
          ? `
    <tr><td style="padding:22px 28px 0;">
      <a href="${escaparHtml(base)}/login" style="display:inline-block;background:#0E4B38;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:bold;font-size:15px;">Ingresar a CEAVital</a>
    </td></tr>`
          : ''
    }
    <tr><td style="padding:24px 28px 0;">
      <div style="border-top:1px solid #ebecee;padding-top:16px;font-size:12px;line-height:1.5;color:#6b7672;">
        Aviso automático sobre tu cuota de CEAVital. ¿Dudas? Respondé este mail.
      </div>
    </td></tr>
    <tr><td style="padding:18px 28px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0E4B38;border-radius:10px;">
        <tr><td align="center" style="padding:14px 18px;text-align:center;color:#ffffff;">
          <div style="font-size:14px;line-height:1.4;">CEAVital es un producto de <strong>CEA Servicios</strong></div>
          <div style="font-size:12px;line-height:1.4;color:#cfe3da;margin-top:2px;">Tu aliado digital</div>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 0 26px;font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>
</body></html>`;
  return { asunto, texto, html };
}
