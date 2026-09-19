import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

// Fabrica de CRUD para catalogos simples (categorias, unidades de medida,
// condiciones de pago): misma forma exacta -- id, nombre unico entre activos
// (sin distinguir mayusculas, indice sobre LOWER(nombre)), soft delete -- evita
// duplicar la misma logica para tablas casi identicas.
// Corrige el hallazgo real que motivo este catalogo (2026-09-15): antes
// productos.categoria/unidad_medida eran texto libre sin ningun control,
// "Kg"/"kg" convivian como 2 valores distintos.
function crearServicioCatalogo(tabla, etiqueta) {
  const etiquetaMinuscula = etiqueta.toLowerCase();

  function validarNombre(valor) {
    if (typeof valor !== 'string' || valor.trim() === '') {
      throw new ApiError(400, 'nombre es requerido');
    }
    const limpio = valor.trim();
    if (limpio.length > 100) throw new ApiError(400, 'nombre no puede superar 100 caracteres');
    return limpio;
  }

  async function verificarNombreLibre(nombre, excluirId = null) {
    const existente = await db
      .prepare(`SELECT id FROM ${tabla} WHERE LOWER(nombre) = LOWER(?) AND eliminado_en IS NULL AND id != ?`)
      .get(nombre, excluirId ?? -1);
    if (existente) throw new ApiError(409, `Ya existe una ${etiquetaMinuscula} activa con ese nombre`);
  }

  async function obtenerActivo(id) {
    const fila = await db.prepare(`SELECT * FROM ${tabla} WHERE id = ? AND eliminado_en IS NULL`).get(id);
    if (!fila) throw new ApiError(404, `${etiqueta} no encontrada`);
    return fila;
  }

  return {
    listar() {
      return db.prepare(`SELECT * FROM ${tabla} WHERE eliminado_en IS NULL ORDER BY LOWER(nombre)`).all();
    },

    crear({ nombre }) {
      const nombreValido = validarNombre(nombre);
      return db.transaction(async () => {
        await verificarNombreLibre(nombreValido);
        return db.prepare(`INSERT INTO ${tabla} (nombre) VALUES (?) RETURNING *`).get(nombreValido);
      });
    },

    editar(id, { nombre }) {
      return db.transaction(async () => {
        await obtenerActivo(id);
        const nombreValido = validarNombre(nombre);
        await verificarNombreLibre(nombreValido, id);
        return db
          .prepare(`UPDATE ${tabla} SET nombre = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`)
          .get(nombreValido, id);
      });
    },

    async eliminar(id) {
      await obtenerActivo(id);
      // Soft delete -- si algun producto activo sigue apuntando a este id, no
      // se bloquea (mismo criterio ya usado con proveedores.eliminado_en: un
      // producto puede seguir referenciando a un proveedor ya eliminado, el
      // JOIN de listarProductos igual devuelve el nombre historico).
      await db.prepare(`UPDATE ${tabla} SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    },
  };
}

export const categoriasService = crearServicioCatalogo('categorias', 'Categoría');
export const unidadesMedidaService = crearServicioCatalogo('unidades_medida', 'Unidad de medida');
export const condicionesPagoService = crearServicioCatalogo('condiciones_pago', 'Condición de pago');
