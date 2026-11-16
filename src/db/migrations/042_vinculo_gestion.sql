-- En Central es la migración 028.
-- Vinculo con CEA Servicios - Gestion (2026-10-24): Gestion le consulta a esta instalacion la cuota y
-- los avisos de cuota, con si cada mail salio o fallo (vinculo.service.js, GET /api/vinculo/estado).
-- Aditiva: una columna nueva en `cuota_avisos`; no cambia ni borra ningun dato.
--
-- correo_id: el mail de la cola (`correos`) que lleva ese aviso. De ahi sale si salio, si sigue
--   pendiente o si fallo. Sin FK a proposito: `cuota_avisos` y `correos` no vuelven atras al
--   restaurar una copia (las dos estan en PRESERVADAS), y una FK solo complicaria ese paso.
ALTER TABLE cuota_avisos ADD COLUMN correo_id BIGINT;
CREATE UNIQUE INDEX idx_cuota_avisos_correo ON cuota_avisos (correo_id) WHERE correo_id IS NOT NULL;

-- Los avisos de antes: el aviso y su mail se guardaron en la misma transaccion (avisos-cuota.service
-- > revisarCuota), asi que tienen la misma hora (NOW() es la del inicio de la transaccion) y el mismo
-- destinatario. Si dos avisos cayeron en el mismo segundo (dos transacciones seguidas), se emparejan
-- por orden de alta: cada transaccion anota el aviso y encola su mail, en ese orden.
WITH avisos AS (
  SELECT id, destinatario, enviado_en,
         ROW_NUMBER() OVER (PARTITION BY destinatario, enviado_en ORDER BY id) AS n
  FROM cuota_avisos
),
mails AS (
  SELECT id, para, creado_en,
         ROW_NUMBER() OVER (PARTITION BY para, creado_en ORDER BY id) AS n
  FROM correos
  WHERE tipo = 'aviso-cuota'
)
UPDATE cuota_avisos SET correo_id = mails.id
FROM avisos JOIN mails ON mails.para = avisos.destinatario AND mails.creado_en = avisos.enviado_en AND mails.n = avisos.n
WHERE cuota_avisos.id = avisos.id;
