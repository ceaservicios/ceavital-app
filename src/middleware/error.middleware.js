import { ApiError } from '../utils/api-error.js';

// Errores de PostgreSQL que son un problema del dato enviado (no del servidor):
// se responden como 4xx con un mensaje para el usuario en vez de un 500.
const ERRORES_DE_DATOS = {
  '23505': [409, 'Ya existe un registro con esos datos'], // unique_violation
  '23503': [409, 'El registro está relacionado con otros datos o hace referencia a algo que no existe'], // foreign_key_violation
  '23502': [400, 'Falta un dato requerido'], // not_null_violation
  '23514': [400, 'Un dato no cumple las reglas permitidas'], // check_violation
  '22003': [400, 'Un valor numérico está fuera del rango permitido'], // numeric_value_out_of_range
  '22P02': [400, 'Un dato tiene un formato inválido'], // invalid_text_representation
  '22007': [400, 'Una fecha tiene un formato inválido'], // invalid_datetime_format
  '22008': [400, 'Una fecha está fuera de rango'], // datetime_field_overflow
  '22001': [400, 'Un texto es demasiado largo'], // string_data_right_truncation
};

export function errorHandler(err, req, res, next) {
  console.error(err);

  // JSON roto: el mensaje de body-parser es técnico ("Unexpected token } in JSON..."),
  // se reemplaza por uno pensado para el usuario.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El pedido llegó con un formato inválido' });
  }

  const errorDeDatos = ERRORES_DE_DATOS[err.code];
  if (errorDeDatos && !(err instanceof ApiError)) {
    return res.status(errorDeDatos[0]).json({ error: errorDeDatos[1] });
  }

  // Respetar el status que ya trae el error (ej. body-parser de Express
  // devuelve err.status = 400 ante JSON malformado) en vez de aplanar todo
  // a 500. Para errores 4xx el mensaje del propio err es seguro de exponer
  // (son errores de input del cliente); para 5xx nunca se expone err.message
  // para no filtrar detalles internos.
  const status = err.status || err.statusCode || 500;
  // ApiError = error que el propio código lanzó a propósito con un mensaje pensado
  // para el usuario (ej. 503 "el envío de mails no está configurado"); esos se
  // exponen aunque sean 5xx. Cualquier otro 5xx (una excepción inesperada) nunca.
  const mensaje = (status >= 400 && status < 500) || err instanceof ApiError ? err.message : 'Error interno del servidor';

  res.status(status).json({ error: mensaje || 'Error interno del servidor' });
}
