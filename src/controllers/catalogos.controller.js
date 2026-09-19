import { ApiError } from '../utils/api-error.js';
import { categoriasService, condicionesPagoService, unidadesMedidaService } from '../services/catalogos.service.js';

function parsearId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id inválido');
  return id;
}

function crearControladorCatalogo(servicio) {
  return {
    async listar(req, res) {
      res.json({ items: await servicio.listar() });
    },
    async crear(req, res) {
      res.status(201).json(await servicio.crear(req.body || {}));
    },
    async editar(req, res) {
      res.json(await servicio.editar(parsearId(req.params.id), req.body || {}));
    },
    async eliminar(req, res) {
      await servicio.eliminar(parsearId(req.params.id));
      res.status(204).send();
    },
  };
}

export const categoriasController = crearControladorCatalogo(categoriasService);
export const unidadesMedidaController = crearControladorCatalogo(unidadesMedidaService);
export const condicionesPagoController = crearControladorCatalogo(condicionesPagoService);
