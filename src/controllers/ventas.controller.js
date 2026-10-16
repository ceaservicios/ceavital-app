import { ApiError } from '../utils/api-error.js';
import * as ventasService from '../services/ventas.service.js';
import { actorDeSesion, registrarAccion } from '../services/registro.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export async function listarVentasController(req, res) {
  const ventas = await ventasService.listarVentas({ fecha: req.query.fecha });
  res.json({ ventas });
}

export async function obtenerVentaController(req, res) {
  const id = parsearId(req.params.id);
  res.json(await ventasService.obtenerVenta(id));
}

export async function registrarVentaController(req, res) {
  const venta = await ventasService.registrarVenta(req.body || {}, { usuarioId: req.sesion.usuario_id });
  res.status(201).json(venta);
}

export async function editarMedioPagoController(req, res) {
  const id = parsearId(req.params.id);
  const { venta, anterior } = await ventasService.editarMedioPago(id, req.body || {});
  // Queda en el registro quién lo cambió y de qué a qué (la anulación ya queda en la venta).
  if (anterior) {
    await registrarAccion('venta-medio-pago', {
      actor: actorDeSesion(req.sesion),
      ip: req.ip,
      detalle: { venta_id: id, de: anterior, a: venta.medio_pago },
    });
  }
  res.json(venta);
}

export async function anularVentaController(req, res) {
  const id = parsearId(req.params.id);
  const venta = await ventasService.anularVenta(id, { usuarioId: req.sesion.usuario_id });
  res.json(venta);
}
