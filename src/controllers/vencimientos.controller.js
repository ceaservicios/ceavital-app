import * as vencimientosService from '../services/vencimientos.service.js';

export async function obtenerVencimientosController(req, res) {
  res.json({
    por_vencer: await vencimientosService.listarPorVencer(),
    vencidos: await vencimientosService.listarVencidos(),
  });
}
