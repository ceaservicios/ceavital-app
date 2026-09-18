import { ApiError } from '../utils/api-error.js';
import * as usuariosService from '../services/usuarios.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export function listarUsuariosController(req, res) {
  res.json({ usuarios: usuariosService.listarUsuarios() });
}

export function obtenerUsuarioController(req, res) {
  const id = parsearId(req.params.id);
  res.json(usuariosService.obtenerUsuario(id));
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

export function eliminarUsuarioController(req, res) {
  const id = parsearId(req.params.id);
  usuariosService.eliminarUsuario(id);
  res.status(204).send();
}
