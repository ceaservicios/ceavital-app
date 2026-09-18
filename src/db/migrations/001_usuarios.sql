CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin', 'encargado', 'cajero')),
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta DATETIME,
  eliminado_en DATETIME,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unico entre usuarios activos: un login de un usuario dado de baja (soft
-- delete) puede reutilizarse por un empleado nuevo. Ver nota en Modelo-de-Datos.md.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_usuario_activo
  ON usuarios(usuario) WHERE eliminado_en IS NULL;
