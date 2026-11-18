// Servidor local de Lechuza Legal.
// Arranque: npm start  ->  http://localhost:3077
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as slp from './slp.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3077);
const HOST = process.env.HOST || '127.0.0.1'; // solo esta computadora
const MAX_LISTAS = 80; // tope por búsqueda: juzgados x días hábiles

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
  const q = await leerCuerpo(req);
  const juzgados = (q.juzgados || []).filter((c) => /^[A-Z0-9]{1,6}$/.test(c));
  const desde = q.desde, hasta = q.hasta || q.desde;
  if (!juzgados.length || !/^\d{4}-\d{2}-\d{2}$/.test(desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return json(res, 400, { error: 'Elige al menos un juzgado y un rango de fechas válido.' });
  }
  const hoy = slp.hoyMexico();
  const dias = slp.diasHabiles(desde, hasta > hoy ? hoy : hasta);
  const tareas = [];
  for (const d of dias) for (const j of juzgados) tareas.push([j, d]);
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
  for (const [codigo, fecha] of tareas) {
    if (cerrado) break;
    const lista = await slp.obtenerLista(codigo, fecha, { incognito });
    const hallazgos = slp.buscarEnLista(lista, criterios);
    enviar({
      tipo: 'lista', codigo, fecha, url: lista.url, estado: lista.estado, detalle: lista.detalle,
      paginas: lista.paginas, acuerdos: lista.acuerdos ? lista.acuerdos.length : 0, cache: !!lista.cache,
      hallazgos: hallazgos.map((h) => ({ ...h, codigo, fecha, url: lista.url })),
    });
  }
  enviar({ tipo: 'fin' });
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname === '/api/juzgados') return json(res, 200, await slp.catalogo());
    if (u.pathname === '/api/fuentes') return json(res, 200, await fuentes());
    if (u.pathname === '/api/estado') return json(res, 200, { hoy: slp.hoyMexico(), version: '0.1' });
    if (u.pathname === '/api/buscar' && req.method === 'POST') return await buscar(req, res);
    // archivos de la vista
    const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const file = path.join(DIR, 'public', path.normalize(rel));
    if (!file.startsWith(path.join(DIR, 'public'))) return json(res, 403, { error: 'no permitido' });
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') return json(res, 404, { error: 'no encontrado' });
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.end();
  }
});

server.listen(PORT, HOST, () => console.log(`Lechuza Legal listo en http://localhost:${PORT}`));
