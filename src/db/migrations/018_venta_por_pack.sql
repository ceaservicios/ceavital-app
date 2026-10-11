-- Venta por pack y precio por cantidad (2026-10-11, decisiones del usuario: modelo de
-- CEAVital-Somnia, con los precios en el producto porque aca no hay listas de precios).
-- Aditiva: columnas nuevas, todas opcionales; no cambia ni borra ningun dato.
--
-- El stock sigue contado en la unidad del producto (lotes.cantidad, venta_items.cantidad y
-- pedido_cliente_items.cantidad son SIEMPRE unidades): vender un pack descuenta pack_unidades
-- unidades. Asi FEFO, reservas y anulaciones no cambian.

-- Producto que tambien se vende por pack o caja: nombre ("Pack", "Caja"), cuantas unidades
-- trae, precio del pack y, opcional, el codigo de barras del pack. Todo o nada (salvo el codigo).
ALTER TABLE productos ADD COLUMN pack_nombre VARCHAR(20);
ALTER TABLE productos ADD COLUMN pack_unidades INTEGER CHECK (pack_unidades BETWEEN 2 AND 100000);
ALTER TABLE productos ADD COLUMN precio_pack BIGINT CHECK (precio_pack >= 0);
ALTER TABLE productos ADD COLUMN codigo_barras_pack TEXT;
ALTER TABLE productos ADD CONSTRAINT productos_pack_completo_check CHECK (
  (pack_nombre IS NULL AND pack_unidades IS NULL AND precio_pack IS NULL AND codigo_barras_pack IS NULL)
  OR (pack_nombre IS NOT NULL AND pack_unidades IS NOT NULL AND precio_pack IS NOT NULL)
);
-- Mismo criterio que codigo_barras (migracion 009): unico entre activos, sin distinguir
-- mayusculas. Que no choque con el codigo de la unidad de otro producto lo valida el servicio.
CREATE UNIQUE INDEX idx_productos_codigo_barras_pack_activo ON productos (LOWER(codigo_barras_pack))
  WHERE codigo_barras_pack IS NOT NULL AND eliminado_en IS NULL;

-- Precio por cantidad: desde N unidades de este producto en una misma venta, toda la linea
-- sale al precio menor. Solo para la venta por unidad (no por pack). Los dos o ninguno.
ALTER TABLE productos ADD COLUMN precio_cantidad_desde INTEGER CHECK (precio_cantidad_desde BETWEEN 2 AND 100000);
ALTER TABLE productos ADD COLUMN precio_cantidad BIGINT CHECK (precio_cantidad >= 0);
ALTER TABLE productos ADD CONSTRAINT productos_precio_cantidad_completo_check CHECK (
  (precio_cantidad_desde IS NULL) = (precio_cantidad IS NULL)
);

-- Cada linea guarda una copia de como se vendio (igual que precio_unitario, congelado):
-- pack_nombre/pack_unidades NULL = por unidad; con pack, precio_unitario es el precio del
-- pack y cantidad / pack_unidades es la cantidad de packs. precio_cantidad_desde: si la
-- linea se cobro con el precio por cantidad, desde cuantas regia (solo para mostrar).
ALTER TABLE venta_items ADD COLUMN pack_nombre VARCHAR(20);
ALTER TABLE venta_items ADD COLUMN pack_unidades INTEGER;
ALTER TABLE venta_items ADD COLUMN precio_cantidad_desde INTEGER;
ALTER TABLE venta_items ADD CONSTRAINT venta_items_pack_check CHECK ((pack_nombre IS NULL) = (pack_unidades IS NULL));

ALTER TABLE pedido_cliente_items ADD COLUMN pack_nombre VARCHAR(20);
ALTER TABLE pedido_cliente_items ADD COLUMN pack_unidades INTEGER;
ALTER TABLE pedido_cliente_items ADD COLUMN precio_cantidad_desde INTEGER;
ALTER TABLE pedido_cliente_items ADD CONSTRAINT pedido_cliente_items_pack_check CHECK ((pack_nombre IS NULL) = (pack_unidades IS NULL));
