import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { obtenerConfiguracionBackups } from './configuracion.service.js';
import { ejecutarBackup } from './backups.service.js';
import { totalGastosDelDia } from './gastos.service.js';

const MEDIOS_PAGO = ['efectivo', 'tarjeta', 'transferencia_qr', 'mercado_pago', 'fiado'];

function validarFecha(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new ApiError(400, 'fecha tiene que tener formato YYYY-MM-DD');
  }
  return valor;
}

function validarEnteroNoNegativo(valor, campo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) {
    throw new ApiError(400, `${campo} tiene que ser un número entero mayor o igual a 0`);
  }
  return n;
}

function fechaHoy() {
  return db.prepare(`SELECT date('now') AS hoy`).get().hoy;
}

// Fondo dejado en el cierre mas reciente ANTERIOR a esta fecha -- se suma al
// efectivo esperado del dia siguiente (decision confirmada con el usuario
// 2026-09-18: "se deja un monto del dia anterior... se suma a las ventas del
// dia"). Si nunca se dejo fondo, o es el primer cierre del negocio, es 0.
function fondoHeredado(fecha) {
  const fila = db
    .prepare(`SELECT fondo_dejado FROM cierres_caja WHERE fecha < ? ORDER BY fecha DESC, id DESC LIMIT 1`)
    .get(fecha);
  return fila?.fondo_dejado ?? 0;
}

// Totales del dia (fecha, default hoy) agrupados por medio de pago, en base a
// las ventas REGISTRADAS (no anuladas) de ese dia -- calculo en vivo, no lee
// de cierres_caja (esa tabla guarda la FOTO de un cierre ya ejecutado, ver
// Docs/Modelo-de-Datos.md > cierres_caja). Es lo que ven los 3 roles como
// "Cierre de caja -- Ver" antes de que Admin/Encargado ejecuten el cierre.
//
// El efectivo esperado no es solo la venta en efectivo del dia (corregido
// 2026-09-15/2026-09-18): tambien suma el fondo heredado del cierre anterior
// y resta los gastos/pagos a proveedores del dia (se asumen en efectivo,
// salen fisicamente del cajon -- ver gastos.service.js) -- si no, el arqueo
// nunca cuadraria con lo que realmente queda en la caja fisica.
export function calcularResumenDelDia(fechaParam) {
  const fecha = validarFecha(fechaParam) ?? fechaHoy();

  const filas = db
    .prepare(
      `SELECT medio_pago, COALESCE(SUM(total), 0) AS total
       FROM ventas
       WHERE estado = 'registrada' AND date(creado_en) = ?
       GROUP BY medio_pago`
    )
    .all(fecha);

  const totales = Object.fromEntries(MEDIOS_PAGO.map((m) => [m, 0]));
  for (const fila of filas) totales[fila.medio_pago] = fila.total;

  const total_general = MEDIOS_PAGO.reduce((acc, m) => acc + totales[m], 0);
  const fondo_heredado = fondoHeredado(fecha);
  const total_gastos = totalGastosDelDia(fecha);

  return {
    fecha,
    fondo_heredado,
    total_gastos,
    total_efectivo_esperado: totales.efectivo + fondo_heredado - total_gastos,
    total_tarjeta: totales.tarjeta,
    total_transferencia_qr: totales.transferencia_qr,
    total_mercado_pago: totales.mercado_pago,
    total_fiado: totales.fiado,
    total_general,
  };
}

export function listarCierres() {
  return db.prepare('SELECT * FROM cierres_caja ORDER BY creado_en DESC').all();
}

export function obtenerCierre(id) {
  const cierre = db.prepare('SELECT * FROM cierres_caja WHERE id = ?').get(id);
  if (!cierre) throw new ApiError(404, 'Cierre de caja no encontrado');
  return cierre;
}

