-- Dolar blue venta del dia y equivalente en pesos del aviso (decision del usuario, 2026-10-21;
-- regla de precios de CEA: los precios van en dolares y el equivalente en pesos se calcula con el
-- dolar blue venta del dia). La cotizacion se consulta sola (dolar-blue.service.js: DolarApi y, de
-- respaldo, Bluelytics) y aca se guarda la ultima valida. Cada pago puede anotar ademas lo que se
-- pago en pesos y a que cotizacion.
-- Aditiva: columnas nuevas en `instancia` y `pagos_cuota`; no cambia ni borra ningun dato.
--
-- Cotizacion en centavos de peso (INTEGER): de 100 a 100.000.000 ($ 1 a $ 1.000.000).

-- Ultima cotizacion valida: en `instancia` (una sola fila, de CEA, que no vuelve atras al restaurar
-- una copia; ver la 026). blue_fecha: el momento de la cotizacion segun la fuente; blue_consultado_en:
-- cuando se la consulto (de ahi salen la cache de 30 minutos y la regla "solo la del mismo dia").
-- Los dos en UTC, como todo el sistema.
ALTER TABLE instancia ADD COLUMN blue_venta_cent INTEGER CHECK (blue_venta_cent BETWEEN 100 AND 100000000);
ALTER TABLE instancia ADD COLUMN blue_fecha TIMESTAMP(0);
ALTER TABLE instancia ADD COLUMN blue_fuente TEXT CHECK (blue_fuente IN ('DolarApi', 'Bluelytics'));
ALTER TABLE instancia ADD COLUMN blue_consultado_en TIMESTAMP(0);
ALTER TABLE instancia ADD CONSTRAINT instancia_blue_completa CHECK (
  (blue_venta_cent IS NULL AND blue_fecha IS NULL AND blue_fuente IS NULL AND blue_consultado_en IS NULL)
  OR (blue_venta_cent IS NOT NULL AND blue_fecha IS NOT NULL AND blue_fuente IS NOT NULL AND blue_consultado_en IS NOT NULL)
);

-- Pagos: opcionalmente, cuanto se pago en pesos (enteros, con el mismo tope que el resto de los
-- montos en pesos del sistema) y la cotizacion del dolar blue que se uso. Van los dos o ninguno, y
-- solo en los pagos en dolares (los de antes del 2026-10-21 ya son en pesos).
ALTER TABLE pagos_cuota ADD COLUMN pesos_pagados BIGINT CHECK (pesos_pagados BETWEEN 1 AND 1000000000);
ALTER TABLE pagos_cuota ADD COLUMN cotizacion_blue_cent INTEGER CHECK (cotizacion_blue_cent BETWEEN 100 AND 100000000);
ALTER TABLE pagos_cuota ADD CONSTRAINT pagos_cuota_pesos_completo CHECK ((pesos_pagados IS NULL) = (cotizacion_blue_cent IS NULL));
ALTER TABLE pagos_cuota ADD CONSTRAINT pagos_cuota_pesos_solo_usd CHECK (pesos_pagados IS NULL OR moneda = 'USD');
