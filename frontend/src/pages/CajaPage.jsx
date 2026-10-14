import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatearMonto, fechaHoyISO } from '../utils/format.js';
import {
  describirStockLargo,
  esFraccionable,
  etiquetaPack,
  factorMedida,
  faltanParaPrecioCantidad,
  formatearCantidad,
  parsearCantidad,
  plural,
  precioCantidadDe,
  precioLinea,
  simboloMedida,
  subtotalLinea,
  sufijoPrecio,
  textoDeCantidad,
  tienePack,
  tienePrecioCantidad,
  unidadesDeLinea,
  vendeSuelto,
} from '../utils/presentacion.js';
import './CajaPage.css';

// Formas en que se puede vender un producto en Caja (2026-10-11): suelto (por unidad, kg o
// litro) y/o por pack, según cómo se cargó. Cada una con su etiqueta y precio.
function opcionesDeVenta(producto) {
  const opciones = [];
  if (vendeSuelto(producto)) {
    opciones.push({
      presentacion: 'unidad',
      etiqueta: esFraccionable(producto.medida) ? `Por ${simboloMedida(producto.medida)}` : 'Unidad',
      precio: `${formatearMonto(producto.precio_venta)}${sufijoPrecio(producto.medida)}`,
    });
  }
  if (tienePack(producto)) {
    opciones.push({
      presentacion: 'pack',
      etiqueta: etiquetaPack(producto.pack_nombre, producto.pack_unidades, producto.medida),
      precio: formatearMonto(producto.precio_pack),
    });
  }
  return opciones;
}

// Una línea suelta de un producto por kg o litro: la cantidad es el peso que se tipea.
const esLineaPorPeso = (item) => item.presentacion === 'unidad' && esFraccionable(item.producto.medida);

const MEDIOS_PAGO = [
  {
    valor: 'efectivo',
    label: 'Efectivo',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    valor: 'tarjeta',
    label: 'Tarjeta',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </svg>
    ),
  },
  {
    valor: 'transferencia_qr',
    label: 'Transferencia / QR',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    valor: 'mercado_pago',
    label: 'Mercado Pago',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1" />
        <path d="M21 12a1.5 1.5 0 0 1 0 3h-3a3 3 0 0 1 0-6h3a1.5 1.5 0 0 1 0 3z" />
      </svg>
    ),
  },
  {
    valor: 'fiado',
    label: 'Fiado',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
    ),
  },
  {
    // B2B Fase 1: venta a la cuenta corriente de un Cliente-Empresa real
    // (con ledger) -- distinta de 'fiado', que sigue siendo el fiado
    // informal sin cliente asociado.
    valor: 'cta_cte',
    label: 'Cuenta Corriente',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </svg>
    ),
  },
];

const PUEDE_ANULAR = new Set(['admin', 'encargado']);
// Gastos y pagos a proveedores (corrección 2026-09-15, decisiones confirmadas
// 2026-09-18): Crear -- los 3 roles. Eliminar (corregir un gasto mal
// cargado) -- Admin+Encargado, mismo criterio que anular una venta.
const PUEDE_ELIMINAR_GASTO = new Set(['admin', 'encargado']);

// Lector de código de barras tipo teclado: manda los caracteres a menos de esto entre sí (una
// persona tarda más). Largo mínimo bajo a propósito para aceptar códigos internos cortos;
// nadie tipea 6 caracteres seguidos a menos de 50 ms cada uno.
const LECTOR_MS_ENTRE_TECLAS = 50;
const LECTOR_LARGO_MINIMO = 6;

