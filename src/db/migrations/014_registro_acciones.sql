-- EST-01, Fase 2 (la de CEAVital-Central del 2026-10-11, portada el 2026-10-14): registro de acciones inmutable (§6).
-- La aplicacion solo inserta; la base rechaza cualquier UPDATE, DELETE o TRUNCATE. Aditiva.
--   actor_tipo  quien lo hizo: superadmin, usuario (del negocio), cliente (del portal) o sistema
--   actor       su mail/usuario o razon social en ese momento (queda aunque despues cambie)
--   categoria   ingreso | cuenta | instalacion | seguridad (para filtrar en el panel)
--   detalle     contexto en JSON; nunca contrasenas, tokens ni codigos
CREATE TABLE registro_acciones (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_en TIMESTAMP(0) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  actor_tipo TEXT NOT NULL CHECK (actor_tipo IN ('superadmin', 'usuario', 'cliente', 'sistema')),
  actor_id INTEGER,
  actor TEXT,
  rol TEXT,
  categoria TEXT NOT NULL CHECK (categoria IN ('ingreso', 'cuenta', 'instalacion', 'seguridad')),
  accion TEXT NOT NULL,
  detalle JSONB,
  ip TEXT
);
CREATE INDEX idx_registro_acciones_categoria ON registro_acciones (categoria, id DESC);

CREATE FUNCTION registro_acciones_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'registro_acciones es inmutable: no se permite %', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER registro_acciones_sin_cambios
  BEFORE UPDATE OR DELETE ON registro_acciones
  FOR EACH ROW EXECUTE FUNCTION registro_acciones_inmutable();

CREATE TRIGGER registro_acciones_sin_vaciar
  BEFORE TRUNCATE ON registro_acciones
  FOR EACH STATEMENT EXECUTE FUNCTION registro_acciones_inmutable();
