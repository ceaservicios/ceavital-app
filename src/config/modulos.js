// Módulos de CEAVital y planes fijos. Única fuente de verdad: el backend (rutas y
// medios de pago) y el frontend (menú y pantallas) salen de acá, vía /api/modulos.
//
// Cada instalación es una empresa (clon completo de la app) con UN plan, que
// determina qué módulos están activos. Un módulo apagado se oculta y sus rutas
// responden 404; sus datos nunca se borran (Docs/Planes-y-Superadmin.md §2).

// detalle: lo que incluye cada módulo, para mostrar los planes en el panel del superadmin. Solo
// lo que el sistema hace de verdad (ver Docs/Instructivo-Funcional.md).
export const MODULOS = {
  nucleo: {
    nombre: 'Gestión del comercio',
    dependeDe: [],
    detalle: [
      'Caja y punto de venta con lector de código de barras: efectivo, tarjeta, transferencia o QR, Mercado Pago y pago pendiente',
      'Stock con lotes, vencimientos y aviso de stock bajo',
      'Proveedores y pedidos a proveedores',
      'Cierre de caja con fondo, gastos y diferencia',
      'Costos y márgenes',
      'Usuarios por rol: Administrador, Encargado y Cajero',
      'Configuración de categorías y unidades de medida',
    ],
  },
  clientes_empresa: {
    nombre: 'Clientes-Empresa y cuenta corriente',
    dependeDe: ['nucleo'],
    detalle: [
      'Fichas de clientes-empresa con su cuenta corriente',
      'Venta en cuenta corriente desde la Caja',
      'Pagos, ajustes y resumen de cuenta en PDF',
      'Condiciones de pago',
    ],
  },
  pedidos: {
    nombre: 'Pedidos de clientes',
    dependeDe: ['clientes_empresa'],
    detalle: [
      'El pedido del cliente reserva el stock hasta aprobarlo o rechazarlo',
      'Al aprobarlo se genera la venta en cuenta corriente, al precio del pedido',
    ],
  },
  portal: {
    nombre: 'Portal del cliente',
    dependeDe: ['pedidos'],
    detalle: [
      'El cliente entra a su cuenta: saldo, movimientos y resumen en PDF',
      'Compra desde el catálogo, con precio y stock disponible',
    ],
  },
};

// Nombres comerciales confirmados por el usuario (2026-10-01), los mismos de
// Docs/Planes-y-Precios.md. El id ("comercio"/"empresas") es el valor guardado en
// configuracion.plan: no se cambia sin migrar ese valor. Cambiar un nombre acá es
// lo único necesario: nada más en el código nombra un plan.
export const PLANES = {
  comercio: { nombre: 'Plan Comercio', modulos: ['nucleo'] },
  empresas: { nombre: 'Plan Empresa', modulos: ['nucleo', 'clientes_empresa', 'pedidos', 'portal'] },
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
