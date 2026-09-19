export const ROL_LABEL = {
  admin: 'Administrador',
  encargado: 'Encargado',
  cajero: 'Cajero',
};

export function etiquetaRol(rol) {
  return ROL_LABEL[rol] ?? rol;
}

export function iniciales(nombre) {
  if (!nombre) return '';
  return nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((palabra) => palabra[0].toUpperCase())
    .join('');
}

// Ítems de menú/rutas que pertenecen a un módulo opcional del plan. Un módulo
// apagado se oculta por completo (no se muestra bloqueado); ver src/config/modulos.js
// del backend.
const MODULO_DEL_PLAN = {
  'clientes-empresa': 'clientes_empresa',
  'pedidos-cliente': 'pedidos',
};

export function moduloDisponible(modulo, modulosActivos) {
  const requerido = MODULO_DEL_PLAN[modulo];
  return !requerido || Boolean(modulosActivos?.includes(requerido));
}

/**
 * Permisos de navegación por modulo. Fuente de verdad: la matriz de permisos
 * real (Docs/Resumen-Ejecutivo.md), NO el Sidebar del mockup original -- ese
 * mockup se armó antes de que el modulo Proveedores quedara definido como
 * "Cajero sin ningun acceso, ni Ver" (confirmado 2026-09-10), asi que el
 * mockup deja Proveedores habilitado para los 3 roles. Acá se corrige para
 * reflejar la regla real.
 */
export function puedeVerModulo(modulo, rol) {
  if (modulo === 'costos' || modulo === 'usuarios' || modulo === 'configuracion') return rol === 'admin';
  // Clientes-Empresa (B2B Fase 1): mismo criterio que Proveedores -- el
  // Cajero no tiene acceso al módulo (ni Ver). Igual puede ELEGIR un cliente
  // al vender en Caja con "Cuenta Corriente": eso usa GET /clientes-empresa,
  // que el backend deja abierto a los 3 roles solo para armar ese selector.
  if (modulo === 'proveedores' || modulo === 'clientes-empresa' || modulo === 'pedidos-cliente') return rol === 'admin' || rol === 'encargado';
  return true;
}
