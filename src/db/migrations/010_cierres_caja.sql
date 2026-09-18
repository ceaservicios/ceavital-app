CREATE TABLE IF NOT EXISTS cierres_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  fecha DATE NOT NULL,
  total_efectivo_esperado INTEGER NOT NULL,
  total_efectivo_contado INTEGER NOT NULL,
  diferencia_efectivo INTEGER NOT NULL,
  total_tarjeta INTEGER NOT NULL,
  total_transferencia_qr INTEGER NOT NULL,
  total_mercado_pago INTEGER NOT NULL,
  total_fiado INTEGER NOT NULL,
  total_general INTEGER NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
