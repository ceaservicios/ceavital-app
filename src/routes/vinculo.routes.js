import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { exigirTokenVinculo, soloConVinculo, vinculoLimiter } from '../middleware/vinculo-auth.middleware.js';
import { ipDe } from '../services/defensa-ip.service.js';
import { mandarAvisoAhora } from '../services/avisos-cuota.service.js';
import { registrarPago } from '../services/pagos-cuota.service.js';
import { ACTOR_SISTEMA, registrarAccion } from '../services/registro.service.js';
import { estadoParaGestion } from '../services/vinculo.service.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';

// CEA Servicios - Gestión, con token y sin sesión (middleware/vinculo-auth). Contrato en
// docs/VINCULO-SISTEMAS.md de Gestión.
//   GET  /estado   la cuota y los avisos de cuota (solo lectura)
//   POST /pago     anota el pago del aviso pendiente, igual que /sa > Cuota y pagos (2026-11-08)
//   POST /aviso    manda ahora el aviso de pago, igual que "Mandar aviso ahora" de /sa (2026-11-08)
// Las dos acciones las pidió el usuario el 2026-11-08, para no tener que entrar a cada sistema. Quedan
// en el registro de acciones a nombre de Gestión. Desde el 2026-11-09 la implementación y el abono son
// dos cobros: sin `concepto` ('implementacion' o 'abono'), el pago es el del vencimiento que manda
// Gestión (`aviso`) y el aviso, el del pago más viejo; `cuota_vence` de la respuesta es el vencimiento
// sin pagar más viejo que queda.
const router = Router();

const ACTOR_GESTION = { ...ACTOR_SISTEMA, nombre: 'CEA Servicios - Gestión' };

// Un pago o un aviso van de a uno: 10 cada 15 minutos sobran y frenan un token que se use mal.
const accionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos seguidos desde Gestión. Esperá unos minutos.' },
});

router.get(
  '/estado',
  soloConVinculo,
  vinculoLimiter,
  exigirTokenVinculo,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await estadoParaGestion());
  })
);

// Gestión manda siempre el aviso que vio pendiente: si cambió, registrarPago contesta 409, así no se
// anota un pago distinto del elegido (ni uno repetido si el pedido se reintenta).
router.post(
  '/pago',
  soloConVinculo,
  accionLimiter,
  exigirTokenVinculo,
  asyncHandler(async (req, res) => {
    const cuerpo = req.body ?? {};
    if (!cuerpo.aviso) throw new ApiError(400, 'Falta el aviso que se paga');
    const r = await registrarPago(cuerpo);
    await registrarAccion('pago-anotado', {
      actor: ACTOR_GESTION,
      ip: ipDe(req),
      detalle: {
        pago_id: r.id,
        concepto: r.concepto,
        ...(r.desglose.implementacion && { cuota: r.desglose.implementacion.numero, de: r.desglose.implementacion.de }),
        monto: r.monto,
        moneda: r.moneda,
        aviso: r.aviso,
        cuota_vence: r.proximo?.vence ?? null,
        ...(r.pesos_pagados !== null ? { pesos: r.pesos_pagados, cotizacion_blue: r.cotizacion_blue_cent } : {}),
      },
    });
    if (r.reactivada) await registrarAccion('instalacion-reactivada', { detalle: { por: 'pago' } });
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ aviso: r.aviso, concepto: r.concepto, cuota_vence: r.proximo?.vence ?? null, reactivada: r.reactivada });
  })
);

router.post(
  '/aviso',
  soloConVinculo,
  accionLimiter,
  exigirTokenVinculo,
  asyncHandler(async (req, res) => {
    const r = await mandarAvisoAhora(req.body?.concepto ?? null);
    await registrarAccion('aviso-cuota-manual', {
      actor: ACTOR_GESTION,
      ip: ipDe(req),
      detalle: { concepto: r.concepto, cuota: r.numero, tipo: r.tipo, vence: r.vence, para: r.enviado_a, reenvio: r.reenvio, estado: r.estado },
    });
    res.set('Cache-Control', 'no-store');
    res.json({ para: r.enviado_a, concepto: r.concepto, etapa: r.tipo, vence: r.vence, reenvio: r.reenvio, envio: r.estado, error: r.error ?? null });
  })
);

export default router;
