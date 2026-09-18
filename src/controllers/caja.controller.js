import { ApiError } from '../utils/api-error.js';
import * as cajaService from '../services/caja.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export function obtenerResumenController(req, res) {
  res.json(cajaService.calcularResumenDelDia(req.query.fecha));
}

export function listarCierresController(req, res) {
  res.json({ cierres: cajaService.listarCierres() });
}

export function obtenerCierreController(req, res) {
  const id = parsearId(req.params.id);
  res.json(cajaService.obtenerCierre(id));
}

export function registrarCierreController(req, res) {
  const cierre = cajaService.registrarCierre(req.body || {}, { usuarioId: req.sesion.usuario_id });
  res.status(201).json(cierre);
}
