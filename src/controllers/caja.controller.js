import { ApiError } from '../utils/api-error.js';
import * as cajaService from '../services/caja.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export async function obtenerResumenController(req, res) {
  res.json(await cajaService.calcularResumenDelDia(req.query.fecha));
}

export async function listarCierresController(req, res) {
  res.json({ cierres: await cajaService.listarCierres() });
}

export async function obtenerCierreController(req, res) {
  const id = parsearId(req.params.id);
  res.json(await cajaService.obtenerCierre(id));
}

export async function registrarCierreController(req, res) {
  const cierre = await cajaService.registrarCierre(req.body || {}, { usuarioId: req.sesion.usuario_id });
  res.status(201).json(cierre);
}
