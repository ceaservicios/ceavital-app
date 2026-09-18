-- Total del dia en medio_pago='cta_cte' (B2B), foto guardada en el cierre --
-- mismo patron exacto que total_fiado y que la migracion 018 (fondo_dejado/
-- fondo_heredado/total_gastos): ADD COLUMN aditivo, sin tocar el CHECK de
-- ninguna otra tabla.
ALTER TABLE cierres_caja ADD COLUMN total_cta_cte INTEGER NOT NULL DEFAULT 0;
