import db from '../db/connection.js';

// Registro de acciones inmutable (EST-01 §6): ingresos y salidas, bloqueos por intentos fallidos,
// altas, bajas y cambios de cuentas, contraseñas y verificación en dos pasos, y toda acción del
// superadmin. La base rechaza modificarlo o borrarlo (migración 014); acá solo se inserta. Nunca
// se guardan contraseñas, tokens ni códigos. Un fallo al registrar no corta la operación.

const fecha = (iso) => (iso ? String(iso).split('-').reverse().join('/') : 'sin fecha');
const METODO = { app: 'app autenticadora', mail: 'código por mail' };
const ROL = { admin: 'Administrador', encargado: 'Encargado', cajero: 'Cajero' };
const SEGUNDO_PASO = { app: 'con la app autenticadora', mail: 'con código por mail', recuperacion: 'con un código de recuperación' };
const MEDIO_PAGO = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia_qr: 'Transferencia / QR',
  mercado_pago: 'Mercado Pago',
  fiado: 'Fiado',
  cta_cte: 'Cuenta Corriente',
};

// accion -> categoría, título y cómo se lee el detalle en el panel.
const CATALOGO = {
  // Ingresos
  ingreso: {
    categoria: 'ingreso',
    titulo: 'Ingresó',
    detalle: (d) =>
      [d.segundo_paso && SEGUNDO_PASO[d.segundo_paso], d.sesion_anterior_cerrada && 'cerró su sesión abierta en otro dispositivo']
        .filter(Boolean)
        .join(' · '),
  },
  salida: { categoria: 'ingreso', titulo: 'Salió' },
  'cuenta-bloqueada': { categoria: 'ingreso', titulo: 'Cuenta bloqueada por intentos fallidos', detalle: (d) => d.cuenta ?? '' },

  // Cuentas
  'contrasena-cambiada': { categoria: 'cuenta', titulo: 'Cambió su contraseña' },
  'dosfa-activado': {
    categoria: 'cuenta',
    titulo: 'Activó la verificación en dos pasos',
    detalle: (d) => `${METODO[d.metodo] ?? d.metodo}${d.anterior ? ` (antes: ${METODO[d.anterior] ?? d.anterior})` : ''}`,
  },
  'codigos-regenerados': { categoria: 'cuenta', titulo: 'Generó códigos de recuperación nuevos' },
  'usuario-creado': { categoria: 'cuenta', titulo: 'Creó un usuario', detalle: (d) => `${d.usuario} · ${ROL[d.rol] ?? d.rol}` },
  'usuario-editado': {
    categoria: 'cuenta',
    titulo: 'Modificó un usuario',
    detalle: (d) => `${d.usuario}${d.cambios?.length ? ` · ${d.cambios.join(', ')}` : ''}`,
  },
  'usuario-eliminado': { categoria: 'cuenta', titulo: 'Dio de baja un usuario', detalle: (d) => d.usuario },
  'administrador-creado': { categoria: 'cuenta', titulo: 'Creó un Administrador', detalle: (d) => d.email },
  'administrador-contrasena': { categoria: 'cuenta', titulo: 'Contraseña provisoria nueva para un Administrador', detalle: (d) => d.email },
  'administrador-dosfa': { categoria: 'cuenta', titulo: 'Restableció la verificación de un Administrador', detalle: (d) => d.email },
  'administrador-email': { categoria: 'cuenta', titulo: 'Cambió el email de un Administrador', detalle: (d) => `${d.anterior} → ${d.email}` },
  'administrador-baja': { categoria: 'cuenta', titulo: 'Dio de baja a un Administrador', detalle: (d) => d.email },
  'administrador-reactivado': { categoria: 'cuenta', titulo: 'Reactivó a un Administrador', detalle: (d) => d.email },
  'acceso-portal': {
    categoria: 'cuenta',
    titulo: 'Configuró el acceso al portal de un cliente',
    detalle: (d) => `${d.cliente}${d.cambios?.length ? ` · ${d.cambios.join(', ')}` : ''}`,
  },
  'dosfa-restablecido-terminal': { categoria: 'cuenta', titulo: 'Verificación del superadmin restablecida desde la terminal' },
  'contrasena-terminal': { categoria: 'cuenta', titulo: 'Contraseña del superadmin cambiada desde la terminal' },

  // Instalación
  'datos-negocio': { categoria: 'instalacion', titulo: 'Cambió los datos del negocio', detalle: (d) => (d.cambios ?? []).join(', ') },
  'venta-medio-pago': {
    categoria: 'instalacion',
    titulo: 'Cambió el medio de pago de una venta',
    detalle: (d) => `venta #${d.venta_id} · ${MEDIO_PAGO[d.de] ?? d.de} → ${MEDIO_PAGO[d.a] ?? d.a}`,
  },
  'plan-cambiado': { categoria: 'instalacion', titulo: 'Cambió el plan', detalle: (d) => `${d.de} → ${d.a}` },
  'instalacion-suspendida': {
    categoria: 'instalacion',
    titulo: 'Suspendió la instalación',
    detalle: (d) => `${d.automatica ? 'automática por la cuota · ' : ''}${d.motivo ?? ''}`,
  },
  'instalacion-reactivada': {
    categoria: 'instalacion',
    titulo: 'Reactivó la instalación',
    detalle: (d) => (d.por === 'pago' ? 'sola, al anotar el pago' : ''),
  },
  'cuota-guardada': {
    categoria: 'instalacion',
    titulo: 'Guardó la cuota',
    detalle: (d) =>
      `vence ${fecha(d.vence)}${d.monto ? ` · ${Number(d.monto).toLocaleString('es-AR')} por mes` : ''} · aviso ${d.aviso_dias} días antes · ${d.suspender_dias ? `se suspende a los ${d.suspender_dias} días` : 'no se suspende sola'}`,
  },
  'pago-anotado': {
    categoria: 'instalacion',
    titulo: 'Anotó un pago de la cuota',
    detalle: (d) => `$${Number(d.monto).toLocaleString('es-AR')} · ${d.meses} ${d.meses === 1 ? 'mes' : 'meses'} · nuevo vencimiento ${fecha(d.cuota_vence)}`,
  },
  'pago-anulado': { categoria: 'instalacion', titulo: 'Anuló un pago de la cuota', detalle: (d) => `pago #${d.pago_id} · ${d.motivo}` },
  'topes-guardados': {
    categoria: 'instalacion',
    titulo: 'Guardó los topes de usuarios',
    detalle: (d) =>
      ['admin', 'encargado', 'cajero', 'portal']
        .map((k) => `${{ admin: 'Admin', encargado: 'Encargado', cajero: 'Cajero', portal: 'Portal' }[k]} ${d[k] ?? '—'}`)
        .join(' · '),
  },
  'email-empresa': { categoria: 'instalacion', titulo: 'Cambió el email de la empresa', detalle: (d) => d.email ?? 'sin email' },
  'correo-prueba': {
    categoria: 'instalacion',
    titulo: 'Mandó un mail de prueba',
    detalle: (d) => `${d.canal === 'empresa' ? 'correo de la empresa' : 'correo de CEA'} · a ${d.para}`,
  },
  'copia-pedida': { categoria: 'instalacion', titulo: 'Pidió una copia de seguridad', detalle: (d) => `copia #${d.copia_id}` },
  'restauracion-pedida': { categoria: 'instalacion', titulo: 'Pidió restaurar una copia', detalle: (d) => `${d.copia} · restauración #${d.restauracion_id}` },
  'restauracion-terminada': {
    categoria: 'instalacion',
    titulo: 'Se restauró una copia',
    detalle: (d) =>
      [d.copia, d.resguardo && `resguardo previo ${d.resguardo}`, d.migraciones?.length && `${d.migraciones.length} actualizaciones aplicadas`]
        .filter(Boolean)
        .join(' · '),
  },
  'restauracion-fallida': {
    categoria: 'instalacion',
    titulo: 'Falló una restauración (no se cambió nada)',
    detalle: (d) => `restauración #${d.restauracion_id} · ${d.error}`,
  },
  'restauracion-rechazada': { categoria: 'seguridad', titulo: 'Restauración rechazada', detalle: (d) => d.motivo },

  // Seguridad
  'ip-desbloqueada': { categoria: 'seguridad', titulo: 'Desbloqueó una IP', detalle: (d) => d.ip ?? `bloqueo #${d.id}` },
  'ips-desbloqueadas': { categoria: 'seguridad', titulo: 'Desbloqueó todas las IPs', detalle: (d) => `${d.cantidad ?? 0}` },
  'ip-bloqueada': { categoria: 'seguridad', titulo: 'Bloqueó una IP a mano', detalle: (d) => `${d.ip}${d.minutos ? ` · ${d.minutos} min` : ''}` },
};

