import db from '../db/connection.js';

// "Por vencer": el producto tiene un umbral de aviso configurado
// (dias_aviso_vencimiento) y a su lote le quedan esos días o menos, sin haber
// vencido todavía. Sin umbral configurado, ese producto no genera aviso
// (Docs\Instructivo-Funcional.md > Vencimientos > "Umbral de aviso").
export function listarPorVencer() {
  return db
    .prepare(
      `SELECT
         l.id AS lote_id,
         l.producto_id,
         p.nombre AS producto_nombre,
         l.cantidad,
         l.fecha_vencimiento,
         CAST(julianday(l.fecha_vencimiento) - julianday(date('now')) AS INTEGER) AS dias_restantes
       FROM lotes l
       JOIN productos p ON p.id = l.producto_id
       WHERE l.eliminado_en IS NULL
         AND p.eliminado_en IS NULL
         AND l.fecha_vencimiento IS NOT NULL
         AND p.dias_aviso_vencimiento IS NOT NULL
         AND date(l.fecha_vencimiento) >= date('now')
         AND date(l.fecha_vencimiento) <= date('now', '+' || p.dias_aviso_vencimiento || ' days')
       ORDER BY l.fecha_vencimiento ASC`
    )
    .all();
}

// "Vencidos": fecha ya pasada, sin importar si el producto tiene umbral de
// aviso configurado o no -- ya está fuera del stock vendible (ver
// stock.service.js) y necesita revisión/retiro físico.
export function listarVencidos() {
  return db
    .prepare(
      `SELECT
         l.id AS lote_id,
         l.producto_id,
         p.nombre AS producto_nombre,
         l.cantidad,
         l.fecha_vencimiento,
         CAST(julianday(date('now')) - julianday(l.fecha_vencimiento) AS INTEGER) AS dias_vencido
       FROM lotes l
       JOIN productos p ON p.id = l.producto_id
       WHERE l.eliminado_en IS NULL
         AND p.eliminado_en IS NULL
         AND l.fecha_vencimiento IS NOT NULL
         AND date(l.fecha_vencimiento) < date('now')
       ORDER BY l.fecha_vencimiento ASC`
    )
    .all();
}
