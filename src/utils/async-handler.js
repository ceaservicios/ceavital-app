/**
 * Wrapper estandar de Express 4 para handlers async: Express 4 (a diferencia
 * de Express 5) no espera la promesa devuelta por un handler `async`, asi que
 * un `throw`/reject dentro de uno sin este wrapper se convierte en un
 * unhandled promise rejection -- que en Node >=15 tumba el proceso entero en
 * vez de terminar en errorHandler como un 500 controlado.
 *
 * No agrega dependencias (no hace falta express-async-errors ni migrar a
 * Express 5): alcanza con capturar el reject y pasarlo a next().
 */
export function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
