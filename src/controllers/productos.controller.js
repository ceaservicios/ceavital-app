import { ApiError } from '../utils/api-error.js';
import * as stockService from '../services/stock.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export async function listarProductosController(req, res) {
  const productos = await stockService.listarProductos({
    rol: req.sesion.rol,
    buscar: req.query.q,
    codigoBarras: req.query.codigo_barras,
  });
  res.json({ productos });
}

export async function obtenerProductoController(req, res) {
  const id = parsearId(req.params.id);
  const producto = await stockService.obtenerProducto(id, { rol: req.sesion.rol });
  res.json(producto);
}

export async function crearProductoController(req, res) {
  const producto = await stockService.crearProducto(req.body || {}, { rol: req.sesion.rol });
  res.status(201).json(producto);
}

export async function editarProductoController(req, res) {
  const id = parsearId(req.params.id);
  const producto = await stockService.editarProducto(id, req.body || {}, { rol: req.sesion.rol });
  res.json(producto);
}

export async function eliminarProductoController(req, res) {
  const id = parsearId(req.params.id);
  await stockService.eliminarProducto(id);
  res.status(204).send();
}
