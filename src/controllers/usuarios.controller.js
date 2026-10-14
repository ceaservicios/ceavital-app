import { ApiError } from '../utils/api-error.js';
import * as usuariosService from '../services/usuarios.service.js';
import { cuposPorRol } from '../services/instancia.service.js';
import { correoDisponible } from '../services/mail.service.js';
import { actorDeSesion, registrarAccion } from '../services/registro.service.js';

const ETIQUETA_ROL = { admin: 'Administrador', encargado: 'Encargado', cajero: 'Cajero' };
const registrar = (req, accion, detalle) => registrarAccion(accion, { actor: actorDeSesion(req.sesion), ip: req.ip, detalle });

// Qué cambió de verdad (la pantalla manda todos los campos en cada guardado). Nunca valores secretos.
function cambiosDe(antes, despues, datos) {
  const cambios = [];
  if (antes.nombre !== despues.nombre) cambios.push('nombre');
  if ((antes.email ?? '') !== (despues.email ?? '')) cambios.push('email');
  if (antes.usuario !== despues.usuario) cambios.push('usuario');
  if (antes.rol !== despues.rol) cambios.push(`rol: ${ETIQUETA_ROL[antes.rol]} → ${ETIQUETA_ROL[despues.rol]}`);
  if (Boolean(antes.dos_fa) !== Boolean(despues.dos_fa)) cambios.push(despues.dos_fa ? '2FA activado' : '2FA desactivado');
  if (datos.password !== undefined) cambios.push('contraseña nueva');
  return cambios;
}

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

// Además de la lista: los lugares libres por rol (topes del superadmin) y si el correo de
// la empresa está configurado (sin él no se pueden crear usuarios ni activar el 2FA).
export async function listarUsuariosController(req, res) {
  res.json({
    usuarios: await usuariosService.listarUsuarios(),
    cupos: await cuposPorRol(),
    correo_disponible: correoDisponible(),
  });
}

export async function obtenerUsuarioController(req, res) {
  const id = parsearId(req.params.id);
  res.json(await usuariosService.obtenerUsuario(id));
}

export async function crearUsuarioController(req, res) {
  const usuario = await usuariosService.crearUsuario(req.body || {});
  await registrar(req, 'usuario-creado', { usuario: usuario.usuario, rol: usuario.rol });
  res.status(201).json(usuario);
}

export async function editarUsuarioController(req, res) {
  const id = parsearId(req.params.id);
  const antes = await usuariosService.obtenerUsuario(id);
  const usuario = await usuariosService.editarUsuario(id, req.body || {});
  const cambios = cambiosDe(antes, usuario, req.body || {});
  if (cambios.length) await registrar(req, 'usuario-editado', { usuario: usuario.usuario, cambios });
  res.json(usuario);
}

export async function eliminarUsuarioController(req, res) {
  const id = parsearId(req.params.id);
  const antes = await usuariosService.obtenerUsuario(id);
  await usuariosService.eliminarUsuario(id);
  await registrar(req, 'usuario-eliminado', { usuario: antes.usuario });
  res.status(204).send();
}
