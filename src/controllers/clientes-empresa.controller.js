import config from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import * as clientesEmpresaService from '../services/clientes-empresa.service.js';
import * as portalService from '../services/clientes-portal.service.js';
import { enviarResumenCuentaPdf } from '../services/resumen-cuenta-pdf.service.js';

function parsearId(valor, campo = 'id') {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${campo} inválido`);
  return id;
}

export async function listarClientesEmpresaController(req, res) {
  const clientes = await clientesEmpresaService.listarClientesEmpresa({
    buscar: req.query.q,
    incluirSaldo: req.sesion.rol !== 'cajero',
  });
  // Mínimo privilegio: el Cajero solo necesita id y razón social para elegir a quién
  // le cobra a cuenta corriente; CUIT, teléfono, email y condición de pago son datos
  // del módulo Clientes, al que no tiene acceso (matriz de permisos).
  if (req.sesion.rol === 'cajero') {
    return res.json({ clientes: clientes.map(({ id, razon_social }) => ({ id, razon_social })) });
  }
  res.json({ clientes });
}

export async function obtenerClienteEmpresaController(req, res) {
  const id = parsearId(req.params.id);
  res.json(await clientesEmpresaService.obtenerClienteEmpresa(id));
}

export async function crearClienteEmpresaController(req, res) {
  const cliente = await clientesEmpresaService.crearClienteEmpresa(req.body || {});
  res.status(201).json(cliente);
}

export async function editarClienteEmpresaController(req, res) {
  const id = parsearId(req.params.id);
  res.json(await clientesEmpresaService.editarClienteEmpresa(id, req.body || {}));
}

export async function eliminarClienteEmpresaController(req, res) {
  const id = parsearId(req.params.id);
  await clientesEmpresaService.eliminarClienteEmpresa(id, { usuarioId: req.sesion.usuario_id });
  res.status(204).send();
}

export async function listarMovimientosController(req, res) {
  const id = parsearId(req.params.id, 'cliente_empresa_id');
  res.json(await clientesEmpresaService.listarMovimientos(id));
}

export async function descargarResumenCuentaController(req, res) {
  const id = parsearId(req.params.id, 'cliente_empresa_id');
  // armarResumenCuenta valida las fechas y lanza ApiError(400) antes de que se
  // escriba nada en la respuesta.
  const resumen = await clientesEmpresaService.armarResumenCuenta(id, { desde: req.query.desde, hasta: req.query.hasta });
  await enviarResumenCuentaPdf(res, resumen);
}

export async function obtenerAccesoController(req, res) {
  const id = parsearId(req.params.id, 'cliente_empresa_id');
  res.json(await portalService.obtenerAcceso(id));
}

// async (hashea la contraseña): se registra con asyncHandler en las rutas.
export async function configurarAccesoController(req, res) {
  const id = parsearId(req.params.id, 'cliente_empresa_id');
  res.json(await portalService.configurarAcceso(id, req.body || {}));
}

// Enlace del portal para el mail: PUBLIC_URL si está configurada, y si no el
// dominio con el que se está usando el sistema (detrás del proxy de Easypanel
// es el dominio real).
function enlaceDelPortal(req) {
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}/portal/login`;
}

export async function enviarAccesoController(req, res) {
  const id = parsearId(req.params.id, 'cliente_empresa_id');
  const resultado = await portalService.enviarAccesoPorCorreo(id, {
    password: req.body?.password,
    enlace: enlaceDelPortal(req),
  });
  res.json(resultado);
}

export async function registrarPagoController(req, res) {
  const id = parsearId(req.params.id, 'cliente_empresa_id');
  const resultado = await clientesEmpresaService.registrarPago(id, req.body || {}, { usuarioId: req.sesion.usuario_id });
  res.status(201).json(resultado);
}

export async function registrarAjusteController(req, res) {
  const id = parsearId(req.params.id, 'cliente_empresa_id');
  const resultado = await clientesEmpresaService.registrarAjuste(id, req.body || {}, { usuarioId: req.sesion.usuario_id });
  res.status(201).json(resultado);
}
