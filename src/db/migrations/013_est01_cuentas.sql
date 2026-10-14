-- EST-01, Fase 1 (la de CEAVital-Central del 2026-10-10, portada el 2026-10-14): verificacion en dos pasos obligatoria para el
-- superadmin y los Admin del negocio, contrasena provisoria y tope de clientes con acceso al portal.
-- Aditiva: columnas nuevas y restricciones que se relajan; no cambia ni borra ningun dato.

-- Verificacion en dos pasos (EST-01 §4), la misma en `usuarios` y en `superadmin`:
--   dosfa_metodo        'app' (codigo de una app autenticadora, TOTP) o 'mail'; NULL = sin configurar
--   dosfa_secreto       secreto TOTP cifrado (AES-256-GCM con la clave DOSFA_CLAVE)
--   dosfa_secreto_nuevo el que se esta configurando, hasta confirmarlo con un codigo
--   dosfa_ultimo_paso   ultimo paso de 30 s aceptado: el mismo codigo no sirve dos veces
--   dosfa_codigos       hashes de los codigos de recuperacion (cada uno sirve una sola vez)
ALTER TABLE usuarios ADD COLUMN debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN ultimo_acceso TIMESTAMP(0);
ALTER TABLE usuarios ADD COLUMN dosfa_metodo TEXT CHECK (dosfa_metodo IN ('app', 'mail'));
ALTER TABLE usuarios ADD COLUMN dosfa_secreto TEXT;
ALTER TABLE usuarios ADD COLUMN dosfa_secreto_nuevo TEXT;
ALTER TABLE usuarios ADD COLUMN dosfa_ultimo_paso BIGINT;
ALTER TABLE usuarios ADD COLUMN dosfa_codigos TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE superadmin ADD COLUMN dosfa_metodo TEXT CHECK (dosfa_metodo IN ('app', 'mail'));
ALTER TABLE superadmin ADD COLUMN dosfa_secreto TEXT;
ALTER TABLE superadmin ADD COLUMN dosfa_secreto_nuevo TEXT;
ALTER TABLE superadmin ADD COLUMN dosfa_ultimo_paso BIGINT;
ALTER TABLE superadmin ADD COLUMN dosfa_codigos TEXT[] NOT NULL DEFAULT '{}';

-- Segundo paso del ingreso: ahora tambien del superadmin y tambien por app. Cada fila es de un
-- usuario del negocio o del superadmin (nunca de los dos). metodo 'app' no guarda codigo (lo da la
-- app); proposito 'configurar' = el codigo para confirmar el 2FA por mail desde "Mi cuenta", que no
-- sirve para ingresar (y al reves).
ALTER TABLE codigos_ingreso ALTER COLUMN usuario_id DROP NOT NULL;
ALTER TABLE codigos_ingreso ALTER COLUMN codigo_hash DROP NOT NULL;
ALTER TABLE codigos_ingreso ALTER COLUMN enviado_a DROP NOT NULL;
ALTER TABLE codigos_ingreso ADD COLUMN superadmin_id INTEGER REFERENCES superadmin(id);
ALTER TABLE codigos_ingreso ADD COLUMN metodo TEXT NOT NULL DEFAULT 'mail' CHECK (metodo IN ('mail', 'app'));
ALTER TABLE codigos_ingreso ADD COLUMN proposito TEXT NOT NULL DEFAULT 'ingreso' CHECK (proposito IN ('ingreso', 'configurar'));
ALTER TABLE codigos_ingreso ADD CONSTRAINT codigos_ingreso_una_cuenta CHECK ((usuario_id IS NULL) <> (superadmin_id IS NULL));
CREATE INDEX idx_codigos_ingreso_superadmin ON codigos_ingreso (superadmin_id) WHERE superadmin_id IS NOT NULL;

-- Navegadores de confianza (una vez por semana): tambien del superadmin. Olvidarlos es vencerlos
-- (expira_en = ahora), nunca borrarlos.
ALTER TABLE dispositivos_2fa ALTER COLUMN usuario_id DROP NOT NULL;
ALTER TABLE dispositivos_2fa ADD COLUMN superadmin_id INTEGER REFERENCES superadmin(id);
ALTER TABLE dispositivos_2fa ADD CONSTRAINT dispositivos_2fa_una_cuenta CHECK ((usuario_id IS NULL) <> (superadmin_id IS NULL));
CREATE UNIQUE INDEX idx_dispositivos_2fa_superadmin ON dispositivos_2fa (superadmin_id, dispositivo_hash)
  WHERE superadmin_id IS NOT NULL;

-- Tope de clientes con acceso al portal (EST-01 §3: "incluidos los clientes finales con acceso").
-- NULL = todavia sin cargar: no se le puede habilitar el acceso a ningun cliente nuevo.
ALTER TABLE instancia ADD COLUMN cupo_portal INTEGER CHECK (cupo_portal BETWEEN 0 AND 99999);
