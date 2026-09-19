import { ApiError } from '../utils/api-error.js';
import * as backupsService from '../services/backups.service.js';

export async function listarHistorialController(req, res) {
  res.json({ historial: await backupsService.listarHistorial() });
}

export async function listarArchivosController(req, res) {
  const destino = req.query.destino;
  if (!destino) throw new ApiError(400, 'destino es requerido');
  res.json({ archivos: await backupsService.listarArchivosDestino(destino) });
}

export async function ejecutarBackupController(req, res) {
  const resultados = await backupsService.ejecutarBackup();
  res.status(201).json({ resultados });
}

// Confirmación explícita obligatoria (Docs/Instructivo-Funcional.md >
// Restauración): el body tiene que declarar `confirmar: true`, no alcanza con
// pegarle al endpoint. `requireLocalhost` ya filtró que la request venga de
// la PC servidor antes de llegar acá (ver routes/configuracion.routes.js).
export async function restaurarController(req, res) {
  const { destino, nombre_archivo, confirmar } = req.body || {};

  if (confirmar !== true) {
    throw new ApiError(400, 'Hace falta confirmar explícitamente la restauración (confirmar: true)');
  }

  const resultado = await backupsService.restaurarBackup({ destino, nombre_archivo });

  res.json({
    ...resultado,
    mensaje:
      'Restauración completada. El servidor se detiene para aplicar el cambio -- hay que volver a iniciarlo (npm start).',
  });

  // El archivo de base de datos ya fue reemplazado con la conexión cerrada
  // (ver backups.service.restaurarBackup) -- el proceso actual ya no puede
  // seguir sirviendo requests de forma segura. Se cierra después de que la
  // respuesta terminó de enviarse; reiniciarlo queda en manos de quien lo
  // opera (igual que el flujo de actualización ya documentado en CLAUDE.md).
  res.on('finish', () => {
    process.exit(0);
  });
}
