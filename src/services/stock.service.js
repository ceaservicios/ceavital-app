import db from '../db/connection.js';
import { hoyNegocio, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
import { ApiError } from '../utils/api-error.js';
import { factorMedida, MEDIDAS } from './presentacion.js';

// Precios y forma de venta: editarlos en un producto ya cargado es solo del Admin.
const CAMPOS_PRECIO = ['precio_costo', 'precio_venta', 'pack', 'precio_cantidad', 'vende_suelto', 'medida'];

// Topes de longitud de los textos libres (sin tope, un nombre de 90.000 caracteres se guardaba).
const MAX_TEXTO = 200;
const MAX_CODIGO_BARRAS = 50;

function validarString(valor, campo, { requerido = true, maxLength = MAX_TEXTO } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ApiError(400, `${campo} es requerido`);
    return null;
  }
  if (typeof valor !== 'string') throw new ApiError(400, `${campo} tiene que ser texto`);
  const limpio = valor.trim();
  if (limpio.length > maxLength) throw new ApiError(400, `${campo} no puede superar ${maxLength} caracteres`);
  return limpio;
}

function validarEntero(valor, campo, { requerido = true, minimo = null } = {}) {
  // Un campo vacío ("" o solo espacios) es "no cargado", no 0: Number('') vale 0 y un
  // precio en blanco terminaba guardado como $0.
  if (valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '')) {
    if (requerido) throw new ApiError(400, `${campo} es requerido`);
    return null;
  }
  const n = Number(valor);
  if (!Number.isInteger(n)) throw new ApiError(400, `${campo} tiene que ser un número entero`);
  if (minimo !== null && n < minimo) throw new ApiError(400, `${campo} no puede ser menor a ${minimo}`);
  return n;
}

function validarFecha(valor, campo) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new ApiError(400, `${campo} tiene que tener formato YYYY-MM-DD`);
  }
  // El formato solo no alcanza: "2026-99-99" lo cumple. Se comprueba que el día exista.
  const fecha = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
    throw new ApiError(400, `${campo} no es una fecha válida`);
  }
  return valor;
}

// "Costos y márgenes -- Ver" es exclusivo del Admin (Docs\Roles-y-Permisos.md):
// ni Encargado ni Cajero ven precio_costo, ni siquiera de un producto que ellos
// mismos crearon (Ver y Editar son permisos distintos en la matriz).
function ocultarCosto(producto, rol) {
  if (rol === 'admin') return producto;
  const { precio_costo, costo_pack, ...resto } = producto;
  return resto;
}

// stock_reservado: unidades apartadas por pedidos de clientes-empresa pendientes
// (B2B Fase 2). stock_vendible sigue siendo lo físico no vencido; lo que Caja
// puede vender de verdad es stock_disponible = vendible - reservado.
function conAlerta(producto) {
  return {
    ...producto,
    stock_disponible: Math.max(0, producto.stock_vendible - producto.stock_reservado),
    alerta_stock_bajo: producto.stock_total <= producto.stock_minimo,
  };
}

async function verificarProveedorActivo(proveedorId) {
  if (proveedorId === null || proveedorId === undefined) return;
  const proveedor = await db
    .prepare('SELECT id FROM proveedores WHERE id = ? AND eliminado_en IS NULL')
    .get(proveedorId);
  if (!proveedor) throw new ApiError(400, 'El proveedor indicado no existe o está eliminado');
}

// Categoría y unidad de medida son claves foráneas a los catálogos
// (Configuración): nada de texto libre ("Kg"/"kg" como 2 valores distintos).
async function obtenerCategoriaActiva(categoriaId) {
  if (categoriaId === null || categoriaId === undefined) return null;
  const fila = await db.prepare('SELECT * FROM categorias WHERE id = ? AND eliminado_en IS NULL').get(categoriaId);
  if (!fila) throw new ApiError(400, 'La categoría indicada no existe o está eliminada');
  return fila;
}

async function obtenerUnidadMedidaActiva(unidadMedidaId) {
  const fila = await db
    .prepare('SELECT * FROM unidades_medida WHERE id = ? AND eliminado_en IS NULL')
    .get(unidadMedidaId);
  if (!fila) throw new ApiError(400, 'La unidad de medida indicada no existe o está eliminada');
  return fila;
}

