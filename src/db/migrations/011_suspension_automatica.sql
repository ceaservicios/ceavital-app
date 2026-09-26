-- Suspension automatica por cuota impaga (decision del usuario, 2026-09-26). Aditiva: columnas
-- nuevas en `instancia` y dos tipos nuevos de aviso por mail; no cambia ningun dato existente.
--
-- cuota_suspender_dias: la instalacion se suspende sola cuando la cuota lleva esos dias vencida
--   (NULL = nunca se suspende sola, como hasta ahora).
-- cuota_aviso_suspension_dias: cuantos dias antes de esa suspension sale UN mail avisando que la
--   cuota vencio y en que fecha se suspende (0 = sin aviso previo).
-- suspension_por_cuota: la suspension vigente la hizo el sistema por la cuota (anotar el pago la
--   levanta sola); una suspension manual no.
-- suspension_auto_vence: vencimiento por el que ya se suspendio sola una vez. Si CEA la reactiva a
--   mano sin anotar el pago (una prorroga), no se vuelve a suspender sola por ese mismo vencimiento.
ALTER TABLE instancia ADD COLUMN cuota_suspender_dias INTEGER CHECK (cuota_suspender_dias BETWEEN 1 AND 365);
ALTER TABLE instancia ADD COLUMN cuota_aviso_suspension_dias INTEGER NOT NULL DEFAULT 0
  CHECK (cuota_aviso_suspension_dias BETWEEN 0 AND 365);
ALTER TABLE instancia ADD COLUMN suspension_por_cuota BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE instancia ADD COLUMN suspension_auto_vence DATE;

-- Tipos nuevos de aviso (uno por vencimiento, igual que los anteriores): el previo a la suspension
-- y el de la suspension. Se reemplaza el CHECK del tipo por uno que los incluye (se busca por
-- catalogo para no depender del nombre que Postgres le puso al crearlo en la 003).
DO $$
DECLARE
  restriccion TEXT;
BEGIN
  FOR restriccion IN
    SELECT conname FROM pg_constraint WHERE conrelid = 'cuota_avisos'::regclass AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE cuota_avisos DROP CONSTRAINT %I', restriccion);
  END LOOP;
END $$;
ALTER TABLE cuota_avisos ADD CONSTRAINT cuota_avisos_tipo_check
  CHECK (tipo IN ('por_vencer', 'vence_hoy', 'vencida', 'suspension_proxima', 'suspendida'));
