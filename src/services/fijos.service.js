import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';
import { esDiaValido, SQL_HOY_NEGOCIO } from '../utils/fecha-negocio.js';
import { SQL_PAGADO, TIPOS_CUENTA, validarMonto, validarTexto } from './saldos.service.js';

// Fijos (pedido del usuario, 2026-11-06, migración 041): lo que se paga siempre. Acá se carga qué se
// repite, cada cuánto y por cuánto. Cada vencimiento entra solo a Saldos pendientes, por fecha y
// aunque el anterior siga sin pagar, y ahí se paga como cualquier otra cuenta.

const FRECUENCIAS = ['semanal', 'quincenal', 'mensual', 'bimestral', 'anual'];
// Cada vencimiento aparece en Saldos pendientes esta cantidad de días antes.
const DIAS_ANTES = 30;
// Hasta dónde se cuenta el calendario de un fijo: unos 38 años de uno semanal.
const MAX_VENCIMIENTOS = 2000;
// Un primer vencimiento tan viejo cargaría de golpe muchas deudas que seguramente ya se pagaron.
const DIAS_ATRAS_MAXIMO = 62;

const SQL_INTERVALO = `CASE f.frecuencia
  WHEN 'semanal' THEN INTERVAL '7 days'
  WHEN 'quincenal' THEN INTERVAL '15 days'
  WHEN 'mensual' THEN INTERVAL '1 month'
  WHEN 'bimestral' THEN INTERVAL '2 months'
  ELSE INTERVAL '1 year'
END`;

// Todos los vencimientos de un fijo, contados siempre desde `desde`: así uno que vence el 31 no queda
// corrido al 28 después de febrero.
const SQL_CALENDARIO = `(SELECT (f.desde + n * (${SQL_INTERVALO}))::date AS vence FROM generate_series(0, ${MAX_VENCIMIENTOS}) AS n)`;

// proximo: el primer vencimiento desde hoy que sigue abierto o que todavía no entró a Saldos pendientes.
const SELECT_FIJO = `
  SELECT f.id, f.tipo, f.concepto, f.monto, f.frecuencia, f.desde, f.nota, f.activo,
    COALESCE(
      (SELECT MIN(cp.vence) FROM cuentas_pagar cp
       WHERE cp.fijo_id = f.id AND cp.eliminado_en IS NULL AND cp.vence >= ${SQL_HOY_NEGOCIO}
         AND (cp.monto IS NULL OR ${SQL_PAGADO} < cp.monto)),
      (SELECT MIN(v.vence) FROM ${SQL_CALENDARIO} v
       WHERE v.vence >= ${SQL_HOY_NEGOCIO} AND (f.generado_hasta IS NULL OR v.vence > f.generado_hasta))
    ) AS proximo
  FROM fijos f`;

function validarFijo(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new ApiError(400, 'Faltan los datos del fijo');
  if (!TIPOS_CUENTA.includes(datos.tipo)) throw new ApiError(400, `tipo tiene que ser uno de: ${TIPOS_CUENTA.join(', ')}`);
  if (!FRECUENCIAS.includes(datos.frecuencia)) throw new ApiError(400, `frecuencia tiene que ser una de: ${FRECUENCIAS.join(', ')}`);
  if (!esDiaValido(datos.desde)) throw new ApiError(400, 'El vencimiento no es una fecha válida (AAAA-MM-DD)');
  return {
    tipo: datos.tipo,
    concepto: validarTexto(datos.concepto, 'El nombre'),
    // Sin monto: cambia cada vez y se escribe al pagar.
    monto: datos.monto === null || datos.monto === undefined ? null : validarMonto(datos.monto, 'El monto'),
    frecuencia: datos.frecuencia,
    desde: datos.desde,
    nota: validarTexto(datos.nota, 'La nota', { requerido: false }),
  };
}