// El código de barras no distingue mayúsculas ("abc123" = "ABC123"; índice único
// sobre LOWER(codigo_barras), migración 009). Desde la venta por pack (migración 018)
// un código no puede repetirse ni como código de unidad ni como código de pack de
// ningún producto activo: al escanearlo en Caja tiene que haber una sola respuesta.
async function verificarCodigoBarrasLibre(codigoBarras, excluirProductoId = null) {
  if (!codigoBarras) return;
  const existente = await db
    .prepare(
      `SELECT id FROM productos
       WHERE (LOWER(codigo_barras) = LOWER(?) OR LOWER(codigo_barras_pack) = LOWER(?))
         AND eliminado_en IS NULL AND id != ?`
    )
    .get(codigoBarras, codigoBarras, excluirProductoId ?? -1);
  if (existente) throw new ApiError(409, `Ya existe un producto activo con el código de barras "${codigoBarras}"`);
}

function verificarCodigosDistintos(codigoUnidad, codigoPack) {
  if (codigoUnidad && codigoPack && codigoUnidad.toLowerCase() === codigoPack.toLowerCase()) {
    throw new ApiError(400, 'El código de barras del pack tiene que ser distinto al de la unidad');
  }
}

// Venta por pack (2026-10-11): `pack` = null (no se vende por pack) o
// { nombre, unidades, precio, codigo_barras }. Todo junto o nada (CHECK de la migración 018).
function validarPack(pack) {
  if (pack === null) {
    return { pack_nombre: null, pack_unidades: null, precio_pack: null, codigo_barras_pack: null };
  }
  if (typeof pack !== 'object' || Array.isArray(pack)) throw new ApiError(400, 'pack tiene que ser un objeto o null');
  const unidades = validarEntero(pack.unidades, 'Unidades que trae el pack', { minimo: 2 });
  if (unidades > 10_000_000) throw new ApiError(400, 'Lo que trae el pack es demasiado grande');
  return {
    pack_nombre: validarString(pack.nombre, 'Nombre del pack', { maxLength: 20 }),
    pack_unidades: unidades,
    precio_pack: validarEntero(pack.precio, 'Precio del pack', { minimo: 0 }),
    codigo_barras_pack: validarString(pack.codigo_barras, 'Código de barras del pack', { requerido: false, maxLength: MAX_CODIGO_BARRAS }),
    // Costo del pack: solo se usa si el producto se vende únicamente por pack (2026-10-11).
    costo_pack: validarEntero(pack.costo, 'Costo del pack', { requerido: false, minimo: 0 }),
  };
}

// Forma de medir y formas de venta (migración 019, decisiones del usuario del 2026-10-11):
// - medida 'unidad' | 'kg' | 'litro' (kg/litro en gramos/ml, precios por kg/litro);
// - vende_suelto y/o pack: al menos una de las dos. Suelto pide precio de venta y costo; si se
//   vende solo por pack, se pide el costo del pack (así se compra) y el precio y el costo de
//   referencia por unidad/kg salen del pack. El precio por cantidad es solo para el suelto.
// `estado` es el producto completo como va a quedar (alta, o fila actual + cambios).
function resolverFormas(estado) {
  if (!MEDIDAS.includes(estado.medida)) throw new ApiError(400, 'medida tiene que ser "unidad", "kg" o "litro"');
  if (typeof estado.vende_suelto !== 'boolean') throw new ApiError(400, 'vende_suelto tiene que ser true o false');
  const tienePack = estado.pack_nombre != null;
  if (!estado.vende_suelto && !tienePack) {
    throw new ApiError(400, 'Elegí al menos una forma de venta: suelto o por caja/pack');
  }
  if (estado.vende_suelto) {
    if (estado.precio_venta == null) throw new ApiError(400, 'Falta el precio de venta suelto');
    if (estado.precio_costo == null) throw new ApiError(400, 'Falta el costo');
    return { ...estado, costo_pack: null };
  }
  if (estado.precio_cantidad_desde != null) {
    throw new ApiError(400, 'El precio por cantidad es para la venta suelta: este producto se vende solo por pack');
  }
  if (estado.costo_pack == null) throw new ApiError(400, `Falta el costo por ${String(estado.pack_nombre).toLowerCase()}`);
  const f = factorMedida(estado.medida);
  return {
    ...estado,
    precio_venta: Math.round((estado.precio_pack * f) / estado.pack_unidades),
    precio_costo: Math.round((estado.costo_pack * f) / estado.pack_unidades),
  };
}

function validarMedida(valor) {
  if (valor === undefined || valor === null || valor === '') return 'unidad';
  if (!MEDIDAS.includes(valor)) throw new ApiError(400, 'medida tiene que ser "unidad", "kg" o "litro"');
  return valor;
}

function validarVendeSuelto(valor) {
  if (valor === undefined || valor === null) return true;
  if (typeof valor !== 'boolean') throw new ApiError(400, 'vende_suelto tiene que ser true o false');
  return valor;
}

