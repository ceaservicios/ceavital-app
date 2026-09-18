CREATE TABLE IF NOT EXISTS sesiones_activas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  rol TEXT NOT NULL CHECK (rol IN ('admin', 'encargado', 'cajero')),
  token TEXT NOT NULL UNIQUE,
  estado TEXT NOT NULL CHECK (estado IN ('activa', 'cerrada')) DEFAULT 'activa',
  motivo_cierre TEXT CHECK (motivo_cierre IN ('logout', 'expulsada', 'timeout')),
  iniciada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultima_actividad DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrada_en DATETIME
);

-- Lock de concurrencia a nivel de base de datos: nunca dos sesiones "activa"
-- con el mismo rol al mismo tiempo (refuerza el lock que valida la app).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_activas_rol_activa
  ON sesiones_activas(rol) WHERE estado = 'activa';

CREATE INDEX IF NOT EXISTS idx_sesiones_activas_usuario ON sesiones_activas(usuario_id);