// "Cierre de caja -- Editar" (Admin+Encargado, no Cajero -- confirmado en
// Docs/Resumen-Ejecutivo.md: "Cajero... ve el cierre de caja, sin editar").
// Guarda una FOTO de los totales al momento del cierre (no se recalculan
// despues). Solo efectivo tiene "esperado vs. contado": es el unico medio que
// se cuenta fisicamente y puede tener diferencia; los demas son registros
// digitales exactos que ya coinciden con lo esperado.
export function registrarCierre({ fecha, total_efectivo_contado, fondo_dejado }, { usuarioId }) {
  const contado = validarEnteroNoNegativo(total_efectivo_contado, 'total_efectivo_contado');
  // Fondo que este cierre deja para el turno/dia siguiente (corregido
  // 2026-09-15) -- opcional, default 0 (mismo comportamiento de siempre si no
  // se carga nada).
  const fondoDejado = fondo_dejado != null ? validarEnteroNoNegativo(fondo_dejado, 'fondo_dejado') : 0;
  const resumen = calcularResumenDelDia(fecha);
  const diferencia = contado - resumen.total_efectivo_esperado;

  // Guardia de idempotencia (hallazgo Media, verificador-funcional 2026-09-10):
  // un doble-click en "Confirmar Cierre de Caja" manda 2 POST con exactamente
  // los mismos totales en el mismo instante -- sin este check, ambos se
  // insertaban como cierres "distintos" (2 filas idénticas). Si el cierre más
  // reciente de este mismo usuario/día tiene los mismos totales Y se registró
  // hace menos de 5 segundos, se lo trata como el mismo submit repetido y se
  // rechaza -- nunca bloquea un cierre distinto legítimo más tarde (fecha/hora
  // siempre resuelta en SQL, mismo criterio que el resto del proyecto).
  const duplicado = db
    .prepare(
      `SELECT id FROM cierres_caja
       WHERE usuario_id = ? AND fecha = ?
         AND total_efectivo_contado = ? AND total_general = ? AND total_efectivo_esperado = ?
         AND creado_en >= datetime('now', '-5 seconds')
       ORDER BY id DESC LIMIT 1`
    )
    .get(usuarioId, resumen.fecha, contado, resumen.total_general, resumen.total_efectivo_esperado);

  if (duplicado) {
    throw new ApiError(409, 'Ya se registró un cierre idéntico hace instantes -- probablemente un doble envío.');
  }

  // total_general usa el total esperado/real de ventas (no el contado): es un
  // total de auditoria de lo que se vendio, separado del desvio de caja
  // fisica que ya queda aislado en diferencia_efectivo. fondo_heredado/
  // total_gastos se guardan tal cual estaban en el momento del cierre (misma
  // logica de "foto" que el resto de la tabla -- nunca se recalculan despues).
  const resultado = db
    .prepare(
      `INSERT INTO cierres_caja
         (usuario_id, fecha, total_efectivo_esperado, total_efectivo_contado, diferencia_efectivo,
          total_tarjeta, total_transferencia_qr, total_mercado_pago, total_fiado, total_general,
          fondo_dejado, fondo_heredado, total_gastos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      usuarioId,
      resumen.fecha,
      resumen.total_efectivo_esperado,
      contado,
      diferencia,
      resumen.total_tarjeta,
      resumen.total_transferencia_qr,
      resumen.total_mercado_pago,
      resumen.total_fiado,
      resumen.total_general,
      fondoDejado,
      resumen.fondo_heredado,
      resumen.total_gastos
    );

  // "Cuándo hacer backup": una de las 3 opciones es "en cada cierre de caja"
  // (Docs/Instructivo-Funcional.md > Backups). El backup es un efecto
  // secundario, nunca bloquea el cierre -- si falla (destino no disponible,
  // sin configurar, etc.) ya queda registrado por su cuenta en
  // backups_historial (backups.service.ejecutarBackup), y acá se lo absorbe
  // para no tumbar la respuesta del cierre por un problema de backup.
  if (obtenerConfiguracionBackups().frecuencia === 'cierre_caja') {
    try {
      ejecutarBackup();
    } catch {
      // sin acción: la falla ya quedó auditada por ejecutarBackup() o, si no
      // hay ningún destino habilitado, simplemente no hay backup que hacer.
    }
  }

  return obtenerCierre(resultado.lastInsertRowid);
}
