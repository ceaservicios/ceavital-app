-- Precio por cantidad también para el pack (2026-10-11, pedido del usuario: "puede ser el caso
-- que, ejemplo, +10 pack tenga oferta"). Igual que el del suelto (migración 018) pero contado en
-- packs: desde pack_cantidad_desde packs del producto en una misma venta, toda la línea por pack
-- sale a precio_pack_cantidad cada pack. Independiente del precio por cantidad del suelto.
-- Aditiva: columnas nuevas, opcionales.

ALTER TABLE productos ADD COLUMN pack_cantidad_desde INTEGER;
ALTER TABLE productos ADD COLUMN precio_pack_cantidad BIGINT;
-- Nombres propios: no chocan con los que Postgres pone solo (incidente de la migración 018).
ALTER TABLE productos ADD CONSTRAINT productos_pack_cantidad_desde_rango_check
  CHECK (pack_cantidad_desde IS NULL OR pack_cantidad_desde BETWEEN 2 AND 100000);
ALTER TABLE productos ADD CONSTRAINT productos_precio_pack_cantidad_positivo_check
  CHECK (precio_pack_cantidad IS NULL OR precio_pack_cantidad >= 0);
ALTER TABLE productos ADD CONSTRAINT productos_pack_cantidad_completo_check
  CHECK ((pack_cantidad_desde IS NULL) = (precio_pack_cantidad IS NULL));
ALTER TABLE productos ADD CONSTRAINT productos_pack_cantidad_con_pack_check
  CHECK (pack_cantidad_desde IS NULL OR pack_nombre IS NOT NULL);

-- En las líneas de venta y de pedido no hace falta columna nueva: precio_cantidad_desde ya guarda
-- "desde cuánto regía" y, en una línea por pack, se lee en packs.
