import { ApiError } from '../utils/api-error.js';
import { categoriasService, unidadesMedidaService } from '../services/catalogos.service.js';

function parsearId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id inválido');
  return id;
}

function crearControladorCatalogo(servicio) {
  return {
    listar(req, res) {
      res.json({ items: servicio.listar() });
    },
    crear(req, res) {
      res.status(201).json(servicio.crear(req.body || {}));
    },
    editar(req, res) {
      res.json(servicio.editar(parsearId(req.params.id), req.body || {}));
    },
    eliminar(req, res) {
      servicio.eliminar(parsearId(req.params.id));
      res.status(204).send();
    },
  };
}

export const categoriasController = crearControladorCatalogo(categoriasService);
export const unidadesMedidaController = crearControladorCatalogo(unidadesMedidaService);
