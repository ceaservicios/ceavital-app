-- Combos: un producto por renglón, con su precio en la promo (pedidos del usuario sobre la maqueta,
-- 2026-11-01: "Saca eso de marca que valen. Y ahí deberíamos poner el precio por pack o unidad según
-- esté cargado el producto"; "No debe cambiar el valor en el sistema. Por algo es promo... El stock
-- sí, pero precio no"). Cada renglón lleva su precio (por unidad, kg o litro, o por pack), que vale
-- solo para el combo: el precio del producto no cambia. El precio del combo es la suma de sus
-- renglones (combos.service.js → listarCombos); combos.precio queda sin uso desde acá.
ALTER TABLE combo_renglones ADD COLUMN precio BIGINT CHECK (precio >= 0 AND precio <= 1000000000);
ALTER TABLE combos ALTER COLUMN precio DROP NOT NULL;

-- Renglones con varias marcas: queda la primera que se cargó; las demás, baja lógica.
UPDATE combo_renglon_productos rp
SET eliminado_en = (NOW() AT TIME ZONE 'UTC')
WHERE rp.eliminado_en IS NULL
  AND EXISTS (
    SELECT 1 FROM combo_renglon_productos otra
    WHERE otra.renglon_id = rp.renglon_id AND otra.eliminado_en IS NULL AND otra.id < rp.id
  );

-- Cada renglón se llama como su producto (el nombre ya no se edita).
UPDATE combo_renglones r
SET nombre = LEFT(p.nombre, 60)
FROM combo_renglon_productos rp
JOIN productos p ON p.id = rp.producto_id
WHERE rp.renglon_id = r.id AND rp.eliminado_en IS NULL;

-- El precio de cada combo que ya estaba se reparte entre sus renglones en proporción a su precio
-- normal, así el combo sigue saliendo lo mismo (salvo el redondeo de cada renglón). Sin precio normal
-- para repartir, cada renglón queda con el precio normal de su forma.
WITH normal AS (
  SELECT r.id, r.combo_id,
         COALESCE(CASE WHEN r.presentacion = 'pack' THEN p.precio_pack ELSE p.precio_venta END, 0) AS precio_normal,
         CASE WHEN r.presentacion = 'pack' THEN r.cantidad * COALESCE(p.precio_pack, 0)
              ELSE ROUND(r.cantidad * p.precio_venta::numeric / CASE WHEN p.medida IN ('kg', 'litro') THEN 1000 ELSE 1 END)
         END AS subtotal_normal
  FROM combo_renglones r
  JOIN combo_renglon_productos rp ON rp.renglon_id = r.id AND rp.eliminado_en IS NULL
  JOIN productos p ON p.id = rp.producto_id
  WHERE r.eliminado_en IS NULL
),
sumas AS (
  SELECT combo_id, SUM(subtotal_normal) AS suma FROM normal GROUP BY combo_id
)
UPDATE combo_renglones r
SET precio = LEAST(
  CASE WHEN s.suma > 0 AND c.precio IS NOT NULL THEN ROUND(n.precio_normal * c.precio::numeric / s.suma) ELSE n.precio_normal END,
  1000000000
)
FROM normal n
JOIN sumas s ON s.combo_id = n.combo_id
JOIN combos c ON c.id = n.combo_id
WHERE r.id = n.id;

UPDATE combo_renglones SET precio = 0 WHERE precio IS NULL;
ALTER TABLE combo_renglones ALTER COLUMN precio SET NOT NULL;