export default function CajaPage() {
  const { usuario, moduloActivo } = useAuth();
  const cuentaCorrienteActiva = moduloActivo('clientes_empresa');
  const mediosVisibles = MEDIOS_PAGO.filter((m) => m.valor !== 'cta_cte' || cuentaCorrienteActiva);

  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState([]);
  // Texto al que corresponden los resultados: el lector tipea el código y aprieta Enter antes
  // de que termine la búsqueda (espera 250 ms), y el Enter se perdía (2026-10-11).
  const [resultadosDe, setResultadosDe] = useState('');
  const [mostrarResultados, setMostrarResultados] = useState(false);
  const [carrito, setCarrito] = useState([]);
  const [focoPeso, setFocoPeso] = useState(null); // clave de la línea por peso a enfocar
  const [medioPago, setMedioPago] = useState('efectivo');
  const [clientesEmpresa, setClientesEmpresa] = useState([]);
  const [clienteEmpresaId, setClienteEmpresaId] = useState('');
  const [montoRecibido, setMontoRecibido] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [ventasHoy, setVentasHoy] = useState([]);
  const [confirmandoAnulacion, setConfirmandoAnulacion] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState(false);

  const [gastosHoy, setGastosHoy] = useState([]);
  const [proveedoresGasto, setProveedoresGasto] = useState([]);
  const [mostrarFormGasto, setMostrarFormGasto] = useState(false);
  const [nuevoGasto, setNuevoGasto] = useState({ concepto: '', monto: '', proveedor_id: '' });
  const [registrandoGasto, setRegistrandoGasto] = useState(false);
  const [errorGasto, setErrorGasto] = useState(null);
  const [eliminandoGastoId, setEliminandoGastoId] = useState(null);

  const searchInputRef = useRef(null);
  // Guardia real contra doble-click (mismo criterio que "Confirmar Cierre de
  // Caja", ver hallazgo Baja #3 de verificador-funcional 2026-09-10): un ref
  // mutado sincrónicamente, no solo el estado `anulando` que gatilla el
  // re-render del `disabled` -- un doble-click muy rápido puede disparar el
  // 2do click antes de que ese re-render se complete.
  const anulandoRef = useRef(false);
  // Guardias sincrónicas: `disabled` no alcanza contra dos clicks en el mismo tick
  // (duplicaba la venta, el gasto o la baja).
  const confirmandoVentaRef = useRef(false);
  const enterEnCursoRef = useRef(new Set());
  const registrandoGastoRef = useRef(false);
  const eliminandoGastoRef = useRef(false);
  const rafagasPesoRef = useRef(new Map()); // clave de línea → { antes, ultima }, ver teclaEnPeso

  const puedeAnular = PUEDE_ANULAR.has(usuario?.rol);
  const puedeEliminarGasto = PUEDE_ELIMINAR_GASTO.has(usuario?.rol);

  const cargarResumen = useCallback(async () => {
    try {
      const [resumenData, ventasData, gastosData] = await Promise.all([
        api.get('/caja/resumen'),
        api.get(`/ventas?fecha=${fechaHoyISO()}`),
        api.get(`/caja/gastos?fecha=${fechaHoyISO()}`),
      ]);
      setResumen(resumenData);
      setVentasHoy(ventasData.ventas);
      setGastosHoy(gastosData.gastos);
    } catch {
      // Los KPIs son informativos -- si fallan, no bloquean el uso de Caja.
    }
  }, []);

  useEffect(() => {
    cargarResumen();
  }, [cargarResumen]);

  // Proveedores solo para el <select> opcional "pago a proveedor" del
  // formulario de gasto -- Cajero no tiene acceso a /proveedores (ni
  // siquiera Ver, ver proveedores.routes.js), así que ese select se omite
  // para ese rol en vez de intentar un fetch que le va a devolver 403.
  useEffect(() => {
    if (usuario?.rol === 'admin' || usuario?.rol === 'encargado') {
      api
        .get('/proveedores')
        .then((data) => setProveedoresGasto(data.proveedores))
        .catch(() => setProveedoresGasto([]));
    }
  }, [usuario?.rol]);

  // Lista de clientes-empresa para el selector de "Cuenta Corriente": los 3
  // roles la necesitan para cobrar una venta a cuenta corriente (el backend
  // deja GET /clientes-empresa abierto a todos y al Cajero le devuelve solo
  // id + razón social, nunca el saldo ni datos de contacto).
  useEffect(() => {
    if (!cuentaCorrienteActiva) return;
    api
      .get('/clientes-empresa')
      .then((data) => setClientesEmpresa(data.clientes))
      .catch(() => setClientesEmpresa([]));
  }, [cuentaCorrienteActiva]);

  async function registrarGasto(e) {
    e.preventDefault();
    if (registrandoGastoRef.current) return;
    registrandoGastoRef.current = true;
    setRegistrandoGasto(true);
    setErrorGasto(null);
    try {
      await api.post('/caja/gastos', {
        concepto: nuevoGasto.concepto,
        monto: Number(nuevoGasto.monto),
        proveedor_id: nuevoGasto.proveedor_id === '' ? null : Number(nuevoGasto.proveedor_id),
      });
      setNuevoGasto({ concepto: '', monto: '', proveedor_id: '' });
      setMostrarFormGasto(false);
      cargarResumen();
    } catch (err) {
      setErrorGasto(err instanceof ApiError ? err.message : 'No se pudo registrar el gasto.');
    } finally {
      registrandoGastoRef.current = false;
      setRegistrandoGasto(false);
    }
  }

  async function eliminarGasto(id) {
    if (eliminandoGastoRef.current) return;
    eliminandoGastoRef.current = true;
    setEliminandoGastoId(id);
    try {
      await api.delete(`/caja/gastos/${id}`);
      cargarResumen();
    } catch (err) {
      setErrorGasto(err instanceof ApiError ? err.message : 'No se pudo eliminar el gasto.');
    } finally {
      eliminandoGastoRef.current = false;
      setEliminandoGastoId(null);
    }
  }

  useEffect(() => {
    if (query.trim().length < 1) {
      setResultados([]);
      setResultadosDe('');
      setErrorBusqueda(false);
      return;
    }
    const timeoutId = setTimeout(async () => {
      try {
        const texto = query.trim();
        const data = await api.get(`/productos?q=${encodeURIComponent(texto)}`);
        setResultados(data.productos);
        setResultadosDe(texto);
        setErrorBusqueda(false);
        setMostrarResultados(true);
      } catch {
        // Cualquier excepción acá es un problema de conexión/servidor -- una
        // búsqueda sin coincidencias NUNCA tira excepción (el backend
        // responde 200 con data.productos:[]). Antes esto se confundía con
        // "no existe" (hallazgo Baja #2, verificador-funcional 2026-09-10).
        setResultados([]);
        setResultadosDe('');
        setErrorBusqueda(true);
        setMostrarResultados(true);
      }
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [query]);

  // Venta por pack (2026-10-11): cada línea del carrito es un producto en una presentación
  // ('unidad' o 'pack'); el mismo producto puede ir en dos líneas. `producto` guarda los
  // precios y el pack para calcular el precio de la línea (el servidor decide el real).
  // `textoEscaneado`: si se agregó con el Enter del lector y mientras se buscaba ya se tipeó
  // otro código, no se borra lo nuevo.
  // Por peso (kg/litro, 2026-10-11): la línea arranca sin peso y el foco va a su campo; agregar
  // otra vez el mismo producto no suma 1 kg, vuelve al campo para corregir el peso.
  function agregarAlCarrito(producto, presentacion = 'unidad', textoEscaneado = null) {
    const pres = presentacion === 'unidad' && !vendeSuelto(producto) ? 'pack' : presentacion;
    const clave = `${producto.id}:${pres}`;
    const porPeso = pres === 'unidad' && esFraccionable(producto.medida);
    setCarrito((prev) => {
      const existente = prev.find((item) => item.clave === clave);
      if (existente) {
        if (porPeso) return prev;
        return prev.map((item) => (item.clave === clave ? { ...item, cantidad: item.cantidad + 1 } : item));
      }
      return [
        ...prev,
        {
          clave,
          producto_id: producto.id,
          presentacion: pres,
          nombre: producto.nombre,
          producto,
          stock_vendible: producto.stock_disponible, // lo que Caja puede vender: vendible menos lo reservado por pedidos de clientes
          cantidad: porPeso ? 0 : 1,
          pesoTexto: '',
        },
      ];
    });
    if (porPeso) setFocoPeso(clave);
    if (textoEscaneado !== null && searchInputRef.current && searchInputRef.current.value.trim() !== textoEscaneado) return;
    setQuery('');
    setResultados([]);
    setResultadosDe('');
    setMostrarResultados(false);
    if (!porPeso) searchInputRef.current?.focus();
  }

  // Foco en el campo de peso de la línea recién agregada (después de que se dibuja).
  useEffect(() => {
    if (!focoPeso) return;
    document.getElementById(`peso-${focoPeso}`)?.focus();
    setFocoPeso(null);
  }, [focoPeso, carrito]);

  function cambiarPeso(clave, texto) {
    setCarrito((prev) =>
      prev.map((item) =>
        item.clave === clave ? { ...item, pesoTexto: texto, cantidad: parsearCantidad(texto, item.producto.medida) ?? 0 } : item
      )
    );
  }

  // Lector en el campo de peso (2026-10-14): si se escanea con el foco en el peso, el código no
  // es un peso. El lector tipea cada carácter y el Enter a pocos ms; una persona, no. Por línea
  // se guarda el texto que había antes de la ráfaga (para devolverlo) y las teclas de la ráfaga
  // (el código): no se deduce del valor del campo, que depende de la selección y del cursor
  // (con Tab el texto queda seleccionado y el código lo reemplaza).
  function teclaEnPeso(e, clave) {
    const ahora = performance.now();
    const rafaga = rafagasPesoRef.current.get(clave);
    const enRafaga = rafaga && ahora - rafaga.ultima < LECTOR_MS_ENTRE_TECLAS;
    if (e.key.length === 1) {
      // El keydown llega antes de que el carácter se escriba: el valor es el de antes.
      if (enRafaga) {
        rafaga.ultima = ahora;
        rafaga.teclas += e.key;
      } else rafagasPesoRef.current.set(clave, { antes: e.currentTarget.value, teclas: e.key, ultima: ahora });
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    rafagasPesoRef.current.delete(clave);
    const codigo = enRafaga ? rafaga.teclas.trim() : '';
    searchInputRef.current?.focus();
    if (codigo.length < LECTOR_LARGO_MINIMO) return;
    cambiarPeso(clave, rafaga.antes);
    setQuery(codigo);
    agregarPorTexto(codigo);
  }

  // Enter con un solo resultado (el lector de código de barras tipea el código + Enter):
  // el código del pack agrega un pack y el de la unidad, una unidad, sin preguntar. Si se
  // buscó por nombre un producto con pack, se elige Unidad o Pack en la lista.
  // Si los resultados en pantalla no son de lo que se tipeó (el lector es más rápido que la
  // búsqueda), se busca en el momento. Un código exacto gana aunque el texto aparezca en otros.
  async function handleSearchKeyDown(e) {
    if (e.key !== 'Enter') return;
    const texto = query.trim();
    if (!texto) return;
    e.preventDefault();
    await agregarPorTexto(texto);
  }

  async function agregarPorTexto(texto) {
    // Un segundo Enter del mismo código mientras se busca no lo agrega dos veces.
    if (enterEnCursoRef.current.has(texto)) return;
    let lista = resultadosDe === texto ? resultados : null;
    if (!lista) {
      enterEnCursoRef.current.add(texto);
      try {
        lista = (await api.get(`/productos?q=${encodeURIComponent(texto)}`)).productos;
      } catch {
        return;
      } finally {
        enterEnCursoRef.current.delete(texto);
      }
    }
    const porCodigo = lista.filter((p) => p.coincide_codigo);
    const candidatos = porCodigo.length === 1 ? porCodigo : lista;
    if (candidatos.length !== 1) return;
    const [producto] = candidatos;
    const opciones = opcionesDeVenta(producto);
    // El código del producto en uno que se vende solo por caja es el de la caja: agregarAlCarrito
    // lo pasa a pack. Por nombre, si tiene una sola forma de venta, va esa; si tiene dos, se elige.
    if (producto.coincide_codigo === 'pack' && tienePack(producto)) agregarAlCarrito(producto, 'pack', texto);
    else if (producto.coincide_codigo === 'unidad') agregarAlCarrito(producto, 'unidad', texto);
    else if (opciones.length === 1) agregarAlCarrito(producto, opciones[0].presentacion, texto);
  }

  // Cambiar una línea de Unidad a Pack o al revés (2026-10-11): si ya había una línea del
  // mismo producto en esa presentación, se suman.
  // Por peso, la cantidad cambia de sentido (packs ↔ gramos): 2 bolsas de 15 kg pasan a 30 kg y
  // 30 kg a 2 bolsas (menos de una bolsa → 1). Lo que no completa una bolsa no se pierde
  // (2026-10-14): 31 kg pasan a 2 bolsas y queda una línea suelta de 1 kg.
  function cambiarPresentacion(clave, presentacion) {
    setCarrito((prev) => {
      const linea = prev.find((item) => item.clave === clave);
      if (!linea || linea.presentacion === presentacion) return prev;
      const { medida, pack_unidades: trae } = linea.producto;
      let cantidad = linea.cantidad;
      let resto = 0;
      if (esFraccionable(medida)) {
        cantidad = presentacion === 'pack' ? Math.max(1, Math.floor(linea.cantidad / trae)) : linea.cantidad * trae;
        if (presentacion === 'pack' && linea.cantidad >= trae) resto = linea.cantidad % trae;
      }
      const nuevaClave = `${linea.producto_id}:${presentacion}`;
      const existente = prev.find((item) => item.clave === nuevaClave);
      const conPeso = (item, total) => ({
        ...item,
        cantidad: total,
        pesoTexto: item.presentacion === 'unidad' && esFraccionable(medida) ? textoDeCantidad(total, medida) : '',
      });
      if (resto > 0) {
        const suelta = conPeso(linea, resto);
        if (existente) {
          return prev.map((item) =>
            item.clave === clave ? suelta : item.clave === nuevaClave ? conPeso(item, item.cantidad + cantidad) : item
          );
        }
        const packs = conPeso({ ...linea, clave: nuevaClave, presentacion }, cantidad);
        return prev.flatMap((item) => (item.clave === clave ? [packs, suelta] : [item]));
      }
      if (existente) {
        return prev
          .filter((item) => item.clave !== clave)
          .map((item) => (item.clave === nuevaClave ? conPeso(item, item.cantidad + cantidad) : item));
      }
      return prev.map((item) => (item.clave === clave ? conPeso({ ...item, clave: nuevaClave, presentacion }, cantidad) : item));
    });
  }

  function cambiarCantidad(clave, delta) {
    setCarrito((prev) =>
      prev
        .map((item) => (item.clave === clave ? { ...item, cantidad: item.cantidad + delta } : item))
        // Solo la línea tocada sale si llega a 0: una línea por peso sin peso no se borra sola.
        .filter((item) => item.clave !== clave || item.cantidad > 0)
    );
  }

  function quitarDelCarrito(clave) {
    setCarrito((prev) => prev.filter((item) => item.clave !== clave));
  }

  const precioDe = (item) => precioLinea(item.producto, item.cantidad, item.presentacion);
  // Unidades pedidas de cada producto, sumando sus líneas por unidad y por pack.
  const unidadesPorProducto = carrito.reduce((mapa, item) => {
    const unidades = unidadesDeLinea(item.producto, item.cantidad, item.presentacion);
    return mapa.set(item.producto_id, (mapa.get(item.producto_id) ?? 0) + unidades);
  }, new Map());
  const total = carrito.reduce((acc, item) => acc + subtotalLinea(item.producto, item.cantidad, item.presentacion), 0);
  // Un producto pesado cuenta como 1 artículo; sin peso, la venta no se puede cobrar.
  const articulos = carrito.reduce((acc, item) => acc + (esLineaPorPeso(item) ? (item.cantidad > 0 ? 1 : 0) : item.cantidad), 0);
  const faltaPeso = carrito.some((item) => esLineaPorPeso(item) && !(item.cantidad > 0));
  const recibidoNumerico = Number(montoRecibido) || 0;
  const vuelto = recibidoNumerico - total;

  async function confirmarVenta() {
    if (confirmandoVentaRef.current) return;
    confirmandoVentaRef.current = true;
    setError(null);
    setExito(null);
    setEnviando(true);
    try {
      const venta = await api.post('/ventas', {
        medio_pago: medioPago,
        ...(medioPago === 'cta_cte' ? { cliente_empresa_id: Number(clienteEmpresaId) } : {}),
        items: carrito.map((item) => ({
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          presentacion: item.presentacion,
        })),
      });
      // Cuánto stock queda de lo que se vendió (2026-10-11): así se ve el efecto de cada venta.
      const quedan = (venta.stock_despues ?? [])
        .map((s) => `${s.nombre}: ${describirStockLargo(s.stock_disponible, s)}`)
        .join(' · ');
      setExito(`Venta #${venta.id} registrada por ${formatearMonto(venta.total)}.${quedan ? ` Stock que queda — ${quedan}.` : ''}`);
      setCarrito([]);
      setMontoRecibido('');
      setClienteEmpresaId('');
      cargarResumen();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar la venta. Probá de nuevo.');
    } finally {
      confirmandoVentaRef.current = false;
      setEnviando(false);
    }
  }

  const ultimaVentaRegistrada = ventasHoy.find((v) => v.estado === 'registrada');

  async function anularUltimoTicket() {
    if (!ultimaVentaRegistrada || anulandoRef.current) return;
    anulandoRef.current = true;
    setAnulando(true);
    setError(null);
    try {
      await api.delete(`/ventas/${ultimaVentaRegistrada.id}`);
      setExito(`Venta #${ultimaVentaRegistrada.id} anulada.`);
      setConfirmandoAnulacion(false);
      cargarResumen();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anular la venta.');
      setConfirmandoAnulacion(false);
    } finally {
      setAnulando(false);
      anulandoRef.current = false;
    }
  }

  const ticketsEmitidos = ventasHoy.filter((v) => v.estado === 'registrada').length;
  const ticketPromedio = ticketsEmitidos > 0 ? Math.round((resumen?.total_general ?? 0) / ticketsEmitidos) : 0;

  return (
    <div className="caja-page">
      <div className="caja-kpis">
        <div className="card caja-kpi">
          <span className="caja-kpi-label">Ventas del turno</span>
          <span className="caja-kpi-value">{formatearMonto(resumen?.total_general ?? 0)}</span>
        </div>
        <div className="card caja-kpi">
          <span className="caja-kpi-label">Tickets emitidos</span>
          <span className="caja-kpi-value">{ticketsEmitidos}</span>
        </div>
        <div className="card caja-kpi">
          <span className="caja-kpi-label">Ticket promedio</span>
          <span className="caja-kpi-value">{formatearMonto(ticketPromedio)}</span>
        </div>
        <div className="card caja-kpi">
          <span className="caja-kpi-label">Gastos del turno</span>
          <span className="caja-kpi-value" style={{ color: (resumen?.total_gastos ?? 0) > 0 ? 'var(--color-danger)' : undefined }}>
            {formatearMonto(resumen?.total_gastos ?? 0)}
          </span>
        </div>
      </div>

      <div className="caja-body">
        <div className="card caja-carrito">
          <div className="caja-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7672" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Buscá un producto…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => setMostrarResultados(true)}
            />
            {mostrarResultados && query.trim().length > 0 && (
              <div className="caja-search-dropdown">
                {resultados.length === 0 && (
                  <div className="caja-search-empty">
                    {errorBusqueda ? 'No se pudo conectar con el servidor. Probá de nuevo en unos segundos.' : 'Sin resultados'}
                  </div>
                )}
                {resultados.map((producto) => {
                  const opciones = opcionesDeVenta(producto);
                  const nombreYStock = (
                    <span className="caja-search-nombre">
                      {producto.nombre}
                      <span className="caja-search-stock">Stock: {describirStockLargo(producto.stock_disponible, producto)}</span>
                    </span>
                  );
                  // Dos formas de venta: se elige cuál. Una sola: toda la fila la agrega.
                  return opciones.length > 1 ? (
                    <div key={producto.id} className="caja-search-item caja-search-item-pack">
                      {nombreYStock}
                      <span className="caja-search-opciones">
                        {opciones.map((o) => (
                          <button key={o.presentacion} type="button" onClick={() => agregarAlCarrito(producto, o.presentacion)}>
                            {o.etiqueta} <strong>{o.precio}</strong>
                          </button>
                        ))}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      key={producto.id}
                      className="caja-search-item"
                      onClick={() => agregarAlCarrito(producto, opciones[0]?.presentacion ?? 'unidad')}
                    >
                      {nombreYStock}
                      <span className="caja-search-item-precio">
                        {opciones[0]?.presentacion === 'pack' && `${opciones[0].etiqueta} `}
                        {opciones[0]?.precio}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="caja-cart-list">
            {carrito.length === 0 ? (
              <div className="caja-cart-empty">El carrito está vacío. Buscá un producto para empezar.</div>
            ) : (
              <>
                <div className="caja-cart-head">
                  <span style={{ flex: 2.4 }}>Producto</span>
                  <span style={{ flex: 1.2, textAlign: 'center' }}>Cantidad</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Precio</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Subtotal</span>
                  <span style={{ width: 32 }} />
                </div>
                {carrito.map((item) => {
                  const { precio, aplicaPrecioCantidad } = precioDe(item);
                  const porPack = item.presentacion === 'pack';
                  const porPeso = esLineaPorPeso(item);
                  const medida = item.producto.medida;
                  const faltan = faltanParaPrecioCantidad(item.producto, item.cantidad, item.presentacion);
                  // "desde 10 cajas" / "desde 3 kg" / "desde 6": el del pack se cuenta en packs.
                  const cantidadTexto = (n) =>
                    porPack ? `${n} ${plural(item.producto.pack_nombre, n)}` : formatearCantidad(n, medida, { corta: true });
                  return (
                  <div className="caja-cart-row" key={item.clave}>
                    <span style={{ flex: 2.4 }} className="caja-cart-nombre">
                      {item.nombre}
                      {/* Unidad o caja en la misma línea, y cuánto descuenta del stock (2026-10-11). */}
                      {opcionesDeVenta(item.producto).length > 1 && (
                        <span className="caja-cart-switch" role="group" aria-label="Se vende por">
                          {opcionesDeVenta(item.producto).map((o) => (
                            <button
                              key={o.presentacion}
                              type="button"
                              className={item.presentacion === o.presentacion ? 'activo' : ''}
                              aria-pressed={item.presentacion === o.presentacion}
                              onClick={() => cambiarPresentacion(item.clave, o.presentacion)}
                            >
                              {o.etiqueta}
                            </button>
                          ))}
                        </span>
                      )}
                      {porPack && (
                        <span className="caja-cart-descuenta">
                          {opcionesDeVenta(item.producto).length === 1 &&
                            `${etiquetaPack(item.producto.pack_nombre, item.producto.pack_unidades, medida)} · `}
                          Descuenta {formatearCantidad(item.cantidad * item.producto.pack_unidades, medida)} del stock
                        </span>
                      )}
                      {porPeso && !(item.cantidad > 0) && <span className="caja-cart-warning">Escribí el peso</span>}
                      {aplicaPrecioCantidad && (
                        <span className="caja-cart-promo">
                          Precio por cantidad (desde {cantidadTexto(precioCantidadDe(item.producto, item.presentacion).desde)})
                        </span>
                      )}
                      {!aplicaPrecioCantidad &&
                        tienePrecioCantidad(item.producto, item.presentacion) &&
                        faltan <= (porPack ? 5 : 5 * factorMedida(medida)) && (
                        <span className="caja-cart-promo-hint">
                          Llevando {cantidadTexto(faltan)} más:{' '}
                          {formatearMonto(precioCantidadDe(item.producto, item.presentacion).precio)}
                          {porPeso ? sufijoPrecio(medida) : ' c/u'}
                        </span>
                      )}
                      {unidadesPorProducto.get(item.producto_id) > item.stock_vendible && (
                        <span className="caja-cart-warning">
                          Solo hay {formatearCantidad(item.stock_vendible, medida)} disponibles
                        </span>
                      )}
                    </span>
                    <span style={{ flex: 1.2 }} className="caja-cart-cantidad">
                      {porPeso ? (
                        <span className="caja-cart-peso">
                          <input
                            id={`peso-${item.clave}`}
                            type="text"
                            inputMode="decimal"
                            placeholder="0,000"
                            aria-label={`Peso de ${item.nombre} en ${simboloMedida(medida)}`}
                            value={item.pesoTexto}
                            onChange={(e) => cambiarPeso(item.clave, e.target.value)}
                            onKeyDown={(e) => teclaEnPeso(e, item.clave)}
                          />
                          {simboloMedida(medida)}
                        </span>
                      ) : (
                        <>
                          <button type="button" onClick={() => cambiarCantidad(item.clave, -1)}>
                            –
                          </button>
                          <span>{item.cantidad}</span>
                          <button type="button" onClick={() => cambiarCantidad(item.clave, 1)}>
                            +
                          </button>
                        </>
                      )}
                    </span>
                    <span style={{ flex: 1, textAlign: 'right' }}>
                      {formatearMonto(precio)}
                      {!porPack && sufijoPrecio(medida)}
                    </span>
                    <span style={{ flex: 1, textAlign: 'right', fontWeight: 700 }}>
                      {formatearMonto(subtotalLinea(item.producto, item.cantidad, item.presentacion))}
                    </span>
                    <span style={{ width: 32, display: 'flex', justifyContent: 'center' }}>
                      <button
                        type="button"
                        className="caja-cart-remove"
                        onClick={() => quitarDelCarrito(item.clave)}
                        title="Quitar"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    </span>
                  </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        <div className="card caja-cobro">
          <div className="caja-medios">
            <span className="caja-section-label">Medio de cobro</span>
            <div className="caja-medios-grid">
              {mediosVisibles.map((medio) => (
                <button
                  type="button"
                  key={medio.valor}
                  className={`caja-medio-btn${medioPago === medio.valor ? ' caja-medio-btn-active' : ''}`}
                  onClick={() => setMedioPago(medio.valor)}
                >
                  {medio.icono}
                  <span>{medio.label}</span>
                </button>
              ))}
            </div>
          </div>

          {medioPago === 'efectivo' && (
            <div className="caja-cambio">
              <div className="caja-cambio-row">
                <span>Monto recibido</span>
                <input
                  type="number"
                  min="0"
                  value={montoRecibido}
                  onChange={(e) => setMontoRecibido(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="caja-cambio-row">
                <span>Vuelto</span>
                <span style={{ fontWeight: 700 }}>{formatearMonto(Math.max(vuelto, 0))}</span>
              </div>
            </div>
          )}

          {medioPago === 'cta_cte' && (
            <div className="caja-cliente">
              <label htmlFor="caja-cliente-empresa">Cliente-Empresa</label>
              {clientesEmpresa.length === 0 ? (
                <span className="caja-cliente-vacio">
                  No hay clientes-empresa cargados. Pedile a un Encargado o Administrador que cargue uno en "Clientes y Cta. Cte.".
                </span>
              ) : (
                <select
                  id="caja-cliente-empresa"
                  value={clienteEmpresaId}
                  onChange={(e) => setClienteEmpresaId(e.target.value)}
                >
                  <option value="">Elegí a quién se le vende…</option>
                  {clientesEmpresa.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.razon_social}
                      {c.cuit ? ` · ${c.cuit}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {error && <div className="alert alert-danger">{error}</div>}
          {exito && (
            <div className="alert" style={{ background: 'rgba(14,75,56,0.08)', color: '#0e4b38', border: '1px solid rgba(14,75,56,0.25)' }}>
              {exito}
            </div>
          )}

          <div className="caja-total-block">
            <div className="caja-total-row">
              <span className="caja-total-label">
                Total a cobrar
                <span className="caja-total-detalle">
                  {articulos === 0 ? 'Sin productos' : articulos === 1 ? '1 artículo' : `${articulos} artículos`}
                </span>
              </span>
              <span className="caja-total-value">{formatearMonto(total)}</span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '15px' }}
              disabled={carrito.length === 0 || faltaPeso || enviando || (medioPago === 'cta_cte' && !clienteEmpresaId)}
              onClick={confirmarVenta}
            >
              {enviando ? 'Registrando…' : 'Confirmar y Cobrar Venta'}
            </button>

            {puedeAnular && ultimaVentaRegistrada && (
              <div className="caja-anular">
                {!confirmandoAnulacion ? (
                  <button type="button" className="caja-anular-link" onClick={() => setConfirmandoAnulacion(true)}>
                    Anular último ticket (#{ultimaVentaRegistrada.id} · {formatearMonto(ultimaVentaRegistrada.total)})
                  </button>
                ) : (
                  <div className="caja-anular-confirm">
                    <span>¿Confirmás la anulación?</span>
                    <button type="button" className="btn" onClick={() => setConfirmandoAnulacion(false)} disabled={anulando}>
                      No
                    </button>
                    <button type="button" className="btn btn-primary" onClick={anularUltimoTicket} disabled={anulando}>
                      {anulando ? 'Anulando…' : 'Sí, anular'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card caja-gastos">
        <div className="caja-gastos-header">
          <span className="caja-section-label" style={{ marginBottom: 0 }}>
            Gastos y pagos a proveedores
          </span>
          {!mostrarFormGasto && (
            <button type="button" className="btn" onClick={() => setMostrarFormGasto(true)}>
              + Registrar gasto
            </button>
          )}
        </div>

        {errorGasto && <div className="alert alert-danger">{errorGasto}</div>}

        {mostrarFormGasto && (
          <form className="caja-gasto-form" onSubmit={registrarGasto}>
            <input
              required
              placeholder="Concepto (ej. flete, limpieza…)"
              value={nuevoGasto.concepto}
              onChange={(e) => setNuevoGasto({ ...nuevoGasto, concepto: e.target.value })}
            />
            <input
              required
              type="number"
              min="1"
              placeholder="Monto"
              value={nuevoGasto.monto}
              onChange={(e) => setNuevoGasto({ ...nuevoGasto, monto: e.target.value })}
            />
            {proveedoresGasto.length > 0 && (
              <select
                value={nuevoGasto.proveedor_id}
                onChange={(e) => setNuevoGasto({ ...nuevoGasto, proveedor_id: e.target.value })}
              >
                <option value="">Sin proveedor asociado</option>
                {proveedoresGasto.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="btn btn-primary" disabled={registrandoGasto}>
              {registrandoGasto ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="btn" onClick={() => setMostrarFormGasto(false)}>
              Cancelar
            </button>
          </form>
        )}

        <div className="caja-gastos-lista">
          {gastosHoy.length === 0 ? (
            <div className="caja-gastos-vacio">Todavía no se registró ningún gasto hoy.</div>
          ) : (
            gastosHoy.map((g) => (
              <div className="caja-gasto-row" key={g.id}>
                <span className="caja-gasto-concepto">{g.concepto}</span>
                <span className="caja-gasto-monto">{formatearMonto(g.monto)}</span>
                {puedeEliminarGasto && (
                  <button
                    type="button"
                    className="caja-gasto-eliminar"
                    disabled={eliminandoGastoId === g.id}
                    onClick={() => eliminarGasto(g.id)}
                    title="Eliminar gasto"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
