import { ApiError } from '../utils/api-error.js';
import * as proveedoresService from '../services/proveedores.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export function listarProveedoresController(req, res) {
  res.json({ proveedores: proveedoresService.listarProveedores({ buscar: req.query.q }) });
}

export function obtenerProveedorController(req, res) {
  const id = parsearId(req.params.id);
  res.json(proveedoresService.obtenerProveedor(id));
}

export function crearProveedorController(req, res) {
  const proveedor = proveedoresService.crearProveedor(req.body || {});
  res.status(201).json(proveedor);
}

export function editarProveedorController(req, res) {
  const id = parsearId(req.params.id);
  res.json(proveedoresService.editarProveedor(id, req.body || {}));
}

export function eliminarProveedorController(req, res) {
  const id = parsearId(req.params.id);
  proveedoresService.eliminarProveedor(id);
  res.status(204).send();
}

export function listarPedidosController(req, res) {
  const proveedorId = parsearId(req.params.id, 'proveedor_id');
  res.json({ pedidos: proveedoresService.listarPedidos(proveedorId) });
}

export function obtenerPedidoController(req, res) {
  const proveedorId = parsearId(req.params.id, 'proveedor_id');
  const pedidoId = parsearId(req.params.pedidoId, 'pedido_id');
  res.json(proveedoresService.obtenerPedido(proveedorId, pedidoId));
}

export function crearPedidoController(req, res) {
  const proveedorId = parsearId(req.params.id, 'proveedor_id');
  const pedido = proveedoresService.crearPedido(proveedorId, req.body || {}, {
    usuarioId: req.sesion.usuario_id,
  });
  res.status(201).json(pedido);
}

export function editarPedidoController(req, res) {
  const proveedorId = parsearId(req.params.id, 'proveedor_id');
  const pedidoId = parsearId(req.params.pedidoId, 'pedido_id');
  res.json(proveedoresService.editarPedido(proveedorId, pedidoId, req.body || {}));
}

export function eliminarPedidoController(req, res) {
  const proveedorId = parsearId(req.params.id, 'proveedor_id');
  const pedidoId = parsearId(req.params.pedidoId, 'pedido_id');
  proveedoresService.eliminarPedido(proveedorId, pedidoId);
  res.status(204).send();
}
