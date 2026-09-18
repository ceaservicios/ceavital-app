CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  medio_pago TEXT NOT NULL CHECK (
    medio_pago IN ('efectivo', 'tarjeta', 'transferencia_qr', 'mercado_pago', 'fiado')
  ),
  total INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('registrada', 'anulada')) DEFAULT 'registrada',
  anulada_por INTEGER REFERENCES usuarios(id),
  anulada_en DATETIME,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ventas_usuario ON ventas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_ventas_creado_en ON ventas(creado_en);
