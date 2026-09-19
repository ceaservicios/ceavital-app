import * as configuracionService from '../services/configuracion.service.js';

export async function obtenerConfiguracionController(req, res) {
  res.json(await configuracionService.obtenerConfiguracionBackups());
}

export async function editarConfiguracionController(req, res) {
  res.json(await configuracionService.editarConfiguracionBackups(req.body || {}));
}
