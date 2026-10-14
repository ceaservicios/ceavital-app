-- EST-01, Fase 3 (la de CEAVital-Central del 2026-10-11, portada el 2026-10-14): los mails salen en cola, con reintentos (§10.3).
-- Aditiva: tabla nueva. Cada mail se guarda aca y lo manda services/cola-correo.service.js. Al
-- terminar (enviado, fallido o descartado) se vacian asunto, texto y html, que pueden llevar una
-- contrasena o un codigo. La fila nunca se borra: queda como historial para el panel.
--   canal            empresa (SMTP_*, el correo del cliente) | cea (SA_SMTP_*, el correo de CEA)
--   tipo             que mail es (codigo, cuenta-admin, acceso-portal, aviso-cuota, alerta-seguridad...)
--   estado           pendiente | enviado | fallido (agoto los reintentos) | descartado (vencio antes
--                    de salir, o su correo dejo de estar configurado)
--   proximo_intento  cuando toca mandarlo (o reintentarlo)
--   vence_en         despues de esto ya no sirve (un codigo de ingreso dura 10 minutos)
CREATE TABLE correos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canal TEXT NOT NULL CHECK (canal IN ('empresa', 'cea')),
  tipo TEXT NOT NULL,
  para TEXT NOT NULL,
  asunto TEXT,
  texto TEXT,
  html TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'fallido', 'descartado')),
  intentos INTEGER NOT NULL DEFAULT 0,
  ultimo_error TEXT,
  proximo_intento TIMESTAMP(0) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  vence_en TIMESTAMP(0),
  creado_en TIMESTAMP(0) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  terminado_en TIMESTAMP(0)
);
CREATE INDEX idx_correos_pendientes ON correos (proximo_intento) WHERE estado = 'pendiente';
CREATE INDEX idx_correos_canal ON correos (canal, id DESC);
