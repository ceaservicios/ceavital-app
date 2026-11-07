import { ApiError } from '../utils/api-error.js';
import * as fijosService from '../services/fijos.service.js';

function parsearId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id inválido');
  return id;
}

export async function listarFijosController(req, res) {
  res.json(await fijosService.listarFijos());
}

export async function obtenerFijoController(req, res) {
  res.json(await fijosService.obtenerFijo(parsearId(req.params.id)));
}

export async function crearFijoController(req, res) {
  res.status(201).json(await fijosService.crearFijo(req.body, { usuarioId: req.sesion.usuario_id }));
}

export async function editarFijoController(req, res) {
  res.json(await fijosService.editarFijo(parsearId(req.params.id), req.body));
}

export async function pausarFijoController(req, res) {
  res.json(await fijosService.pausarFijo(parsearId(req.params.id)));
}

export async function activarFijoController(req, res) {
  res.json(await fijosService.activarFijo(parsearId(req.params.id)));
}

export async function eliminarFijoController(req, res) {
  await fijosService.eliminarFijo(parsearId(req.params.id));
  res.status(204).send();
}
