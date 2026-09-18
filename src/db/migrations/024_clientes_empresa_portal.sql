-- Portal del cliente-empresa (pedido del usuario 2026-09-18): el cliente entra
-- con su propio usuario y contraseña a ver su cuenta corriente. Migración
-- aditiva: solo agrega columnas y una tabla, no toca ni borra nada existente.

-- Credenciales del portal, en la propia ficha del cliente. Nunca se expone
-- portal_password_hash por la API (las lecturas eligen columnas explícitas).
-- portal_habilitado permite cortar el acceso sin borrar el usuario ni la
-- contraseña (regla del proyecto: nada se borra físicamente).
ALTER TABLE clientes_empresa ADD COLUMN portal_usuario TEXT;
ALTER TABLE clientes_empresa ADD COLUMN portal_password_hash TEXT;
ALTER TABLE clientes_empresa ADD COLUMN portal_habilitado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clientes_empresa ADD COLUMN portal_intentos_fallidos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clientes_empresa ADD COLUMN portal_bloqueado_hasta DATETIME;
ALTER TABLE clientes_empresa ADD COLUMN portal_ultimo_acceso DATETIME;

-- Backstop de unicidad (la validación con mensaje de negocio vive en el
-- servicio): dos clientes activos no pueden compartir usuario de portal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_empresa_portal_usuario
  ON clientes_empresa(portal_usuario COLLATE NOCASE)
  WHERE portal_usuario IS NOT NULL AND eliminado_en IS NULL;

-- Sesiones del portal. Separadas de sesiones_activas a propósito: aquella
-- aplica "una sesión por rol" a los usuarios internos; un cliente puede tener
-- más de una sesión abierta (celular y PC) y jamás debe poder confundirse con
-- una sesión interna.
CREATE TABLE IF NOT EXISTS sesiones_cliente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_empresa_id INTEGER NOT NULL REFERENCES clientes_empresa(id),
  token TEXT NOT NULL UNIQUE,
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'cerrada')),
  motivo_cierre TEXT,
  iniciada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultima_actividad DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrada_en DATETIME
);

CREATE INDEX IF NOT EXISTS idx_sesiones_cliente_cliente
  ON sesiones_cliente(cliente_empresa_id, estado);