export const CATEGORIAS = ['ingreso', 'cuenta', 'instalacion', 'seguridad'];

// ---- Quién lo hizo ----
export const actorDeSesion = (sesion) => ({ tipo: 'usuario', id: sesion.usuario_id, nombre: sesion.usuario, rol: sesion.rol });
export const actorDeSuperadmin = (sa) => ({ tipo: 'superadmin', id: sa.id, nombre: sa.usuario, rol: 'superadmin' });
export const actorCliente = (cliente) => ({ tipo: 'cliente', id: cliente.id, nombre: cliente.razon_social, rol: 'cliente' });
export const ACTOR_SISTEMA = { tipo: 'sistema', id: null, nombre: 'Sistema', rol: null };

export async function registrarAccion(accion, { actor = ACTOR_SISTEMA, ip = null, detalle = null } = {}) {
  const definicion = CATALOGO[accion];
  if (!definicion) {
    console.error(`[registro] acción desconocida: ${accion}`);
    return;
  }
  try {
    await db
      .prepare(
        `INSERT INTO registro_acciones (actor_tipo, actor_id, actor, rol, categoria, accion, detalle, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?)`
      )
      .run(
        actor.tipo,
        actor.id ?? null,
        actor.nombre ? String(actor.nombre).slice(0, 200) : null,
        actor.rol ?? null,
        definicion.categoria,
        accion,
        detalle ? JSON.stringify(detalle) : null,
        ip ? String(ip).slice(0, 64) : null
      );
  } catch (err) {
    console.error(`[registro] no se pudo registrar ${accion}:`, err.message);
  }
}

