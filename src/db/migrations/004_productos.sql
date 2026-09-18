CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  categoria TEXT,
  codigo_barras TEXT,
  precio_costo INTEGER NOT NULL,
  precio_venta INTEGER NOT NULL,
  unidad_medida TEXT NOT NULL,
  proveedor_id INTEGER REFERENCES proveedores(id),
  stock_minimo INTEGER NOT NULL DEFAULT 0,
  dias_aviso_vencimiento INTEGER,
  eliminado_en DATETIME,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unico entre productos activos con codigo de barras cargado (nullable: varios
-- productos sin codigo de barras no chocan entre si).
CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_codigo_barras_activo
  ON productos(codigo_barras) WHERE codigo_barras IS NOT NULL AND eliminado_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_productos_proveedor ON productos(proveedor_id);
