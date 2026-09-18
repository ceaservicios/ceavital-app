import * as configuracionService from '../services/configuracion.service.js';

export function obtenerConfiguracionController(req, res) {
  res.json(configuracionService.obtenerConfiguracionBackups());
}

export function editarConfiguracionController(req, res) {
  res.json(configuracionService.editarConfiguracionBackups(req.body || {}));
}