// Precio por cantidad: null o { desde, precio } (desde N unidades de este producto, toda la
// línea sale a `precio`). Solo para la venta por unidad.
function validarPrecioCantidad(valor) {
  if (valor === null) return { precio_cantidad_desde: null, precio_cantidad: null };
  if (typeof valor !== 'object' || Array.isArray(valor)) throw new ApiError(400, 'precio_cantidad tiene que ser un objeto o null');
  const desde = validarEntero(valor.desde, 'A partir de cuántas', { minimo: 2 });
  if (desde > 10_000_000) throw new ApiError(400, 'A partir de cuántas es demasiado grande');
  return {
    precio_cantidad_desde: desde,
    precio_cantidad: validarEntero(valor.precio, 'Precio por cantidad', { minimo: 0 }),
  };
}

// Cantidad de un lote: en unidades o, con `en_packs`, en packs del producto (se guarda en
// unidades). Ingreso de mercadería en packs, decisión del usuario del 2026-10-11.
function unidadesDelLote(cantidad, enPacks, packUnidades) {
  if (enPacks !== true) return cantidad;
  if (!packUnidades) throw new ApiError(400, 'Este producto no tiene pack: cargá la cantidad en unidades');
  const unidades = cantidad * packUnidades;
  if (unidades > 10_000_000) throw new ApiError(400, 'La cantidad es demasiado grande');
  return unidades;
}

async function obtenerProductoActivo(productoId) {
  const producto = await db.prepare('SELECT id FROM productos WHERE id = ? AND eliminado_en IS NULL').get(productoId);
  if (!producto) throw new ApiError(404, 'Producto no encontrado');
  return producto;
}

async function obtenerLoteActivo(productoId, loteId) {
  const lote = await db
    .prepare('SELECT * FROM lotes WHERE id = ? AND producto_id = ? AND eliminado_en IS NULL')
    .get(loteId, productoId);
  if (!lote) throw new ApiError(404, 'Lote no encontrado');
  return lote;
}

// stock_total: suma de todos los lotes activos. stock_vendible: igual pero
// excluyendo lotes vencidos (Docs\Modelo-de-Datos.md > productos/lotes). "Vencido"
// se mide contra el día de hoy en Argentina. categoria/unidad_medida salen del
// JOIN contra los catálogos (contrato de la API: strings). El JOIN no filtra
// por eliminado_en del catálogo a propósito: un producto ya cargado con una
// categoría que después se desactivó sigue mostrando su nombre real, no un "—"
// (mismo espíritu del proyecto: nunca perder historial).
const SELECT_PRODUCTOS_CON_STOCK = `
  SELECT
    p.id, p.nombre, p.codigo_barras, p.precio_costo, p.precio_venta,
    p.proveedor_id, p.stock_minimo, p.dias_aviso_vencimiento,
    p.eliminado_en, p.creado_en, p.actualizado_en,
    p.categoria_id, c.nombre AS categoria,
    p.unidad_medida_id, u.nombre AS unidad_medida,
    p.medida, p.vende_suelto, p.costo_pack,
    p.pack_nombre, p.pack_unidades, p.precio_pack, p.codigo_barras_pack,
    p.precio_cantidad_desde, p.precio_cantidad,
    COALESCE(SUM(l.cantidad), 0) AS stock_total,
    COALESCE(SUM(CASE WHEN l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= ${SQL_HOY_NEGOCIO} THEN l.cantidad ELSE 0 END), 0) AS stock_vendible,
    COALESCE((
      SELECT SUM(i.cantidad) FROM pedido_cliente_items i
      JOIN pedidos_cliente pc ON pc.id = i.pedido_id
      WHERE i.producto_id = p.id AND pc.estado = 'pendiente'
    ), 0) AS stock_reservado
  FROM productos p
  LEFT JOIN lotes l ON l.producto_id = p.id AND l.eliminado_en IS NULL
  LEFT JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN unidades_medida u ON u.id = p.unidad_medida_id
`;

