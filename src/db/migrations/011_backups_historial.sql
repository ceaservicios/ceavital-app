CREATE TABLE IF NOT EXISTS backups_historial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  destino TEXT NOT NULL CHECK (destino IN ('local', 'usb', 'nube')),
  estado TEXT NOT NULL CHECK (estado IN ('exito', 'error')),
  tamano_bytes INTEGER,
  mensaje_error TEXT,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
