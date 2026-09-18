CREATE TABLE IF NOT EXISTS gastos_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  concepto TEXT NOT NULL,
  monto INTEGER NOT NULL,
  proveedor_id INTEGER REFERENCES proveedores(id),
  eliminado_en DATETIME,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gastos_caja_creado_en ON gastos_caja(creado_en);
CREATE INDEX IF NOT EXISTS idx_gastos_caja_proveedor ON gastos_caja(proveedor_id);
