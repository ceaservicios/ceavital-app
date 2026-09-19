// Módulos de CEAVital y planes fijos. Única fuente de verdad: el backend (rutas y
// medios de pago) y el frontend (menú y pantallas) salen de acá, vía /api/modulos.
//
// Cada instalación es una empresa (clon completo de la app) con UN plan, que
// determina qué módulos están activos. Un módulo apagado se oculta y sus rutas
// responden 404; sus datos nunca se borran (Docs/Planes-y-Superadmin.md §2).

export const MODULOS = {
  nucleo: { nombre: 'Núcleo', dependeDe: [] },
  clientes_empresa: { nombre: 'Clientes-Empresa y cuenta corriente', dependeDe: ['nucleo'] },
  pedidos: { nombre: 'Pedidos de clientes', dependeDe: ['clientes_empresa'] },
  portal: { nombre: 'Portal del cliente', dependeDe: ['pedidos'] },
};

// Contenido y nombres a confirmar con el usuario (2026-09-19). Cambiarlos acá es
// lo único necesario: nada más en el código nombra un plan.
export const PLANES = {
  comercio: { nombre: 'Comercio', modulos: ['nucleo'] },
  empresas: { nombre: 'Empresas', modulos: ['nucleo', 'clientes_empresa', 'pedidos', 'portal'] },
};

// Plan de una instalación que todavía no tiene ninguno guardado. Es "empresas"
// para que la instalación de hoy (app.ceavital.net, que es la demo) siga con todo
// activo al desplegar esto; una instalación nueva se clona y se le fija el plan
// contratado (npm run set-plan, y desde el superadmin cuando exista).
export const PLAN_POR_DEFECTO = 'empresas';

// Un plan nunca puede quedar con un módulo sin sus dependencias.
for (const [idPlan, plan] of Object.entries(PLANES)) {
  for (const modulo of plan.modulos) {
    if (!MODULOS[modulo]) throw new Error(`Plan "${idPlan}": módulo desconocido "${modulo}"`);
    for (const dependencia of MODULOS[modulo].dependeDe) {
      if (!plan.modulos.includes(dependencia)) {
        throw new Error(`Plan "${idPlan}": "${modulo}" requiere "${dependencia}"`);
      }
    }
  }
}

export const MEDIOS_PAGO_BASE = ['efectivo', 'tarjeta', 'transferencia_qr', 'mercado_pago', 'fiado'];
