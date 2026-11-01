import { ApiError } from '../utils/api-error.js';
import * as combosService from '../services/combos.service.js';
import { actorDeSesion, registrarAccion } from '../services/registro.service.js';

// Combos (2026-11-01): cambian lo que se cobra en Caja, así que cada cambio queda en el registro de
// acciones con quién lo hizo (como los grupos de promoción).

function parsearId(valor, campo) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

const registrar = (req, accion, detalle) => registrarAccion(accion, { actor: actorDeSesion(req.sesion), ip: req.ip, detalle });

export async function listarCombosController(req, res) {
  res.json({ items: await combosService.listarCombos() });
}

export async function crearComboController(req, res) {
  const combo = await combosService.crearCombo(req.body || {});
  await registrar(req, 'combo-creado', { combo: combo.nombre, precio: combo.precio });
  res.status(201).json(combo);
}

export async function editarComboController(req, res) {
  const { combo, anterior } = await combosService.editarCombo(parsearId(req.params.id, 'id'), req.body || {});
  if (anterior.nombre !== combo.nombre || anterior.precio !== combo.precio) {
    await registrar(req, 'combo-editado', { anterior, combo });
  }
  res.json(combo);
}

export async function eliminarComboController(req, res) {
  const combo = await combosService.eliminarCombo(parsearId(req.params.id, 'id'));
  await registrar(req, 'combo-eliminado', { combo: combo.nombre });
  res.status(204).send();
}

export async function guardarProductoController(req, res) {
  const cambio = await combosService.guardarProducto(parsearId(req.params.id, 'id'), req.body || {});
  if (cambio) {
    await registrar(req, cambio.antes ? 'combo-producto-cambiado' : 'combo-producto-agregado', {
      combo: cambio.combo.nombre,
      producto: cambio.producto,
      lleva: cambio.lleva,
      antes: cambio.antes,
    });
  }
  res.status(204).send();
}

export async function sacarProductoController(req, res) {
  const { combo, producto, lleva } = await combosService.sacarProducto(parsearId(req.params.id, 'id'), parsearId(req.params.itemId, 'item'));
  await registrar(req, 'combo-producto-sacado', { combo: combo.nombre, producto, lleva });
  res.status(204).send();
}
