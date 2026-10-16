import config from '../config/env.js';
import { MODULOS, PLANES } from '../config/modulos.js';
import {
  cambiarPlanComoSuperadmin,
  cupoPortal,
  cuposPorRol,
  enviarCorreoDePrueba,
  fijarCupos,
  fijarCuota,
  fijarEmpresaEmail,
  obtenerInstancia,
  reactivarInstancia,
  suspenderInstancia,
} from '../services/instancia.service.js';
import { listarAvisosEnviados } from '../services/avisos-cuota.service.js';
import { anularPago, listarPagos, registrarPago } from '../services/pagos-cuota.service.js';
import { armarCorreoPrueba, correoCeaDisponible, correoDisponible, enviarCorreo } from '../services/mail.service.js';
import { estadoCorreos } from '../services/cola-correo.service.js';
import { estadoCopias, instalacion, listarCopiasDrive, pedirCopia } from '../services/copias.service.js';
import {
  demasiadosRechazos,
  estadoRestauraciones,
  iniciarRestauracion,
  validarCopiaElegida,
} from '../services/restauracion.service.js';
import { confirmarCodigo, iniciarDesafio, obtenerCuenta } from '../services/codigo-ingreso.service.js';
import { planActual } from '../services/modulos.service.js';
import { cerrarSesionSuperadmin, loginSuperadmin } from '../services/superadmin.service.js';
import {
  comprobarPassword,
  confirmarApp,
  confirmarMail,
  estadoDosfa,
  iniciarApp,
  iniciarMail,
  regenerarCodigos,
} from '../services/dosfa.service.js';
import {
  cambiarEmailAdministrador,
  crearAdministrador,
  darDeBajaAdministrador,
  listarAdministradores,
  reactivarAdministrador,
  restablecerDosfaAdministrador,
  restablecerPasswordAdministrador,
} from '../services/administradores.service.js';
import { origenPermitido } from '../middleware/superadmin-auth.middleware.js';
import { ApiError } from '../utils/api-error.js';
import { responderSegundoPaso } from './segundo-paso.js';
import { bloquearManual, desbloquearIp, desbloquearTodas, estadoDefensa } from '../services/defensa-ip.service.js';
import { ACTOR_SISTEMA, actorDeSuperadmin, CATEGORIAS, listarAcciones, registrarAccion } from '../services/registro.service.js';

// Toda acción del superadmin queda en el registro inmutable (EST-01 §6).
const registrar = (req, accion, detalle = null) =>
  registrarAccion(accion, { actor: actorDeSuperadmin(req.superadmin), ip: req.ip, detalle });

// La cookie solo viaja a /api/sa (Path) y nunca en pedidos que vienen de otro sitio
// (SameSite=Strict): el resto de la app ni siquiera la recibe.
const OPCIONES_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/sa',
};

// Sesión del superadmin abierta (después de la contraseña o del segundo paso).
export function responderSesionSuperadmin(res, r) {
  res.set('Cache-Control', 'no-store'); // la respuesta trae el token CSRF
  res.cookie('sa_token', r.token, { ...OPCIONES_COOKIE, maxAge: config.session.timeoutMinutes * 60 * 1000 });
  res.json({ tipo: 'superadmin', superadmin: r.superadmin, csrf_token: r.csrfToken, expulso_sesion_anterior: r.expulsada });
}

export async function loginSuperadminController(req, res) {
  const { usuario, password } = req.body || {};
  if (!usuario || typeof usuario !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }
  if (!origenPermitido(req)) return res.status(403).json({ error: 'Pedido no autorizado' });
  let r;
  try {
    r = await loginSuperadmin(usuario.trim(), password, { dispositivo: req.cookies?.dispositivo });
  } catch (err) {
    if (err.recienBloqueado) {
      await registrarAccion('cuenta-bloqueada', { actor: err.cuenta, ip: req.ip, detalle: { cuenta: err.cuenta.nombre } });
    }
    throw err;
  }
  if (r.requiereCodigo) return responderSegundoPaso(res, r);
  await registrarAccion('ingreso', {
    actor: actorDeSuperadmin(r.superadmin),
    ip: req.ip,
    detalle: { sesion_anterior_cerrada: r.expulsada },
  });
  responderSesionSuperadmin(res, r);
}

