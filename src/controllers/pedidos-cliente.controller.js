import { ApiError } from '../utils/api-error.js';
import * as pedidosService from '../services/pedidos-cliente.service.js';

function parsearId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id inválido');
  return id;
}

export async function listarPedidosController(req, res) {
  res.json({ pedidos: await pedidosService.listarPedidos({ estado: req.query.estado }) });
}

export async function obtenerPedidoController(req, res) {
  res.json(await pedidosService.obtenerPedido(parsearId(req.params.id)));
}

export async function aprobarPedidoController(req, res) {
  res.json(await pedidosService.aprobarPedido(parsearId(req.params.id), { usuarioId: req.sesion.usuario_id }));
}

export async function rechazarPedidoController(req, res) {
  res.json(await pedidosService.rechazarPedido(parsearId(req.params.id), req.body || {}, { usuarioId: req.sesion.usuario_id }));
}
