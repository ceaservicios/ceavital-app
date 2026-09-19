import db from './connection.js';
import { runMigrations } from './migrate.js';
import { restaurarBackup } from '../services/backup-completo.service.js';

// Restaura un backup completo (.ceavbak, el que se descarga del panel del superadmin) en la
// base de ESTA instalación. REEMPLAZA los datos del negocio (productos, ventas, clientes,
// usuarios, caja...): todo o nada, si algo falla no se toca nada. No toca la cuenta del
// superadmin. La contraseña del backup va en BACKUP_PASSWORD (nunca como argumento).
//   BACKUP_PASSWORD=... npm run restaurar-backup -- ruta/al/archivo.ceavbak --confirmar
// Para pasar los datos a otra app: crear la instalación nueva (que arranque una vez para
// crear el esquema) y correr esto en ella. Sin --confirmar solo se explica lo que haría.

const [archivo, ...opciones] = process.argv.slice(2);

try {
  if (!archivo) throw new Error('Falta la ruta del archivo .ceavbak');
  if (!opciones.includes('--confirmar')) {
    console.log(`Esto REEMPLAZA los datos del negocio de la base actual con los de ${archivo}.`);
    console.log('Si estás seguro, repetí el comando agregando --confirmar');
  } else {
    await runMigrations();
    const r = await restaurarBackup(archivo, process.env.BACKUP_PASSWORD);
    const filas = Object.values(r.tablas).reduce((a, b) => a + b, 0);
    console.log(`[backup] restaurado: backup del ${r.creado_en} (app ${r.version}), ${Object.keys(r.tablas).length} tablas, ${filas} filas.`);
  }
} catch (err) {
  console.error(`[backup] ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.cerrar();
}
