import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { guardarDatosNegocio, obtenerDatosNegocio } from '../services/negocio.service.js';
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

export default router;
