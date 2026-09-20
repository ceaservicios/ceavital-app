import db from '../db/connection.js';

// Seguro contra el peor error posible: apuntar la app de backups a la base de PRODUCCIÓN.
// Restaurar un backup para verificarlo VACÍA las tablas del negocio, así que solo se acepta una
// base que (a) está vacía (recién creada, ceavital-bd-bkps) o (b) ya fue marcada como base de
// verificación por esta misma app. La tabla marca no viaja en los backups, así que sobrevive
// a cada restauración. La producción nunca la tiene y, con datos, se rechaza.
export async function asegurarBaseDeVerificacion() {
  const { existe } = await db.prepare(`SELECT to_regclass('public.bkps_marca') IS NOT NULL AS existe`).get();
  if (existe) return;

  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM usuarios').get();
  if (n > 0) {
    throw new Error(
      'DATABASE_URL apunta a una base con datos que no es una base de verificación (parece la de PRODUCCIÓN). ' +
        'La app de backups tiene que usar ceavital-bd-bkps, una base vacía y propia. No se hizo nada.'
    );
  }
  await db.exec(`CREATE TABLE bkps_marca (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    creada_en TIMESTAMP(0) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
  )`);
  await db.prepare('INSERT INTO bkps_marca (id) VALUES (1)').run();
  console.log('[bkps] base de verificación marcada');
}
