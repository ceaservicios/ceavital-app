import { ApiError } from '../utils/api-error.js';
import * as ventasService from '../services/ventas.service.js';
import { calcularResumenDelTurno } from '../services/caja.service.js';
import { hoyNegocio } from '../utils/fecha-negocio.js';
import { actorDeSesion, registrarAccion } from '../services/registro.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export async function listarVentasController(req, res) {
  const q = req.query;
  // Con desde/hasta es el listado de "Ventas diarias" (filtros y totales); con fecha, el de Caja.
  if (q.desde !== undefined || q.hasta !== undefined) {
    const resultado = await ventasService.buscarVentas({
      desde: q.desde,
      hasta: q.hasta,
      medio_pago: q.medio_pago,
      cliente_empresa_id: q.cliente_empresa_id,
      usuario_id: q.usuario_id,
      estado: q.estado,
    });
    // Plata del cajón (tarjetas "Fondo" y "Efectivo en caja", 2026-10-16): la del turno abierto,
    // el mismo cálculo que Cierre de Caja y sin los filtros de ventas. Solo cuando se mira hoy: el
    // cierre es por turno y cada cierre retira la plata, así que para otros días ese número no existe.
    let caja = null;
    if ((q.hasta ?? q.desde) === q.desde && q.desde === hoyNegocio()) {
      const resumen = await calcularResumenDelTurno();
      caja = { fondo: resumen.fondo_heredado, fondo_desde: resumen.desde, efectivo_en_caja: resumen.total_efectivo_esperado };
    }
    res.json({ ...resultado, caja });
    return;
  }
  const ventas = await ventasService.listarVentas({ fecha: q.fecha });
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
