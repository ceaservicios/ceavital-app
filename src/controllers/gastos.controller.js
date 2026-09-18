import { ApiError } from '../utils/api-error.js';
import * as gastosService from '../services/gastos.service.js';

function parsearId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id inválido');
  return id;
}

export function listarGastosController(req, res) {
  res.json({ gastos: gastosService.listarGastos({ fecha: req.query.fecha }) });
}

export function registrarGastoController(req, res) {
  const gasto = gastosService.registrarGasto(req.body || {}, { usuarioId: req.sesion.usuario_id });
  res.status(201).json(gasto);
}

export function eliminarGastoController(req, res) {
  const id = parsearId(req.params.id);
  gastosService.eliminarGasto(id);
  res.status(204).send();
}
