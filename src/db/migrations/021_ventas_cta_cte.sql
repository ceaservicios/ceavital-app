-- Amplia medio_pago para aceptar 'cta_cte' (venta a cuenta corriente de un
-- Cliente-Empresa real, con ledger -- decision confirmada con el usuario:
-- distinto y separado de 'fiado', que sigue siendo la venta fiada informal
-- sin cliente ni ledger) y agrega cliente_empresa_id (nullable a nivel de
-- esquema, obligatorio a nivel de servicio solo cuando medio_pago='cta_cte').
--
-- SQLite no permite alterar un CHECK constraint con ALTER TABLE -- exige
-- reconstruir la tabla. ventas es tabla padre de venta_items (con filas
-- reales de produccion) y PRAGMA foreign_keys esta siempre en ON
-- (connection.js): con eso activo, DROP TABLE dispara un DELETE implicito
-- que viola esa FK. El runner (migrate.js) ahora togglea el pragma fuera de
-- la transaccion antes/despues de cada archivo -- procedimiento de 12 pasos
-- que documenta SQLite para cambios de esquema no soportados por ALTER
-- TABLE. Probada primero contra una copia de la base real antes de
-- aplicarla (mismo criterio que la migracion 016).
CREATE TABLE ventas_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  medio_pago TEXT NOT NULL CHECK (
    medio_pago IN ('efectivo', 'tarjeta', 'transferencia_qr', 'mercado_pago', 'fiado', 'cta_cte')
  ),
  cliente_empresa_id INTEGER REFERENCES clientes_empresa(id),
  total INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('registrada', 'anulada')) DEFAULT 'registrada',
  anulada_por INTEGER REFERENCES usuarios(id),
  anulada_en DATETIME,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO ventas_new (id, usuario_id, medio_pago, cliente_empresa_id, total, estado, anulada_por, anulada_en, creado_en)
SELECT id, usuario_id, medio_pago, NULL, total, estado, anulada_por, anulada_en, creado_en
FROM ventas;

DROP TABLE ventas;
ALTER TABLE ventas_new RENAME TO ventas;

CREATE INDEX IF NOT EXISTS idx_ventas_usuario ON ventas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_ventas_creado_en ON ventas(creado_en);
CREATE INDEX IF NOT EXISTS idx_ventas_cliente_empresa ON ventas(cliente_empresa_id);
