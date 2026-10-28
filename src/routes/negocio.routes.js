import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { guardarDatosNegocio, guardarStockEn, obtenerDatosNegocio, obtenerStockEn } from '../services/negocio.service.js';
import { actorDeSesion, registrarAccion } from '../services/registro.service.js';

const router = Router();

const ETIQUETAS = { nombre: 'nombre', telefono: 'teléfono', email: 'mail', direccion: 'dirección', instagram: 'Instagram' };

// Datos del negocio (Configuración > Datos del negocio): exclusivo Admin, como el resto de
// Configuración. Los mails los leen directo del servicio.
router.get('/', requireAuth(['admin']), async (req, res) => {
  res.json(await obtenerDatosNegocio());
});

router.put('/', requireAuth(['admin']), async (req, res) => {
  const { anteriores, datos } = await guardarDatosNegocio(req.body || {});
  const cambios = Object.keys(ETIQUETAS).filter((k) => (anteriores[k] ?? null) !== datos[k]).map((k) => ETIQUETAS[k]);
  if (cambios.length) {
    await registrarAccion('datos-negocio', { actor: actorDeSesion(req.sesion), ip: req.ip, detalle: { cambios } });
  }
  res.json(datos);
});

// Cómo se muestra el stock (unidades o packs): lo leen los 3 roles, porque Stock, Caja y
// Vencimientos lo usan; lo cambia solo el Admin, en Configuración > Datos del negocio.
router.get('/stock-en', requireAuth(), async (req, res) => {
  res.json({ stock_en: await obtenerStockEn() });
});

router.put('/stock-en', requireAuth(['admin']), async (req, res) => {
  const { anterior, stock_en } = await guardarStockEn(req.body?.stock_en);
  if (anterior !== stock_en) {
    await registrarAccion('stock-en', { actor: actorDeSesion(req.sesion), ip: req.ip, detalle: { de: anterior, a: stock_en } });
  }
  res.json({ stock_en });
});

export default router;
