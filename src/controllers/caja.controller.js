import { ApiError } from '../utils/api-error.js';
import * as cajaService from '../services/caja.service.js';
import { actorDeSesion, registrarAccion } from '../services/registro.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export async function obtenerResumenController(req, res) {
  res.json(await cajaService.calcularResumenDelTurno());
}

export async function listarCierresController(req, res) {
  res.json({ cierres: await cajaService.listarCierres() });
}

export async function obtenerCierreController(req, res) {
  const id = parsearId(req.params.id);
  res.json(await cajaService.obtenerCierre(id));
}

export async function cargarFondoController(req, res) {
  const fondo = await cajaService.cargarFondo(req.body || {}, { usuarioId: req.sesion.usuario_id });
  // Queda en el registro quién lo cargó y de cuánto a cuánto: cambia el efectivo esperado del arqueo.
  await registrarAccion('fondo-turno', { actor: actorDeSesion(req.sesion), ip: req.ip, detalle: fondo });
  res.json(fondo);
}

// Corregir y eliminar un cierre (Administrador, 2026-10-31): quedan en el registro con el antes.
export async function editarCierreController(req, res) {
  const id = parsearId(req.params.id);
  const { cierre, antes, cambio } = await cajaService.editarCierre(id, req.body || {}, { usuarioId: req.sesion.usuario_id });
  if (cambio) {
    await registrarAccion('cierre-editado', {
      actor: actorDeSesion(req.sesion),
      ip: req.ip,
      detalle: {
        cierre_id: id,
        fecha: cierre.fecha,
        contado_antes: antes.contado,
        contado: cierre.total_efectivo_contado,
        fondo_antes: antes.fondo,
        fondo: cierre.fondo_dejado,
      },
    });
  }
  res.json(cierre);
}

export async function eliminarCierreController(req, res) {
  const id = parsearId(req.params.id);
  const cierre = await cajaService.eliminarCierre(id, { usuarioId: req.sesion.usuario_id });
  await registrarAccion('cierre-eliminado', {
    actor: actorDeSesion(req.sesion),
    ip: req.ip,
    detalle: { cierre_id: id, fecha: cierre.fecha, contado: cierre.total_efectivo_contado, fondo: cierre.fondo_dejado },
  });
  res.json({ ok: true });
}

export async function registrarCierreController(req, res) {
  const cierre = await cajaService.registrarCierre(req.body || {}, { usuarioId: req.sesion.usuario_id });
  res.status(201).json(cierre);
}