async function verificarQueNoSeaViejo(desde) {
  const { vieja } = await db.prepare(`SELECT ?::date < ${SQL_HOY_NEGOCIO} - ${DIAS_ATRAS_MAXIMO} AS vieja`).get(desde);
  if (vieja) throw new ApiError(400, `El vencimiento no puede ser de hace más de ${DIAS_ATRAS_MAXIMO} días.`);
}

async function obtenerFijoActivo(id) {
  const fijo = await db.prepare(`${SELECT_FIJO} WHERE f.id = ? AND f.eliminado_en IS NULL`).get(id);
  if (!fijo) throw new ApiError(404, 'Fijo no encontrado');
  return fijo;
}

// Entra a Saldos pendientes cada vencimiento que ya está a menos de DIAS_ANTES. Corre cada hora y al
// cargar o cambiar un fijo; `generado_hasta` y el índice único evitan repetir uno. Un vencimiento
// salteado no vuelve, porque ya quedó detrás de `generado_hasta`.
export async function generarVencimientos(fijoId = null) {
  await db.transaction(async () => {
    const nuevos = await db
      .prepare(
        `SELECT f.id, f.tipo, f.concepto, f.monto, f.frecuencia, f.nota, f.usuario_id, v.vence
         FROM fijos f
         CROSS JOIN LATERAL ${SQL_CALENDARIO} v
         WHERE f.activo AND f.eliminado_en IS NULL
           AND v.vence <= ${SQL_HOY_NEGOCIO} + ${DIAS_ANTES}
           AND (f.generado_hasta IS NULL OR v.vence > f.generado_hasta)
           ${fijoId === null ? '' : 'AND f.id = ?'}
         ORDER BY f.id, v.vence`
      )
      .all(...(fijoId === null ? [] : [fijoId]));
    for (const n of nuevos) {
      await db
        .prepare(
          `INSERT INTO cuentas_pagar (tipo, concepto, monto, vence, repeticion, nota, serie_base, fijo_id, usuario_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (fijo_id, vence) WHERE fijo_id IS NOT NULL AND eliminado_en IS NULL DO NOTHING`
        )
        .run(n.tipo, n.concepto, n.monto, n.vence, n.frecuencia, n.nota, n.vence, n.id, n.usuario_id);
      await db.prepare('UPDATE fijos SET generado_hasta = ? WHERE id = ?').run(n.vence, n.id);
    }
  });
}

