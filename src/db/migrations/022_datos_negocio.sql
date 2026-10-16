-- Datos del negocio para los mails que manda el sistema a sus usuarios y a los clientes del portal
-- (pedido del usuario, 2026-10-14): nombre, telefono, direccion e Instagram, al pie de cada mail
-- junto al logo del negocio. Los carga el Administrador en Configuracion > Datos del negocio.
-- Tabla propia de una sola fila (no en `configuracion`): son datos del negocio, asi que una
-- restauracion los trae con la copia. Aditiva.
CREATE TABLE datos_negocio (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nombre TEXT NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 100),
  telefono TEXT CHECK (char_length(telefono) <= 40),
  direccion TEXT CHECK (char_length(direccion) <= 200),
  instagram TEXT CHECK (instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  actualizado_en TIMESTAMP(0) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- Esta instalacion (app.ceavital.net) usa la marca de CEAVital (logo en
-- frontend/public/logo-negocio.png). Un clon carga los datos de su negocio desde Configuracion.
-- (En Central esta fila arranca con los datos de Mayorista Central.)
INSERT INTO datos_negocio (id, nombre) VALUES (1, 'CEAVital');
