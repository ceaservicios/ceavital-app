-- Importe de la cuota mensual de CEA (pedido del usuario, 2026-10-14): lo carga el superadmin en
-- /sa > Cuota y pagos y sale en los avisos de cuota por mail. NULL = sin cargar (el aviso no
-- muestra importe). Pesos enteros, como todos los montos. Aditiva: no cambia ningun dato.
ALTER TABLE instancia ADD COLUMN cuota_monto BIGINT CHECK (cuota_monto BETWEEN 1 AND 1000000000);