// La pantalla: los fijos, y lo que falta pagar de sus vencimientos, vencido y de lo que queda del mes.
export async function listarFijos() {
  const fijos = await db.prepare(`${SELECT_FIJO} WHERE f.eliminado_en IS NULL ORDER BY f.id`).all();
  const abiertos = await db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE x.vence < ${SQL_HOY_NEGOCIO}) AS vencidos,
         COALESCE(SUM(x.falta) FILTER (WHERE x.vence < ${SQL_HOY_NEGOCIO}), 0) AS monto_vencido,
         COUNT(*) FILTER (WHERE x.del_mes) AS del_mes,
         COALESCE(SUM(x.falta) FILTER (WHERE x.del_mes), 0) AS monto_mes
       FROM (
         SELECT cp.vence, COALESCE(cp.monto, 0) - ${SQL_PAGADO} AS falta,
           cp.vence >= ${SQL_HOY_NEGOCIO} AND date_trunc('month', cp.vence) = date_trunc('month', ${SQL_HOY_NEGOCIO}) AS del_mes
         FROM cuentas_pagar cp
         WHERE cp.fijo_id IS NOT NULL AND cp.eliminado_en IS NULL AND (cp.monto IS NULL OR ${SQL_PAGADO} < cp.monto)
       ) x`
    )
    .get();
  const { hoy } = await db.prepare(`SELECT ${SQL_HOY_NEGOCIO}::text AS hoy`).get();
  return {
    hoy,
    fijos,
    vencido: { monto: abiertos.monto_vencido, cantidad: abiertos.vencidos },
    mes: { monto: abiertos.monto_mes, cantidad: abiertos.del_mes },
  };
}

export function obtenerFijo(id) {
  return obtenerFijoActivo(id);
}

// Dentro de la transacción de quien llama.
async function insertarFijo(f, usuarioId) {
  const { id } = await db
    .prepare('INSERT INTO fijos (tipo, concepto, monto, frecuencia, desde, nota, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .get(f.tipo, f.concepto, f.monto, f.frecuencia, f.desde, f.nota, usuarioId);
  await generarVencimientos(id);
  return id;
}

export async function crearFijo(datos, { usuarioId }) {
  const f = validarFijo(datos);
  const id = await db.transaction(async () => {
    await verificarQueNoSeaViejo(f.desde);
    return insertarFijo(f, usuarioId);
  });
  return obtenerFijoActivo(id);
}

// "Repetir todos los meses" al anotar un gasto (Administrador y Encargado): el de hoy ya quedó
// anotado, así que el primer vencimiento es dentro de un mes. Dentro de la transacción del gasto.
export async function crearFijoDeGasto({ concepto, monto }, { usuarioId }) {
  const { desde } = await db.prepare(`SELECT (${SQL_HOY_NEGOCIO} + INTERVAL '1 month')::date AS desde`).get();
  return insertarFijo({ tipo: 'otro', concepto, monto, frecuencia: 'mensual', desde, nota: null }, usuarioId);
}

// El monto, el nombre y la nota valen para los próximos vencimientos: lo que ya está en Saldos
// pendientes queda como está. Si cambian las fechas (`desde` es el próximo vencimiento que muestra la
// pantalla), lo que está sin pagar y por vencer se vuelve a armar con el calendario nuevo, para que
// no queden dos vencimientos del mismo mes.
export async function editarFijo(id, datos) {
  const f = validarFijo(datos);
  await db.transaction(async () => {
    const actual = await obtenerFijoActivo(id);
    const cambiaCalendario = f.frecuencia !== actual.frecuencia || f.desde !== actual.proximo;
    if (cambiaCalendario) {
      await verificarQueNoSeaViejo(f.desde);
      await db
        .prepare(
          `UPDATE cuentas_pagar cp SET eliminado_en = CURRENT_TIMESTAMP
           WHERE cp.fijo_id = ? AND cp.eliminado_en IS NULL AND cp.vence >= ${SQL_HOY_NEGOCIO}
             AND NOT EXISTS (SELECT 1 FROM pagos_cuenta p WHERE p.cuenta_id = cp.id AND p.anulado_en IS NULL)`
        )
        .run(id);
      await db.prepare('UPDATE fijos SET desde = ?, generado_hasta = NULL WHERE id = ?').run(f.desde, id);
    }
    await db
      .prepare('UPDATE fijos SET tipo = ?, concepto = ?, monto = ?, frecuencia = ?, nota = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
      .run(f.tipo, f.concepto, f.monto, f.frecuencia, f.nota, id);
    await generarVencimientos(id);
  });
  return obtenerFijoActivo(id);
}

// En pausa no genera vencimientos. Lo que ya está en Saldos pendientes sigue ahí.
export async function pausarFijo(id) {
  await db.transaction(async () => {
    await obtenerFijoActivo(id);
    await db.prepare('UPDATE fijos SET activo = FALSE, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  });
  return obtenerFijoActivo(id);
}

// Vuelve desde hoy: lo que venció mientras estaba en pausa no se carga de golpe.
export async function activarFijo(id) {
  await db.transaction(async () => {
    await obtenerFijoActivo(id);
    await db
      .prepare(
        `UPDATE fijos SET activo = TRUE, generado_hasta = GREATEST(generado_hasta, ${SQL_HOY_NEGOCIO} - 1), actualizado_en = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(id);
    await generarVencimientos(id);
  });
  return obtenerFijoActivo(id);
}

// Baja lógica. Lo que ya está en Saldos pendientes sigue ahí, porque es una deuda.
export async function eliminarFijo(id) {
  await db.transaction(async () => {
    await obtenerFijoActivo(id);
    await db.prepare('UPDATE fijos SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  });
}
