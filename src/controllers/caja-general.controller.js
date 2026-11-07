import { ApiError } from '../utils/api-error.js';
import { calcularResumenDelTurno } from '../services/caja.service.js';
import * as cajaGeneralService from '../services/caja-general.service.js';
import { actorDeSesion, registrarAccion } from '../services/registro.service.js';

function parsearId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id inválido');
  return id;
}

// La pantalla: saldo, movimientos del período y lo que hay en la caja del turno.
export async function obtenerCajaGeneralController(req, res) {
  const { desde, hasta } = req.query;
  const [datos, turno] = await Promise.all([cajaGeneralService.obtenerCajaGeneral({ desde, hasta }), calcularResumenDelTurno()]);
  res.json({ ...datos, caja: turno.total_efectivo_esperado });
}

// Cuánto hay en cada lugar, para elegir de dónde sale un pago.
export async function disponibleController(req, res) {
  const [general, turno] = await Promise.all([cajaGeneralService.saldoCajaGeneral(), calcularResumenDelTurno()]);
  res.json({ general, caja: turno.total_efectivo_esperado });
}

function detalleDelMovimiento(m) {
  return { movimiento_id: m.id, concepto: m.concepto, monto: m.monto, fecha: m.fecha, detalle: m.detalle };
}

export async function anotarMovimientoController(req, res) {
  const movimiento = await cajaGeneralService.anotarMovimiento(req.body, { usuarioId: req.sesion.usuario_id });
  await registrarAccion('caja-general-movimiento', { actor: actorDeSesion(req.sesion), ip: req.ip, detalle: detalleDelMovimiento(movimiento) });
  res.status(201).json(movimiento);
}

export async function anularMovimientoController(req, res) {
  const movimiento = await cajaGeneralService.anularMovimiento(parsearId(req.params.id), { usuarioId: req.sesion.usuario_id });
  await registrarAccion('caja-general-anulado', { actor: actorDeSesion(req.sesion), ip: req.ip, detalle: detalleDelMovimiento(movimiento) });
  res.json({ ok: true });
}