export async function logoutSuperadminController(req, res) {
  await cerrarSesionSuperadmin(req.superadmin.sesionId, 'logout');
  await registrar(req, 'salida');
  res.clearCookie('sa_token', { path: OPCIONES_COOKIE.path });
  res.json({ ok: true });
}

export function meSuperadminController(req, res) {
  res.json({
    superadmin: { id: req.superadmin.id, usuario: req.superadmin.usuario, pendiente_dosfa: req.superadmin.pendienteDosfa },
    csrf_token: req.superadmin.csrfToken,
  });
}

const describirPlan = (id) => ({ id, nombre: PLANES[id].nombre, modulos: PLANES[id].modulos });

export async function panelSuperadminController(req, res) {
  const [instancia, plan] = await Promise.all([obtenerInstancia(), planActual()]);
  res.json({
    version: config.version,
    instancia,
    plan: describirPlan(plan),
    planes: Object.keys(PLANES).map(describirPlan),
    modulos: Object.entries(MODULOS).map(([id, m]) => ({ id, nombre: m.nombre, detalle: m.detalle })),
    correo: { disponible: correoCeaDisponible(), avisos: await listarAvisosEnviados() },
    pagos: await listarPagos(),
    // Usuarios del negocio: topes por rol, tope de clientes con acceso al portal y si el correo de
    // la empresa (SMTP_*) está configurado (los códigos de ingreso de los empleados salen de ahí).
    usuarios: { cupos: await cuposPorRol(), portal: await cupoPortal(), correo_empresa: correoDisponible() },
    administradores: await listarAdministradores(),
  });
}

export async function fijarCuposSuperadminController(req, res) {
  await fijarCupos(req.body || {});
  const [cupos, portal] = await Promise.all([cuposPorRol(), cupoPortal()]);
  await registrar(req, 'topes-guardados', { ...Object.fromEntries(cupos.map((c) => [c.rol, c.tope])), portal: portal.tope });
  res.json({ cupos, portal });
}

// ---- Registro de acciones (EST-01 §6): solo lectura ----
export async function registroSuperadminController(req, res) {
  const categoria = CATEGORIAS.includes(req.query.categoria) ? req.query.categoria : null;
  const antes = Number(req.query.antes);
  res.json(await listarAcciones({ categoria, antes: Number.isInteger(antes) && antes > 0 ? antes : null }));
}

// ---- Verificación en dos pasos del propio superadmin (EST-01 §4) ----
export async function estadoDosfaSuperadminController(req, res) {
  res.json(await estadoDosfa('superadmin', req.superadmin.id));
}

export async function iniciarAppSuperadminController(req, res) {
  res.json(await iniciarApp('superadmin', req.superadmin.id));
}

export async function confirmarAppSuperadminController(req, res) {
  const r = await confirmarApp('superadmin', req.superadmin.id, req.body || {});
  await registrar(req, 'dosfa-activado', { metodo: r.metodo, anterior: r.anterior });
  res.json(r);
}

export async function iniciarMailSuperadminController(req, res) {
  res.json(await iniciarMail('superadmin', req.superadmin.id));
}

export async function confirmarMailSuperadminController(req, res) {
  const r = await confirmarMail('superadmin', req.superadmin.id, req.body || {});
  await registrar(req, 'dosfa-activado', { metodo: r.metodo, anterior: r.anterior });
  res.json(r);
}

export async function regenerarCodigosSuperadminController(req, res) {
  const r = await regenerarCodigos('superadmin', req.superadmin.id, req.body?.password);
  await registrar(req, 'codigos-regenerados');
  res.json(r);
}

