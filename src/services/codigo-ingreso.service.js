import crypto from 'node:crypto';
import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { verificarTotp } from '../utils/totp.js';
import { buscarCodigoRecuperacion, descifrarSecreto } from '../utils/dosfa.js';
import { armarCorreoCodigo, correoDelCanalDisponible, correoDisponible } from './mail.service.js';
import { encolarCorreo } from './cola-correo.service.js';

// Segundo paso del ingreso, para las dos cuentas con ingreso propio: los usuarios del negocio
// (`usuarios`) y el superadmin de CEA (`superadmin`). Dos métodos:
//  - 'mail': código de 6 números por mail (10 min, 5 intentos, reenvío). Sirve para verificar el
//    email de un usuario nuevo y para la verificación en dos pasos.
//  - 'app': código de la app autenticadora (TOTP) o un código de recuperación.
// La verificación en dos pasos es obligatoria para el Admin del negocio y el superadmin (EST-01 §4)
// y opcional para Encargados y Cajeros (por mail, la activa el Admin). Se pide una vez por semana
// en cada navegador. En la base solo se guardan hashes: el "desafío" identifica el ingreso en
// curso (la contraseña ya se validó) y el código es lo que llegó por mail.

export const CUENTAS = {
  usuario: { tabla: 'usuarios', fk: 'usuario_id', canal: 'empresa' },
  superadmin: { tabla: 'superadmin', fk: 'superadmin_id', canal: 'cea' },
};

const MINUTOS_VIGENCIA = 10;
const MAX_INTENTOS = 5;
const MAX_ENVIOS = 5;
const SEGUNDOS_ENTRE_ENVIOS = 60;
const DIAS_DISPOSITIVO = 7; // EST-01 §4.3: una vez por semana en cada navegador
const DISPOSITIVO_VALIDO = /^[0-9a-f]{64}$/;

export const MENSAJE_SIN_CORREO =
  'No se puede mandar el código de ingreso: falta configurar el correo de la empresa. Avisale a CEA Servicios.';
const MENSAJE_SIN_CORREO_CEA =
  'No se puede mandar el código: falta configurar el correo de CEA (SA_SMTP_*). Desde la terminal del servidor se puede restablecer la verificación: npm run restablecer-2fa-superadmin.';
const MENSAJE_VENCIDO = 'El código venció o ya no sirve. Volvé a ingresar con tu contraseña.';

const hash = (valor) => crypto.createHash('sha256').update(valor).digest('hex');
// El código va atado a su desafío: el mismo código de 6 números en otro ingreso no sirve.
const hashCodigo = (desafio, codigo) => hash(`${desafio}:${codigo}`);
const nuevoCodigo = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

