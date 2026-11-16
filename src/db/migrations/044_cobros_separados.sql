-- En Central también es la migración 044.
-- La implementacion y el abono pasan a ser dos cobros separados (pedido del usuario, 2026-11-09: el
-- aviso del mes estaba atado a un unico vencimiento, y con la cuota de la implementacion del 26/10 sin
-- anotar nunca salia el mail del abono del 10/11). Cada cuota de la implementacion vence en su fecha
-- y tiene su aviso y su pago; el abono (con las modificaciones con costo) sigue la serie de
-- instancia.cuota_vence, con su aviso y su pago. La suspension cuenta desde el pago mas viejo sin pagar.
-- Aditiva: una columna nueva en `pagos_cuota` y otra en `cuota_avisos`, la restriccion unica de
-- `cuota_avisos` suma el concepto, y el vencimiento del abono se acomoda si quedo antes de su primer
-- abono. No borra ningun dato.

-- Que paga cada pago. Los de antes pagaban el aviso unico: si su foto trae solo la cuota de la
-- implementacion (sin abono ni modificaciones), es de la implementacion; si no, es del abono (los de
-- pesos tambien, que no tienen foto).
ALTER TABLE pagos_cuota ADD COLUMN concepto TEXT NOT NULL DEFAULT 'abono' CHECK (concepto IN ('abono', 'implementacion'));
UPDATE pagos_cuota SET concepto = 'implementacion'
WHERE desglose IS NOT NULL
  AND jsonb_typeof(desglose -> 'implementacion') = 'object'
  AND COALESCE(jsonb_typeof(desglose -> 'abono'), 'null') = 'null'
  AND COALESCE(CASE WHEN jsonb_typeof(desglose -> 'modificaciones') = 'array' THEN jsonb_array_length(desglose -> 'modificaciones') END, 0) = 0;

-- De que cobro es cada aviso por mail. Los de antes eran del aviso unico: los de un vencimiento de un
-- mes anterior al del primer abono solo podian llevar la implementacion y quedan como suyos, asi la
-- revision horaria no le repite a la empresa un aviso que ya le llego.
ALTER TABLE cuota_avisos ADD COLUMN concepto TEXT NOT NULL DEFAULT 'abono' CHECK (concepto IN ('abono', 'implementacion'));
UPDATE cuota_avisos SET concepto = 'implementacion'
WHERE cuota_vence < (SELECT date_trunc('month', abono_desde)::date FROM instancia WHERE id = 1);

-- Un aviso por cobro, por etapa y por vencimiento (antes, por etapa y vencimiento: la cuota y el abono
-- pueden vencer el mismo dia). Se busca por catalogo, como en la 011, para no depender del nombre que
-- Postgres le puso en la 003. El indice unico de correo_id (042) no es una restriccion y queda.
DO $$
DECLARE
  restriccion TEXT;
BEGIN
  FOR restriccion IN
    SELECT conname FROM pg_constraint WHERE conrelid = 'cuota_avisos'::regclass AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE cuota_avisos DROP CONSTRAINT %I', restriccion);
  END LOOP;
END $$;
ALTER TABLE cuota_avisos ADD CONSTRAINT cuota_avisos_concepto_tipo_vence UNIQUE (concepto, tipo, cuota_vence);

-- El abono arranca en su primer vencimiento: si el vencimiento del abono quedo en un mes anterior (lo
-- habia corrido a la cuota de la implementacion la regla del 2026-10-26), pasa a esa fecha, con su
-- dia como dia fijo. No se toca si ya hay un pago del abono de ese mes o posterior.
UPDATE instancia
SET cuota_vence = abono_desde, cuota_dia_vence = EXTRACT(DAY FROM abono_desde)::smallint, actualizado_en = CURRENT_TIMESTAMP
WHERE id = 1
  AND abono_desde IS NOT NULL
  AND cuota_vence IS NOT NULL
  AND date_trunc('month', cuota_vence) < date_trunc('month', abono_desde)
  AND NOT EXISTS (
    SELECT 1 FROM pagos_cuota
    WHERE anulado_en IS NULL AND concepto = 'abono' AND periodo_desde >= date_trunc('month', instancia.abono_desde)::date
  );
