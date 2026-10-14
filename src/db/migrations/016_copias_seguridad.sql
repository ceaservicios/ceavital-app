-- EST-01, Fase 4 (la de CEAVital-Central del 2026-10-11, portada el 2026-10-14): copias de seguridad de la base (metodo DaleFit).
-- Aditiva: tabla nueva. Una fila por copia (automatica o pedida desde el panel); nunca se borra.
-- Las tablas viejas backups_historial (001) y backup_corridas (006) son de la epoca de CEAVital
-- y no se usan: quedan como estan.
--   estado    en_curso | ok | error
--   manual    true = la pidio el superadmin ("Respaldar ahora"); false = la automatica del dia
--   archivo   nombre del .dump subido a Drive (solo si salio bien)
--   detalle   que paso (tamano, copias viejas borradas de Drive, o el error)
CREATE TABLE copias_seguridad (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  estado TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'ok', 'error')),
  manual BOOLEAN NOT NULL,
  archivo TEXT,
  bytes BIGINT,
  detalle TEXT,
  iniciada_en TIMESTAMP(0) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  terminada_en TIMESTAMP(0)
);
-- Nunca corren dos a la vez: solo puede haber una fila en curso (vale tambien con dos contenedores).
CREATE UNIQUE INDEX idx_copias_una_en_curso ON copias_seguridad ((TRUE)) WHERE estado = 'en_curso';
CREATE INDEX idx_copias_iniciada ON copias_seguridad (iniciada_en DESC);
