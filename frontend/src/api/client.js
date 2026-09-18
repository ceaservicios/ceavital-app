const BASE = '/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// AuthContext se registra acá para enterarse cuando CUALQUIER llamada (no solo
// la hidratación inicial de /auth/me) devuelve 401 -- ej. la sesión vence por
// inactividad mientras el usuario ya está usando una pantalla. Sin esto, una
// acción a mitad de uso (confirmar una venta, un cierre de caja) fallaba con
// un error generico ("No autenticado") en vez de mandar al usuario a loguearse
// de nuevo. /auth/login queda afuera: un 401 ahi es "contraseña incorrecta",
// no "se venció la sesión", y ya lo maneja LoginPage por su cuenta.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include', // manda/recibe la cookie httpOnly de sesion
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') {
      onUnauthorized?.();
    }
    throw new ApiError(data?.error || 'Ocurrió un error inesperado', res.status);
  }

  return data;
}

// Descarga de un archivo (PDF, etc.): devuelve { blob, nombre }. Aparte de
// request() porque esa siempre espera JSON. Mantiene el mismo manejo de 401.
async function descargar(path) {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' });

  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : null;
    throw new ApiError(data?.error || 'No se pudo descargar el archivo', res.status);
  }

  const nombre = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] ?? 'descarga.pdf';
  return { blob: await res.blob(), nombre };
}

export const api = {
  descargar,
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
};
