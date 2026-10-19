-- Verificacion en dos pasos apagada para un Administrador (decision del usuario, 2026-10-19): el
-- superadmin la puede deshabilitar o volver a habilitar desde /sa, Admin por Admin. Desactivada,
-- el Admin entra solo con la contrasena, no tiene nada configurado y no la puede activar desde
-- "Mi cuenta". Aparta al proyecto de EST-01 §4 (la pide obligatoria para el Admin).
-- Solo vale para rol = 'admin': Encargados y Cajeros siguen con su dos_fa (lo maneja el Admin).
-- Aditiva: columna nueva. Los Admins existentes quedan en FALSE, con la verificacion obligatoria
-- como hasta ahora.
ALTER TABLE usuarios ADD COLUMN dosfa_desactivada BOOLEAN NOT NULL DEFAULT FALSE;
