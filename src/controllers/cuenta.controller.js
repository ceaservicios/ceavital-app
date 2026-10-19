import { ApiError } from '../utils/api-error.js';
import { cambiarPassword, datosDeCuenta } from '../services/cuenta.service.js';
import { confirmarApp, confirmarMail, estadoDosfa, iniciarApp, iniciarMail, regenerarCodigos } from '../services/dosfa.service.js';
import { pendienteDeCuenta } from '../services/session.service.js';
import { actorDeSesion, registrarAccion } from '../services/registro.service.js';

const registrar = (req, accion, detalle = null) => registrarAccion(accion, { actor: actorDeSesion(req.sesion), ip: req.ip, detalle });

// "Mi cuenta" del usuario del negocio que tiene la sesión (nunca recibe un id: siempre es la propia).

export async function verCuentaController(req, res) {
  const cuenta = await datosDeCuenta(req.sesion.usuario_id);
  if (!cuenta) throw new ApiError(404, 'Usuario no encontrado');
  // Admin al que el superadmin le desactivó la verificación (decisión del usuario, 2026-10-19).
  const desactivada = cuenta.rol === 'admin' && Boolean(req.sesion.dosfa_desactivada);
  res.json({
    ...cuenta,
    pendiente: req.sesion.pendiente,
    // La verificación en dos pasos propia la configura el Admin (obligatoria, EST-01 §4, salvo que
    // se la hayan desactivado); la de Encargados y Cajeros es por mail y la activa el Admin desde Usuarios.
    dosfa: cuenta.rol === 'admin' && !desactivada ? await estadoDosfa('usuario', cuenta.id) : null,
    dosfa_desactivada: desactivada,
  });
}

export async function cambiarPasswordController(req, res) {
  await cambiarPassword(req.sesion.usuario_id, req.body || {});
  await registrar(req, 'contrasena-cambiada');
  const pendiente = pendienteDeCuenta({ ...req.sesion, debe_cambiar_password: false });
  res.json({ ok: true, pendiente });
}

const tipo = 'usuario';

export async function iniciarAppController(req, res) {
  res.set('Cache-Control', 'no-store'); // trae el secreto
  res.json(await iniciarApp(tipo, req.sesion.usuario_id));
}

export async function confirmarAppController(req, res) {
  res.set('Cache-Control', 'no-store'); // trae los códigos de recuperación
  const r = await confirmarApp(tipo, req.sesion.usuario_id, req.body || {});
  await registrar(req, 'dosfa-activado', { metodo: r.metodo, anterior: r.anterior });
  res.json(r);
}

export async function iniciarMailController(req, res) {
  res.json(await iniciarMail(tipo, req.sesion.usuario_id));
}

export async function confirmarMailController(req, res) {
  const r = await confirmarMail(tipo, req.sesion.usuario_id, req.body || {});
  await registrar(req, 'dosfa-activado', { metodo: r.metodo, anterior: r.anterior });
  res.json(r);
}

export async function regenerarCodigosController(req, res) {
  res.set('Cache-Control', 'no-store');
  const r = await regenerarCodigos(tipo, req.sesion.usuario_id, req.body?.password);
  await registrar(req, 'codigos-regenerados');
  res.json(r);
}
