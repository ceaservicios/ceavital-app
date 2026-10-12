-- Forma de medir y formas de venta (2026-10-11, decisiones del usuario: "unidad y pack tienen
-- que ser formas opcionales", "no todo se vende por unidad", "¿cuando es por kg cómo sería?").
--
-- 1. medida: cómo se mide el producto, fija (ya no la lista libre de unidades de medida, que
--    dejaba cargar "Caja x 12" como unidad). 'unidad' se cuenta; 'kg' y 'litro' se pesan o
--    miden con decimales. El stock y las cantidades de las líneas siguen siendo enteros, en la
--    medida más chica: unidades, gramos o mililitros. Los precios (venta, costo, precio por
--    cantidad) son por unidad, por kg o por litro: subtotal = cantidad * precio / 1000 en kg/litro.
-- 2. vende_suelto: si se vende suelto (por unidad, por kg o por litro). Si no, se vende solo por
--    el pack (caja, bolsa…): ahí el pack es obligatorio, se carga el costo del pack (costo_pack) y
--    precio_venta/precio_costo quedan calculados del pack, solo como referencia (inventario).
-- Aditiva: no borra datos. Los productos que ya tenían unidad "Kg" o "Litro" pasan a esa
-- medida y sus cantidades a gramos/mililitros (5 kg siguen siendo 5 kg).

ALTER TABLE productos ADD COLUMN medida TEXT NOT NULL DEFAULT 'unidad';
ALTER TABLE productos ADD CONSTRAINT productos_medida_check CHECK (medida IN ('unidad', 'kg', 'litro'));
ALTER TABLE productos ADD COLUMN vende_suelto BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE productos ADD COLUMN costo_pack BIGINT;
ALTER TABLE productos ADD CONSTRAINT productos_costo_pack_check CHECK (costo_pack IS NULL OR costo_pack >= 0);
ALTER TABLE productos ADD CONSTRAINT productos_alguna_forma_check CHECK (vende_suelto OR pack_nombre IS NOT NULL);
-- La unidad de medida del catálogo queda solo como dato histórico.
ALTER TABLE productos ALTER COLUMN unidad_medida_id DROP NOT NULL;

-- En gramos, un pack o un "desde" se pasan de 100000 (una bolsa de 150 kg).
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_pack_unidades_check;
ALTER TABLE productos ADD CONSTRAINT productos_pack_unidades_rango_check CHECK (pack_unidades BETWEEN 2 AND 10000000);
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_precio_cantidad_desde_check;
ALTER TABLE productos ADD CONSTRAINT productos_precio_cantidad_desde_rango_check CHECK (precio_cantidad_desde BETWEEN 2 AND 10000000);

-- Productos con unidad "Kg" / "Litro": pasan a esa medida.
UPDATE productos p SET medida = 'kg'
FROM unidades_medida u
WHERE u.id = p.unidad_medida_id
  AND LOWER(TRIM(u.nombre)) IN ('kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos', '1 kg', 'x kg', 'por kg');
UPDATE productos p SET medida = 'litro'
FROM unidades_medida u
WHERE u.id = p.unidad_medida_id
  AND LOWER(TRIM(u.nombre)) IN ('l', 'lt', 'lts', 'litro', 'litros', '1 l', '1 lt', '1 litro', 'x litro', 'por litro');

-- Y sus cantidades, de kg/litros a gramos/mililitros (lotes también retirados, por si una
-- anulación reingresa en ellos; líneas de venta y de pedidos; mínimos, packs y "desde").
UPDATE lotes SET cantidad = cantidad * 1000
WHERE producto_id IN (SELECT id FROM productos WHERE medida <> 'unidad');
UPDATE venta_items SET cantidad = cantidad * 1000, pack_unidades = pack_unidades * 1000,
  precio_cantidad_desde = precio_cantidad_desde * 1000
WHERE producto_id IN (SELECT id FROM productos WHERE medida <> 'unidad');
UPDATE pedido_cliente_items SET cantidad = cantidad * 1000, pack_unidades = pack_unidades * 1000,
  precio_cantidad_desde = precio_cantidad_desde * 1000
WHERE producto_id IN (SELECT id FROM productos WHERE medida <> 'unidad');
UPDATE productos SET stock_minimo = stock_minimo * 1000, pack_unidades = pack_unidades * 1000,
  precio_cantidad_desde = precio_cantidad_desde * 1000
WHERE medida <> 'unidad';
