import { ApiError } from '../utils/api-error.js';
import * as gastosService from '../services/gastos.service.js';
import { actorDeSesion, registrarAccion } from '../services/registro.service.js';

function parsearId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id inválido');
  return id;
}

export async function listarGastosController(req, res) {
  const { fecha, desde, hasta } = req.query;
  res.json({ gastos: await gastosService.listarGastos({ fecha, desde, hasta }) });
}

export async function registrarGastoController(req, res) {
  const gasto = await gastosService.registrarGasto(req.body || {}, { usuarioId: req.sesion.usuario_id, rol: req.sesion.rol });
  res.status(201).json(gasto);
}

// Corregir un gasto (2026-11-03): queda en el registro de acciones con el antes y el después.
export async function editarGastoController(req, res) {
  const id = parsearId(req.params.id);
  const { gasto, antes } = await gastosService.editarGasto(id, req.body || {});
  const cambio = ['concepto', 'monto', 'medio_pago', 'origen', 'proveedor_id'].some((campo) => gasto[campo] !== antes[campo]);
  if (cambio) {
    await registrarAccion('gasto-editado', {
      actor: actorDeSesion(req.sesion),
      ip: req.ip,
      detalle: {
        gasto_id: id,
        concepto_antes: antes.concepto,
        concepto: gasto.concepto,
        monto_antes: antes.monto,
        monto: gasto.monto,
        medio_antes: antes.medio_pago,
        medio: gasto.medio_pago,
        origen_antes: antes.origen,
        origen: gasto.origen,
        proveedor_antes: antes.proveedor_nombre,
        proveedor: gasto.proveedor_nombre,
      },
    });
  }
  res.json(gasto);
}

export async function eliminarGastoController(req, res) {
  const id = parsearId(req.params.id);
  await gastosService.eliminarGasto(id);
  res.status(204).send();
}
