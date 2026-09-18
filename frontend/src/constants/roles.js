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

/**
 * Permisos de navegación por modulo. Fuente de verdad: la matriz de permisos
 * real (Docs/Resumen-Ejecutivo.md), NO el Sidebar del mockup original -- ese
 * mockup se armó antes de que el modulo Proveedores quedara definido como
 * "Cajero sin ningun acceso, ni Ver" (confirmado 2026-09-10), asi que el
 * mockup deja Proveedores habilitado para los 3 roles. Acá se corrige para
 * reflejar la regla real.
 */
export function puedeVerModulo(modulo, rol) {
  if (modulo === 'costos' || modulo === 'usuarios') return rol === 'admin';
  if (modulo === 'proveedores') return rol === 'admin' || rol === 'encargado';
  return true;
}