export function enmascararEmail(email) {
  const [local, dominio] = email.split('@');
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${dominio}`;
}

// Misma validación de mail que usuarios.service y superadmin.service.
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// El superadmin entra con su mail: está en la columna `usuario`. Una cuenta vieja sin renombrar
// (usuario de antes de SUPERADMIN_EMAIL, que no es un mail) no tiene a dónde recibir códigos: null.
export function emailDeCuenta(tipo, cuenta) {
  const email = tipo === 'superadmin' ? cuenta.usuario : cuenta.email;
  return typeof email === 'string' && EMAIL_VALIDO.test(email) ? email : null;
}

// Lo que hace falta de cada cuenta para el segundo paso (nunca viaja a una respuesta HTTP).
export function obtenerCuenta(tipo, id) {
  if (tipo === 'superadmin') {
    return db
      .prepare('SELECT id, usuario, dosfa_metodo, dosfa_secreto, dosfa_ultimo_paso, dosfa_codigos FROM superadmin WHERE id = ?')
      .get(id);
  }
  return db
    .prepare(
      `SELECT id, nombre, usuario, rol, email, dos_fa, debe_cambiar_password,
              dosfa_metodo, dosfa_secreto, dosfa_ultimo_paso, dosfa_codigos
       FROM usuarios WHERE id = ? AND eliminado_en IS NULL`
    )
    .get(id);
}

function asegurarCorreo(tipo) {
  if (!correoDelCanalDisponible(CUENTAS[tipo].canal)) {
    throw new ApiError(503, tipo === 'superadmin' ? MENSAJE_SIN_CORREO_CEA : MENSAJE_SIN_CORREO);
  }
}

// Sale por la cola; si no salió mientras el código sirve, se descarta.
async function mandarCodigo(tipo, { nombre, email }, codigo) {
  await encolarCorreo(
    { para: email, ...armarCorreoCodigo({ nombre, codigo, minutos: MINUTOS_VIGENCIA, paraCea: tipo === 'superadmin' }) },
    { canal: CUENTAS[tipo].canal, tipo: 'codigo', venceEnMinutos: MINUTOS_VIGENCIA }
  );
}

// ---- Navegadores de confianza (cookie "dispositivo"; acá va su hash) ----

export async function dispositivoConfiable(tipo, id, dispositivo) {
  if (!DISPOSITIVO_VALIDO.test(dispositivo ?? '')) return false;
  const { fk } = CUENTAS[tipo];
  const fila = await db
    .prepare(`SELECT 1 AS ok FROM dispositivos_2fa WHERE ${fk} = ? AND dispositivo_hash = ? AND expira_en > LOCALTIMESTAMP`)
    .get(id, hash(dispositivo));
  return Boolean(fila);
}

// Este navegador queda de confianza por una semana. Devuelve su identificador (el que ya tenía
// en la cookie o uno nuevo) para guardarlo en la cookie.
export async function recordarDispositivo(tipo, id, dispositivoActual) {
  const dispositivo = DISPOSITIVO_VALIDO.test(dispositivoActual ?? '') ? dispositivoActual : crypto.randomBytes(32).toString('hex');
  const { fk } = CUENTAS[tipo];
  const conflicto = tipo === 'superadmin' ? '(superadmin_id, dispositivo_hash) WHERE superadmin_id IS NOT NULL' : '(usuario_id, dispositivo_hash)';
  await db
    .prepare(
      `INSERT INTO dispositivos_2fa (${fk}, dispositivo_hash, expira_en)
       VALUES (?, ?, LOCALTIMESTAMP + (?::int * INTERVAL '1 day'))
       ON CONFLICT ${conflicto} DO UPDATE SET expira_en = EXCLUDED.expira_en`
    )
    .run(id, hash(dispositivo), DIAS_DISPOSITIVO);
  return dispositivo;
}

// Al cambiar de método o restablecer el 2FA ningún navegador sigue de confianza. Se vencen, no se borran.
export async function olvidarDispositivos(tipo, id) {
  const { fk } = CUENTAS[tipo];
  await db
    .prepare(`UPDATE dispositivos_2fa SET expira_en = LOCALTIMESTAMP WHERE ${fk} = ? AND expira_en > LOCALTIMESTAMP`)
    .run(id);
}

// ---- ¿Qué segundo paso pide este ingreso? ----

// Admin del negocio y superadmin: obligatorio, con el método que eligió. Devuelve el método a pedir,
// o null si este navegador es de confianza o si todavía no lo configuró (entra y lo configura
// antes de poder usar el sistema: la sesión queda "pendiente", ver auth.middleware).
export async function segundoPasoObligatorio(tipo, cuenta, dispositivo) {
  if (!cuenta.dosfa_metodo) return null;
  return (await dispositivoConfiable(tipo, cuenta.id, dispositivo)) ? null : cuenta.dosfa_metodo;
}

// Encargado y Cajero: código por mail si el email todavía no se verificó, o si el Admin le activó
// el 2FA y este navegador no lo confirmó en la última semana. Sin email (usuarios anteriores),
// entra como siempre. Sin el correo de la empresa (SMTP_*) las dos cosas quedan en pausa (EST-01
// §10.2: la app funciona sin él) y se piden en cuanto se configure.
export async function segundoPasoDeEmpleado(usuario, dispositivo) {
  if (!usuario.email || !correoDisponible()) return null;
  if (!usuario.email_verificado_en) return 'mail';
  if (!usuario.dos_fa) return null;
  return (await dispositivoConfiable('usuario', usuario.id, dispositivo)) ? null : 'mail';
}

// ---- Desafíos ----

// Abre el segundo paso. Con 'mail' manda el código; con 'app' solo anota el desafío (el código lo
// da la app). proposito 'configurar': el código para confirmar el 2FA por mail desde "Mi cuenta",
// que no sirve para ingresar (y al revés).
export async function iniciarDesafio(tipo, cuenta, metodo, proposito = 'ingreso') {
  const { fk } = CUENTAS[tipo];
  const desafio = crypto.randomBytes(32).toString('hex');
  if (metodo === 'app') {
    await db
      .prepare(
        `INSERT INTO codigos_ingreso (${fk}, desafio_hash, metodo, proposito, expira_en)
         VALUES (?, ?, 'app', ?, LOCALTIMESTAMP + (?::int * INTERVAL '1 minute'))`
      )
      .run(cuenta.id, hash(desafio), proposito, MINUTOS_VIGENCIA);
    return { desafio, metodo: 'app' };
  }

  asegurarCorreo(tipo);
  const email = emailDeCuenta(tipo, cuenta);
  const codigo = nuevoCodigo();
  await db
    .prepare(
      `INSERT INTO codigos_ingreso (${fk}, desafio_hash, codigo_hash, enviado_a, metodo, proposito, expira_en)
       VALUES (?, ?, ?, ?, 'mail', ?, LOCALTIMESTAMP + (?::int * INTERVAL '1 minute'))`
    )
    .run(cuenta.id, hash(desafio), hashCodigo(desafio, codigo), email, proposito, MINUTOS_VIGENCIA);
  await mandarCodigo(tipo, { nombre: cuenta.nombre, email }, codigo);
  return { desafio, metodo: 'mail', email: enmascararEmail(email) };
}

// Método 'app': un código de 6 números de la app (TOTP) o un código de recuperación.
async function comprobarApp(cuenta, codigo) {
  const limpio = String(codigo ?? '').trim();
  if (/^\d{6}$/.test(limpio)) {
    if (!cuenta.dosfa_secreto) return null;
    let secreto;
    try {
      secreto = descifrarSecreto(cuenta.dosfa_secreto);
    } catch (err) {
      // DOSFA_CLAVE cambió o falta: el código no se puede comprobar (queda el de recuperación).
      console.error('[2fa] no se pudo descifrar el secreto de la app:', err.message);
      return null;
    }
    const paso = verificarTotp(secreto, limpio, cuenta.dosfa_ultimo_paso);
    return paso === null ? null : { paso };
  }
  const usado = await buscarCodigoRecuperacion(limpio, cuenta.dosfa_codigos);
  return usado ? { recuperacion: usado } : null;
}

// Deja asentado el factor usado, de forma atómica: el mismo paso de la app o el mismo código de
// recuperación no sirven en dos ingresos simultáneos. false = otro pedido lo usó primero.
async function consumirFactorApp(tipo, cuentaId, resultado) {
  const { tabla } = CUENTAS[tipo];
  if (resultado.paso !== undefined) {
    const fila = await db
      .prepare(
        `UPDATE ${tabla} SET dosfa_ultimo_paso = ?
         WHERE id = ? AND (dosfa_ultimo_paso IS NULL OR dosfa_ultimo_paso < ?) RETURNING id`
      )
      .get(resultado.paso, cuentaId, resultado.paso);
    return Boolean(fila);
  }
  const fila = await db
    .prepare(`UPDATE ${tabla} SET dosfa_codigos = array_remove(dosfa_codigos, ?) WHERE id = ? AND ? = ANY(dosfa_codigos) RETURNING id`)
    .get(resultado.recuperacion, cuentaId, resultado.recuperacion);
  return Boolean(fila);
}

// Valida el código y consume el desafío. Devuelve { tipo, cuenta, recuperacion } para abrir la
// sesión. Cada intento (correcto o no) se anota ANTES de comparar, en un solo UPDATE atómico con el
// tope en el WHERE: así 30 pedidos simultáneos no pasan todos el "intentos < 5".
export async function confirmarCodigo(desafio, codigo, proposito = 'ingreso') {
  // Desde "Mi cuenta" un código malo no es una sesión vencida: 400, no 401 (el 401 saca al usuario).
  const estado = proposito === 'ingreso' ? 401 : 400;
  const vencido = proposito === 'ingreso' ? MENSAJE_VENCIDO : 'El código venció o ya no sirve. Pedí uno nuevo.';

  const fila = await db
    .prepare(
      `UPDATE codigos_ingreso c SET intentos = c.intentos + 1
       WHERE c.desafio_hash = ? AND c.proposito = ? AND c.usado_en IS NULL AND c.expira_en > LOCALTIMESTAMP AND c.intentos < ?
       RETURNING c.id, c.usuario_id, c.superadmin_id, c.metodo, c.codigo_hash, c.enviado_a, c.intentos`
    )
    .get(hash(desafio), proposito, MAX_INTENTOS);
  if (!fila) throw new ApiError(estado, vencido);

  const tipo = fila.superadmin_id ? 'superadmin' : 'usuario';
  const cuenta = await obtenerCuenta(tipo, fila.superadmin_id ?? fila.usuario_id);
  if (!cuenta) throw new ApiError(estado, vencido);

  let resultadoApp = null;
  let correcto;
  if (fila.metodo === 'mail') {
    const limpio = String(codigo ?? '').trim();
    correcto =
      /^\d{6}$/.test(limpio) &&
      crypto.timingSafeEqual(Buffer.from(fila.codigo_hash, 'hex'), Buffer.from(hashCodigo(desafio, limpio), 'hex'));
  } else {
    resultadoApp = await comprobarApp(cuenta, codigo);
    correcto = Boolean(resultadoApp) && (await consumirFactorApp(tipo, cuenta.id, resultadoApp));
  }

  if (!correcto) {
    const { intentos } = fila;
    const reinicio = proposito === 'ingreso' ? 'Volvé a ingresar con tu contraseña.' : 'Pedí un código nuevo.';
    if (intentos >= MAX_INTENTOS) throw new ApiError(estado, `Demasiados intentos con un código incorrecto. ${reinicio}`);
    const quedan = MAX_INTENTOS - intentos;
    throw new ApiError(estado, `El código no es correcto. Te ${quedan === 1 ? 'queda 1 intento' : `quedan ${quedan} intentos`}.`);
  }

  // Consumo atómico: el mismo código mandado dos veces no abre dos sesiones.
  const usado = await db
    .prepare(
      `UPDATE codigos_ingreso SET usado_en = CURRENT_TIMESTAMP
       WHERE id = ? AND usado_en IS NULL AND expira_en > LOCALTIMESTAMP RETURNING id`
    )
    .get(fila.id);
  if (!usado) throw new ApiError(estado, vencido);

  // El código llegó a ese email: queda verificado (si no lo cambiaron mientras tanto).
  if (tipo === 'usuario' && fila.metodo === 'mail' && cuenta.email && cuenta.email.toLowerCase() === fila.enviado_a.toLowerCase()) {
    await db
      .prepare('UPDATE usuarios SET email_verificado_en = COALESCE(email_verificado_en, CURRENT_TIMESTAMP) WHERE id = ?')
      .run(cuenta.id);
  }
  return { tipo, cuenta, metodo: fila.metodo, recuperacion: Boolean(resultadoApp?.recuperacion) };
}

// Otro código para un ingreso por mail en curso (máximo 5, uno por minuto).
export async function reenviarCodigo(desafio) {
  const codigo = nuevoCodigo();
  const destino = await db.transaction(async () => {
    const actual = await db
      .prepare(
        `SELECT id, envios, usuario_id, superadmin_id,
                (ultimo_envio_en > LOCALTIMESTAMP - (?::int * INTERVAL '1 second')) AS muy_pronto
         FROM codigos_ingreso
         WHERE desafio_hash = ? AND metodo = 'mail' AND proposito = 'ingreso' AND usado_en IS NULL
           AND creado_en > LOCALTIMESTAMP - INTERVAL '30 minutes'`
      )
      .get(SEGUNDOS_ENTRE_ENVIOS, hash(desafio));
    const tipo = actual?.superadmin_id ? 'superadmin' : 'usuario';
    const cuenta = actual ? await obtenerCuenta(tipo, actual.superadmin_id ?? actual.usuario_id) : null;
    const email = cuenta ? emailDeCuenta(tipo, cuenta) : null;
    if (!email) throw new ApiError(401, 'El ingreso venció. Volvé a ingresar con tu contraseña.');
    asegurarCorreo(tipo);
    if (actual.envios >= MAX_ENVIOS) {
      throw new ApiError(429, 'Ya se mandaron varios códigos. Volvé a ingresar con tu contraseña.');
    }
    if (actual.muy_pronto) throw new ApiError(429, 'Esperá un minuto antes de pedir otro código.');
    await db
      .prepare(
        `UPDATE codigos_ingreso SET codigo_hash = ?, enviado_a = ?, intentos = 0, envios = envios + 1,
                ultimo_envio_en = CURRENT_TIMESTAMP, expira_en = LOCALTIMESTAMP + (?::int * INTERVAL '1 minute')
         WHERE id = ?`
      )
      .run(hashCodigo(desafio, codigo), email, MINUTOS_VIGENCIA, actual.id);
    return { tipo, nombre: cuenta.nombre, email };
  });
  await mandarCodigo(destino.tipo, destino, codigo);
  return { email: enmascararEmail(destino.email) };
}

// Códigos para confirmar el 2FA por mail pedidos en la última media hora (tope de envíos desde
// "Mi cuenta", que no tiene un desafío previo con su propio contador).
export async function codigosDeConfiguracionRecientes(tipo, id) {
  const { fk } = CUENTAS[tipo];
  const fila = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM codigos_ingreso
       WHERE ${fk} = ? AND proposito = 'configurar' AND creado_en > LOCALTIMESTAMP - INTERVAL '30 minutes'`
    )
    .get(id);
  return Number(fila.n);
}
