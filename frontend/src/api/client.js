const BASE = '/api';

export class ApiError extends Error {
  constructor(message, status, codigo = null) {
    super(message);
    this.status = status;
    this.codigo = codigo;
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

// La cuenta tiene algo que resolver antes de seguir (contraseña provisoria, Admin sin verificación
// en dos pasos): el servidor responde 403 con codigo CUENTA_PENDIENTE y AuthContext manda a "Mi cuenta".
let onPendiente = null;
export function setPendienteHandler(fn) {
  onPendiente = fn;
}

// El ingreso (contraseña y código por mail): un 401 ahí es "dato incorrecto", no "se venció
// la sesión"; lo maneja LoginPage.
function esRutaDeIngreso(path) {
  return path === '/auth/login' || path.startsWith('/auth/codigo');
}

// El portal del cliente tiene su propia sesión: un 401 ahí (contraseña
// incorrecta, sesión vencida) lo maneja la pantalla del portal, no debe
// tratarse como "se venció la sesión interna".
function esRutaDelPortal(path) {
  return path.startsWith('/portal');
}

// La sesión del portal se cerró porque entró un tercer equipo con el mismo usuario (codigo
// SESION_OTRO_EQUIPO): se guarda el texto para que el ingreso del portal lo muestre en un
// cartel, venga de la pantalla que venga. Solo en esta pestaña; si el navegador no deja
// guardarlo, el ingreso aparece sin cartel.
const CLAVE_AVISO_PORTAL = 'ceavital.avisoPortal';

function guardarAvisoPortal(texto) {
  try {
    sessionStorage.setItem(CLAVE_AVISO_PORTAL, texto);
  } catch {
    // sin almacenamiento: no hay cartel
  }
}

export function tomarAvisoPortal() {
  try {
    const texto = sessionStorage.getItem(CLAVE_AVISO_PORTAL);
    if (texto) sessionStorage.removeItem(CLAVE_AVISO_PORTAL);
    return texto;
  } catch {
    return null;
  }
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
    if (res.status === 401 && !esRutaDeIngreso(path) && !esRutaDelPortal(path) && !esRutaDelSuperadmin(path)) {
      onUnauthorized?.();
    }
    if (res.status === 401 && esRutaDelPortal(path) && data?.codigo === 'SESION_OTRO_EQUIPO') guardarAvisoPortal(data.error);
    if (res.status === 403 && data?.codigo === 'CUENTA_PENDIENTE') onPendiente?.(data.pendiente);
    throw new ApiError(data?.error || 'Ocurrió un error inesperado', res.status, data?.codigo ?? null);
  }

  return data;
}

// Descarga de un archivo (PDF, etc.): devuelve { blob, nombre }. Aparte de
// request() porque esa siempre espera JSON. Mantiene el mismo manejo de 401.
async function descargar(path) {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' });

  if (!res.ok) {
    if (res.status === 401 && !esRutaDelPortal(path)) onUnauthorized?.();
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
