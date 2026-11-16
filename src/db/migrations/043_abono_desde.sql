-- En Central es la migración 029.
-- El abono puede arrancar despues que la implementacion (pedido del usuario, 2026-10-26: "quiero que
-- abone la implementacion ahora y el abono el 10"). instancia.abono_desde es el vencimiento del primer
-- abono: los avisos de los meses anteriores salen sin abono y, al pagar el ultimo de ellos, el
-- vencimiento pasa solo a esa fecha (pagos-cuota.service). NULL = el abono va desde el primer aviso,
-- como hasta ahora.
-- Aditiva: columnas nuevas en `instancia` y `pagos_cuota`; no cambia ni borra ningun dato.

-- En `instancia`, como el resto del abono (ver la 026): no vuelve atras al restaurar una copia.
ALTER TABLE instancia ADD COLUMN abono_desde DATE;
ALTER TABLE instancia ADD CONSTRAINT instancia_abono_desde CHECK (abono_desde IS NULL OR abono_usd IS NOT NULL);

-- El dia fijo de vencimiento que habia antes del pago (NULL si no habia vencimiento cargado). Si el
-- pago paso el vencimiento a la fecha del primer abono, con otro dia, anularlo devuelve los dos.
ALTER TABLE pagos_cuota ADD COLUMN dia_vence_anterior SMALLINT CHECK (dia_vence_anterior BETWEEN 1 AND 31);