export async function listarProductos({ rol, buscar, codigoBarras }) {
  const condiciones = ['p.eliminado_en IS NULL'];
  const params = [];

  if (codigoBarras) {
    condiciones.push('(LOWER(p.codigo_barras) = LOWER(?) OR LOWER(p.codigo_barras_pack) = LOWER(?))');
    params.push(codigoBarras, codigoBarras);
  } else if (buscar) {
    condiciones.push('(p.nombre ILIKE ? OR p.codigo_barras ILIKE ? OR p.codigo_barras_pack ILIKE ?)');
    params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
  }

  const sql = `${SELECT_PRODUCTOS_CON_STOCK} WHERE ${condiciones.join(' AND ')} GROUP BY p.id, c.id, u.id ORDER BY LOWER(p.nombre)`;
  const productos = await db.prepare(sql).all(...params);

  // coincide_codigo: si lo buscado es exactamente el código de la unidad o el del pack.
  // Caja lo usa al escanear: el código del pack agrega un pack sin preguntar.
  const texto = (codigoBarras || buscar || '').trim().toLowerCase();
  return productos.map((p) => ({
    ...ocultarCosto(conAlerta(p), rol),
    coincide_codigo:
      texto && p.codigo_barras?.toLowerCase() === texto
        ? 'unidad'
        : texto && p.codigo_barras_pack?.toLowerCase() === texto
          ? 'pack'
          : null,
  }));
}

export async function obtenerProducto(id, { rol }) {
  const producto = await db
    .prepare(`${SELECT_PRODUCTOS_CON_STOCK} WHERE p.id = ? AND p.eliminado_en IS NULL GROUP BY p.id, c.id, u.id`)
    .get(id);
  if (!producto) throw new ApiError(404, 'Producto no encontrado');

  // Orden FEFO: primero los lotes con fecha de vencimiento (el que vence
  // antes, primero); los que no tienen fecha (no perecederos) van al final,
  // ordenados entre si por fecha_ingreso (FIFO). "(fecha_vencimiento IS NULL)"
  // es false/true -- ordenar ASC deja primero a los que SI tienen fecha.
  const lotes = await db
    .prepare(
      `SELECT *, (fecha_vencimiento IS NOT NULL AND fecha_vencimiento < ${SQL_HOY_NEGOCIO}) AS vencido
       FROM lotes
       WHERE producto_id = ? AND eliminado_en IS NULL
       ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC, fecha_ingreso ASC`
    )
    .all(id);

  return {
    ...ocultarCosto(conAlerta(producto), rol),
    lotes: lotes.map((l) => ({ ...l, vencido: Boolean(l.vencido) })),
  };
}

