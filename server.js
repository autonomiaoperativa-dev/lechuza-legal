// Servidor de Lechuza Legal.
// En tu computadora: npm start  ->  http://localhost:3077
// En un servidor (Render u otro) se usa la variable PORT y acepta visitas de internet.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as slp from './slp.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3077);
// Sin PORT (uso local): solo esta computadora. Con PORT (servidor en internet): todas las direcciones.
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const MAX_BUSQUEDAS_A_LA_VEZ = Number(process.env.MAX_BUSQUEDAS || 8); // las descargas comparten un límite global (slp.MAX_DESCARGAS)
let activas = 0;
// Tope por búsqueda (juzgados x días hábiles). 1500 = todos los juzgados durante ~4 semanas,
// o un juzgado durante ~6 años. Se puede cambiar con la variable MAX_LISTAS.
const MAX_LISTAS = Number(process.env.MAX_LISTAS || 1500);

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
async function leerCuerpo(req) {
  let b = '';
  for await (const c of req) { b += c; if (b.length > 1e6) throw new Error('cuerpo muy grande'); }
  return b ? JSON.parse(b) : {};
}

async function fuentes() {
  const dir = path.join(DIR, 'fuentes');
  const out = [];
  try {
    for (const f of await fs.readdir(dir)) {
      if (!/^investigacion_.*\.json$/.test(f)) continue;
      try { out.push(...JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'))); } catch {}
    }
  } catch {}
  return out;
}

async function buscar(req, res) {
  if (activas >= MAX_BUSQUEDAS_A_LA_VEZ) {
    return json(res, 429, { error: 'Hay varias búsquedas en curso. Intenta de nuevo en un minuto.' });
  }
  activas++;
  try { await buscarSeguro(req, res); } finally { activas--; }
}

async function buscarSeguro(req, res) {
  const q = await leerCuerpo(req);
  const juzgados = (q.juzgados || []).filter((c) => /^[A-Z0-9]{1,6}$/.test(c));
  const desde = q.desde, hasta = q.hasta || q.desde;
  if (!juzgados.length || !/^\d{4}-\d{2}-\d{2}$/.test(desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return json(res, 400, { error: 'Elige al menos un juzgado y un rango de fechas válido.' });
  }
  const hoy = slp.hoyMexico();
  // El sitio oficial tiene listas desde el 3 de noviembre de 2010; antes no hay nada que descargar.
  const PRIMERA = '2010-11-03';
  const dias = slp.diasHabiles(desde < PRIMERA ? PRIMERA : desde, hasta > hoy ? hoy : hasta);
  const tareas = [];
  for (const d of [...dias].reverse()) for (const j of juzgados) tareas.push([j, d]); // lo más reciente primero
  if (tareas.length > MAX_LISTAS) {
    return json(res, 400, { error: `La búsqueda pide ${tareas.length} listas (juzgados × días hábiles). El máximo es ${MAX_LISTAS}. Reduce juzgados o fechas.` });
  }
  const criterios = {
    expedientes: String(q.expedientes || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
    nombres: String(q.nombres || '').split(/[\n;]+/).map((s) => s.trim()).filter(Boolean),
    enTexto: !!q.enTexto,
  };
  const incognito = !!q.incognito; // nada se escribe en disco y el servidor no registra la búsqueda
  if (!criterios.expedientes.length && !criterios.nombres.length) {
    return json(res, 400, { error: 'Escribe al menos un número de expediente o un nombre.' });
  }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
  const enviar = (o) => res.write(JSON.stringify(o) + '\n');
  enviar({ tipo: 'inicio', total: tareas.length, dias: dias.length, incognito });
  let cerrado = false;
  req.on('close', () => { cerrado = true; });
  // Varias listas a la vez: las ya guardadas salen al instante y las nuevas respetan el
  // límite global de descargas. Cada resultado se envía en cuanto está listo.
  let siguiente = 0;
  const trabajador = async () => {
    while (!cerrado && siguiente < tareas.length) {
      const [codigo, fecha] = tareas[siguiente++];
      const lista = await slp.obtenerLista(codigo, fecha, { incognito });
      if (cerrado) break;
      const hallazgos = slp.buscarEnLista(lista, criterios);
      enviar({
        tipo: 'lista', codigo, fecha, url: lista.url, estado: lista.estado, detalle: lista.detalle,
        paginas: lista.paginas, acuerdos: lista.acuerdos ? lista.acuerdos.length : 0, cache: !!lista.cache,
        hallazgos: hallazgos.map((h) => ({ ...h, codigo, fecha, url: lista.url })),
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(tareas.length, slp.MAX_DESCARGAS * 2) }, trabajador));
  enviar({ tipo: 'fin' });
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname === '/api/juzgados') return json(res, 200, await slp.catalogo());
    if (u.pathname === '/api/fuentes') return json(res, 200, await fuentes());
    if (u.pathname === '/api/estado') return json(res, 200, { hoy: slp.hoyMexico(), version: '0.3', max_listas: MAX_LISTAS, descargas_a_la_vez: slp.MAX_DESCARGAS });
    if (u.pathname === '/api/buscar' && req.method === 'POST') return await buscar(req, res);
    // archivos de la vista
    const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const file = path.join(DIR, 'public', path.normalize(rel));
    if (!file.startsWith(path.join(DIR, 'public'))) return json(res, 403, { error: 'no permitido' });
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') return json(res, 404, { error: 'no encontrado' });
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.end();
  }
});

server.listen(PORT, HOST, () => console.log(`Lechuza Legal listo en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (escuchando en ${HOST})`));
