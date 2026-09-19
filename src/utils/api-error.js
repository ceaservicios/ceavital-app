// Convención del proyecto (desde el módulo Stock): los servicios lanzan
// ApiError(status, mensaje) para errores esperables (validación, 404, 409,
// 403 de negocio); error.middleware.js ya expone err.status/err.message tal
// cual para 4xx. Los controllers son async (la base es PostgreSQL) y
// express-async-errors (importado en server.js) manda cualquier throw o
// rechazo de un handler async a errorHandler.
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