export async function crearProducto(datos, { rol }) {
  const nombre = validarString(datos.nombre, 'nombre');
  const codigoBarras = validarString(datos.codigo_barras, 'codigo_barras', { requerido: false, maxLength: MAX_CODIGO_BARRAS });
  const categoriaId = datos.categoria_id != null ? validarEntero(datos.categoria_id, 'categoria_id') : null;
  // La unidad del catálogo quedó como dato histórico (migración 019): opcional.
  const unidadMedidaId = datos.unidad_medida_id != null ? validarEntero(datos.unidad_medida_id, 'unidad_medida_id') : null;
  const medida = validarMedida(datos.medida);
  const vendeSuelto = validarVendeSuelto(datos.vende_suelto);
  const proveedorId = datos.proveedor_id != null ? validarEntero(datos.proveedor_id, 'proveedor_id') : null;
  const stockMinimo =
    datos.stock_minimo != null ? validarEntero(datos.stock_minimo, 'stock_minimo', { minimo: 0 }) : 0;
  const diasAviso =
    datos.dias_aviso_vencimiento != null
      ? validarEntero(datos.dias_aviso_vencimiento, 'dias_aviso_vencimiento', { minimo: 0 })
      : null;
  // Pack y precio por cantidad (opcionales): el Encargado también los carga al crear,
  // igual que el precio de venta inicial.
  const pack = validarPack(datos.pack ?? null);
  const precioCantidad = validarPrecioCantidad(datos.precio_cantidad ?? null);
  verificarCodigosDistintos(codigoBarras, pack.codigo_barras_pack);
  const formas = resolverFormas({
    medida,
    vende_suelto: vendeSuelto,
    precio_venta: vendeSuelto ? validarEntero(datos.precio_venta, 'Precio de venta', { minimo: 0 }) : null,
    precio_costo: vendeSuelto ? validarEntero(datos.precio_costo, 'Costo', { minimo: 0 }) : null,
    ...pack,
    ...precioCantidad,
  });

  // Lote inicial opcional, directo en la misma alta (corrección 2026-09-15:
  // antes había que crear el producto y recién en un segundo paso separado
  // -- "Ingreso de Nuevo Lote", pensado para reponer stock de un producto YA
  // existente -- cargar el primer lote). Si no se manda (o cantidad es 0),
  // el producto queda creado sin stock -- catálogo cargado antes de que
  // llegue la mercadería sigue siendo un caso válido.
  let loteInicial = null;
  if (datos.lote_inicial != null) {
    if (typeof datos.lote_inicial !== 'object') throw new ApiError(400, 'lote_inicial tiene que ser un objeto');
    // Cantidad vacía/0: se interpreta como "sin lote inicial todavía", no
    // como un error -- catálogo cargado antes de que llegue la mercadería.
    // Un valor no numérico (ej. "abc") ya no se ignora en silencio: cae en
    // validarEntero y responde 400. Solo vacío/0 significa "sin lote todavía".
    const cantidadCargada = datos.lote_inicial.cantidad;
    const sinLote = cantidadCargada == null || cantidadCargada === '' || Number(cantidadCargada) === 0;
    if (!sinLote) {
      loteInicial = {
        cantidad: unidadesDelLote(
          validarEntero(datos.lote_inicial.cantidad, 'lote_inicial.cantidad', { minimo: 1 }),
          datos.lote_inicial.en_packs,
          pack.pack_unidades
        ),
        fecha_ingreso:
          datos.lote_inicial.fecha_ingreso != null
            ? validarFecha(datos.lote_inicial.fecha_ingreso, 'lote_inicial.fecha_ingreso')
            : hoyNegocio(),
        fecha_vencimiento:
          datos.lote_inicial.fecha_vencimiento != null
            ? validarFecha(datos.lote_inicial.fecha_vencimiento, 'lote_inicial.fecha_vencimiento')
            : null,
      };
    }
  }

  // Todo en una transacción: si algo falla, el producto no queda huérfano
  // creado sin querer (ni sin su lote inicial).
  const productoId = await db.transaction(async () => {
    await verificarProveedorActivo(proveedorId);
    await verificarCodigoBarrasLibre(codigoBarras);
    await verificarCodigoBarrasLibre(pack.codigo_barras_pack);
    await obtenerCategoriaActiva(categoriaId);
    if (unidadMedidaId !== null) await obtenerUnidadMedidaActiva(unidadMedidaId);

    const producto = await db
      .prepare(
        `INSERT INTO productos
           (nombre, codigo_barras, precio_costo, precio_venta, categoria_id, unidad_medida_id, proveedor_id, stock_minimo, dias_aviso_vencimiento,
            medida, vende_suelto, costo_pack,
            pack_nombre, pack_unidades, precio_pack, codigo_barras_pack, precio_cantidad_desde, precio_cantidad)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`
      )
      .get(
        nombre, codigoBarras, formas.precio_costo, formas.precio_venta, categoriaId, unidadMedidaId, proveedorId, stockMinimo, diasAviso,
        formas.medida, formas.vende_suelto, formas.costo_pack,
        formas.pack_nombre, formas.pack_unidades, formas.precio_pack, formas.codigo_barras_pack,
        formas.precio_cantidad_desde, formas.precio_cantidad
      );

    if (loteInicial) {
      await db
        .prepare(`INSERT INTO lotes (producto_id, cantidad, fecha_ingreso, fecha_vencimiento) VALUES (?, ?, ?, ?)`)
        .run(producto.id, loteInicial.cantidad, loteInicial.fecha_ingreso, loteInicial.fecha_vencimiento);
    }
    return producto.id;
  });

  return obtenerProducto(productoId, { rol });
}

