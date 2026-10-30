import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { IconoFila } from '../components/ConAvatar.jsx';
import Hero from '../components/Hero.jsx';
import Icono from '../components/Icono.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { COLOR_MEDIO, COLOR_MEDIO_CLARO, ICONO_MEDIO, colorDe } from '../utils/colores.js';
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

// Opciones de los filtros (categoría o proveedor): solo las que tienen productos.
const nombresDe = (productos, campo) =>
  [...new Set(productos.map((p) => p[campo]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

const MEDIOS_PAGO = [
  {
    valor: 'efectivo',
    label: 'Efectivo',
    icono: (
      <svg width="18" height="18" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    valor: 'tarjeta',
    label: 'Tarjeta',
    icono: (
      <svg width="18" height="18" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </svg>
    ),
  },
  {
    valor: 'transferencia_qr',
    label: 'Transferencia / QR',
    icono: (
      <svg width="18" height="18" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="18" height="18" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1" />
        <path d="M21 12a1.5 1.5 0 0 1 0 3h-3a3 3 0 0 1 0-6h3a1.5 1.5 0 0 1 0 3z" />
      </svg>
    ),
  },
  {
    valor: 'fiado',
    label: 'Pago pendiente',
    icono: (
      <svg width="18" height="18" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
    label: 'Cuenta corriente',
    icono: (
      <svg width="18" height="18" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </svg>
    ),
  },
];

const PUEDE_ANULAR = new Set(['admin', 'encargado']);
// Caja es solo para cobrar (pedido del usuario, 2026-10-16): los números del turno y los gastos
// y pagos a proveedores pasaron a la pantalla "Ventas diarias" (VentasDiariasPage.jsx).

// Lector de código de barras tipo teclado: manda los caracteres a menos de esto entre sí (una
// persona tarda más). Largo mínimo bajo a propósito para aceptar códigos internos cortos;
// nadie tipea 6 caracteres seguidos a menos de 50 ms cada uno.
const LECTOR_MS_ENTRE_TECLAS = 50;
const LECTOR_LARGO_MINIMO = 6;

export default function CajaPage() {
  const { usuario, moduloActivo, stockEnPacks } = useAuth();
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
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);
  const [ventasHoy, setVentasHoy] = useState([]);
  const [confirmandoAnulacion, setConfirmandoAnulacion] = useState(false);
  const [anulando, setAnulando] = useState(false);
  // Cambiar el medio de pago del último ticket (Admin y Encargado, decisión del usuario 2026-10-16).
  const [cambiandoMedio, setCambiandoMedio] = useState(false);
  const [nuevoMedio, setNuevoMedio] = useState('');
  const [guardandoMedio, setGuardandoMedio] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState(false);
  // Filtros por categoría y proveedor (pedido del usuario, 2026-10-30): con uno elegido, la lista
  // muestra sus productos sin escribir nada. Los ven los tres roles.
  const [catalogo, setCatalogo] = useState([]);
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroProveedor, setFiltroProveedor] = useState('');
  const hayFiltro = Boolean(filtroCategoria || filtroProveedor);

  const searchInputRef = useRef(null);
  const cobroRef = useRef(null);
  const barraRef = useRef(null);
  // Guardia real contra doble-click (mismo criterio que "Confirmar Cierre de
  // Caja", ver hallazgo Baja #3 de verificador-funcional 2026-09-10): un ref
  // mutado sincrónicamente, no solo el estado `anulando` que gatilla el
  // re-render del `disabled` -- un doble-click muy rápido puede disparar el
  // 2do click antes de que ese re-render se complete.
  const anulandoRef = useRef(false);
  // Guardias sincrónicas: `disabled` no alcanza contra dos clicks en el mismo tick
  // (duplicaba la venta).
  const confirmandoVentaRef = useRef(false);
  const enterEnCursoRef = useRef(new Set());
  const guardandoMedioRef = useRef(false);
  const rafagasPesoRef = useRef(new Map()); // clave de línea → { antes, ultima }, ver teclaEnPeso

  const puedeAnular = PUEDE_ANULAR.has(usuario?.rol);

  // Las ventas de hoy: de ahí sale el último ticket (anular / cambiar el medio de pago).
  const cargarVentasHoy = useCallback(async () => {
    try {
      const ventasData = await api.get(`/ventas?fecha=${fechaHoyISO()}`);
      setVentasHoy(ventasData.ventas);
    } catch {
      // Si falla, solo no se ofrece "Anular último ticket": no bloquea el cobro.
    }
  }, []);

  useEffect(() => {
    cargarVentasHoy();
  }, [cargarVentasHoy]);

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

  useEffect(() => {
    api
      .get('/productos')
      .then((data) => setCatalogo(data.productos))
      .catch(() => setCatalogo([])); // sin opciones no se muestran los filtros; la búsqueda sigue
  }, []);
  const opcionesCategoria = useMemo(() => nombresDe(catalogo, 'categoria'), [catalogo]);
  const opcionesProveedor = useMemo(() => nombresDe(catalogo, 'proveedor'), [catalogo]);

  // Al bajar, la franja de cobro, el buscador y los títulos del carrito quedan fijos arriba, uno
  // debajo del otro: sus altos cambian (avisos, el cliente de cuenta corriente) y se miden.
  useEffect(() => {
    const cobro = cobroRef.current;
    const barra = barraRef.current;
    const medir = () => {
      cobro.parentElement.style.setProperty('--alto-cobro', `${cobro.offsetHeight}px`);
      cobro.parentElement.style.setProperty('--alto-barra', `${barra.offsetHeight}px`);
    };
    const observador = new ResizeObserver(medir);
    observador.observe(cobro);
    observador.observe(barra);
    return () => observador.disconnect();
  }, []);

  // La lista se cierra con un click fuera del buscador y los filtros (con un filtro queda abierta
  // encima del carrito); vuelve al tocar el buscador o un filtro.
  useEffect(() => {
    if (!mostrarResultados) return undefined;
    const alClick = (e) => {
      if (!barraRef.current?.contains(e.target)) setMostrarResultados(false);
    };
    document.addEventListener('mousedown', alClick);
    return () => document.removeEventListener('mousedown', alClick);
  }, [mostrarResultados]);

  // Con texto se busca; con un filtro y sin texto se traen todos. El filtro se aplica al mostrar
  // (`resultadosVisibles`): el Enter del lector busca el código en todos los productos.
  useEffect(() => {
    if (query.trim().length < 1 && !hayFiltro) {
      setResultados([]);
      setResultadosDe('');
      setErrorBusqueda(false);
      return;
    }
    const timeoutId = setTimeout(async () => {
      try {
        const texto = query.trim();
        const data = await api.get(texto ? `/productos?q=${encodeURIComponent(texto)}` : '/productos');
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
  }, [query, hayFiltro]);

  const resultadosVisibles = resultados.filter(
    (p) => (!filtroCategoria || p.categoria === filtroCategoria) && (!filtroProveedor || p.proveedor === filtroProveedor)
  );
  const listaAbierta = mostrarResultados && (query.trim().length > 0 || hayFiltro);

  function cambiarFiltro(setFiltro, valor) {
    setFiltro(valor);
    if (resultados.length > 0) setMostrarResultados(true);
  }

  function limpiarBusqueda() {
    setFiltroCategoria('');
    setFiltroProveedor('');
    setQuery('');
    setMostrarResultados(false);
    searchInputRef.current?.focus();
  }

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
    // Con un filtro, la lista queda abierta para sumar otro de la misma categoría o proveedor;
    // con un producto por peso se cierra, para ver su línea y escribir el peso.
    if (!hayFiltro || porPeso) {
      setResultados([]);
      setResultadosDe('');
      setMostrarResultados(false);
    }
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
        .map((s) => `${s.nombre}: ${describirStockLargo(s.stock_disponible, s, stockEnPacks)}`)
        .join(' · ');
      setExito(`Venta #${venta.id} registrada por ${formatearMonto(venta.total)}.${quedan ? ` Stock restante — ${quedan}.` : ''}`);
      setCarrito([]);
      setClienteEmpresaId('');
      cargarVentasHoy();
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
      cargarVentasHoy();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anular la venta.');
      setConfirmandoAnulacion(false);
    } finally {
      setAnulando(false);
      anulandoRef.current = false;
    }
  }

  // A ni desde Cuenta Corriente no se cambia (eso toca la deuda): se anula y se vuelve a cobrar.
  const mediosCambiables = mediosVisibles.filter((m) => m.valor !== 'cta_cte');
  const idUltimaVenta = ultimaVentaRegistrada?.id;
  // Si entra otra venta mientras está abierto, se cierra: el "último ticket" ya es otro.
  useEffect(() => {
    setCambiandoMedio(false);
  }, [idUltimaVenta]);
  const puedeCambiarMedio = Boolean(ultimaVentaRegistrada) && ultimaVentaRegistrada.medio_pago !== 'cta_cte';
  const etiquetaMedio = (valor) => MEDIOS_PAGO.find((m) => m.valor === valor)?.label ?? valor;

  function abrirCambioMedio() {
    setNuevoMedio(ultimaVentaRegistrada.medio_pago);
    setCambiandoMedio(true);
  }

  async function guardarMedioPago() {
    if (!ultimaVentaRegistrada || guardandoMedioRef.current) return;
    if (nuevoMedio === ultimaVentaRegistrada.medio_pago) return setCambiandoMedio(false);
    guardandoMedioRef.current = true;
    setGuardandoMedio(true);
    setError(null);
    try {
      await api.patch(`/ventas/${ultimaVentaRegistrada.id}`, { medio_pago: nuevoMedio });
      setExito(`Venta #${ultimaVentaRegistrada.id}: medio de pago cambiado a ${etiquetaMedio(nuevoMedio)}.`);
      setCambiandoMedio(false);
      cargarVentasHoy();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar el medio de pago.');
    } finally {
      guardandoMedioRef.current = false;
      setGuardandoMedio(false);
    }
  }

  return (
    <div className="caja-page">
      {/* Panel verde (2026-10-29): el total a cobrar arriba, como el visor de un punto de venta, con
          el medio de cobro elegido y el último ticket. Compacto, para dejarle lugar al carrito. Caja
          sigue siendo solo para cobrar. */}
      <Hero
        etiqueta="Total a cobrar"
        valor={formatearMonto(total)}
        sub={articulos === 0 ? 'Sin productos: buscá o escaneá uno para empezar.' : articulos === 1 ? '1 artículo' : `${articulos} artículos`}
        minis={[
          {
            etiqueta: 'Medio de cobro',
            valor: etiquetaMedio(medioPago),
            icono: ICONO_MEDIO[medioPago],
            color: COLOR_MEDIO_CLARO[medioPago],
          },
          ultimaVentaRegistrada
            ? {
                etiqueta: 'Último ticket',
                valor: formatearMonto(ultimaVentaRegistrada.total),
                sub: `#${ultimaVentaRegistrada.id} · ${etiquetaMedio(ultimaVentaRegistrada.medio_pago)}`,
                icono: 'ticket',
                tono: 'blanco',
              }
            : { etiqueta: 'Último ticket', valor: '—', sub: 'Todavía no hay ventas hoy', icono: 'ticket', tono: 'blanco' },
        ]}
      />

      {/* Cobro (rediseño 2026-10-30, pedido del usuario): abajo del panel, los medios de cobro en
          una fila y "Cobrar venta" al lado. Al bajar con un carrito largo queda fija arriba. */}
      <section className="card caja-cobro" aria-label="Cobro" ref={cobroRef}>
        <div className="caja-cobro-cabeza">
          <span className="caja-section-label" id="caja-medios-label">
            Medio de cobro
          </span>
          {/* El monto y el medio del último ticket están en el panel verde; acá, lo que se le puede hacer. */}
          {puedeAnular && ultimaVentaRegistrada && !cambiandoMedio && !confirmandoAnulacion && (
            <div className="caja-anular-links">
              {puedeCambiarMedio && (
                <button type="button" className="caja-anular-link" onClick={abrirCambioMedio}>
                  Cambiar medio de pago del #{ultimaVentaRegistrada.id}
                </button>
              )}
              <button type="button" className="caja-anular-link caja-anular-link-peligro" onClick={() => setConfirmandoAnulacion(true)}>
                Anular ticket #{ultimaVentaRegistrada.id}
              </button>
            </div>
          )}
        </div>

        <div className="caja-cobro-fila">
          <div
            className={`caja-medios-grid${mediosVisibles.length > 5 ? ' caja-medios-dos-filas' : ''}`}
            role="group"
            aria-labelledby="caja-medios-label"
          >
            {mediosVisibles.map((medio) => (
              <button
                type="button"
                key={medio.valor}
                className={`caja-medio-btn${medioPago === medio.valor ? ' caja-medio-btn-active' : ''}`}
                style={{ '--c': COLOR_MEDIO[medio.valor] }}
                aria-pressed={medioPago === medio.valor}
                onClick={() => setMedioPago(medio.valor)}
              >
                {medio.icono}
                <span>{medio.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary caja-cobrar"
            disabled={carrito.length === 0 || faltaPeso || enviando || (medioPago === 'cta_cte' && !clienteEmpresaId)}
            onClick={confirmarVenta}
          >
            {enviando ? 'Registrando…' : 'Cobrar venta'}
          </button>
        </div>

        {medioPago === 'cta_cte' && (
          <div className="field caja-cliente">
            <label htmlFor="caja-cliente-empresa">Cliente</label>
            {clientesEmpresa.length === 0 ? (
              <span className="caja-cliente-vacio">
                No hay clientes con cuenta corriente. Un Administrador o Encargado puede darlos de alta en Clientes.
              </span>
            ) : (
              <select id="caja-cliente-empresa" value={clienteEmpresaId} onChange={(e) => setClienteEmpresaId(e.target.value)}>
                <option value="">Seleccioná el cliente…</option>
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

        {puedeAnular && ultimaVentaRegistrada && cambiandoMedio && (
          <div className="field caja-medio-cambio">
            <label htmlFor="caja-medio-nuevo">Nuevo medio de pago del ticket #{ultimaVentaRegistrada.id}</label>
            <div className="caja-medio-cambio-fila">
              <select id="caja-medio-nuevo" value={nuevoMedio} onChange={(e) => setNuevoMedio(e.target.value)} disabled={guardandoMedio}>
                {mediosCambiables.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={() => setCambiandoMedio(false)} disabled={guardandoMedio}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={guardarMedioPago}
                disabled={guardandoMedio || nuevoMedio === ultimaVentaRegistrada.medio_pago}
              >
                {guardandoMedio ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        )}
        {puedeAnular && ultimaVentaRegistrada && confirmandoAnulacion && !cambiandoMedio && (
          <div className="caja-anular-confirm">
            <span>
              ¿Anular el ticket #{ultimaVentaRegistrada.id} por {formatearMonto(ultimaVentaRegistrada.total)}? Los productos vuelven al stock.
            </span>
            <div className="caja-anular-confirm-botones">
              <button type="button" className="btn" onClick={() => setConfirmandoAnulacion(false)} disabled={anulando}>
                Cancelar
              </button>
              <button type="button" className="btn btn-peligro" onClick={anularUltimoTicket} disabled={anulando}>
                {anulando ? 'Anulando…' : 'Anular ticket'}
              </button>
            </div>
          </div>
        )}

        {error && <div className="alert alert-danger">{error}</div>}
        {exito && <div className="alert alert-exito">{exito}</div>}
      </section>

      {/* El carrito a todo el ancho, con el buscador (lector de códigos) y los filtros. Los filtros
          usan las clases de Stock (StockPage.css). */}
      <section className="card caja-carrito" aria-label="Venta en curso">
        <div className="caja-barra" ref={barraRef}>
          <div className="caja-barra-fila">
            <div className="caja-search">
              <svg className="caja-search-icono" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Buscá o escaneá un producto…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setMostrarResultados(true)}
              />
            </div>
            {opcionesCategoria.length > 0 && (
              <select
                className={`stock-filtro${filtroCategoria ? ' stock-filtro-activo' : ''}`}
                value={filtroCategoria}
                onChange={(e) => cambiarFiltro(setFiltroCategoria, e.target.value)}
                aria-label="Filtrar por categoría"
              >
                <option value="">Todas las categorías</option>
                {opcionesCategoria.map((nombre) => (
                  <option key={nombre} value={nombre}>
                    {nombre}
                  </option>
                ))}
              </select>
            )}
            {opcionesProveedor.length > 0 && (
              <select
                className={`stock-filtro${filtroProveedor ? ' stock-filtro-activo' : ''}`}
                value={filtroProveedor}
                onChange={(e) => cambiarFiltro(setFiltroProveedor, e.target.value)}
                aria-label="Filtrar por proveedor"
              >
                <option value="">Todos los proveedores</option>
                {opcionesProveedor.map((nombre) => (
                  <option key={nombre} value={nombre}>
                    {nombre}
                  </option>
                ))}
              </select>
            )}
            {(hayFiltro || query.trim().length > 0) && (
              <button type="button" className="stock-filtro-limpiar" onClick={limpiarBusqueda}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                Limpiar
              </button>
            )}
            {listaAbierta && (
              <div className="caja-search-dropdown">
                {hayFiltro && resultadosVisibles.length > 0 && (
                  <div className="caja-search-cab">
                    <strong>{[filtroCategoria, filtroProveedor].filter(Boolean).join(' · ')}</strong>
                    {` · ${resultadosVisibles.length === 1 ? '1 producto' : `${resultadosVisibles.length} productos`}. Tocá uno para sumarlo al carrito.`}
                  </div>
                )}
                {resultadosVisibles.length === 0 && (
                  <div className="caja-search-empty">
                    {errorBusqueda
                      ? 'No se pudo conectar con el servidor. Probá de nuevo en unos segundos.'
                      : hayFiltro
                        ? 'Ningún producto coincide con la búsqueda y los filtros.'
                        : 'Sin resultados.'}
                  </div>
                )}
                {resultadosVisibles.map((producto) => {
                  const opciones = opcionesDeVenta(producto);
                  const nombreYStock = (
                    <span className="caja-search-cabeza">
                      <IconoFila icono="paquete" color={colorDe(producto.id)} />
                      <span className="caja-search-nombre">
                        {producto.nombre}
                        <span className="caja-search-stock">Stock: {describirStockLargo(producto.stock_disponible, producto, stockEnPacks)}</span>
                      </span>
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
                        {opciones[0]?.presentacion === 'pack' && <span className="caja-search-item-pack-label">{opciones[0].etiqueta}</span>}
                        {opciones[0]?.precio}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="caja-cart-list">
          {carrito.length === 0 ? (
            <div className="caja-cart-empty">
              <span className="caja-cart-empty-icono">
                <Icono nombre="carrito" tam={26} />
              </span>
              <strong>El carrito está vacío</strong>
              <span>Buscá un producto o escaneá su código.</span>
            </div>
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
                    <IconoFila icono="paquete" color={colorDe(item.producto_id)} />
                    <span className="caja-cart-nombre-col">
                      <span className="caja-cart-nombre-texto">{item.nombre}</span>
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
                      {porPeso && !(item.cantidad > 0) && <span className="caja-cart-warning">Ingresá el peso</span>}
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
                      <span className="caja-cart-stepper">
                        <button type="button" onClick={() => cambiarCantidad(item.clave, -1)} aria-label={`Restar uno de ${item.nombre}`}>
                          –
                        </button>
                        <span>{item.cantidad}</span>
                        <button type="button" onClick={() => cambiarCantidad(item.clave, 1)} aria-label={`Sumar uno de ${item.nombre}`}>
                          +
                        </button>
                      </span>
                    )}
                  </span>
                  <span style={{ flex: 1, textAlign: 'right' }} className="caja-cart-precio">
                    {formatearMonto(precio)}
                    {!porPack && sufijoPrecio(medida)}
                  </span>
                  <span style={{ flex: 1, textAlign: 'right' }} className="caja-cart-subtotal">
                    {formatearMonto(subtotalLinea(item.producto, item.cantidad, item.presentacion))}
                  </span>
                  <span style={{ width: 32, display: 'flex', justifyContent: 'center' }} className="caja-cart-quitar">
                    <button
                      type="button"
                      className="caja-cart-remove"
                      onClick={() => quitarDelCarrito(item.clave)}
                      title="Quitar"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      </section>
    </div>
  );
}
