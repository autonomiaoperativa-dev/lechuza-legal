// Listados públicos del SAT (Datos Abiertos) para el reporte de antecedentes:
//   - Artículo 69-B CFF: contribuyentes con operaciones presuntamente inexistentes (EFOS)
//   - Artículo 69 CFF: contribuyentes con créditos fiscales cancelados o condonados
// Fuente: https://www.sat.gob.mx/minisitio/DatosAbiertos/contribuyentes_publicados.html
// Los archivos se descargan directo del SAT y se guardan en el archivo local (data/lechuza.db).
//
// Uso:  node sat.js            -> actualiza solo los listados que cambiaron en el SAT
//       node sat.js --forzar   -> vuelve a bajar todos
import { normalizar } from './slp.js';
import * as indice from './indice.js';

const BASE = 'https://wu1agsprosta001.blob.core.windows.net/agsc-publicaciones/Datos_abiertos/';
export const LISTADOS = [
  { id: '69B', grupo: 'efos', nombre: 'Listado completo artículo 69-B (EFOS)', ruta: 'Documents_AGAFF/Listado_completo_69-B.csv' },
  { id: 'CANCELADOS', grupo: 'cancelados', nombre: 'Créditos cancelados (art. 69)', ruta: 'Documents_AGR/Cancelados.csv' },
  { id: 'CANCELADOS_07_15', grupo: 'cancelados', nombre: 'Créditos cancelados 2007-2015', ruta: 'Cifras_SAT/Indef/Cancelados_07_15.csv' },
  { id: 'CONDONADOS_07_15', grupo: 'condonados', nombre: 'Créditos condonados 2007-2015', ruta: 'Cifras_SAT/Indef/Condonados_07_15.csv' },
  { id: 'CONDONADOS_146B', grupo: 'condonados', nombre: 'Condonados art. 146-B CFF', ruta: 'Cifras_SAT/Indef/Condonadosart146BCFF.csv' },
  { id: 'CONDONADOS_21', grupo: 'condonados', nombre: 'Condonados art. 21 CFF', ruta: 'Cifras_SAT/Indef/Condonadosart21CFF.csv' },
  { id: 'CONDONADOS_DECRETO', grupo: 'condonados', nombre: 'Condonados por decreto', ruta: 'Cifras_SAT/Indef/CondonadosporDecreto.csv' },
];
export const PAGINA_FUENTE = 'https://www.sat.gob.mx/minisitio/DatosAbiertos/contribuyentes_publicados.html';

