// Copia de seguridad del archivo local (lechuza.db): listas, alertas, usuarios y listados del SAT.
// Uso:  node respaldar.js [--destino=C:\LechuzaLegal\respaldos] [--conservar=2]
// Usa "VACUUM INTO", que hace una copia consistente aunque el servidor o la descarga diaria estén
// trabajando al mismo tiempo. Guarda las N copias más recientes y borra las anteriores.
import fs from 'node:fs';
import path from 'node:path';
import { DATOS } from './rutas.js';

const arg = (n, def) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : def; };
const DESTINO = path.resolve(arg('destino', process.env.LECHUZA_RESPALDOS || 'C:\\LechuzaLegal\\respaldos'));
const CONSERVAR = Math.max(1, Number(arg('conservar', 2)) || 2);
const ORIGEN = process.env.LECHUZA_DB || path.join(DATOS, 'lechuza.db');
const LOG = path.join(DATOS, 'respaldo.log');
const ESTADO = path.join(DATOS, 'respaldo_estado.json');

const log = (m) => { const l = `${new Date().toISOString()} [respaldo] ${m}`; console.log(l); try { fs.appendFileSync(LOG, l + '\n'); } catch {} };
const gb = (b) => (b / 1024 ** 3).toFixed(2) + ' GB';

async function main() {
  if (!fs.existsSync(ORIGEN)) { log(`No existe ${ORIGEN}; nada que respaldar.`); return; }
  fs.mkdirSync(DESTINO, { recursive: true });
  const tam = fs.statSync(ORIGEN).size;
  const libre = fs.statfsSync(DESTINO); const disponible = libre.bavail * libre.bsize;
  if (disponible < tam * 1.2) throw new Error(`Espacio insuficiente en ${DESTINO}: hay ${gb(disponible)}, se necesitan ~${gb(tam * 1.2)}.`);

  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const final = path.join(DESTINO, `lechuza-${hoy}.db`);
  const temporal = final + '.parcial';
  try { fs.rmSync(temporal, { force: true }); } catch {}
  const t0 = Date.now();
  log(`Iniciando copia de ${ORIGEN} (${gb(tam)}) a ${final}`);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(ORIGEN, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 60000');
  db.exec(`VACUUM INTO '${temporal.replace(/'/g, "''")}'`);
  db.close();

  // comprobación rápida de la copia antes de darla por buena
  const copia = new DatabaseSync(temporal, { readOnly: true });
  const ok = copia.prepare('PRAGMA quick_check').get();
  const filas = copia.prepare('SELECT COUNT(*) n FROM listas').get().n;
  copia.close();
  if (Object.values(ok)[0] !== 'ok') throw new Error('La copia no pasó la revisión de integridad: ' + JSON.stringify(ok));
  fs.rmSync(final, { force: true });
  fs.renameSync(temporal, final);
  const seg = Math.round((Date.now() - t0) / 1000);
  log(`Copia lista: ${final} (${gb(fs.statSync(final).size)}, ${filas.toLocaleString('es-MX')} listas, ${seg} s, revisión ok)`);

  // conservar solo las más recientes
  const copias = fs.readdirSync(DESTINO).filter((f) => /^lechuza-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse();
  for (const f of copias.slice(CONSERVAR)) { fs.rmSync(path.join(DESTINO, f), { force: true }); log(`Copia anterior borrada: ${f}`); }
  fs.writeFileSync(ESTADO, JSON.stringify({ ultimo: new Date().toISOString(), archivo: final, bytes: fs.statSync(final).size, listas: filas, segundos: seg,
    conservadas: copias.slice(0, CONSERVAR) }, null, 2));
}

main().catch((e) => { log('ERROR: ' + e.message); try { fs.writeFileSync(ESTADO, JSON.stringify({ ultimo: new Date().toISOString(), error: e.message }, null, 2)); } catch {} process.exit(1); });
