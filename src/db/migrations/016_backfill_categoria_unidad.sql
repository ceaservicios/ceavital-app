-- Backfill unico: crea una fila de catalogo por cada valor de texto libre
-- distinto que ya existe en productos (activos e inactivos, para no perder la
-- categoria de un producto soft-eliminado) y enlaza cada producto a su fila
-- nueva. INSERT OR IGNORE + COLLATE NOCASE del catalogo (ver 013/014): si dos
-- productos tenian "Kg" y "kg", el segundo INSERT choca contra el indice
-- unico NOCASE y se ignora -- ambos quedan enlazados a la primera fila
-- creada, fusionando el caso real que motivo este catalogo.
INSERT OR IGNORE INTO categorias (nombre)
SELECT DISTINCT TRIM(categoria) FROM productos
WHERE categoria IS NOT NULL AND TRIM(categoria) != '';

UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE categorias.nombre = TRIM(productos.categoria))
WHERE categoria IS NOT NULL AND TRIM(categoria) != '';

INSERT OR IGNORE INTO unidades_medida (nombre)
SELECT DISTINCT TRIM(unidad_medida) FROM productos
WHERE unidad_medida IS NOT NULL AND TRIM(unidad_medida) != '';

UPDATE productos
SET unidad_medida_id = (SELECT id FROM unidades_medida WHERE unidades_medida.nombre = TRIM(productos.unidad_medida))
WHERE unidad_medida IS NOT NULL AND TRIM(unidad_medida) != '';