function describir(fila) {
  const definicion = CATALOGO[fila.accion];
  let detalle = '';
  try {
    detalle = definicion?.detalle && fila.detalle ? definicion.detalle(fila.detalle) : '';
  } catch {
    detalle = '';
  }
  return {
    id: fila.id,
    creado_en: fila.creado_en,
    actor_tipo: fila.actor_tipo,
    actor: fila.actor,
    rol: fila.rol,
    categoria: fila.categoria,
    titulo: definicion?.titulo ?? fila.accion,
    detalle,
    ip: fila.ip,
  };
}

// Las más nuevas primero, de a `limite`; `antes` = el id de la última que ya se mostró.
export async function listarAcciones({ categoria = null, antes = null, limite = 100 } = {}) {
  const filtros = [];
  const valores = [];
  if (categoria) {
    filtros.push('categoria = ?');
    valores.push(categoria);
  }
  if (antes) {
    filtros.push('id < ?');
    valores.push(antes);
  }
  const filas = await db
    .prepare(
      `SELECT id, creado_en, actor_tipo, actor, rol, categoria, accion, detalle, ip
       FROM registro_acciones ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
       ORDER BY id DESC LIMIT ?`
    )
    .all(...valores, limite + 1);
  return { acciones: filas.slice(0, limite).map(describir), hay_mas: filas.length > limite };
}
