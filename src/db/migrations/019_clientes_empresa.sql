-- B2B Fase 1: clientes-empresa (razon social, datos fiscales/contacto,
-- condicion de pago, soft delete) -- ver Docs/Modelo-de-Datos.md > "Modulo
-- B2B Cliente-Empresa" (Fase 0, ya definido) y Tarea/auditoria.md > RETOMAR
-- AQUI para el detalle de fases.
CREATE TABLE IF NOT EXISTS clientes_empresa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  razon_social TEXT NOT NULL,
  cuit TEXT,
  contacto_nombre TEXT,
  telefono TEXT,
  email TEXT,
  direccion TEXT,
  condicion_pago TEXT,
  eliminado_en DATETIME,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backstop de unicidad a nivel de esquema (mismo criterio que
-- productos.codigo_barras) -- la validacion real, con el mensaje de error de
-- negocio, vive en el servicio.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_empresa_cuit
  ON clientes_empresa(cuit)
  WHERE cuit IS NOT NULL AND eliminado_en IS NULL;
