import { ApiError } from '../utils/api-error.js';
import * as proveedoresService from '../services/proveedores.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export async function listarProveedoresController(req, res) {
  res.json({ proveedores: await proveedoresService.listarProveedores({ buscar: req.query.q }) });
}

export async function obtenerProveedorController(req, res) {
  const id = parsearId(req.params.id);
  res.json(await proveedoresService.obtenerProveedor(id));
}

export async function crearProveedorController(req, res) {
  const proveedor = await proveedoresService.crearProveedor(req.body || {});
  res.status(201).json(proveedor);
}

export async function editarProveedorController(req, res) {
  const id = parsearId(req.params.id);
  res.json(await proveedoresService.editarProveedor(id, req.body || {}));
}

export async function eliminarProveedorController(req, res) {
  const id = parsearId(req.params.id);
  await proveedoresService.eliminarProveedor(id);
  res.status(204).send();
}

export async function listarPedidosController(req, res) {
  const proveedorId = parsearId(req.params.id, 'proveedor_id');
  res.json({ pedidos: await proveedoresService.listarPedidos(proveedorId) });
}

export async function obtenerPedidoController(req, res) {
  const proveedorId = parsearId(req.params.id, 'proveedor_id');
  const pedidoId = parsearId(req.params.pedidoId, 'pedido_id');
  res.json(await proveedoresService.obtenerPedido(proveedorId, pedidoId));
}

export async function crearPedidoController(req, res) {
  const proveedorId = parsearId(req.params.id, 'proveedor_id');
  const pedido = await proveedoresService.crearPedido(proveedorId, req.body || {}, {
    usuarioId: req.sesion.usuario_id,
  });
  res.status(201).json(pedido);
}

export async function editarPedidoController(req, res) {
  const proveedorId = parsearId(req.params.id, 'proveedor_id');
  const pedidoId = parsearId(req.params.pedidoId, 'pedido_id');
  res.json(await proveedoresService.editarPedido(proveedorId, pedidoId, req.body || {}));
}

export async function eliminarPedidoController(req, res) {
  const proveedorId = parsearId(req.params.id, 'proveedor_id');
  const pedidoId = parsearId(req.params.pedidoId, 'pedido_id');
  await proveedoresService.eliminarPedido(proveedorId, pedidoId);
  res.status(204).send();
}
