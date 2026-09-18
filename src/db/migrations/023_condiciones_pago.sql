-- Catalogo de Condiciones de pago (pedido del usuario 2026-09-18): antes
-- clientes_empresa.condicion_pago era texto libre; ahora se elige de un
-- catalogo que el Admin gestiona en Configuracion (mismo esquema que
-- categorias/unidades_medida, ver 013/014).
CREATE TABLE IF NOT EXISTS condiciones_pago (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL COLLATE NOCASE,
  eliminado_en DATETIME,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_condiciones_pago_nombre_activo
  ON condiciones_pago(nombre) WHERE eliminado_en IS NULL;

-- FK real (nullable: la condicion de pago sigue siendo opcional). La columna
-- de texto vieja (condicion_pago) queda en el esquema sin tocar -- nunca se
-- hacen migraciones destructivas -- pero la app ya no la escribe ni la lee:
-- las lecturas resuelven el nombre por JOIN contra el catalogo.
ALTER TABLE clientes_empresa ADD COLUMN condicion_pago_id INTEGER REFERENCES condiciones_pago(id);
CREATE INDEX IF NOT EXISTS idx_clientes_empresa_condicion_pago ON clientes_empresa(condicion_pago_id);

-- Backfill unico (mismo criterio que la 016): una fila de catalogo por cada
-- texto distinto que ya existe (incluye clientes eliminados, para no perder
-- la condicion de un cliente con historial). INSERT OR IGNORE + NOCASE del
-- catalogo fusiona "30 dias" / "30 DIAS" en una sola fila.
INSERT OR IGNORE INTO condiciones_pago (nombre)
SELECT DISTINCT TRIM(condicion_pago) FROM clientes_empresa
WHERE condicion_pago IS NOT NULL AND TRIM(condicion_pago) != '';

UPDATE clientes_empresa
SET condicion_pago_id = (SELECT id FROM condiciones_pago WHERE condiciones_pago.nombre = TRIM(clientes_empresa.condicion_pago))
WHERE condicion_pago IS NOT NULL AND TRIM(condicion_pago) != '';
