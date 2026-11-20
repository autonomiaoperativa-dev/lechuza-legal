// Revisa todas las alertas activas contra el archivo local y envía los correos pendientes.
// Lo ejecuta ACTUALIZAR ARCHIVO.bat cada mañana, después de bajar las listas del día.
// Uso manual:  node revisar-alertas.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as indice from './indice.js';
import * as alertas from './alertas.js';
import { DATOS } from './rutas.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(DATOS, 'indexar.log');
const log = (m) => {
  const linea = `[${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}] [alertas] ${m}`;
  console.log(linea);
  try { fs.appendFileSync(LOG, linea + '\n'); } catch {}
};

const db = await indice.abrir();
if (!db) { log('No hay archivo local (data/lechuza.db): no se revisan alertas.'); process.exit(0); }
alertas.prepararTablas(db);
const r = await alertas.revisar(db);
const nuevas = r.reduce((s, a) => s + a.nuevas, 0);
log(`Revisadas ${r.length} alertas activas: ${nuevas} acuerdo(s) nuevo(s)` + (nuevas ? ' en ' + r.filter((a) => a.nuevas).map((a) => `${a.etiqueta || a.valor} (${a.nuevas})`).join(', ') : '') + '.');
try {
  const e = await alertas.enviarPendientes(db);
  log(e.correos ? `Correos enviados: ${e.correos} (${e.novedades} novedades).` : `Correos: ninguno (${e.motivo}).`);
} catch (e) {
  log('No se pudieron enviar los correos: ' + e.message + ' (se reintenta la próxima vez).');
}
db.close();
