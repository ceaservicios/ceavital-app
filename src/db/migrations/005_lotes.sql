CREATE TABLE IF NOT EXISTS lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL,
  fecha_ingreso DATE NOT NULL,
  fecha_vencimiento DATE,
  eliminado_en DATETIME,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lotes_producto ON lotes(producto_id);

-- Soporta la eleccion FEFO (vencimiento mas proximo, FIFO como desempate)
-- sin tener que escanear todos los lotes de un producto.
CREATE INDEX IF NOT EXISTS idx_lotes_fefo ON lotes(producto_id, fecha_vencimiento, fecha_ingreso);
