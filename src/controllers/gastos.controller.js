import { ApiError } from '../utils/api-error.js';
import * as gastosService from '../services/gastos.service.js';

function parsearId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id inválido');
  return id;
}

export async function listarGastosController(req, res) {
  res.json({ gastos: await gastosService.listarGastos({ fecha: req.query.fecha }) });
}

export async function registrarGastoController(req, res) {
  const gasto = await gastosService.registrarGasto(req.body || {}, { usuarioId: req.sesion.usuario_id });
  res.status(201).json(gasto);
}

export async function eliminarGastoController(req, res) {
  const id = parsearId(req.params.id);
  await gastosService.eliminarGasto(id);
  res.status(204).send();
}