export function prepararTablas(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sat_listados (
      id TEXT PRIMARY KEY, nombre TEXT, url TEXT, modificado_sat TEXT, descargado TEXT, filas INTEGER, actualizado_al TEXT
    );
    CREATE TABLE IF NOT EXISTS sat_registros (
      id INTEGER PRIMARY KEY, listado TEXT NOT NULL, rfc TEXT, nombre TEXT, tipo_persona TEXT,
      situacion TEXT, fecha TEXT, monto TEXT, entidad TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_sat_rfc ON sat_registros(rfc);
    CREATE INDEX IF NOT EXISTS ix_sat_listado ON sat_registros(listado);
    CREATE VIRTUAL TABLE IF NOT EXISTS sat_fts USING fts5(nombre, content='sat_registros', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER IF NOT EXISTS sat_ai AFTER INSERT ON sat_registros BEGIN
      INSERT INTO sat_fts(rowid, nombre) VALUES (new.id, new.nombre);
    END;
    CREATE TRIGGER IF NOT EXISTS sat_ad AFTER DELETE ON sat_registros BEGIN
      INSERT INTO sat_fts(sat_fts, rowid, nombre) VALUES ('delete', old.id, old.nombre);
    END;
  `);
}

// ---------- CSV ----------
function parsearCsv(texto) {
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; }
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.some((x) => x.trim())) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); if (fila.some((x) => x.trim())) filas.push(fila); }
  return filas;
}

// Reconoce las columnas por su encabezado (cada listado las nombra distinto)
function columnas(enc) {
  const n = enc.map((h) => normalizar(h));
  const buscar = (re, excluir) => n.findIndex((h) => re.test(h) && !(excluir && excluir.test(h)));
  return {
    rfc: n.findIndex((h) => h === 'rfc'),
    nombre: buscar(/nombre|razon social|contribuyente/, /tipo|situacion|numero|oficio|publicacion/),
    tipo: buscar(/tipo de persona|tipo persona|^persona/),
    situacion: buscar(/situacion|supuesto|motivo/),
    fecha: buscar(/fecha|ano|año/),
    monto: buscar(/monto|importe/),
    entidad: buscar(/entidad/),
  };
}
const MAX_CAMPO = 300;
const celda = (f, i) => (i >= 0 && f[i] != null ? String(f[i]).trim().slice(0, MAX_CAMPO) : null);

export async function actualizar(db, { forzar = false, log = console.log } = {}) {
  prepararTablas(db);
  const resumen = [];
  for (const l of LISTADOS) {
    const url = BASE + l.ruta;
    try {
      const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(60000) });
      const modificado = head.headers.get('last-modified');
      const previo = db.prepare('SELECT modificado_sat FROM sat_listados WHERE id = ?').get(l.id);
      if (!forzar && previo && previo.modificado_sat === modificado) { resumen.push({ id: l.id, cambio: false }); continue; }
      const r = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      // los listados vienen en latin1; si fuera UTF-8 válido se respeta
      const utf = buf.toString('utf8');
      const texto = utf.includes('�') ? buf.toString('latin1') : utf;
      const filas = parsearCsv(texto);
      const iEnc = filas.findIndex((f) => f.some((c) => normalizar(c) === 'rfc'));
      if (iEnc < 0) throw new Error('no se encontró la fila de encabezados');
      const col = columnas(filas[iEnc]);
      if (col.rfc < 0 || col.nombre < 0) throw new Error('no se reconocieron las columnas RFC / nombre');
      const actualizadoAl = (filas.slice(0, iEnc).join(' ').match(/actualizada al ([^;,"]+)/i) || [])[1] || null;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM sat_registros WHERE listado = ?').run(l.id);
        const ins = db.prepare(`INSERT INTO sat_registros (listado, rfc, nombre, tipo_persona, situacion, fecha, monto, entidad) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        let n = 0;
        for (const f of filas.slice(iEnc + 1)) {
          const rfc = celda(f, col.rfc), nombre = celda(f, col.nombre);
          if (!rfc || !nombre || !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(rfc.replace(/[\s-]/g, ''))) continue;
          ins.run(l.id, rfc.replace(/[\s-]/g, '').toUpperCase(), nombre, celda(f, col.tipo),
            l.grupo === 'efos' ? celda(f, col.situacion) : (celda(f, col.situacion) || l.grupo.toUpperCase()),
            celda(f, col.fecha), celda(f, col.monto), celda(f, col.entidad));
          n++;
        }
        db.prepare(`INSERT OR REPLACE INTO sat_listados (id, nombre, url, modificado_sat, descargado, filas, actualizado_al) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(l.id, l.nombre, url, modificado, new Date().toISOString(), n, actualizadoAl);
        db.exec('COMMIT');
        resumen.push({ id: l.id, cambio: true, filas: n });
        log(`SAT ${l.id}: ${n.toLocaleString('es-MX')} registros`);
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    } catch (e) {
      resumen.push({ id: l.id, error: e.message });
      log(`SAT ${l.id}: no se pudo actualizar (${e.message}); se conserva la versión anterior`);
    }
  }
  return resumen;
}

export function estado(db) {
  try { return db.prepare('SELECT * FROM sat_listados ORDER BY id').all().map((r) => ({ ...r })); } catch { return []; }
}

// Busca por nombre completo (palabras juntas; acepta apellidos primero) y por RFC exacto si se da.
export function buscar(db, { nombre, rfc, moral = false }) {
  const res = { efos: [], cancelados: [], condonados: [] };
  const listados = estado(db);
  if (!listados.length) return { ...res, disponible: false, listados };
  const grupoDe = Object.fromEntries(LISTADOS.map((l) => [l.id, l.grupo]));
  const vistos = new Set();
  const agregar = (r, por) => {
    const k = r.listado + '|' + r.rfc + '|' + r.fecha;
    if (vistos.has(k)) return;
    vistos.add(k);
    res[grupoDe[r.listado]].push({ ...r, por, listado_nombre: (LISTADOS.find((l) => l.id === r.listado) || {}).nombre });
  };
  const rfcLimpio = String(rfc || '').replace(/[\s-]/g, '').toUpperCase();
  if (rfcLimpio.length >= 12) {
    for (const r of db.prepare('SELECT * FROM sat_registros WHERE rfc = ?').iterate(rfcLimpio)) agregar(r, 'RFC');
  }
  const palabras = normalizar(nombre || '').split(' ').filter(Boolean);
  if (palabras.length >= (moral ? 1 : 2)) {
    const frases = indice.rotaciones(palabras).map((p) => `"${p.join(' ')}"`).join(' OR ');
    for (const r of db.prepare(`SELECT s.* FROM sat_fts f JOIN sat_registros s ON s.id = f.rowid WHERE sat_fts MATCH ? LIMIT 200`).iterate(`nombre : (${frases})`)) {
      agregar(r, 'nombre');
    }
  }
  return { ...res, disponible: true, listados };
}

// ---------- uso desde la línea de comandos ----------
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/sat.js')) {
  const db = await indice.abrir({ crear: true });
  const r = await actualizar(db, { forzar: process.argv.includes('--forzar') });
  console.log(JSON.stringify(r));
  db.close();
}
