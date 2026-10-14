// Respuesta del ingreso cuando falta el segundo paso (código de la app autenticadora o el que se
// acaba de mandar por mail). La comparten el ingreso del negocio y el del superadmin.
export function responderSegundoPaso(res, resultado) {
  res.set('Cache-Control', 'no-store');
  res.json({ requiere_codigo: true, desafio: resultado.desafio, metodo: resultado.metodo, email: resultado.email ?? null });
}
