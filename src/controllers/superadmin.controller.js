import config from '../config/env.js';
import { MODULOS, PLANES } from '../config/modulos.js';
import {
  cambiarPlanComoSuperadmin,
  enviarCorreoDePrueba,
  fijarCuota,
  fijarEmpresaEmail,
  obtenerInstancia,
  reactivarInstancia,
  suspenderInstancia,
} from '../services/instancia.service.js';
import { listarAvisosEnviados } from '../services/avisos-cuota.service.js';
import { correoCeaDisponible } from '../services/mail.service.js';
import { planActual } from '../services/modulos.service.js';
import { cerrarSesionSuperadmin, listarAcciones, loginSuperadmin } from '../services/superadmin.service.js';
import { ApiError } from '../utils/api-error.js';

// La cookie solo viaja a /api/sa (Path) y nunca en pedidos que vienen de otro sitio
// (SameSite=Strict): el resto de la app ni siquiera la recibe.
const OPCIONES_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/sa',
};

export async function loginSuperadminController(req, res) {
  const { usuario, password } = req.body || {};
  if (!usuario || typeof usuario !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }
  const r = await loginSuperadmin(usuario.trim(), password, req.ip);
  res.cookie('sa_token', r.token, { ...OPCIONES_COOKIE, maxAge: config.session.timeoutMinutes * 60 * 1000 });
  res.json({ superadmin: r.superadmin, csrf_token: r.csrfToken });
}

export async function logoutSuperadminController(req, res) {
  await cerrarSesionSuperadmin(req.superadmin.sesionId, 'logout');
  res.clearCookie('sa_token', { path: OPCIONES_COOKIE.path });
  res.json({ ok: true });
}

export function meSuperadminController(req, res) {
  res.json({ superadmin: { id: req.superadmin.id, usuario: req.superadmin.usuario }, csrf_token: req.superadmin.csrfToken });
}

const describirPlan = (id) => ({ id, nombre: PLANES[id].nombre, modulos: PLANES[id].modulos });

export async function panelSuperadminController(req, res) {
  const [instancia, plan, acciones] = await Promise.all([obtenerInstancia(), planActual(), listarAcciones(20)]);
  res.json({
    version: config.version,
    instancia,
    plan: describirPlan(plan),
    planes: Object.keys(PLANES).map(describirPlan),
    modulos: Object.entries(MODULOS).map(([id, m]) => ({ id, nombre: m.nombre })),
    correo: { disponible: correoCeaDisponible(), avisos: await listarAvisosEnviados() },
    acciones,
  });
}

export async function accionesSuperadminController(req, res) {
  res.json({ acciones: await listarAcciones(req.query.limite) });
}

export async function cambiarPlanSuperadminController(req, res) {
  const plan = req.body?.plan;
  if (typeof plan !== 'string') throw new ApiError(400, 'plan es requerido');
  await cambiarPlanComoSuperadmin(req.superadmin.id, plan, req.ip);
  res.json({ plan: describirPlan(plan) });
}

export async function suspenderSuperadminController(req, res) {
  await suspenderInstancia(req.superadmin.id, req.body?.motivo, req.ip);
  res.json({ instancia: await obtenerInstancia() });
}

export async function reactivarSuperadminController(req, res) {
  await reactivarInstancia(req.superadmin.id, req.ip);
  res.json({ instancia: await obtenerInstancia() });
}

export async function fijarCuotaSuperadminController(req, res) {
  await fijarCuota(req.superadmin.id, req.body || {}, req.ip);
  res.json({ instancia: await obtenerInstancia() });
}

export async function empresaEmailSuperadminController(req, res) {
  await fijarEmpresaEmail(req.superadmin.id, req.body?.email, req.ip);
  res.json({ instancia: await obtenerInstancia() });
}

export async function correoPruebaSuperadminController(req, res) {
  res.json(await enviarCorreoDePrueba(req.superadmin.id, req.ip));
}