export async function editarProducto(id, datos, { rol }) {
  // "Precios (costo/venta) -- Editar" es exclusivo del Admin (distinto de
  // "Stock -- Editar: alta, lotes, ajustes", que incluye tambien al Encargado).
  // El pack, el precio por cantidad y las formas de venta y de medir también (2026-10-11).
  const tocaPrecios = CAMPOS_PRECIO.some((c) => datos[c] !== undefined);

  await db.transaction(async () => {
    await obtenerProductoActivo(id);

    if (tocaPrecios && rol !== 'admin') {
      throw new ApiError(403, 'Solo el Admin puede editar precios (costo/venta)');
    }

    const actualizaciones = {};

    if (datos.nombre !== undefined) actualizaciones.nombre = validarString(datos.nombre, 'nombre');
    if (datos.categoria_id !== undefined) {
      actualizaciones.categoria_id = datos.categoria_id === null ? null : validarEntero(datos.categoria_id, 'categoria_id');
      await obtenerCategoriaActiva(actualizaciones.categoria_id);
    }
    if (datos.unidad_medida_id !== undefined) {
      actualizaciones.unidad_medida_id =
        datos.unidad_medida_id === null ? null : validarEntero(datos.unidad_medida_id, 'unidad_medida_id');
      if (actualizaciones.unidad_medida_id !== null) await obtenerUnidadMedidaActiva(actualizaciones.unidad_medida_id);
    }
    if (datos.stock_minimo !== undefined) {
      actualizaciones.stock_minimo = validarEntero(datos.stock_minimo, 'stock_minimo', { minimo: 0 });
    }
    if (datos.dias_aviso_vencimiento !== undefined) {
      actualizaciones.dias_aviso_vencimiento =
        datos.dias_aviso_vencimiento === null
          ? null
          : validarEntero(datos.dias_aviso_vencimiento, 'dias_aviso_vencimiento', { minimo: 0 });
    }
    if (datos.proveedor_id !== undefined) {
      actualizaciones.proveedor_id = datos.proveedor_id === null ? null : validarEntero(datos.proveedor_id, 'proveedor_id');
      await verificarProveedorActivo(actualizaciones.proveedor_id);
    }
    if (datos.codigo_barras !== undefined) {
      actualizaciones.codigo_barras = validarString(datos.codigo_barras, 'codigo_barras', { requerido: false, maxLength: MAX_CODIGO_BARRAS });
      await verificarCodigoBarrasLibre(actualizaciones.codigo_barras, id);
    }
    // Precios y formas de venta: se arma el producto completo como va a quedar (fila actual +
    // cambios) y se valida entero, así nunca queda sin forma de venta ni con precios sueltos.
    if (tocaPrecios) {
      const actual = await db
        .prepare(
          `SELECT medida, vende_suelto, precio_venta, precio_costo, costo_pack, pack_nombre, pack_unidades, precio_pack,
             codigo_barras_pack, precio_cantidad_desde, precio_cantidad
           FROM productos WHERE id = ?`
        )
        .get(id);
      const estado = { ...actual };
      if (datos.medida !== undefined) {
        estado.medida = validarMedida(datos.medida);
        if (estado.medida !== actual.medida) {
          // Kg y litro van en gramos/ml: con stock o ventas, cambiar la medida cambiaría su sentido.
          const movimientos = await db
            .prepare(
              `SELECT (SELECT COUNT(*) FROM lotes WHERE producto_id = ?) + (SELECT COUNT(*) FROM venta_items WHERE producto_id = ?)
                 + (SELECT COUNT(*) FROM pedido_cliente_items WHERE producto_id = ?) AS n`
            )
            .get(id, id, id);
          if (Number(movimientos.n) > 0) {
            throw new ApiError(409, 'La forma de medir no se puede cambiar: el producto ya tiene stock o ventas');
          }
        }
      }
      if (datos.vende_suelto !== undefined) estado.vende_suelto = validarVendeSuelto(datos.vende_suelto);
      if (datos.precio_venta !== undefined) estado.precio_venta = validarEntero(datos.precio_venta, 'Precio de venta', { minimo: 0 });
      if (datos.precio_costo !== undefined) estado.precio_costo = validarEntero(datos.precio_costo, 'Costo', { minimo: 0 });
      if (datos.pack !== undefined) {
        Object.assign(estado, validarPack(datos.pack));
        if (datos.pack !== null && datos.pack.costo === undefined) estado.costo_pack = actual.costo_pack;
        await verificarCodigoBarrasLibre(estado.codigo_barras_pack, id);
      }
      if (datos.precio_cantidad !== undefined) Object.assign(estado, validarPrecioCantidad(datos.precio_cantidad));
      // De "solo por pack" a suelto: el precio suelto se pide, no se toma el de referencia.
      if (estado.vende_suelto && !actual.vende_suelto && (datos.precio_venta === undefined || datos.precio_costo === undefined)) {
        throw new ApiError(400, 'Para venderlo suelto, cargá el precio de venta y el costo sueltos');
      }
      const final = resolverFormas(estado);
      for (const campo of Object.keys(actual)) actualizaciones[campo] = final[campo];
    }
    if (datos.codigo_barras !== undefined || datos.pack !== undefined) {
      const actual = await db.prepare('SELECT codigo_barras, codigo_barras_pack FROM productos WHERE id = ?').get(id);
      verificarCodigosDistintos(
        'codigo_barras' in actualizaciones ? actualizaciones.codigo_barras : actual.codigo_barras,
        'codigo_barras_pack' in actualizaciones ? actualizaciones.codigo_barras_pack : actual.codigo_barras_pack
      );
    }

    const claves = Object.keys(actualizaciones);
    if (claves.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');

    const set = claves.map((c) => `${c} = ?`).join(', ');
    const valores = claves.map((c) => actualizaciones[c]);

    await db
      .prepare(`UPDATE productos SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...valores, id);
  });

  return obtenerProducto(id, { rol });
}

// "Pasar a unidad + pack" (2026-10-11): para un producto que se cargó con un envase como
// unidad de medida ("Caja x 12") y por eso cuenta, cobra y descuenta de a una caja. Queda
// con una unidad suelta y la caja como pack, y todo lo que estaba contado en cajas pasa a
// unidades con la copia del pack, así significa lo mismo que antes:
// - lotes (también los retirados, por si una anulación reingresa en ellos): cantidad × N;
// - líneas de venta y de pedidos de clientes sin pack: cantidad × N + pack copiado (el precio
//   de la línea era el de la caja = precio del pack, y el subtotal no cambia);
// - precios: el de venta que tenía pasa a ser el del pack; el costo, dividido por N.
// Los pedidos a proveedores son administrativos y no mueven stock: no se tocan.
// Solo Admin (son precios). No se permite si ya tiene pack o precio por cantidad.
// Desde la migración 019 queda medido por unidad y puede quedar "solo por caja"
// (vende_suelto: false): ahí no se pide precio suelto y el costo que tenía es el de la caja.
export async function pasarAPack(id, datos, { rol }) {
  if (rol !== 'admin') throw new ApiError(403, 'Solo el Admin puede pasar un producto a unidad + pack');
  const unidadMedidaId = datos.unidad_medida_id != null ? validarEntero(datos.unidad_medida_id, 'Unidad suelta') : null;
  const packNombre = validarString(datos.pack_nombre, 'Nombre del pack', { maxLength: 20 });
  const n = validarEntero(datos.pack_unidades, 'Unidades que trae', { minimo: 2 });
  if (n > 100000) throw new ApiError(400, 'Unidades que trae no puede superar 100000');
  const vendeSuelto = validarVendeSuelto(datos.vende_suelto);
  const precioUnidad = vendeSuelto ? validarEntero(datos.precio_venta, 'Precio de venta por unidad', { minimo: 0 }) : null;
  const codigoUnidad = validarString(datos.codigo_barras_unidad, 'Código de barras de la unidad', {
    requerido: false,
    maxLength: MAX_CODIGO_BARRAS,
  });
  const codigoEsDelPack = datos.codigo_es_del_pack === true;

  await db.transaction(async () => {
    const actual = await db
      .prepare(
        `SELECT id, nombre, codigo_barras, precio_costo, precio_venta, pack_nombre, precio_cantidad_desde, stock_minimo, medida
         FROM productos WHERE id = ? AND eliminado_en IS NULL`
      )
      .get(id);
    if (!actual) throw new ApiError(404, 'Producto no encontrado');
    if (actual.medida !== 'unidad') throw new ApiError(409, `"${actual.nombre}" se vende por ${actual.medida}: no es una caja`);
    if (actual.stock_minimo * n > 1_000_000) throw new ApiError(400, 'Con esa cantidad por pack el stock mínimo superaría 1.000.000 de unidades');
    if (actual.pack_nombre) throw new ApiError(409, `"${actual.nombre}" ya se vende por pack`);
    if (actual.precio_cantidad_desde != null) {
      throw new ApiError(409, 'Sacale primero el precio por cantidad: estaba pensado por caja y no se puede convertir solo');
    }
    if (unidadMedidaId !== null) await obtenerUnidadMedidaActiva(unidadMedidaId);

    const maxLote = await db.prepare('SELECT COALESCE(MAX(cantidad), 0) AS m FROM lotes WHERE producto_id = ?').get(id);
    if (maxLote.m * n > 1_000_000) throw new ApiError(400, 'Con esa cantidad por pack algún lote superaría 1.000.000 de unidades');
    // Las líneas viejas también se multiplican: que ninguna se pase del entero de la columna.
    for (const tabla of ['venta_items', 'pedido_cliente_items']) {
      const maxLinea = await db.prepare(`SELECT COALESCE(MAX(cantidad), 0) AS m FROM ${tabla} WHERE producto_id = ?`).get(id);
      if (maxLinea.m * n > 2_000_000_000) throw new ApiError(400, 'Con esa cantidad por pack una venta o pedido viejo quedaría fuera de rango');
    }

    // El código que tenía: si es el que trae la caja, pasa a ser el del pack.
    const codigoPack = codigoEsDelPack ? actual.codigo_barras : null;
    const codigoNuevo = codigoEsDelPack ? codigoUnidad : actual.codigo_barras;
    if (codigoEsDelPack) await verificarCodigoBarrasLibre(codigoUnidad, id);
    verificarCodigosDistintos(codigoNuevo, codigoPack);

    await db.prepare('UPDATE lotes SET cantidad = cantidad * ?, actualizado_en = CURRENT_TIMESTAMP WHERE producto_id = ?').run(n, id);
    for (const tabla of ['venta_items', 'pedido_cliente_items']) {
      // Primero las líneas de un pack que el producto tuvo antes y se sacó ("Pallet x 10" de
      // cajas): sus unidades también eran cajas; se conserva el nombre y pasan a unidades
      // sueltas. Va antes que las sueltas para no multiplicar dos veces las que se convierten.
      await db
        .prepare(
          `UPDATE ${tabla} SET cantidad = cantidad * ?, pack_unidades = pack_unidades * ?
           WHERE producto_id = ? AND pack_nombre IS NOT NULL`
        )
        .run(n, n, id);
      await db
        .prepare(
          `UPDATE ${tabla} SET cantidad = cantidad * ?, pack_nombre = ?, pack_unidades = ?, precio_cantidad_desde = NULL
           WHERE producto_id = ? AND pack_nombre IS NULL`
        )
        .run(n, packNombre, n, id);
    }
    await db
      .prepare(
        `UPDATE productos SET unidad_medida_id = ?, codigo_barras = ?, precio_venta = ?, precio_costo = ?,
           stock_minimo = stock_minimo * ?, medida = 'unidad', vende_suelto = ?, costo_pack = ?,
           pack_nombre = ?, pack_unidades = ?, precio_pack = ?, codigo_barras_pack = ?, actualizado_en = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(
        unidadMedidaId, codigoNuevo,
        // Solo por caja: el precio por unidad queda de referencia (caja / N) y el costo de la caja, entero.
        vendeSuelto ? precioUnidad : Math.round(actual.precio_venta / n),
        Math.round(actual.precio_costo / n), n,
        vendeSuelto, vendeSuelto ? null : actual.precio_costo,
        packNombre, n, actual.precio_venta, codigoPack, id
      );
  });

  return obtenerProducto(id, { rol });
}

export async function eliminarProducto(id) {
  await obtenerProductoActivo(id);
  await db.prepare('UPDATE productos SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

// `en_packs: true`: la cantidad viene en packs del producto y se guarda en unidades.
export async function crearLote(productoId, datos) {
  const cantidadCargada = validarEntero(datos.cantidad, 'cantidad', { minimo: 1 });
  const fechaIngreso =
    datos.fecha_ingreso !== undefined && datos.fecha_ingreso !== null
      ? validarFecha(datos.fecha_ingreso, 'fecha_ingreso')
      : hoyNegocio();
  const fechaVencimiento = datos.fecha_vencimiento != null ? validarFecha(datos.fecha_vencimiento, 'fecha_vencimiento') : null;

  return db.transaction(async () => {
    await obtenerProductoActivo(productoId);
    const { pack_unidades: packUnidades } = await db.prepare('SELECT pack_unidades FROM productos WHERE id = ?').get(productoId);
    const cantidad = unidadesDelLote(cantidadCargada, datos.en_packs, packUnidades);
    return db
      .prepare(
        `INSERT INTO lotes (producto_id, cantidad, fecha_ingreso, fecha_vencimiento) VALUES (?, ?, ?, ?) RETURNING *`
      )
      .get(productoId, cantidad, fechaIngreso, fechaVencimiento);
  });
}

export async function editarLote(productoId, loteId, datos) {
  return db.transaction(async () => {
    await obtenerProductoActivo(productoId);
    await obtenerLoteActivo(productoId, loteId);

    const actualizaciones = {};
    if (datos.cantidad !== undefined) actualizaciones.cantidad = validarEntero(datos.cantidad, 'cantidad', { minimo: 0 });
    if (datos.fecha_ingreso !== undefined) actualizaciones.fecha_ingreso = validarFecha(datos.fecha_ingreso, 'fecha_ingreso');
    if (datos.fecha_vencimiento !== undefined) {
      actualizaciones.fecha_vencimiento =
        datos.fecha_vencimiento === null ? null : validarFecha(datos.fecha_vencimiento, 'fecha_vencimiento');
    }

    const claves = Object.keys(actualizaciones);
    if (claves.length === 0) throw new ApiError(400, 'No se envió ningún campo para actualizar');

    const set = claves.map((c) => `${c} = ?`).join(', ');
    const valores = claves.map((c) => actualizaciones[c]);

    return db
      .prepare(`UPDATE lotes SET ${set}, actualizado_en = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`)
      .get(...valores, loteId);
  });
}

export async function eliminarLote(productoId, loteId) {
  await obtenerProductoActivo(productoId);
  await obtenerLoteActivo(productoId, loteId);
  await db.prepare('UPDATE lotes SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(loteId);
}
