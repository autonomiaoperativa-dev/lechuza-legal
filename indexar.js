// Descargador del archivo local de Lechuza Legal.
// Baja las listas de acuerdos de todos los juzgados de SLP, de lo más reciente a lo más antiguo,
// y las guarda en data/lechuza.db. Se puede detener (Ctrl+C) y volver a lanzar: retoma donde iba.
//
// Uso:
//   node indexar.js                      -> últimos 10 años, todos los juzgados
//   node indexar.js --desde=2025-01-01   -> desde esa fecha hasta hoy
//   node indexar.js --dias=7             -> solo los últimos 7 días (actualización diaria)
//   node indexar.js --juzgados=1C,2C     -> solo esos juzgados
//   node indexar.js --descargas=3        -> descargas a la vez (por defecto 3, máximo 4)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? 'true'];
}));
// Hasta 4 descargas a la vez como máximo, para no saturar el sitio oficial durante días.
process.env.MAX_DESCARGAS = String(Math.min(4, Math.max(1, Number(args.descargas || 3))));
process.env.PAUSA_MS = process.env.PAUSA_MS || '300';

const slp = await import('./slp.js');
const indice = await import('./indice.js');

const DATA = path.join(DIR, 'data');
const LOCK = path.join(DATA, 'indexar.lock');
const ESTADO = path.join(DATA, 'indexar_estado.json');
const LOG = path.join(DATA, 'indexar.log');
fs.mkdirSync(DATA, { recursive: true });

// Un solo descargador a la vez
try {
  const pid = Number(fs.readFileSync(LOCK, 'utf8'));
  try { process.kill(pid, 0); console.error(`Ya hay un descargador funcionando (proceso ${pid}).`); process.exit(1); } catch {}
} catch {}
fs.writeFileSync(LOCK, String(process.pid));
const quitarLock = () => { try { if (fs.readFileSync(LOCK, 'utf8') === String(process.pid)) fs.unlinkSync(LOCK); } catch {} };

const log = (m) => {
  const linea = `[${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}] ${m}`;
  console.log(linea);
  fs.appendFileSync(LOG, linea + '\n');
};

const hoy = slp.hoyMexico();
const PRIMERA = '2010-11-03';
let desde = args.desde;
if (!desde && args.dias) {
  const d = new Date(hoy + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - Number(args.dias));
  desde = d.toISOString().slice(0, 10);
}
if (!desde) desde = `${Number(hoy.slice(0, 4)) - 10}${hoy.slice(4)}`;
if (desde < PRIMERA) desde = PRIMERA;
const hasta = args.hasta && args.hasta < hoy ? args.hasta : hoy;

const catalogo = await slp.catalogo();
const juzgados = args.juzgados ? args.juzgados.split(',') : catalogo.map((j) => j.codigo);
const db = await indice.abrir({ crear: true });

// Pendientes: todo lo del rango que no está guardado, de lo más reciente a lo más antiguo
const dias = slp.diasHabiles(desde, hasta).reverse();
const ya = indice.cobertura(db, juzgados, desde, hasta);
const pendientes = [];
for (const f of dias) for (const j of juzgados) if (!ya.has(j + '|' + f)) pendientes.push([j, f]);
const total = dias.length * juzgados.length;
log(`Inicio: ${juzgados.length} juzgados, ${desde} a ${hasta} (${dias.length} días hábiles). ` +
  `Ya guardadas: ${(total - pendientes.length).toLocaleString('es-MX')}. Por descargar: ${pendientes.length.toLocaleString('es-MX')}. ` +
  `Descargas a la vez: ${slp.MAX_DESCARGAS}.`);

let hechas = 0, ok = 0, sin = 0, errores = 0, paginas = 0;
const t0 = Date.now();
let detener = false;
const guardarEstado = (fin = false) => {
  const seg = (Date.now() - t0) / 1000;
  const ritmo = hechas / Math.max(seg, 1);
  const faltan = pendientes.length - hechas;
  const estado = {
    corriendo: !fin, pid: process.pid, desde, hasta, juzgados: juzgados.length,
    total_rango: total, pendientes_al_inicio: pendientes.length, hechas, ok, sin_lista: sin, errores, paginas,
    por_minuto: Math.round(ritmo * 60), faltan, eta_horas: ritmo > 0 ? +(faltan / ritmo / 3600).toFixed(1) : null,
    fecha_en_curso: pendientes[Math.min(hechas, pendientes.length - 1)]?.[1] || null,
    actualizado: new Date().toISOString(),
  };
  fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 2));
  return estado;
};
const parar = () => { if (!detener) { detener = true; log('Deteniendo… (termina las descargas en curso y se puede retomar después)'); } };
process.on('SIGINT', parar);
process.on('SIGTERM', parar);

let siguiente = 0;
const trabajador = async () => {
  while (!detener && siguiente < pendientes.length) {
    const [codigo, fecha] = pendientes[siguiente++];
    let lista;
    try { lista = await slp.descargarDirecto(codigo, fecha); } catch (e) { lista = { codigo, fecha, estado: 'error', detalle: e.message }; }
    // la lista de hoy que aún no se publica no se guarda como "sin lista"
    if (lista.estado === 'sin_lista' && fecha >= hoy) { hechas++; continue; }
    if (lista.estado === 'error') errores++;
    else {
      try { indice.guardar(db, lista); } catch (e) { errores++; log(`No se pudo guardar ${codigo} ${fecha}: ${e.message}`); }
      if (lista.estado === 'ok') { ok++; paginas += lista.paginas || 0; } else sin++;
    }
    hechas++;
    if (hechas % 100 === 0) {
      const e = guardarEstado();
      log(`${hechas.toLocaleString('es-MX')}/${pendientes.length.toLocaleString('es-MX')} · va en ${e.fecha_en_curso} · ` +
        `${e.por_minuto}/min · faltan ~${e.eta_horas} h · con lista ${ok}, sin lista ${sin}, errores ${errores}`);
    }
  }
};
guardarEstado();
await Promise.all(Array.from({ length: slp.MAX_DESCARGAS * 2 }, trabajador));
const e = guardarEstado(true);
const st = indice.estadisticas(db);
log(`${detener ? 'Detenido' : 'Terminado'}: ${hechas.toLocaleString('es-MX')} revisadas (con lista ${ok}, sin lista ${sin}, errores ${errores}) en ` +
  `${((Date.now() - t0) / 60000).toFixed(1)} min. Archivo: ${st.listas.toLocaleString('es-MX')} listas, ` +
  `${st.acuerdos.toLocaleString('es-MX')} acuerdos, ${st.desde} a ${st.hasta}, ${st.mb} MB.` +
  (errores ? ' Las listas con error se reintentan la próxima vez.' : ''));
db.close();
quitarLock();
process.exit(0);
