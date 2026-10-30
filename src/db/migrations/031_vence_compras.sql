-- Saldos pendientes en una sola lista (pedido del usuario, 2026-10-29): cada boleta de proveedor con
-- su fecha para pagar, la que trae la factura o el remito (opción A, elegida por el usuario). Sin
-- ella vence el mismo día de la boleta: así quedan las cargadas antes de esta versión.
-- Aditiva: columnas nuevas, completadas con la fecha de cada boleta; ningún dato cambia.
ALTER TABLE compras_proveedor ADD COLUMN vence DATE;
UPDATE compras_proveedor SET vence = fecha;
ALTER TABLE compras_proveedor ALTER COLUMN vence SET NOT NULL;
ALTER TABLE compras_proveedor ADD CONSTRAINT compras_proveedor_vence_check CHECK (vence >= fecha);

-- Una corrección también puede cambiar el vencimiento. Las de antes quedan sin dato (no lo tocaban).
ALTER TABLE correcciones_compra ADD COLUMN antes_vence DATE;
ALTER TABLE correcciones_compra ADD COLUMN despues_vence DATE;
