-- FK reales a los catalogos nuevos (corregido 2026-09-15: antes
-- productos.categoria/unidad_medida eran texto libre sin ningun control).
-- Nullable a nivel de esquema (SQLite no permite agregar una columna NOT NULL
-- sin default sobre una tabla con filas existentes) -- la app exige
-- unidad_medida_id en la validacion de servicio, categoria_id sigue siendo
-- opcional (igual que lo era el texto libre). Las columnas viejas
-- (productos.categoria/unidad_medida) quedan en el esquema sin tocar --
-- nunca se hacen migraciones destructivas -- y la app las sigue escribiendo
-- en espejo del nombre de la FK (stock.service.js) porque unidad_medida
-- tiene NOT NULL desde la migracion 004 y no se puede relajar con un ALTER
-- simple; las lecturas, en cambio, siempre van por JOIN contra estas tablas
-- nuevas, nunca por las columnas viejas.
ALTER TABLE productos ADD COLUMN categoria_id INTEGER REFERENCES categorias(id);
ALTER TABLE productos ADD COLUMN unidad_medida_id INTEGER REFERENCES unidades_medida(id);

CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_productos_unidad_medida ON productos(unidad_medida_id);
