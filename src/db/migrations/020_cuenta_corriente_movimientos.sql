-- Ledger insert-only de la cuenta corriente de cada cliente-empresa -- nunca
-- hay una columna de saldo editable a mano, el saldo siempre se calcula
-- sumando estos movimientos (mismo criterio que stock_total/stock_vendible).
-- Sin eliminado_en/actualizado_en a proposito: una fila mal cargada se
-- corrige con un AJUSTE nuevo, nunca se edita ni se borra.
CREATE TABLE IF NOT EXISTS cuenta_corriente_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_empresa_id INTEGER NOT NULL REFERENCES clientes_empresa(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('CARGO', 'PAGO', 'AJUSTE')),
  monto INTEGER NOT NULL,
  descripcion TEXT,
  venta_id INTEGER REFERENCES ventas(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ccm_cliente_empresa ON cuenta_corriente_movimientos(cliente_empresa_id);
CREATE INDEX IF NOT EXISTS idx_ccm_venta ON cuenta_corriente_movimientos(venta_id);
