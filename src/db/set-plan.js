import db from './connection.js';
import { runMigrations } from './migrate.js';
import { PLANES } from '../config/modulos.js';
import { cambiarPlan } from '../services/modulos.service.js';

const plan = process.argv[2];

try {
  if (!plan) {
    console.error(`Uso: npm run set-plan -- <plan>   (planes: ${Object.keys(PLANES).join(', ')})`);
    process.exitCode = 1;
  } else {
    await runMigrations();
    await cambiarPlan(plan);
    console.log(`[plan] la instalación quedó en el plan "${plan}" (módulos: ${PLANES[plan].modulos.join(', ')})`);
  }
} catch (err) {
  console.error(`[plan] ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.cerrar();
}