// ---- Administradores del negocio (EST-01 §5) ----
function enlaceDeIngreso(req) {
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}/login`;
}

function parsearId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'id inválido');
  return id;
}

export async function crearAdministradorController(req, res) {
  const r = await crearAdministrador(req.body || {}, { enlace: enlaceDeIngreso(req) });
  await registrar(req, 'administrador-creado', { email: r.administrador.email });
  res.status(201).json(r);
}

export async function passwordAdministradorController(req, res) {
  const r = await restablecerPasswordAdministrador(parsearId(req.params.id), { enlace: enlaceDeIngreso(req) });
  await registrar(req, 'administrador-contrasena', { email: r.email });
  res.json(r);
}

export async function dosfaAdministradorController(req, res) {
  const { email } = await restablecerDosfaAdministrador(parsearId(req.params.id));
  await registrar(req, 'administrador-dosfa', { email });
  res.json({ ok: true });
}

export async function bajaAdministradorController(req, res) {
  const { email } = await darDeBajaAdministrador(parsearId(req.params.id));
  await registrar(req, 'administrador-baja', { email });
  res.json({ ok: true });
}

export async function emailAdministradorController(req, res) {
  const r = await cambiarEmailAdministrador(parsearId(req.params.id), req.body || {});
  await registrar(req, 'administrador-email', { anterior: r.anterior, email: r.administrador.email });
  res.json(r.administrador);
}

export async function reactivarAdministradorController(req, res) {
  const admin = await reactivarAdministrador(parsearId(req.params.id));
  await registrar(req, 'administrador-reactivado', { email: admin.email });
  res.json(admin);
}

export async function cambiarPlanSuperadminController(req, res) {
  const plan = req.body?.plan;
  if (typeof plan !== 'string') throw new ApiError(400, 'plan es requerido');
  const anterior = await planActual();
  await cambiarPlanComoSuperadmin(plan);
  await registrar(req, 'plan-cambiado', { de: PLANES[anterior]?.nombre ?? anterior, a: PLANES[plan].nombre });
  res.json({ plan: describirPlan(plan) });
}

export async function suspenderSuperadminController(req, res) {
  await suspenderInstancia(req.body?.motivo);
  const instancia = await obtenerInstancia();
  await registrar(req, 'instalacion-suspendida', { motivo: instancia.motivo_suspension });
  res.json({ instancia });
}

export async function reactivarSuperadminController(req, res) {
  const { avisado_a: avisadoA } = await reactivarInstancia();
  await registrar(req, 'instalacion-reactivada', { por: 'superadmin' });
  res.json({ instancia: await obtenerInstancia(), avisado_a: avisadoA });
}

export async function fijarCuotaSuperadminController(req, res) {
  await fijarCuota(req.body || {});
  const instancia = await obtenerInstancia();
  const { cuota } = instancia;
  await registrar(req, 'cuota-guardada', {
    vence: cuota.vence,
    monto: cuota.monto,
    aviso_dias: cuota.aviso_dias,
    suspender_dias: cuota.suspender_dias,
    aviso_suspension_dias: cuota.aviso_suspension_dias,
  });
  res.json({ instancia });
}

export async function empresaEmailSuperadminController(req, res) {
  await fijarEmpresaEmail(req.body?.email);
  const instancia = await obtenerInstancia();
  await registrar(req, 'email-empresa', { email: instancia.empresa_email });
  res.json({ instancia });
}

export async function correoPruebaSuperadminController(req, res) {
  const r = await enviarCorreoDePrueba();
  await registrar(req, 'correo-prueba', { canal: 'cea', para: r.enviado_a });
  res.json(r);
}

// ---- Pestaña Correo (EST-01 §10.4): estado de los dos correos y correo de prueba de cada uno ----
export async function correoCanalSuperadminController(req, res) {
  res.json(await estadoCorreos());
}

// Inmediato (sin cola), al mail del propio superadmin: es para ver en el momento si ese correo sale.
export async function correoPruebaCanalSuperadminController(req, res) {
  const canal = req.body?.canal;
  if (canal !== 'cea' && canal !== 'empresa') throw new ApiError(400, 'canal tiene que ser "cea" o "empresa"');
  const para = req.superadmin.usuario;
  await enviarCorreo({ para, ...armarCorreoPrueba(canal) }, canal);
  await registrar(req, 'correo-prueba', { canal, para });
  res.json({ enviado_a: para });
}

// ---- Copias de seguridad (Fase 4) ----
export async function copiasSuperadminController(req, res) {
  res.json(await estadoCopias());
}

// Arranca la copia y responde enseguida: el panel sigue el avance con GET /copias.
export async function respaldarSuperadminController(req, res) {
  const { id } = await pedirCopia();
  await registrar(req, 'copia-pedida', { copia_id: id });
  res.status(202).json({ id });
}

// ---- Restaurar una copia del Drive (reemplaza la base real) ----
export async function copiasDriveSuperadminController(req, res) {
  res.json({ copias: await listarCopiasDrive() });
}

export async function restauracionesSuperadminController(req, res) {
  res.json(await estadoRestauraciones());
}

async function frenarRechazos(req) {
  if (await demasiadosRechazos(req.superadmin.id)) {
    throw new ApiError(429, 'Demasiados intentos con la contraseña o el código. Esperá 15 minutos.');
  }
}

// Paso 1: la contraseña. Abre el desafío del código (por mail lo manda; con la app, lo da la app).
export async function desafioRestauracionSuperadminController(req, res) {
  await frenarRechazos(req);
  try {
    await comprobarPassword('superadmin', req.superadmin.id, req.body?.password);
  } catch (err) {
    if (err.status === 403) await registrar(req, 'restauracion-rechazada', { motivo: 'contraseña incorrecta' });
    throw err;
  }
  const cuenta = await obtenerCuenta('superadmin', req.superadmin.id);
  if (!cuenta?.dosfa_metodo) throw new ApiError(409, 'Primero activá tu verificación en dos pasos.');
  res.json(await iniciarDesafio('superadmin', cuenta, cuenta.dosfa_metodo, 'restaurar'));
}

// Paso 2: el código, el dominio escrito y la copia elegida. Arranca y responde enseguida.
export async function restaurarSuperadminController(req, res) {
  await frenarRechazos(req);
  const { desafio, codigo, dominio, archivo_id: archivoId } = req.body || {};
  if (String(dominio ?? '').trim().toLowerCase() !== instalacion()) {
    throw new ApiError(400, `Para confirmar, escribí el dominio tal cual: ${instalacion()}`);
  }
  if (typeof desafio !== 'string' || !/^[0-9a-f]{64}$/.test(desafio)) throw new ApiError(400, 'Volvé a poner tu contraseña.');
  const copia = await validarCopiaElegida(archivoId);
  let r;
  try {
    r = await confirmarCodigo(desafio, codigo, 'restaurar');
  } catch (err) {
    await registrar(req, 'restauracion-rechazada', { motivo: 'código incorrecto o vencido' });
    throw err;
  }
  if (r.tipo !== 'superadmin' || r.cuenta.id !== req.superadmin.id) throw new ApiError(400, 'El código no corresponde a tu cuenta.');
  const { id } = await iniciarRestauracion({ copia, superadmin: req.superadmin, ip: req.ip });
  await registrar(req, 'restauracion-pedida', { restauracion_id: id, copia: copia.nombre });
  res.status(202).json({ id });
}

// ---- Historial de pagos de la cuota ----
export async function registrarPagoSuperadminController(req, res) {
  const r = await registrarPago(req.body || {});
  await registrar(req, 'pago-anotado', { pago_id: r.id, monto: r.monto, meses: r.meses, cuota_vence: r.cuota_vence });
  // Anotar el pago puede reactivar sola una instalación suspendida por la cuota.
  if (r.reactivada) await registrarAccion('instalacion-reactivada', { actor: ACTOR_SISTEMA, detalle: { por: 'pago' } });
  res.status(201).json(r);
}

export async function anularPagoSuperadminController(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'id inválido');
  const r = await anularPago(id, req.body?.motivo);
  await registrar(req, 'pago-anulado', { pago_id: id, motivo: String(req.body?.motivo ?? '').slice(0, 200) });
  res.json(r);
}

// ---- Defensa activa por IP ----
export async function defensaSuperadminController(req, res) {
  res.json(await estadoDefensa());
}

export async function desbloquearSuperadminController(req, res) {
  const id = Number(req.body?.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'id es requerido');
  const r = await desbloquearIp(id);
  await registrar(req, 'ip-desbloqueada', { id, ip: r.ip });
  res.json(r);
}

export async function desbloquearTodasSuperadminController(req, res) {
  const r = await desbloquearTodas();
  await registrar(req, 'ips-desbloqueadas', { cantidad: r.liberadas });
  res.json(r);
}

export async function bloquearSuperadminController(req, res) {
  const { ip, minutos, detalle } = req.body || {};
  if (typeof ip !== 'string') throw new ApiError(400, 'ip es requerida');
  const r = await bloquearManual(ip, minutos, detalle);
  await registrar(req, 'ip-bloqueada', { ip: r.ip, minutos: r.minutos });
  res.json(r);
}
