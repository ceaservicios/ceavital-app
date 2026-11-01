import { ApiError } from '../utils/api-error.js';
import * as gruposService from '../services/grupos-promocion.service.js';
import { actorDeSesion, registrarAccion } from '../services/registro.service.js';

// Grupos de promoción (2026-11-01): cambian lo que se cobra, así que cada cambio queda en el
// registro de acciones con quién lo hizo.

function parsearId(valor, campo) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

const registrar = (req, accion, detalle) => registrarAccion(accion, { actor: actorDeSesion(req.sesion), ip: req.ip, detalle });

export async function listarGruposController(req, res) {
  res.json({ items: await gruposService.listarGrupos() });
}

export async function crearGrupoController(req, res) {
  const grupo = await gruposService.crearGrupo(req.body || {});
  await registrar(req, 'grupo-promocion-creado', { grupo: grupo.nombre });
  res.status(201).json(grupo);
}

export async function renombrarGrupoController(req, res) {
  const { grupo, anterior } = await gruposService.renombrarGrupo(parsearId(req.params.id, 'id'), req.body || {});
  if (anterior !== grupo.nombre) await registrar(req, 'grupo-promocion-renombrado', { anterior, grupo: grupo.nombre });
  res.json(grupo);
}

export async function eliminarGrupoController(req, res) {
  const { grupo, productos } = await gruposService.eliminarGrupo(parsearId(req.params.id, 'id'));
  await registrar(req, 'grupo-promocion-eliminado', { grupo: grupo.nombre, productos });
  res.status(204).send();
}

export async function agregarProductoController(req, res) {
  const cambio = await gruposService.agregarProducto(parsearId(req.params.id, 'id'), parsearId(req.params.productoId, 'producto_id'));
  if (cambio) {
    await registrar(req, 'grupo-promocion-producto-agregado', {
      grupo: cambio.grupo.nombre,
      producto: cambio.producto,
      anterior: cambio.anterior,
    });
  }
  res.status(204).send();
}

export async function sacarProductoController(req, res) {
  const { grupo, producto } = await gruposService.sacarProducto(parsearId(req.params.id, 'id'), parsearId(req.params.productoId, 'producto_id'));
  await registrar(req, 'grupo-promocion-producto-sacado', { grupo: grupo.nombre, producto });
  res.status(204).send();
}
