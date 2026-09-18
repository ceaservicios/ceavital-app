CREATE TABLE IF NOT EXISTS pedidos_proveedor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  estado TEXT NOT NULL CHECK (estado IN ('realizado', 'pendiente', 'recibido', 'cancelado')),
  fecha DATE NOT NULL,
  eliminado_en DATETIME,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pedidos_proveedor_proveedor ON pedidos_proveedor(proveedor_id);
