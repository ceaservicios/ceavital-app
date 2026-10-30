import { ApiError } from '../utils/api-error.js';
import * as saldosService from '../services/saldos.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

const quien = (req) => ({ usuarioId: req.sesion.usuario_id, rol: req.sesion.rol });

export async function obtenerSaldosController(req, res) {
  res.json(await saldosService.obtenerSaldos());
}

export async function avisoSaldosController(req, res) {
  res.json({ vencidas: await saldosService.contarVencidas() });
}

export async function obtenerCuentaController(req, res) {
  res.json(await saldosService.obtenerCuenta(parsearId(req.params.id)));
}

export async function crearCuentaController(req, res) {
  res.status(201).json(await saldosService.crearCuenta(req.body || {}, quien(req)));
}

export async function editarCuentaController(req, res) {
  res.json(await saldosService.editarCuenta(parsearId(req.params.id), req.body || {}));
}

export async function eliminarCuentaController(req, res) {
  await saldosService.eliminarCuenta(parsearId(req.params.id));
  res.status(204).send();
}

// Cada uno responde la ficha completa de la cuenta.
export async function registrarPagoCuentaController(req, res) {
  res.status(201).json(await saldosService.registrarPagoCuenta(parsearId(req.params.id), req.body || {}, quien(req)));
}

export async function anularPagoCuentaController(req, res) {
  const id = parsearId(req.params.id);
  res.json(await saldosService.anularPagoCuenta(id, parsearId(req.params.pagoId, 'pago_id'), quien(req)));
}
