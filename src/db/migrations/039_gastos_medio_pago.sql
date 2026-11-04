-- En Central es la migración 041.
-- Medio de pago de cada gasto (pedido del usuario, 2026-11-03: "en gastos, poder poner medio de pago.
-- Mercado Pago, efectivo etc."; eligió Efectivo, Mercado Pago, Transferencia, Tarjeta y Cheque). Solo
-- los gastos en efectivo salen de la caja y se descuentan del arqueo del turno; los demás quedan
-- anotados sin tocar el efectivo. Los gastos de antes, y los pagos a proveedores y de Saldos
-- pendientes que salen de la caja, son en efectivo (el valor por defecto).
-- Aditiva: una columna con valor por defecto.
ALTER TABLE gastos_caja ADD COLUMN medio_pago TEXT NOT NULL DEFAULT 'efectivo'
  CHECK (medio_pago IN ('efectivo', 'mercado_pago', 'transferencia', 'tarjeta', 'cheque'));
