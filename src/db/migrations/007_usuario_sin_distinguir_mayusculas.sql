-- El usuario de un negocio no distingue mayusculas (mismo criterio que el superadmin y el portal
-- del cliente): "admin_v" y "Admin_V" son la misma cuenta. Se suma un indice unico sobre
-- LOWER(usuario), solo entre los activos, y se deja el indice anterior (el de la migracion 001)
-- como esta: es aditiva, no borra ni modifica ningun dato.
--
-- Si la base ya tiene dos usuarios activos que solo se diferencian en mayusculas, el indice no
-- se puede crear: la migracion aborta con un mensaje claro (y no cambia nada) para que se
-- renombre o se elimine uno de los dos desde Usuarios y se vuelva a arrancar.
DO $$
DECLARE
  repetidos TEXT;
BEGIN
  SELECT string_agg(u, ', ') INTO repetidos FROM (
    SELECT LOWER(usuario) AS u FROM usuarios WHERE eliminado_en IS NULL GROUP BY LOWER(usuario) HAVING COUNT(*) > 1
  ) d;

  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay usuarios activos repetidos que solo se diferencian en mayusculas (%). Renombra o elimina uno de cada par y volve a arrancar.', repetidos;
  END IF;
END $$;

CREATE UNIQUE INDEX idx_usuarios_usuario_lower_activo ON usuarios (LOWER(usuario)) WHERE eliminado_en IS NULL;
