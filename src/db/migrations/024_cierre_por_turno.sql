-- Cierre de caja por turno (decision del usuario, 2026-10-16): cada cierre cuenta lo que paso
-- desde el cierre anterior, aunque sea del mismo dia. Se guarda hasta que venta y que gasto
-- entro en cada cierre, asi el turno siguiente arranca exacto (por id, no por hora: dos
-- movimientos del mismo segundo no se pierden ni se cuentan dos veces).
-- Aditiva: columnas nuevas. Los cierres anteriores quedan en NULL y el turno que sigue a uno de
-- ellos se cuenta por la hora de ese cierre (caja.service.condicionDelTurno).
ALTER TABLE cierres_caja ADD COLUMN hasta_venta_id INTEGER;
ALTER TABLE cierres_caja ADD COLUMN hasta_gasto_id INTEGER;
