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

// El portal del cliente tiene su propia sesión: un 401 ahí (contraseña
// incorrecta, sesión vencida) lo maneja la pantalla del portal, no debe
// tratarse como "se venció la sesión interna".
function esRutaDelPortal(path) {
  return path.startsWith('/portal');
}

// Lo mismo para el panel del superadmin (/sa): sesión y cookie propias; su pantalla
// decide qué hacer con un 401. Además toda petición que modifica algo lleva el token
// CSRF de esa sesión (lo entrega el servidor en /sa/login y /sa/me), solo en memoria.
function esRutaDelSuperadmin(path) {
  return path === '/sa' || path.startsWith('/sa/');
}

let csrfSuperadmin = null;
export function setCsrfSuperadmin(token) {
  csrfSuperadmin = token;
}

function encabezados(path, method, conCuerpo) {
  const h = {};
  if (conCuerpo) h['Content-Type'] = 'application/json';
  if (esRutaDelSuperadmin(path) && method !== 'GET' && csrfSuperadmin) h['X-CSRF-Token'] = csrfSuperadmin;
  return Object.keys(h).length ? h : undefined;
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include', // manda/recibe la cookie httpOnly de sesion
    headers: encabezados(path, method, Boolean(body)),
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && !esRutaDelPortal(path) && !esRutaDelSuperadmin(path)) {
      onUnauthorized?.();
    }
    throw new ApiError(data?.error || 'Ocurrió un error inesperado', res.status);
  }

  return data;
}

// Descarga de un archivo (PDF, etc.): devuelve { blob, nombre }. Aparte de
// request() porque esa siempre espera JSON. Mantiene el mismo manejo de 401.
async function descargar(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: encabezados(path, method, Boolean(body)),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    if (res.status === 401 && !esRutaDelPortal(path) && !esRutaDelSuperadmin(path)) onUnauthorized?.();
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : null;
    throw new ApiError(data?.error || 'No se pudo descargar el archivo', res.status);
  }

  const nombre = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] ?? 'descarga';
  return { blob: await res.blob(), nombre };
}

export const api = {
  descargar,
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
};
