CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL COLLATE NOCASE,
  eliminado_en DATETIME,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- COLLATE NOCASE: evita que "Kg" y "kg" convivan como 2 categorias distintas
-- (el problema real que motivo este catalogo -- antes era texto libre sin
-- ningun control, ver Docs/Modelo-de-Datos.md).
CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_nombre_activo
  ON categorias(nombre) WHERE eliminado_en IS NULL;
