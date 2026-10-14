-- Restaurar una copia de seguridad desde el panel /sa (pedido del usuario, 2026-10-11). Aditiva:
-- tabla nueva y una restriccion que se relaja (no cambia ni borra ningun dato).
--   estado          en_curso | ok | error
--   fase            validando | resguardo | descargando | restaurando | terminada
--   archivo_id      id del .dump en Google Drive; archivo = su nombre
--   resguardo       nombre de la copia de como estaba todo justo antes (el "deshacer")
--   esquema_previo  donde quedo la base anterior, dentro de la misma base (nunca se borra)
--   migraciones     las que se aplicaron porque la copia era de una version anterior
--   cambios_admins  que Administradores cambiaron con la copia (para mostrarlo en el panel)
CREATE TABLE restauraciones (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  estado TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'ok', 'error')),
  fase TEXT NOT NULL DEFAULT 'validando' CHECK (fase IN ('validando', 'resguardo', 'descargando', 'restaurando', 'terminada')),
  archivo_id TEXT NOT NULL,
  archivo TEXT NOT NULL,
  resguardo TEXT,
  esquema_previo TEXT,
  migraciones TEXT[] NOT NULL DEFAULT '{}',
  cambios_admins JSONB,
  superadmin_id INTEGER,
  superadmin TEXT,
  ip TEXT,
  detalle TEXT,
  iniciada_en TIMESTAMP(0) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  terminada_en TIMESTAMP(0)
);
-- Nunca dos restauraciones a la vez.
CREATE UNIQUE INDEX idx_restauraciones_una_en_curso ON restauraciones ((TRUE)) WHERE estado = 'en_curso';
CREATE INDEX idx_restauraciones_iniciada ON restauraciones (iniciada_en DESC);

-- El codigo de verificacion que confirma una restauracion tiene su propio proposito: no sirve
-- para ingresar ni para configurar el 2FA (y al reves).
ALTER TABLE codigos_ingreso DROP CONSTRAINT codigos_ingreso_proposito_check;
ALTER TABLE codigos_ingreso ADD CONSTRAINT codigos_ingreso_proposito_check
  CHECK (proposito IN ('ingreso', 'configurar', 'restaurar'));
