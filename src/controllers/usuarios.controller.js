import { ApiError } from '../utils/api-error.js';
import * as usuariosService from '../services/usuarios.service.js';
import { cuposPorRol } from '../services/instancia.service.js';
import { correoDisponible } from '../services/mail.service.js';

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
  res.status(201).json(usuario);
}

export async function editarUsuarioController(req, res) {
  const id = parsearId(req.params.id);
  const usuario = await usuariosService.editarUsuario(id, req.body || {});
  res.json(usuario);
}

export async function eliminarUsuarioController(req, res) {
  const id = parsearId(req.params.id);
  await usuariosService.eliminarUsuario(id);
  res.status(204).send();
}
