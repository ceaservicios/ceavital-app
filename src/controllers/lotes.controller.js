import { ApiError } from '../utils/api-error.js';
import * as stockService from '../services/stock.service.js';

function parsearId(valor, campo) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export async function crearLoteController(req, res) {
  const productoId = parsearId(req.params.id, 'producto_id');
  const lote = await stockService.crearLote(productoId, req.body || {});
  res.status(201).json(lote);
}

export async function editarLoteController(req, res) {
  const productoId = parsearId(req.params.id, 'producto_id');
  const loteId = parsearId(req.params.loteId, 'lote_id');
  const lote = await stockService.editarLote(productoId, loteId, req.body || {});
  res.json(lote);
}

export async function eliminarLoteController(req, res) {
  const productoId = parsearId(req.params.id, 'producto_id');
  const loteId = parsearId(req.params.loteId, 'lote_id');
  await stockService.eliminarLote(productoId, loteId);
  res.status(204).send();
}
