-- Mail de contacto del negocio (pedido del usuario, 2026-10-14): sale con los demas datos al pie de
-- los mails a los clientes del portal y a los usuarios, y en el resumen de cuenta en PDF.
-- Aditiva: columna nueva.
ALTER TABLE datos_negocio ADD COLUMN email TEXT CHECK (char_length(email) <= 100 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
-- (En Central se completa con la casilla del deposito; aca queda vacio, lo carga el Administrador.)
