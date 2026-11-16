import config from '../config/env.js';
import db from '../db/connection.js';
import { leerCobro, pendientesDeCobro } from './cobro-cea.service.js';
import { obtenerInstancia } from './instancia.service.js';
import { correoCeaDisponible } from './mail.service.js';
import { MEDIOS_PAGO } from './pagos-cuota.service.js';
import { obtenerDatosNegocio } from './negocio.service.js';

// Lo que esta instalación le contesta a CEA Servicios - Gestión (GET /api/vinculo/estado; contrato 1,
// en docs/VINCULO-SISTEMAS.md de Gestión). Solo lectura: los datos de contacto de la empresa (con
// ellos Gestión arma y sincroniza la ficha del cliente), el estado de la instalación, la cuota con el
// total del aviso pendiente, si los avisos automáticos pueden salir, y los últimos avisos de cuota con
// lo que pasó con cada mail en la cola. Nada de lo que la empresa vende ni de sus clientes.
// Desde el 2026-11-08 Gestión también anota pagos y manda avisos (routes/vinculo.routes.js).
// Desde el 2026-11-09 la implementación y el abono son dos cobros (cobro-cea.service): `cuota` es el
// vencimiento sin pagar más viejo de los dos (con `concepto`), y `pendientes` trae los dos. Los campos
// nuevos son opcionales para el contrato 1: Gestión ignora lo que no conoce.

export const CONTRATO = 1;
const MAX_AVISOS = 50;

// "AAAA-MM-DD HH:MM:SS" en UTC, como guarda el sistema -> "AAAA-MM-DDTHH:MM:SSZ".
const iso = (texto) => (texto ? `${String(texto).slice(0, 19).replace(' ', 'T')}Z` : null);

// pendiente: un cobro de cobro-cea.pendientesDeCobro, o null.
export function estadoDeCuota(pendiente) {
  if (!pendiente) return 'sin_definir';
  if (pendiente.dias_restantes < 0) return 'vencida';
  if (pendiente.dias_restantes === 0) return 'vence_hoy';
  return pendiente.estado; // 'por_vencer' o 'vigente'
}

// Sin implementación, abono ni modificaciones con costo, el aviso sale sin total.
const totalUsd = (pendiente) => (pendiente?.aviso.configurado ? pendiente.aviso.total / 100 : null);

// Por qué no saldrían los avisos automáticos (null = salen).
export function faltaParaAvisar({ avisosActivos, correoCea, empresaEmail }) {
  if (!avisosActivos) return 'apagados';
  if (!correoCea) return 'correo_cea';
  if (!empresaEmail) return 'mail_empresa';
  return null;
}

// Datos de la empresa para la ficha del cliente en Gestión: los de Configuración > Datos del negocio.
// Este sistema no guarda razón social ni CUIT. El mail, si no hay uno del negocio, es el de los avisos de cuota.
export function datosDeEmpresa(negocio, empresaEmail) {
  return {
    nombre: negocio?.nombre ?? null,
    razon_social: null,
    cuit: null,
    email: negocio?.email ?? empresaEmail ?? null,
    telefono: negocio?.telefono ?? null,
    domicilio: negocio?.direccion ?? null,
  };
}

// filas: los mails de aviso de cuota de la cola, del más nuevo al más viejo, con la etapa de su aviso.
// pendientes: cobro-cea.pendientesDeCobro (el primero es el más viejo).
export function armarEstado({ instancia, negocio = null, pendientes, filas, avisosActivos, correoCea, version, ahora = new Date() }) {
  const falta = faltaParaAvisar({ avisosActivos, correoCea, empresaEmail: instancia.empresa_email });
  const [masViejo = null] = pendientes;
  return {
    contrato: CONTRATO,
    sistema: { producto: 'CEAVital', version },
    generado_en: iso(ahora.toISOString()),
    empresa: datosDeEmpresa(negocio, instancia.empresa_email),
    instalacion: {
      estado: instancia.estado,
      suspendida_en: iso(instancia.suspendida_en),
      suspension_por_cuota: instancia.suspension_por_cuota,
    },
    cuota: {
      vence: masViejo?.vence ?? null,
      dias_restantes: masViejo?.dias_restantes ?? null,
      estado: estadoDeCuota(masViejo),
      suspende_el: instancia.cuota.suspende_el,
      total_usd: totalUsd(masViejo),
      concepto: masViejo?.concepto ?? null, // 'implementacion' o 'abono'
    },
    pendientes: pendientes.map((p) => ({
      concepto: p.concepto,
      vence: p.vence,
      dias_restantes: p.dias_restantes,
      estado: estadoDeCuota(p),
      total_usd: totalUsd(p),
      cuota: p.aviso.implementacion ? { numero: p.aviso.implementacion.numero, de: p.aviso.implementacion.de } : null,
    })),
    avisos_automaticos: { activos: falta === null, destinatario: instancia.empresa_email, falta },
    // Lo que Gestión puede pedir además de consultar (2026-11-08): anotar el pago del aviso pendiente
    // (POST /api/vinculo/pago, con estos medios de pago) y mandar el aviso ahora (POST /api/vinculo/aviso).
    acciones: ['pago', 'aviso'],
    medios_pago: MEDIOS_PAGO,
    avisos: filas.map((f) => ({
      // El único aviso de cuota que no se anota en cuota_avisos es el de la reactivación
      // (instancia.service > avisarReactivacion): no tiene etapa ni vencimiento propios.
      etapa: f.etapa ?? 'reactivada',
      concepto: f.concepto ?? null,
      cuota_vence: f.cuota_vence ?? null,
      para: f.para,
      anotado_en: iso(f.creado_en),
      envio: f.estado,
      intentos: f.intentos,
      error: f.ultimo_error ?? null,
      terminado_en: iso(f.terminado_en),
    })),
  };
}

export async function estadoParaGestion() {
  const instancia = await obtenerInstancia();
  const [negocio, cobro, filas] = await Promise.all([
    obtenerDatosNegocio(),
    leerCobro(),
    db
      .prepare(
        `SELECT c.para, c.estado, c.intentos, c.ultimo_error, c.creado_en, c.terminado_en, a.tipo AS etapa, a.concepto, a.cuota_vence
         FROM correos c LEFT JOIN cuota_avisos a ON a.correo_id = c.id
         WHERE c.tipo = 'aviso-cuota'
         ORDER BY c.id DESC LIMIT ?`
      )
      .all(MAX_AVISOS),
  ]);
  const pendientes = pendientesDeCobro(cobro);
  return armarEstado({ instancia, negocio, pendientes, filas, avisosActivos: config.avisosCuota, correoCea: correoCeaDisponible(), version: config.version });
}
