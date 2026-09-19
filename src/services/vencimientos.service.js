import db from '../db/connection.js';
import { hoyNegocio } from '../utils/fecha-negocio.js';

// Los dias se cuentan contra "hoy" en hora argentina (fecha-negocio.js), no contra
// la fecha UTC del servidor: pasadas las 21:00 argentinas la UTC ya es el dia siguiente.

// "Por vencer": el producto tiene un umbral de aviso configurado
// (dias_aviso_vencimiento) y a su lote le quedan esos días o menos, sin haber
// vencido todavía. Sin umbral configurado, ese producto no genera aviso
// (Docs\Instructivo-Funcional.md > Vencimientos > "Umbral de aviso").
export function listarPorVencer() {
  const hoy = hoyNegocio();
  return db
    .prepare(
      `SELECT
         l.id AS lote_id,
         l.producto_id,
         p.nombre AS producto_nombre,
         l.cantidad,
         l.fecha_vencimiento,
         (l.fecha_vencimiento - ?::date) AS dias_restantes
       FROM lotes l
       JOIN productos p ON p.id = l.producto_id
       WHERE l.eliminado_en IS NULL
         AND p.eliminado_en IS NULL
         AND l.fecha_vencimiento IS NOT NULL
         AND p.dias_aviso_vencimiento IS NOT NULL
         AND l.fecha_vencimiento >= ?::date
         AND l.fecha_vencimiento <= ?::date + p.dias_aviso_vencimiento
       ORDER BY l.fecha_vencimiento ASC`
    )
    .all(hoy, hoy, hoy);
}

// "Vencidos": fecha ya pasada, sin importar si el producto tiene umbral de
// aviso configurado o no -- ya está fuera del stock vendible (ver
// stock.service.js) y necesita revisión/retiro físico.
export function listarVencidos() {
  const hoy = hoyNegocio();
  return db
    .prepare(
      `SELECT
         l.id AS lote_id,
         l.producto_id,
         p.nombre AS producto_nombre,
         l.cantidad,
         l.fecha_vencimiento,
         (?::date - l.fecha_vencimiento) AS dias_vencido
       FROM lotes l
       JOIN productos p ON p.id = l.producto_id
       WHERE l.eliminado_en IS NULL
         AND p.eliminado_en IS NULL
         AND l.fecha_vencimiento IS NOT NULL
         AND l.fecha_vencimiento < ?::date
       ORDER BY l.fecha_vencimiento ASC`
    )
    .all(hoy, hoy);
}
