-- Corregido 2026-09-15: dejar un monto "fondo" al cerrar para el turno/dia
-- siguiente. fondo_dejado = lo que ESTE cierre deja para el proximo (elegido
-- por quien cierra); fondo_heredado/total_gastos = lo que este cierre ya
-- tenia sumado/restado en su propio total_efectivo_esperado, guardado aca
-- para que la foto del cierre sea auto-explicativa (mismo criterio que el
-- resto de la tabla: nunca se recalcula despues).
ALTER TABLE cierres_caja ADD COLUMN fondo_dejado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cierres_caja ADD COLUMN fondo_heredado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cierres_caja ADD COLUMN total_gastos INTEGER NOT NULL DEFAULT 0;
