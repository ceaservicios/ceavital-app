// Colores del estilo "panel protagonista" (2026-10-29): uno por medio de pago (sobre blanco y,
// más claro, sobre el panel verde) y una paleta para los íconos con iniciales de las listas.

export const COLOR_MEDIO = {
  efectivo: '#1f8f66',
  tarjeta: '#2d6cdf',
  transferencia_qr: '#6b4bd8',
  mercado_pago: '#0891b2',
  fiado: '#e09a00',
  cta_cte: '#c03d86',
};

export const COLOR_MEDIO_CLARO = {
  efectivo: '#9fe0c0',
  tarjeta: '#a9c2f5',
  transferencia_qr: '#c9b8ff',
  mercado_pago: '#8fdcf0',
  fiado: '#f3c043',
  cta_cte: '#f5a3cf',
};

export const ICONO_MEDIO = {
  efectivo: 'billete',
  tarjeta: 'tarjeta',
  transferencia_qr: 'qr',
  mercado_pago: 'celular',
  fiado: 'reloj',
  cta_cte: 'ticket',
};

const PALETA = ['#2d6cdf', '#0f8b7d', '#e4662c', '#6b4bd8', '#c03d86', '#0891b2', '#e09a00'];

// Pestañas e íconos de fila (2026-10-29): el mismo concepto lleva el mismo color en todo el sistema.
export const COLOR = {
  verde: '#1f8f66',
  azul: '#2d6cdf',
  naranja: '#e4662c',
  teal: '#0f8b7d',
  violeta: '#6b4bd8',
  rosa: '#c03d86',
  cian: '#0891b2',
  ambar: '#e09a00',
  rojo: '#c13d48',
  gris: '#6b7570',
};

/** Ícono y color por estado de pago de una compra o pedido. */
export const ICONO_ESTADO = {
  pagada: { icono: 'check', color: COLOR.verde },
  parcial: { icono: 'mitad', color: COLOR.azul },
  impaga: { icono: 'reloj', color: COLOR.ambar },
  anulada: { icono: 'menos', color: COLOR.gris },
};

/** Ícono y color por estado de un pedido de cliente. */
export const ICONO_PEDIDO = {
  pendiente: { icono: 'reloj', color: COLOR.ambar },
  aprobado: { icono: 'check', color: COLOR.verde },
  rechazado: { icono: 'alerta', color: COLOR.rojo },
  cancelado: { icono: 'menos', color: COLOR.gris },
};

/** Ícono y color por medio de pago a un proveedor o de una cuenta. */
export const ICONO_MEDIO_PAGO = {
  efectivo: { icono: 'billete', color: COLOR_MEDIO.efectivo },
  mercado_pago: { icono: 'celular', color: COLOR_MEDIO.mercado_pago },
  cheque: { icono: 'banco', color: COLOR.violeta },
  transferencia: { icono: 'qr', color: COLOR_MEDIO.transferencia_qr },
  debito: { icono: 'repetir', color: COLOR.teal },
  tarjeta: { icono: 'tarjeta', color: COLOR_MEDIO.tarjeta },
};

/** Color fijo para un id (proveedor, cliente, usuario): siempre el mismo para el mismo id. */
export function colorDe(id) {
  return PALETA[Math.abs(Number(id) || 0) % PALETA.length];
}
