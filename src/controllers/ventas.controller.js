import { ApiError } from '../utils/api-error.js';
import * as ventasService from '../services/ventas.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export function listarVentasController(req, res) {
  const ventas = ventasService.listarVentas({ fecha: req.query.fecha });
  res.json({ ventas });
}

export function obtenerVentaController(req, res) {
  const id = parsearId(req.params.id);
  res.json(ventasService.obtenerVenta(id));
}

export function registrarVentaController(req, res) {
  const venta = ventasService.registrarVenta(req.body || {}, { usuarioId: req.sesion.usuario_id });
  res.status(201).json(venta);
}

export function editarMedioPagoController(req, res) {
  const id = parsearId(req.params.id);
  const venta = ventasService.editarMedioPago(id, req.body || {});
  res.json(venta);
}

export function anularVentaController(req, res) {
  const id = parsearId(req.params.id);
  const venta = ventasService.anularVenta(id, { usuarioId: req.sesion.usuario_id });
  res.json(venta);
}
