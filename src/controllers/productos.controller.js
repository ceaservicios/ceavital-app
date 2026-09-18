import { ApiError } from '../utils/api-error.js';
import * as stockService from '../services/stock.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export function listarProductosController(req, res) {
  const productos = stockService.listarProductos({
    rol: req.sesion.rol,
    buscar: req.query.q,
    codigoBarras: req.query.codigo_barras,
  });
  res.json({ productos });
}

export function obtenerProductoController(req, res) {
  const id = parsearId(req.params.id);
  const producto = stockService.obtenerProducto(id, { rol: req.sesion.rol });
  res.json(producto);
}

export function crearProductoController(req, res) {
  const producto = stockService.crearProducto(req.body || {}, { rol: req.sesion.rol });
  res.status(201).json(producto);
}

export function editarProductoController(req, res) {
  const id = parsearId(req.params.id);
  const producto = stockService.editarProducto(id, req.body || {}, { rol: req.sesion.rol });
  res.json(producto);
}

export function eliminarProductoController(req, res) {
  const id = parsearId(req.params.id);
  stockService.eliminarProducto(id);
  res.status(204).send();
}
