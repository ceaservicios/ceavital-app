import { ApiError } from '../utils/api-error.js';
import * as stockService from '../services/stock.service.js';
import { actorDeSesion, registrarAccion } from '../services/registro.service.js';

function parsearId(valor, campo) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export async function crearLoteController(req, res) {
  const productoId = parsearId(req.params.id, 'producto_id');
  const lote = await stockService.crearLote(productoId, req.body || {});
  res.status(201).json(lote);
}

export async function editarLoteController(req, res) {
  const productoId = parsearId(req.params.id, 'producto_id');
  const loteId = parsearId(req.params.loteId, 'lote_id');
  const { lote, antes, producto } = await stockService.editarLote(productoId, loteId, req.body || {});
  // Corregir un lote cambia el stock: queda en el registro quién lo hizo y de qué a qué (2026-10-31).
  const cambio = (campo) => String(antes[campo] ?? '') !== String(lote[campo] ?? '');
  if (['cantidad', 'fecha_ingreso', 'fecha_vencimiento'].some(cambio)) {
    await registrarAccion('lote-editado', {
      actor: actorDeSesion(req.sesion),
      ip: req.ip,
      detalle: {
        producto: producto.nombre,
        medida: producto.medida,
        lote_id: loteId,
        ingreso: antes.fecha_ingreso,
        ...(cambio('cantidad') && { cantidad_antes: antes.cantidad, cantidad: lote.cantidad }),
        ...(cambio('fecha_ingreso') && { ingreso_nuevo: lote.fecha_ingreso }),
        ...(cambio('fecha_vencimiento') && { vence_antes: antes.fecha_vencimiento, vence: lote.fecha_vencimiento, cambia_vence: true }),
      },
    });
  }
  res.json(lote);
}

export async function eliminarLoteController(req, res) {
  const productoId = parsearId(req.params.id, 'producto_id');
  const loteId = parsearId(req.params.loteId, 'lote_id');
  await stockService.eliminarLote(productoId, loteId);
  res.status(204).send();
}
