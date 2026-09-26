-- El codigo de barras de un producto no distingue mayusculas (decision del usuario, 2026-09-26):
-- "abc123" y "ABC123" son el mismo codigo. Se suma un indice unico sobre LOWER(codigo_barras),
-- solo entre los productos activos, y se deja el indice anterior (el de la migracion 001) como
-- esta: es aditiva, no borra ni modifica ningun dato. Mismo criterio que la 007 con los usuarios.
--
-- Si la base ya tiene dos productos activos cuyos codigos solo se diferencian en mayusculas, el
-- indice no se puede crear: la migracion aborta con un mensaje claro (y no cambia nada). Como la
-- app no arranca mientras tanto, la salida es volver a desplegar el commit anterior, corregir o
-- eliminar uno de cada par desde Stock y desplegar de nuevo.
DO $$
DECLARE
  repetidos TEXT;
BEGIN
  SELECT string_agg(c, ', ') INTO repetidos FROM (
    SELECT LOWER(codigo_barras) AS c FROM productos
    WHERE codigo_barras IS NOT NULL AND eliminado_en IS NULL
    GROUP BY LOWER(codigo_barras) HAVING COUNT(*) > 1
  ) d;

  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay productos activos con codigos de barras que solo se diferencian en mayusculas (%). Corregi o elimina uno de cada par y volve a arrancar.', repetidos;
  END IF;
END $$;

CREATE UNIQUE INDEX idx_productos_codigo_barras_lower_activo ON productos (LOWER(codigo_barras))
  WHERE codigo_barras IS NOT NULL AND eliminado_en IS NULL;
