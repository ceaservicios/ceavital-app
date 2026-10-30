import { ApiError } from '../utils/api-error.js';
import * as proveedoresService from '../services/proveedores.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

const quien = (req) => ({ usuarioId: req.sesion.usuario_id, rol: req.sesion.rol });

export async function listarProveedoresController(req, res) {
  res.json({ proveedores: await proveedoresService.listarProveedores({ buscar: req.query.q }) });
}

export async function obtenerProveedorController(req, res) {
  const id = parsearId(req.params.id);
  res.json(await proveedoresService.obtenerProveedor(id, quien(req)));
}

export async function crearProveedorController(req, res) {
  const proveedor = await proveedoresService.crearProveedor(req.body || {}, quien(req));
  res.status(201).json(proveedor);
}

export async function editarProveedorController(req, res) {
  const id = parsearId(req.params.id);
  res.json(await proveedoresService.editarProveedor(id, req.body || {}, quien(req)));
}

export async function eliminarProveedorController(req, res) {
  const id = parsearId(req.params.id);
  await proveedoresService.eliminarProveedor(id);
  res.status(204).send();
}

// Mercadería que trajo (compras) y pagos (2026-10-28): cada uno responde el perfil completo.
export async function crearCompraController(req, res) {
  const id = parsearId(req.params.id, 'proveedor_id');
  res.status(201).json(await proveedoresService.crearCompra(id, req.body || {}, quien(req)));
}

export async function anularCompraController(req, res) {
  const id = parsearId(req.params.id, 'proveedor_id');
  const compraId = parsearId(req.params.compraId, 'compra_id');
  res.json(await proveedoresService.anularCompra(id, compraId, quien(req)));
}

// A mano, desde Saldos pendientes (2026-10-29): una deuda sin mercadería y la corrección de una boleta.
export async function crearDeudaManualController(req, res) {
  const id = parsearId(req.params.id, 'proveedor_id');
  res.status(201).json(await proveedoresService.crearDeudaManual(id, req.body || {}, quien(req)));
}

export async function corregirCompraController(req, res) {
  const id = parsearId(req.params.id, 'proveedor_id');
  const compraId = parsearId(req.params.compraId, 'compra_id');
  res.json(await proveedoresService.corregirCompra(id, compraId, req.body || {}, quien(req)));
}

export async function registrarPagoController(req, res) {
  const id = parsearId(req.params.id, 'proveedor_id');
  res.status(201).json(await proveedoresService.registrarPago(id, req.body || {}, quien(req)));
}

export async function anularPagoController(req, res) {
  const id = parsearId(req.params.id, 'proveedor_id');
  const pagoId = parsearId(req.params.pagoId, 'pago_id');
  res.json(await proveedoresService.anularPago(id, pagoId, quien(req)));
}
