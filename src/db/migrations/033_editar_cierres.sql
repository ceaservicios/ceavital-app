-- Editar y eliminar cierres de caja, solo el Administrador (pedido del usuario, 2026-10-31; traído de
-- Central el mismo día, donde es la 035).
-- Eliminar es una baja lógica: el cierre deja de contar y, como es siempre el último, sus ventas y
-- gastos vuelven al turno abierto. Editar corrige lo que se cargó a mano (efectivo contado y fondo
-- dejado); queda quién y cuándo, y el antes y el después en el registro de acciones.
-- Aditiva: columnas nuevas, vacías en los cierres que ya existen.
ALTER TABLE cierres_caja ADD COLUMN eliminado_en TIMESTAMP(0);
ALTER TABLE cierres_caja ADD COLUMN eliminado_por INTEGER REFERENCES usuarios(id);
ALTER TABLE cierres_caja ADD COLUMN editado_en TIMESTAMP(0);
ALTER TABLE cierres_caja ADD COLUMN editado_por INTEGER REFERENCES usuarios(id);
