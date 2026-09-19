import config from '../config/env.js';
import { armarResumenCuenta, obtenerClienteEmpresa } from '../services/clientes-empresa.service.js';
import { cerrarSesionCliente, loginCliente } from '../services/clientes-portal.service.js';
import { catalogoConDisponibilidad } from '../services/reservas.service.js';
import {
  cancelarPedidoDelCliente,
  crearPedidoDelCliente,
  listarPedidosDelCliente,
  pedidoDelCliente,
} from '../services/pedidos-cliente.service.js';
import { ApiError } from '../utils/api-error.js';
import { enviarResumenCuentaPdf } from '../services/resumen-cuenta-pdf.service.js';

export async function loginPortalController(req, res) {
  const { usuario, password } = req.body || {};

  if (!usuario || typeof usuario !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  try {
    const resultado = await loginCliente(usuario.trim(), password);

    res.cookie('portal_token', resultado.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: config.session.timeoutMinutes * 60 * 1000,
    });

    res.json({ cliente: resultado.cliente });
  } catch (err) {
    if (err.codigo === 'USUARIO_BLOQUEADO') return res.status(423).json({ error: err.message });
    if (err.codigo === 'CREDENCIALES_INVALIDAS') return res.status(401).json({ error: err.message });
    throw err;
  }
}

export async function logoutPortalController(req, res) {
  await cerrarSesionCliente(req.cliente.sesionId, 'logout');
  res.clearCookie('portal_token');
  res.json({ ok: true });
}

// Lo que el cliente ve de SU cuenta. No se expone el nombre del empleado que
// registró cada movimiento (dato interno del negocio) ni ningún campo de acceso.
function soloParaElCliente(movimiento) {
  return {
    id: movimiento.id,
    tipo: movimiento.tipo,
    monto: movimiento.monto,
    descripcion: movimiento.descripcion,
    venta_id: movimiento.venta_id,
    creado_en: movimiento.creado_en,
  };
}

export async function cuentaPortalController(req, res) {
  const completo = await obtenerClienteEmpresa(req.cliente.id);
  const movimientos = completo.movimientos.map(soloParaElCliente);
  res.json({
    cliente: {
      id: completo.id,
      razon_social: completo.razon_social,
      cuit: completo.cuit,
      condicion_pago: completo.condicion_pago,
    },
    saldo: completo.saldo,
    total_comprado: movimientos.filter((m) => m.tipo === 'CARGO').reduce((suma, m) => suma + m.monto, 0),
    total_pagado: -movimientos.filter((m) => m.tipo === 'PAGO').reduce((suma, m) => suma + m.monto, 0),
    movimientos,
  });
}

export async function resumenPortalController(req, res) {
  const resumen = await armarResumenCuenta(req.cliente.id, { desde: req.query.desde, hasta: req.query.hasta });
  await enviarResumenCuentaPdf(res, resumen);
}

// Comprar desde el portal (B2B Fase 2). Todo se resuelve contra el cliente de
// la sesión (req.cliente.id): ninguna de estas rutas acepta el id de un cliente.
export async function catalogoPortalController(req, res) {
  res.json({ productos: await catalogoConDisponibilidad() });
}

export async function listarPedidosPortalController(req, res) {
  res.json({ pedidos: await listarPedidosDelCliente(req.cliente.id) });
}

export async function crearPedidoPortalController(req, res) {
  res.status(201).json(await crearPedidoDelCliente(req.cliente.id, req.body || {}));
}

export async function obtenerPedidoPortalController(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id inválido');
  res.json(await pedidoDelCliente(req.cliente.id, id));
}

export async function cancelarPedidoPortalController(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id inválido');
  res.json(await cancelarPedidoDelCliente(req.cliente.id, id));
}
