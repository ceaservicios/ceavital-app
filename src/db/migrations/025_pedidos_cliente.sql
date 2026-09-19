-- B2B Fase 2: pedidos de los clientes-empresa (los arma el cliente desde su
-- portal, el negocio los aprueba o rechaza). Distinto de pedidos_proveedor
-- (008), que son las compras del negocio a sus proveedores.
--
-- Un pedido 'pendiente' RESERVA stock: no descuenta ningun lote, pero Caja y el
-- portal ven el stock disponible menos lo reservado (stock_reservado se calcula
-- sumando los items de los pendientes, nunca es una columna). Al aprobar se
-- genera una venta 'cta_cte' (descuenta lotes FEFO y carga la deuda), y
-- venta_id apunta a ella. Aditiva: no toca ninguna tabla existente.
CREATE TABLE IF NOT EXISTS pedidos_cliente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_empresa_id INTEGER NOT NULL REFERENCES clientes_empresa(id),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'cancelado')),
  total INTEGER NOT NULL DEFAULT 0,
  observaciones TEXT,
  motivo_rechazo TEXT,
  venta_id INTEGER REFERENCES ventas(id),
  resuelto_por INTEGER REFERENCES usuarios(id),
  resuelto_en DATETIME,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_cliente ON pedidos_cliente(cliente_empresa_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_estado ON pedidos_cliente(estado);

-- precio_unitario queda congelado al momento de pedir: es el que se factura al
-- aprobar aunque el precio del producto cambie mientras tanto.
CREATE TABLE IF NOT EXISTS pedido_cliente_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos_cliente(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario INTEGER NOT NULL,
  subtotal INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedido_cliente_items_pedido ON pedido_cliente_items(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_cliente_items_producto ON pedido_cliente_items(producto_id);
