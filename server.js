// Servidor de Lechuza Legal.
// En tu computadora: npm start  ->  http://localhost:3077
// En un servidor (Render u otro) se usa la variable PORT y acepta visitas de internet.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATOS } from './rutas.js';
import * as slp from './slp.js';
import * as indice from './indice.js';
import { generarResumenPdf } from './pdf.js';
import * as alertas from './alertas.js';
import * as sat from './sat.js';
import * as usuarios from './usuarios.js';

// Archivo local (data/lechuza.db). Si no existe, todo funciona como antes (descargando).
let DB = null;
async function obtenerIndice() {
  if (!DB) {
    try { DB = await indice.abrir(); if (DB) { alertas.prepararTablas(DB); alertas.prepararDueno(DB); sat.prepararTablas(DB); usuarios.prepararTablas(DB); } } catch (e) { console.error('Archivo local no disponible:', e.message); }
  }
  return DB;
}
let statsCache = { t: 0, v: null };
async function estadoArchivo() {
  const db = await obtenerIndice();
  if (!db) return null;
  if (Date.now() - statsCache.t > 60000) statsCache = { t: Date.now(), v: indice.estadisticas(db) };
  let descargador = null;
  try {
    const e = JSON.parse(await fs.readFile(path.join(DATOS, 'indexar_estado.json'), 'utf8'));
    if (e.corriendo && Date.now() - Date.parse(e.actualizado) < 30 * 60000) descargador = e;
  } catch {}
  return { ...statsCache.v, descargador };
}

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
async function leerCuerpo(req, max = 1e6) {
  let b = '';
  for await (const c of req) { b += c; if (b.length > max) throw new Error('cuerpo muy grande'); }
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
  if (!dias.length) return json(res, 400, { error: 'No hay días hábiles en ese rango (las listas en línea empiezan el 3 de noviembre de 2010).' });
  const tareas = [];
  for (const d of [...dias].reverse()) for (const j of juzgados) tareas.push([j, d]); // lo más reciente primero
  // Lo que ya está en el archivo local se busca ahí al instante; solo se descarga lo que falte.
  const db = await obtenerIndice();
  const rango = { desde: dias[0], hasta: dias[dias.length - 1] };
  let faltantes = tareas, enArchivo = { listas: 0, ok: 0, sin_lista: 0 };
  if (db) {
    const cob = indice.cobertura(db, juzgados, rango.desde, rango.hasta);
    faltantes = tareas.filter(([j, d]) => !cob.has(j + '|' + d));
    for (const v of cob.values()) { enArchivo.listas++; if (v === 'ok') enArchivo.ok++; else enArchivo.sin_lista++; }
  }
  if (faltantes.length > MAX_LISTAS) {
    const guardadas = enArchivo.listas ? ` (${enArchivo.listas.toLocaleString('es-MX')} ya están guardadas)` : '';
    return json(res, 400, { error: `La búsqueda pide ${tareas.length.toLocaleString('es-MX')} listas${guardadas} y habría que descargar ${faltantes.length.toLocaleString('es-MX')}. El máximo por búsqueda es ${MAX_LISTAS.toLocaleString('es-MX')}. Reduce juzgados o fechas, o espera a que el archivo local tenga esas fechas.` });
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
  enviar({ tipo: 'inicio', total: faltantes.length, total_rango: tareas.length, dias: dias.length, incognito });
  if (db && enArchivo.listas) {
    const t0 = Date.now();
    const r = indice.buscar(db, { juzgados, ...rango, ...criterios });
    enviar({ tipo: 'indice', ...enArchivo, hallazgos: r.hallazgos, recortado: r.recortado, ms: Date.now() - t0 });
  }
  let cerrado = false;
  req.on('close', () => { cerrado = true; });
  // Varias listas a la vez: las ya guardadas salen al instante y las nuevas respetan el
  // límite global de descargas. Cada resultado se envía en cuanto está listo.
  let siguiente = 0;
  const trabajador = async () => {
    while (!cerrado && siguiente < faltantes.length) {
      const [codigo, fecha] = faltantes[siguiente++];
      const lista = await slp.obtenerLista(codigo, fecha, { incognito });
      // lo recién descargado también queda en el archivo local (salvo en incógnito y la lista de hoy sin publicar)
      if (db && !incognito && (lista.estado === 'ok' || lista.estado === 'danado' || (lista.estado === 'sin_lista' && fecha < hoy))) {
        try { indice.guardar(db, lista); } catch {}
      }
      if (cerrado) break;
      const hallazgos = slp.buscarEnLista(lista, criterios);
      enviar({
        tipo: 'lista', codigo, fecha, url: lista.url, estado: lista.estado, detalle: lista.detalle,
        paginas: lista.paginas, acuerdos: lista.acuerdos ? lista.acuerdos.length : 0, cache: !!lista.cache,
        hallazgos: hallazgos.map((h) => ({ ...h, codigo, fecha, url: lista.url })),
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(faltantes.length, slp.MAX_DESCARGAS * 2) }, trabajador));
  enviar({ tipo: 'fin' });
  res.end();
}

// ---------- alertas (solo donde hay archivo local) ----------
// ---------- antecedentes legales: un nombre en todos los juzgados durante N años ----------
const GENERICOS_MORAL = new Set(['sa', 's', 'a', 'de', 'cv', 'c', 'v', 'rl', 'r', 'l', 'sapi', 'sab', 'sc', 'ac', 'spr', 'sas', 'y', 'la', 'el', 'del', 'los', 'las']);
async function antecedentes(req, res) {
  const db = await obtenerIndice();
  if (!db) return json(res, 200, { disponible: false, mensaje: 'La búsqueda de antecedentes usa el archivo local de 10 años y funciona en la versión instalada en la computadora.' });
  const q = await leerCuerpo(req);
  const moral = q.tipo_persona === 'moral';
  const partes = moral ? [q.razon_social] : [q.nombres, q.ap_paterno, q.ap_materno];
  const nombre = partes.map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  const palabras = slp.normalizar(nombre).split(' ').filter((w) => w.length >= 2 && !(moral && GENERICOS_MORAL.has(w)));
  if (moral ? palabras.length < 1 : (!String(q.nombres || '').trim() || !String(q.ap_paterno || '').trim())) {
    return json(res, 400, { error: moral ? 'Escribe la razón social.' : 'Escribe el nombre y al menos el apellido paterno.' });
  }
  const anios = [1, 3, 5, 10].includes(Number(q.periodo)) ? Number(q.periodo) : 10;
  const hoy = slp.hoyMexico();
  const desde = `${Number(hoy.slice(0, 4)) - anios}${hoy.slice(4)}`;
  const juzgados = (await slp.catalogo()).map((j) => j.codigo);
  const t0 = Date.now();
  const r = indice.buscar(db, { juzgados, desde, hasta: hoy, expedientes: [], nombres: [palabras.join(' ')], enTexto: !!q.en_texto });
  // Posibles variantes: muchas listas omiten el apellido materno. Se buscan aparte (nombre + paterno) y
  // se muestran como "por revisar", sin sumarlas al resultado principal.
  let variantes = null;
  if (!moral && String(q.ap_materno || '').trim()) {
    const sinMaterno = slp.normalizar(`${q.nombres} ${q.ap_paterno}`).split(' ').filter(Boolean).join(' ');
    const ya = new Set(r.hallazgos.map((h) => h.id));
    const rv = indice.buscar(db, { juzgados, desde, hasta: hoy, expedientes: [], nombres: [sinMaterno], enTexto: false });
    // Solo cuenta si tras "nombre paterno" NO sigue otro apellido (coma, VS, "y", fin...). Así se descarta
    // "Alejandra Alvarado Martínez" cuando se busca a "Alejandra Alvarado Pérez".
    const SEPARA = new Set([',', '.', ';', 'vs', 'v', 'y', 'e', 'contra', 'en', 'quien', 'quienes', 'por', 'como', 'su', 'sus', 'actor', 'actora', 'demandado', 'demandada', 'apoderado', 'albacea', 'parte', '-', '(']);
    // antes del nombre se aceptan títulos ("Lic.", "C.") pero no otro nombre de pila
    const PREVIOS = new Set(['lic', 'licenciado', 'licenciada', 'c', 'ciudadano', 'ciudadana', 'sr', 'sra', 'senor', 'senora', 'ing', 'dr', 'dra', 'arq', 'cp', 'mtro', 'mtra', 'el', 'la', 'del', 'a', 'al']);
    const tokens = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/([,.;(-])/g, ' $1 ').replace(/[^a-z0-9,.;(\- ]+/g, ' ').split(/\s+/).filter(Boolean);
    const buscadas = sinMaterno.split(' ');
    const sinOtroApellido = (texto) => {
      const t = tokens(texto);
      for (let i = 0; i + buscadas.length <= t.length; i++) {
        if (buscadas.every((w, k) => t[i + k] === w)) {
          const sig = t[i + buscadas.length], prev = t[i - 1];
          const finOk = sig === undefined || SEPARA.has(sig);
          const inicioOk = prev === undefined || SEPARA.has(prev) || PREVIOS.has(prev);
          if (finOk && inicioOk) return true;
        }
      }
      return false;
    };
    const solo = rv.hallazgos.filter((h) => !ya.has(h.id) && sinOtroApellido(h.partes));
    variantes = { criterio: `${String(q.nombres).trim()} ${String(q.ap_paterno).trim()}`, total: solo.length, hallazgos: solo.slice(0, 400), recortado: solo.length > 400 };
  }
  const st = indice.estadisticas(db);
  const cobertura = db.prepare('SELECT COUNT(*) n, MIN(fecha) desde, MAX(fecha) hasta FROM listas WHERE fecha BETWEEN ? AND ?').get(desde, hoy);
  // listados públicos del SAT (69-B y 69): por nombre completo y por RFC si se dio
  let satRes = null;
  try { satRes = sat.buscar(db, { nombre: moral ? palabras.join(' ') : nombre, rfc: q.rfc, moral }); } catch (e) { satRes = { disponible: false, error: e.message }; }
  return json(res, 200, {
    disponible: true, criterio: nombre, palabras, desde, hasta: hoy, anios, ms: Date.now() - t0,
    hallazgos: r.hallazgos, recortado: r.recortado, variantes, sat: satRes, sat_fuente: sat.PAGINA_FUENTE,
    fuentes: { listas_revisadas: cobertura.n, archivo_desde: cobertura.desde, archivo_hasta: cobertura.hasta, juzgados: juzgados.length, total_archivo: st.listas },
  });
}

async function rutasAlertas(req, res, u, ctx) {
  const quien = ctx.quien;
  const db = await obtenerIndice();
  if (!db) return json(res, 200, { disponible: false, mensaje: 'Las alertas funcionan en la versión instalada en la computadora, donde está el archivo local de listas.' });
  try {
    if (u.pathname === '/api/alertas' && req.method === 'GET') {
      return json(res, 200, { disponible: true, correo: alertas.correoConfigurado(), alertas: alertas.listar(db, quien) });
    }
    if (u.pathname === '/api/alertas' && req.method === 'POST') return json(res, 200, alertas.crear(db, await leerCuerpo(req), quien));
    if (u.pathname === '/api/alertas/revisar' && req.method === 'POST') {
      const r = await alertas.revisar(db);
      let correo = null;
      try { correo = await alertas.enviarPendientes(db); } catch (e) { correo = { correos: 0, motivo: e.message }; }
      return json(res, 200, { revisadas: r.length, nuevas: r.reduce((s, a) => s + a.nuevas, 0), correo });
    }
    if (u.pathname === '/api/novedades' && req.method === 'GET') return json(res, 200, { novedades: alertas.novedades(db, {}, quien) });
    if (u.pathname === '/api/novedades' && req.method === 'POST') { alertas.marcarVistas(db, (await leerCuerpo(req)).alerta_id, quien); return json(res, 200, { ok: true }); }
    const m = u.pathname.match(/^\/api\/alertas\/(\d+)$/);
    if (m && req.method === 'POST') return json(res, 200, alertas.actualizar(db, Number(m[1]), await leerCuerpo(req), quien));
    if (m && req.method === 'DELETE') { alertas.borrar(db, Number(m[1]), quien); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'no encontrado' });
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
}

// ---------- acceso: cuentas de usuario, clave única o abierto ----------
// 1) Si en el archivo local existe al menos una cuenta, se pide usuario y contraseña (modo "usuarios").
// 2) Si no hay cuentas pero existe LECHUZA_CLAVE (app/.env o Render), se pide esa clave (modo "clave").
// 3) Si no hay ninguna de las dos, la aplicación queda abierta (uso en la propia computadora).
const CLAVE = process.env.LECHUZA_CLAVE || '';
const TOKEN_CLAVE = CLAVE ? crypto.createHash('sha256').update('lechuza-legal:' + CLAVE).digest('hex') : '';
const intentos = new Map(); // ip -> { n, desde }
const ipDe = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const esEstaComputadora = (req) => !req.headers['x-forwarded-for'] && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
function cookie(req, nombre) {
  const c = (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(nombre + '='));
  return c ? decodeURIComponent(c.slice(nombre.length + 1)) : '';
}
function bloqueado(req) {
  const a = intentos.get(ipDe(req));
  return a && Date.now() - a.desde < 10 * 60000 && a.n >= 5;
}
function fallo(req) {
  const ip = ipDe(req);
  const a = intentos.get(ip) || { n: 0, desde: Date.now() };
  if (Date.now() - a.desde > 10 * 60000) { a.n = 0; a.desde = Date.now(); }
  a.n++; intentos.set(ip, a);
}
const cookieSesion = (req, nombre, valor, dias) => `${nombre}=${valor}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${dias * 86400}${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;

async function contexto(req) {
  const db = await obtenerIndice();
  if (db && usuarios.hayUsuarios(db)) {
    const u = usuarios.sesion(db, cookie(req, 'lechuza_cuenta'));
    return { modo: 'usuarios', ok: !!u, usuario: u, quien: u ? { id: u.id, admin: u.rol === 'admin' } : null, db };
  }
  if (CLAVE) {
    const v = cookie(req, 'lechuza_sesion');
    const ok = v.length === TOKEN_CLAVE.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(TOKEN_CLAVE));
    return { modo: 'clave', ok, usuario: null, quien: null, db };
  }
  return { modo: 'abierto', ok: true, usuario: null, quien: null, db };
}

const ESTILO_ENTRAR = `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f9;color:#1b2733;font:15px system-ui,sans-serif}
@media (prefers-color-scheme:dark){body{background:#0f1620;color:#e6edf3}form{background:#18222e!important;border-color:#2a3746!important}input{background:#0f1620;color:#e6edf3;border-color:#2a3746!important}a{color:#6fb1e3}}
form{background:#fff;border:1px solid #dde3ea;border-radius:12px;padding:24px;width:min(340px,90vw)}h1{font-size:18px;margin:0 0 4px}p{color:#5b6b7b;font-size:13px;margin:0 0 14px}
label{display:block;font-size:13px;font-weight:600;margin-bottom:4px}input{display:block;width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #dde3ea;border-radius:8px;font:inherit;margin-bottom:12px}
button{width:100%;padding:10px;border:0;border-radius:8px;background:#16324a;color:#fff;font:600 14px system-ui;cursor:pointer}#e{color:#b3261e;font-size:13px;min-height:1em}
.pie{margin:14px 0 0;font-size:12px;text-align:center}a{color:#2f6f9f}</style>`;
const PIE_LEGAL = `<p class="pie"><a href="/aviso-privacidad.html" target="_blank">Aviso de privacidad</a> · <a href="/terminos.html" target="_blank">Términos y condiciones</a></p>`;
const PAGINA_CLAVE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lechuza Legal · Entrar</title>${ESTILO_ENTRAR}</head>
<body><form id="f"><h1>Lechuza Legal</h1><p>Escribe la clave de acceso que te compartieron.</p>
<input type="password" id="c" autocomplete="current-password" aria-label="Clave de acceso" required autofocus><button>Entrar</button><p id="e" role="alert"></p>${PIE_LEGAL}</form>
<script>document.getElementById('f').onsubmit=async(ev)=>{ev.preventDefault();const r=await fetch('/api/entrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clave:document.getElementById('c').value})});
if(r.ok)location.reload();else document.getElementById('e').textContent=(await r.json().catch(()=>({}))).error||'Clave incorrecta.';};</script></body></html>`;
const PAGINA_LOGIN = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lechuza Legal · Iniciar sesión</title>${ESTILO_ENTRAR}</head>
<body><form id="f"><h1>Lechuza Legal</h1><p>Inicia sesión con tu usuario y contraseña.</p>
<label for="u">Usuario</label><input id="u" autocomplete="username" required autofocus>
<label for="c">Contraseña</label><input type="password" id="c" autocomplete="current-password" required>
<button>Entrar</button><p id="e" role="alert"></p><p class="pie">¿Olvidaste tu contraseña? Pide al administrador que la restablezca.</p>${PIE_LEGAL}</form>
<script>document.getElementById('f').onsubmit=async(ev)=>{ev.preventDefault();const b=ev.submitter;b.disabled=true;
const r=await fetch('/api/sesion/entrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:document.getElementById('u').value,contrasena:document.getElementById('c').value})});
b.disabled=false;if(r.ok)location.reload();else document.getElementById('e').textContent=(await r.json().catch(()=>({}))).error||'No se pudo entrar.';};</script></body></html>`;

async function entrarClave(req, res) {
  if (bloqueado(req)) return json(res, 429, { error: 'Demasiados intentos. Espera 10 minutos.' });
  const { clave } = await leerCuerpo(req, 2000);
  const ok = typeof clave === 'string' && clave.length === CLAVE.length && crypto.timingSafeEqual(Buffer.from(clave), Buffer.from(CLAVE));
  if (!ok) { fallo(req); return json(res, 401, { error: 'Clave incorrecta.' }); }
  intentos.delete(ipDe(req));
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookieSesion(req, 'lechuza_sesion', TOKEN_CLAVE, 30) });
  res.end('{"ok":true}');
}

// Rutas de cuenta: /api/sesion..., /api/usuarios...
async function rutasCuenta(req, res, u, ctx) {
  const db = ctx.db;
  try {
    if (u.pathname === '/api/sesion' && req.method === 'GET') {
      return json(res, 200, { modo: ctx.modo, usuario: ctx.usuario, cuentas_disponibles: !!db,
        hay_usuarios: db ? usuarios.hayUsuarios(db) : false, puede_crear_primero: !!db && !usuarios.hayUsuarios(db) && esEstaComputadora(req) });
    }
    if (u.pathname === '/api/sesion/entrar' && req.method === 'POST') {
      if (!db || !usuarios.hayUsuarios(db)) return json(res, 400, { error: 'No hay cuentas configuradas.' });
      if (bloqueado(req)) return json(res, 429, { error: 'Demasiados intentos. Espera 10 minutos.' });
      const q = await leerCuerpo(req, 4000);
      try {
        const s = usuarios.entrar(db, q.usuario, q.contrasena);
        intentos.delete(ipDe(req));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookieSesion(req, 'lechuza_cuenta', s.token, s.dias) });
        return res.end(JSON.stringify({ ok: true, usuario: s.usuario }));
      } catch (e) { fallo(req); return json(res, 401, { error: e.message }); }
    }
    if (u.pathname === '/api/sesion/salir' && req.method === 'POST') {
      if (db) usuarios.salir(db, cookie(req, 'lechuza_cuenta'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'lechuza_cuenta=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      return res.end('{"ok":true}');
    }
    // La primera cuenta (administrador) solo se puede crear desde esta computadora y cuando aún no hay ninguna.
    if (u.pathname === '/api/usuarios/primero' && req.method === 'POST') {
      if (!db) return json(res, 400, { error: 'Las cuentas necesitan el archivo local.' });
      if (usuarios.hayUsuarios(db)) return json(res, 400, { error: 'Ya existe una cuenta de administrador.' });
      if (!esEstaComputadora(req)) return json(res, 403, { error: 'La primera cuenta solo se puede crear desde la computadora donde corre Lechuza Legal.' });
      const q = await leerCuerpo(req, 4000);
      const nuevo = usuarios.crear(db, { ...q, rol: 'admin' });
      const s = usuarios.entrar(db, nuevo.usuario, q.contrasena);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookieSesion(req, 'lechuza_cuenta', s.token, s.dias) });
      return res.end(JSON.stringify({ ok: true, usuario: nuevo }));
    }
    if (u.pathname === '/api/sesion/contrasena' && req.method === 'POST') {
      if (!ctx.usuario) return json(res, 401, { error: 'Inicia sesión primero.' });
      const q = await leerCuerpo(req, 4000);
      usuarios.cambiarContrasena(db, ctx.usuario.id, q.actual, q.nueva);
      return json(res, 200, { ok: true });
    }
    // ---- administración de usuarios (solo administradores) ----
    if (u.pathname.startsWith('/api/usuarios')) {
      if (!ctx.usuario || ctx.usuario.rol !== 'admin') return json(res, 403, { error: 'Solo un administrador puede hacer esto.' });
      if (u.pathname === '/api/usuarios' && req.method === 'GET') return json(res, 200, { usuarios: usuarios.listar(db) });
      if (u.pathname === '/api/usuarios' && req.method === 'POST') {
        const q = await leerCuerpo(req, 4000);
        const temporal = usuarios.contrasenaTemporal();
        const nuevo = usuarios.crear(db, { ...q, contrasena: temporal, debeCambiar: true });
        return json(res, 200, { usuario: nuevo, contrasena_temporal: temporal });
      }
      const m = u.pathname.match(/^\/api\/usuarios\/(\d+)(\/restablecer)?$/);
      if (m && req.method === 'POST' && m[2]) return json(res, 200, { contrasena_temporal: usuarios.restablecer(db, Number(m[1])) });
      if (m && req.method === 'POST') return json(res, 200, usuarios.actualizar(db, Number(m[1]), await leerCuerpo(req, 4000), ctx.usuario));
    }
    return json(res, 404, { error: 'no encontrado' });
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
}

// Archivos que se pueden ver sin iniciar sesión (página de entrada y textos legales)
const PUBLICOS = new Set(['/aviso-privacidad.html', '/terminos.html', '/estilos.css', '/favicon.ico']);

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const ctx = await contexto(req);
    if (u.pathname === '/api/entrar' && req.method === 'POST' && ctx.modo === 'clave') return await entrarClave(req, res);
    if (u.pathname === '/api/sesion' || u.pathname.startsWith('/api/sesion/') || u.pathname.startsWith('/api/usuarios')) return await rutasCuenta(req, res, u, ctx);
    if (!ctx.ok && !PUBLICOS.has(u.pathname)) {
      if (u.pathname === '/api/estado' && req.method === 'GET' && req.headers['user-agent']?.includes('Render')) return json(res, 200, { ok: true }); // chequeo de salud de Render
      if (u.pathname.startsWith('/api/')) return json(res, 401, { error: ctx.modo === 'usuarios' ? 'Inicia sesión.' : 'Se necesita la clave de acceso.' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(ctx.modo === 'usuarios' ? PAGINA_LOGIN : PAGINA_CLAVE);
    }
    // con contraseña temporal, primero hay que cambiarla
    if (ctx.usuario && ctx.usuario.debe_cambiar && u.pathname.startsWith('/api/') && !['/api/estado', '/api/juzgados'].includes(u.pathname)) {
      return json(res, 403, { error: 'Cambia tu contraseña temporal en la pestaña Cuenta para continuar.', debe_cambiar: true });
    }
    if (u.pathname === '/api/juzgados') return json(res, 200, await slp.catalogo());
    if (u.pathname === '/api/fuentes') return json(res, 200, await fuentes());
    if (u.pathname === '/api/estado') return json(res, 200, { hoy: slp.hoyMexico(), version: '1.0', max_listas: MAX_LISTAS, descargas_a_la_vez: slp.MAX_DESCARGAS, archivo: await estadoArchivo() });
    if (u.pathname === '/api/buscar' && req.method === 'POST') { if (ctx.db) usuarios.registrarUso(ctx.db, ctx.usuario?.id, 'busqueda'); return await buscar(req, res); }
    if (u.pathname.startsWith('/api/alertas') || u.pathname === '/api/novedades') return await rutasAlertas(req, res, u, ctx);
    if (u.pathname === '/api/pdf' && req.method === 'POST') {
      const q = await leerCuerpo(req, 20e6);
      const grupos = Array.isArray(q.grupos) ? q.grupos.slice(0, 200) : [];
      if (!grupos.length && !Array.isArray(q.bloques)) return json(res, 400, { error: 'No hay expedientes para el PDF.' });
      return generarResumenPdf(res, {
        grupos, incluirTexto: !!q.incluirTexto, criterios: String(q.criterios || '').slice(0, 300),
        titulo: q.titulo ? String(q.titulo).slice(0, 120) : undefined,
        bloques: Array.isArray(q.bloques) ? q.bloques.slice(0, 20) : [],
        nombreArchivo: q.nombreArchivo ? String(q.nombreArchivo).replace(/[^\w.-]+/g, '_').slice(0, 80) : undefined,
      });
    }
    if (u.pathname === '/api/antecedentes' && req.method === 'POST') { if (ctx.db) usuarios.registrarUso(ctx.db, ctx.usuario?.id, 'antecedentes'); return await antecedentes(req, res); }
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
