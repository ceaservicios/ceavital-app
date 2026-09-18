import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import config from '../config/env.js';

fs.mkdirSync(config.dataDir, { recursive: true });

// node:sqlite (nativo de Node, sin dependencia npm ni compilacion nativa
// propia) en vez de better-sqlite3: esta maquina no tiene Python/Visual
// Studio Build Tools para compilar better-sqlite3 desde codigo fuente
// (sin binario precompilado para este ABI de Node todavia), y ademas evita
// depender de un binario nativo de terceros para el empaquetado a .exe.
const db = new DatabaseSync(config.dbPath);

// WAL: necesario porque puede haber hasta 3 sesiones simultaneas (una por rol)
// leyendo/escribiendo a la vez.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

export default db;
