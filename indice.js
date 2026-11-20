// Archivo local de Lechuza Legal: guarda cada lista de acuerdos ya descargada en una base de
// datos SQLite (data/lechuza.db) con un índice de texto completo, para buscar años de listas en
// milisegundos. Es opcional: si el archivo no existe (por ejemplo en Render), el buscador sigue
// funcionando como antes, descargando del sitio oficial.
//
// El archivo contiene nombres de personas publicados en las listas: nunca se sube a GitHub
// (data/ está en .gitignore).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATOS } from './rutas.js';
import { normalizar, normExpediente, pdfUrl } from './slp.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.LECHUZA_DB || path.join(DATOS, 'lechuza.db');

let sqlite = null;
async function cargarSqlite() {
  if (sqlite) return sqlite;
  try {
    const original = process.emitWarning;
    process.emitWarning = () => {}; // silencia el aviso "experimental" de node:sqlite
    sqlite = await import('node:sqlite');
    process.emitWarning = original;
  } catch { sqlite = false; }
  return sqlite;
}

export async function abrir({ crear = false } = {}) {
  if (!crear && !fs.existsSync(DB_PATH)) return null;
  const mod = await cargarSqlite();
  if (!mod) return null;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new mod.DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 15000;
    CREATE TABLE IF NOT EXISTS listas (
      codigo TEXT NOT NULL, fecha TEXT NOT NULL, estado TEXT NOT NULL,
      paginas INTEGER, acuerdos INTEGER, descargado TEXT,
      PRIMARY KEY (codigo, fecha)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS ix_listas_fecha ON listas(fecha);
    CREATE TABLE IF NOT EXISTS acuerdos (
      id INTEGER PRIMARY KEY, codigo TEXT NOT NULL, fecha TEXT NOT NULL,
      expediente TEXT, clase TEXT, tipo_juicio TEXT, partes TEXT, texto TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_acuerdos_exp ON acuerdos(expediente, fecha);
    CREATE INDEX IF NOT EXISTS ix_acuerdos_cf ON acuerdos(codigo, fecha);
    CREATE VIRTUAL TABLE IF NOT EXISTS acuerdos_fts USING fts5(
      partes, texto, content='acuerdos', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS acuerdos_ai AFTER INSERT ON acuerdos BEGIN
      INSERT INTO acuerdos_fts(rowid, partes, texto) VALUES (new.id, new.partes, new.texto);
    END;
    CREATE TRIGGER IF NOT EXISTS acuerdos_ad AFTER DELETE ON acuerdos BEGIN
      INSERT INTO acuerdos_fts(acuerdos_fts, rowid, partes, texto) VALUES ('delete', old.id, old.partes, old.texto);
    END;
  `);
  return db;
}

// Guarda una lista ya leída (resultado de slp.obtenerLista / slp.descargarDirecto).
// Las listas con error no se guardan (se reintentan después).
export function guardar(db, lista) {
  if (!db || lista.estado === 'error') return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM acuerdos WHERE codigo = ? AND fecha = ?').run(lista.codigo, lista.fecha);
    const ins = db.prepare('INSERT INTO acuerdos (codigo, fecha, expediente, clase, tipo_juicio, partes, texto) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let n = 0;
    if (lista.estado === 'ok') {
      if (lista.acuerdos && lista.acuerdos.length) {
        for (const a of lista.acuerdos) {
          ins.run(lista.codigo, lista.fecha, a.expediente || null, a.clase || null, a.tipo_juicio || null, a.partes || '', a.texto || '');
          n++;
        }
      } else if (lista.texto) {
        // listas sin el formato "Expediente: ..." se guardan completas para poder buscar en ellas
        ins.run(lista.codigo, lista.fecha, null, 'LISTA COMPLETA', null, '(lista sin formato estándar)', lista.texto.replace(/\s+/g, ' '));
        n++;
      }
    }
    db.prepare(`INSERT OR REPLACE INTO listas (codigo, fecha, estado, paginas, acuerdos, descargado) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(lista.codigo, lista.fecha, lista.estado, lista.paginas || null, n, lista.descargado || new Date().toISOString());
    db.exec('COMMIT');
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Qué listas del rango ya están en el archivo: Map "CODIGO|fecha" -> estado
export function cobertura(db, juzgados, desde, hasta) {
  const mapa = new Map();
  if (!db) return mapa;
  const set = new Set(juzgados);
  for (const r of db.prepare('SELECT codigo, fecha, estado FROM listas WHERE fecha BETWEEN ? AND ?').iterate(desde, hasta)) {
    if (set.has(r.codigo)) mapa.set(r.codigo + '|' + r.fecha, r.estado);
  }
  return mapa;
}

export function estadisticas(db) {
  if (!db) return null;
  const t = db.prepare(`SELECT COUNT(*) total, SUM(estado = 'ok') ok, SUM(estado = 'sin_lista') sin_lista,
    MIN(fecha) desde, MAX(fecha) hasta FROM listas`).get();
  const a = db.prepare('SELECT COUNT(*) n FROM acuerdos').get();
  let tam = 0;
  for (const f of [DB_PATH, DB_PATH + '-wal']) { try { tam += fs.statSync(f).size; } catch {} }
  return { listas: t.total || 0, con_lista: t.ok || 0, sin_lista: t.sin_lista || 0, desde: t.desde, hasta: t.hasta, acuerdos: a.n, mb: Math.round(tam / 1048576) };
}

// Convierte un nombre en una consulta FTS de FRASE: las palabras deben ir juntas y en orden, para no
// mezclar a personas distintas ("Alejandra X" + "Juan Alvarado Pérez" no es "Alejandra Alvarado Pérez").
// Se aceptan todas las rotaciones, para cubrir "APELLIDOS NOMBRE" ("ALVARADO PEREZ ALEJANDRA").
export function rotaciones(palabras) {
  return palabras.map((_, i) => [...palabras.slice(i), ...palabras.slice(0, i)]);
}
function consultaNombre(nombre, columnas) {
  const palabras = normalizar(nombre).replace(/\//g, ' ').split(' ').filter((w) => w.length >= 1);
  if (!palabras.length) return null;
  const frases = rotaciones(palabras).map((p) => `"${p.join(' ')}"`);
  return `${columnas} : (${frases.join(' OR ')})`;
}

const MAX_RESULTADOS = 3000;

// Busca en el archivo local dentro de los juzgados y fechas pedidos.
export function buscar(db, { juzgados, desde, hasta, expedientes = [], nombres = [], enTexto = false }) {
  const set = new Set(juzgados);
  const porId = new Map();
  const agregar = (r, motivo) => {
    if (!set.has(r.codigo)) return;
    const ya = porId.get(r.id);
    if (ya) { if (!ya.motivos.includes(motivo)) ya.motivos.push(motivo); return; }
    if (porId.size >= MAX_RESULTADOS) return;
    porId.set(r.id, {
      tipo_juicio: r.tipo_juicio, clase: r.clase, expediente: r.expediente, partes: r.partes,
      texto: r.texto && r.texto.length > 6000 ? r.texto.slice(0, 6000) + ' […]' : r.texto,
      id: r.id, motivos: [motivo], codigo: r.codigo, fecha: r.fecha, url: pdfUrl(r.codigo, r.fecha),
    });
  };
  const cols = 'a.id, a.codigo, a.fecha, a.expediente, a.clase, a.tipo_juicio, a.partes, a.texto';

  const exps = [...new Set(expedientes.map(normExpediente).filter(Boolean))];
  if (exps.length) {
    const marcas = exps.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT ${cols} FROM acuerdos a WHERE a.expediente IN (${marcas}) AND a.fecha BETWEEN ? AND ?`).iterate(...exps, desde, hasta)) {
      agregar(r, 'expediente ' + r.expediente);
    }
    // menciones del número dentro del texto de otros acuerdos (salas, listas sin formato, referencias)
    const fts = db.prepare(`SELECT ${cols} FROM acuerdos_fts f JOIN acuerdos a ON a.id = f.rowid
      WHERE acuerdos_fts MATCH ? AND a.fecha BETWEEN ? AND ? LIMIT 500`);
    for (const e of exps) {
      const [n, y] = e.split('/');
      for (const r of fts.iterate(`texto : "${n} ${y}"`, desde, hasta)) {
        if (r.expediente === e) continue;
        // confirmar que de verdad dice NNN/AAAA (y no "NNN de AAAA" u otra cosa)
        if (!new RegExp(`(?<![\\d/])0*${n}\\s*/\\s*${y}(?!\\d)`).test(r.texto || '')) continue;
        agregar(r, 'expediente ' + e + ' (en texto)');
      }
    }
  }

  const fts = db.prepare(`SELECT ${cols} FROM acuerdos_fts f JOIN acuerdos a ON a.id = f.rowid
    WHERE acuerdos_fts MATCH ? AND a.fecha BETWEEN ? AND ? LIMIT ${MAX_RESULTADOS}`);
  for (const nombre of nombres) {
    const q = consultaNombre(nombre, enTexto ? '{partes texto}' : 'partes');
    if (!q) continue;
    for (const r of fts.iterate(q, desde, hasta)) agregar(r, 'nombre: ' + normalizar(nombre));
    // las listas guardadas completas no tienen "partes": se busca en su texto
    if (!enTexto) {
      const q2 = consultaNombre(nombre, 'texto');
      for (const r of fts.iterate(q2, desde, hasta)) if (r.clase === 'LISTA COMPLETA') agregar(r, 'nombre: ' + normalizar(nombre) + ' (en texto)');
    }
  }
  return { hallazgos: [...porId.values()], recortado: porId.size >= MAX_RESULTADOS };
}
