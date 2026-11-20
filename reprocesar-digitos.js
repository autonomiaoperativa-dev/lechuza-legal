// Corrige en el archivo local los acuerdos cuyo número de expediente quedó con dígitos separados
// ("Expediente: 37 8/2026"). Cuando eso pasaba, el acuerdo no se reconocía y quedaba pegado al anterior.
// Este programa separa esos acuerdos y les pone su número correcto (378/2026).
// Uso:  node reprocesar-digitos.js [--prueba]      (--prueba solo cuenta, no cambia nada)
// Seguro de repetir: lo ya corregido no se vuelve a tocar. Conserva el id de cada fila original.
import fs from 'node:fs';
import path from 'node:path';
import { DATOS } from './rutas.js';
import * as indice from './indice.js';
import { separarAcuerdos } from './slp.js';

const PRUEBA = process.argv.includes('--prueba');
const LOG = path.join(DATOS, 'reprocesar.log');
const log = (m) => { const l = `${new Date().toISOString()} [digitos] ${m}`; console.log(l); if (!PRUEBA) try { fs.appendFileSync(LOG, l + '\n'); } catch {} };

// encabezado de acuerdo con mayúscula y dígitos separados por espacio antes de la diagonal
const SOSPECHA = /(?:Expediente|Causa\s+Penal|Carpeta|Toca|Exhorto|Cuadernillo)[^0-9]{0,30}\d+(?: \d{1,3})+\s*\/\s*\d{4}(?!\d)/;

const db = await indice.abrir();
if (!db) { console.error('No se encontró el archivo local.'); process.exit(1); }
db.exec('PRAGMA busy_timeout = 60000');
const maxId = db.prepare('SELECT MAX(id) m FROM acuerdos').get().m || 0;
const leer = db.prepare('SELECT id, codigo, fecha, expediente, clase, tipo_juicio, partes, texto FROM acuerdos WHERE id > ? AND id <= ? ORDER BY id');
const ftsBorrar = db.prepare("INSERT INTO acuerdos_fts(acuerdos_fts, rowid, partes, texto) VALUES ('delete', ?, ?, ?)");
const ftsPoner = db.prepare('INSERT INTO acuerdos_fts(rowid, partes, texto) VALUES (?, ?, ?)');
const actualizar = db.prepare('UPDATE acuerdos SET expediente = ?, clase = ?, partes = ?, texto = ? WHERE id = ?');
const insertar = db.prepare('INSERT INTO acuerdos (codigo, fecha, expediente, clase, tipo_juicio, partes, texto) VALUES (?, ?, ?, ?, ?, ?, ?)');
const contar = db.prepare('UPDATE listas SET acuerdos = acuerdos + ? WHERE codigo = ? AND fecha = ?');

let revisadas = 0, corregidas = 0, nuevas = 0;
const t0 = Date.now();
const LOTE = 20000;
log(`${PRUEBA ? 'PRUEBA (sin cambios): ' : ''}revisando ${maxId.toLocaleString('es-MX')} filas`);
for (let desde = 0; desde < maxId; desde += LOTE) {
  const filas = leer.all(desde, desde + LOTE);
  const cambios = [];
  for (const r of filas) {
    revisadas++;
    if (!r.texto || !SOSPECHA.test(r.texto)) continue;
    const { acuerdos } = separarAcuerdos(r.texto);
    if (!acuerdos.length) continue;
    // texto antes del primer encabezado reconocido (p. ej. una "lista completa" o el inicio del acuerdo original)
    const primero = r.texto.indexOf(acuerdos[0].texto.slice(0, 40));
    const prefijo = primero > 0 ? r.texto.slice(0, primero).trim() : '';
    let piezas;
    if (prefijo.length > 15) piezas = [{ expediente: r.expediente, clase: r.clase, partes: r.partes, texto: prefijo }, ...acuerdos];
    else piezas = acuerdos;
    const misma = piezas.length === 1 && piezas[0].expediente === r.expediente;
    if (misma) continue;
    cambios.push({ r, piezas });
  }
  if (cambios.length && !PRUEBA) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const { r, piezas } of cambios) {
        const [p0, ...resto] = piezas;
        ftsBorrar.run(r.id, r.partes, r.texto);
        actualizar.run(p0.expediente ?? null, p0.clase ?? r.clase, p0.partes ?? '', p0.texto, r.id);
        ftsPoner.run(r.id, p0.partes ?? '', p0.texto);
        for (const p of resto) insertar.run(r.codigo, r.fecha, p.expediente, p.clase, r.tipo_juicio, p.partes || '', p.texto);
        if (resto.length) contar.run(resto.length, r.codigo, r.fecha);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  for (const c of cambios) { corregidas++; nuevas += c.piezas.length - 1; }
  if (PRUEBA && cambios.length && corregidas <= 12) for (const c of cambios.slice(0, 3)) {
    console.log(`  ${c.r.codigo} ${c.r.fecha} fila ${c.r.id} (${c.r.expediente}) -> ${c.piezas.map((p) => p.expediente || 'sin número').join(', ')}`);
  }
  if ((desde / LOTE) % 25 === 0) log(`… ${Math.min(desde + LOTE, maxId).toLocaleString('es-MX')} filas, ${corregidas} corregidas, ${nuevas} acuerdos recuperados`);
}
log(`Terminado en ${Math.round((Date.now() - t0) / 1000)} s: ${revisadas.toLocaleString('es-MX')} filas revisadas, ${corregidas} filas corregidas, ${nuevas} acuerdos recuperados${PRUEBA ? ' (prueba, sin cambios)' : ''}`);
