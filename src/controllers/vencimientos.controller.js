import * as vencimientosService from '../services/vencimientos.service.js';

export function obtenerVencimientosController(req, res) {
  res.json({
    por_vencer: vencimientosService.listarPorVencer(),
    vencidos: vencimientosService.listarVencidos(),
  });
}
