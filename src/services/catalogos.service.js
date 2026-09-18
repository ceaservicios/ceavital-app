import db from '../db/connection.js';
import { ApiError } from '../utils/api-error.js';

// Fabrica de CRUD para catalogos simples (categorias, unidades de medida):
// misma forma exacta -- id, nombre unico (COLLATE NOCASE) entre activos, soft
// delete -- evita duplicar la misma logica para 2 tablas casi identicas.
// Corrige el hallazgo real que motivo este catalogo (2026-09-15): antes
// productos.categoria/unidad_medida eran texto libre sin ningun control,
// "Kg"/"kg" convivian como 2 valores distintos.
function crearServicioCatalogo(tabla, etiqueta) {
  const etiquetaMinuscula = etiqueta.toLowerCase();

  function validarNombre(valor) {
    if (typeof valor !== 'string' || valor.trim() === '') {
      throw new ApiError(400, 'nombre es requerido');
    }
    return valor.trim();
  }

  function verificarNombreLibre(nombre, excluirId = null) {
    const existente = db
      .prepare(`SELECT id FROM ${tabla} WHERE nombre = ? AND eliminado_en IS NULL AND id != ?`)
      .get(nombre, excluirId ?? -1);
    if (existente) throw new ApiError(409, `Ya existe una ${etiquetaMinuscula} activa con ese nombre`);
  }

  function obtenerActivo(id) {
    const fila = db.prepare(`SELECT * FROM ${tabla} WHERE id = ? AND eliminado_en IS NULL`).get(id);
    if (!fila) throw new ApiError(404, `${etiqueta} no encontrada`);
    return fila;
  }

  return {
    listar() {
      return db.prepare(`SELECT * FROM ${tabla} WHERE eliminado_en IS NULL ORDER BY nombre`).all();
    },

    crear({ nombre }) {
      const nombreValido = validarNombre(nombre);
      verificarNombreLibre(nombreValido);
      const resultado = db.prepare(`INSERT INTO ${tabla} (nombre) VALUES (?)`).run(nombreValido);
      return db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(resultado.lastInsertRowid);
    },

    editar(id, { nombre }) {
      obtenerActivo(id);
      const nombreValido = validarNombre(nombre);
      verificarNombreLibre(nombreValido, id);
      db.prepare(`UPDATE ${tabla} SET nombre = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(nombreValido, id);
      return db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id);
    },

    eliminar(id) {
      obtenerActivo(id);
      // Soft delete -- si algun producto activo sigue apuntando a este id, no
      // se bloquea (mismo criterio ya usado con proveedores.eliminado_en: un
      // producto puede seguir referenciando a un proveedor ya eliminado, el
      // JOIN de listarProductos igual devuelve el nombre historico).
      db.prepare(`UPDATE ${tabla} SET eliminado_en = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    },
  };
}

export const categoriasService = crearServicioCatalogo('categorias', 'Categoría');
export const unidadesMedidaService = crearServicioCatalogo('unidades_medida', 'Unidad de medida');
