import { ApiError } from '../utils/api-error.js';
import * as clientesEmpresaService from '../services/clientes-empresa.service.js';
import { generarResumenCuentaPdf } from '../services/resumen-cuenta-pdf.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export function listarClientesEmpresaController(req, res) {
  const clientes = clientesEmpresaService.listarClientesEmpresa({
    buscar: req.query.q,
    incluirSaldo: req.sesion.rol !== 'cajero',
  });
  res.json({ clientes });
}

export function obtenerClienteEmpresaController(req, res) {
  const id = parsearId(req.params.id);
  res.json(clientesEmpresaService.obtenerClienteEmpresa(id));
}

export function crearClienteEmpresaController(req, res) {
  const cliente = clientesEmpresaService.crearClienteEmpresa(req.body || {});
  res.status(201).json(cliente);
}

export function editarClienteEmpresaController(req, res) {
  const id = parsearId(req.params.id);
  res.json(clientesEmpresaService.editarClienteEmpresa(id, req.body || {}));
}

export function eliminarClienteEmpresaController(req, res) {
  const id = parsearId(req.params.id);
  clientesEmpresaService.eliminarClienteEmpresa(id);
  res.status(204).send();
}

export function listarMovimientosController(req, res) {
  const id = parsearId(req.params.id, 'cliente_empresa_id');
  res.json(clientesEmpresaService.listarMovimientos(id));
}

// Nombre de archivo seguro para el header Content-Disposition: solo ASCII, sin
// espacios ni caracteres que rompan el header.
function nombreArchivoSeguro(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function descargarResumenCuentaController(req, res) {
  const id = parsearId(req.params.id, 'cliente_empresa_id');
  // armarResumenCuenta valida las fechas y lanza ApiError(400) antes de que se
  // escriba nada en la respuesta.
  const resumen = clientesEmpresaService.armarResumenCuenta(id, { desde: req.query.desde, hasta: req.query.hasta });

  const hoy = new Date().toISOString().slice(0, 10);
  const nombre = `Resumen-cuenta-${nombreArchivoSeguro(resumen.cliente.razon_social) || 'cliente'}-${hoy}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.setHeader('Cache-Control', 'no-store');
  generarResumenCuentaPdf(resumen).pipe(res);
}

export function registrarPagoController(req, res) {
  const id = parsearId(req.params.id, 'cliente_empresa_id');
  const resultado = clientesEmpresaService.registrarPago(id, req.body || {}, { usuarioId: req.sesion.usuario_id });
  res.status(201).json(resultado);
}

export function registrarAjusteController(req, res) {
  const id = parsearId(req.params.id, 'cliente_empresa_id');
  const resultado = clientesEmpresaService.registrarAjuste(id, req.body || {}, { usuarioId: req.sesion.usuario_id });
  res.status(201).json(resultado);
}
