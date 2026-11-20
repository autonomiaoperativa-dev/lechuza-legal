// Fuente: Poder Judicial del Estado de San Luis Potosí - Listas de Acuerdos
// https://www.stjslp.gob.mx/Acuerdos/Index
// Cada juzgado publica un PDF por día hábil a las 8:00 (hora del centro de México):
//   https://www.stjslp.gob.mx/Archivos/Listas/tradicionales/<CODIGO><DDMMAA>.pdf
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DATOS } from './rutas.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(DATOS, 'slp');
const BASE = 'https://www.stjslp.gob.mx/Archivos/Listas/tradicionales/';
const UA = 'LechuzaLegal/0.1 (consulta de listas publicas)';

// ---------- Catálogo de juzgados ----------
export async function catalogo() {
  const csv = await fs.readFile(path.join(DIR, 'fuentes', 'slp_juzgados.csv'), 'utf8');
  const [, ...lines] = csv.trim().split(/\r?\n/);
  const vistos = new Set();
  const out = [];
  for (const l of lines) {
    const [materia_id, materia, , juzgado, codigo] = l.split(',');
    if (vistos.has(codigo)) continue; // Soledad aparece dos veces en el sitio oficial
    vistos.add(codigo);
    out.push({ materia_id: Number(materia_id), materia, juzgado, codigo });
  }
  return out;
}

// ---------- Fechas ----------
export function ddmmaa(iso) {
  const [y, m, d] = iso.split('-');
  return d + m + y.slice(2);
}
export function diasHabiles(desde, hasta, max = 6000) {
  const out = [];
  let t = new Date(desde + 'T12:00:00Z');
  const fin = new Date(hasta + 'T12:00:00Z');
  while (t <= fin && out.length < max) {
    const dow = t.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(t.toISOString().slice(0, 10));
    t = new Date(t.getTime() + 86400000);
  }
  return out;
}
export function hoyMexico() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
}

export const pdfUrl = (codigo, fecha) => `${BASE}${codigo}${ddmmaa(fecha)}.pdf`;

// ---------- Texto ----------
export function normalizar(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function normExpediente(s) {
  const m = String(s || '').match(/(\d+)\s*\/\s*(\d{4})/);
  return m ? `${parseInt(m[1], 10)}/${m[2]}` : null;
}

async function pdfATexto(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  let texto = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      texto += it.str;
      texto += it.hasEOL ? '\n' : (it.str.endsWith(' ') ? '' : ' ');
    }
    texto += '\n';
  }
  const paginas = doc.numPages;
  await doc.destroy();
  return { texto: texto.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n'), paginas };
}

// Separa la lista en acuerdos. Cada acuerdo empieza con "Expediente: NNN/AAAA.- Actor VS Demandado.-"
// Las listas penales usan "CAUSA PENAL 1333/2024"; las salas usan "Toca".
const RE_EXP = /(Expediente|Causa\s+Penal|Carpeta(?:\s+(?:Judicial|Administrativa|de\s+Ejecuci[oó]n))?|Toca(?:\s+(?:Civil|Penal|Familiar|Mercantil))?|Exhorto|Cuadernillo)\s*(?:No\.?|n[úu]m(?:ero)?\.?)?\s*[:.]?\s*(\d+\s*\/\s*\d{4})/gi;
export function separarAcuerdos(texto) {
  const idx = [];
  let m;
  RE_EXP.lastIndex = 0;
  while ((m = RE_EXP.exec(texto))) {
    // Solo abre un acuerdo nuevo si empieza con mayúscula y está al inicio de línea o lleva ":"
    // (así no cortamos cuando el auto menciona "el expediente 123/2020" dentro del texto)
    const mayus = /[A-ZÁÉÍÓÚ]/.test(m[0][0]);
    const inicioLinea = m.index === 0 || /\n\s*[*#\s]*$/.test(texto.slice(Math.max(0, m.index - 6), m.index));
    const dosPuntos = /^[^0-9]*:/.test(m[0]);
    if (mayus && (inicioLinea || dosPuntos)) idx.push({ pos: m.index, exp: m[2], clase: m[1].replace(/\s+/g, ' ').toUpperCase() });
  }
  const acuerdos = [];
  let tipo = null;
  // tipo de juicio: línea en MAYÚSCULAS sin minúsculas justo antes del expediente
  const tipoDe = (trozo) => {
    const lineas = trozo.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    const ult = lineas[lineas.length - 1] || '';
    if (ult.length > 3 && ult.length < 90 && !/[a-zñáéíóú]/.test(ult) && /[A-ZÑÁÉÍÓÚ]{4}/.test(ult)
      && !/NOTIF|LISTA|PERSONALMENTE|PARTE|PUBL[IÍ]QUESE/.test(ult.replace(/\s/g, ''))
      && /JUICIO|ORDINARIO|EJECUTIVO|ESPECIAL|SUMARI|HIPOTECARIO|MERCANTIL|CIVIL|FAMILIAR|SUCESORIO|INTESTAMENTARIO|TESTAMENTARIO|DIVORCIO|ALIMENTOS|CONTROVERSIA|JURISDICCI|DILIGENCIAS|PENAL|LABORAL|INCIDENTE|ARRENDAMIENTO|USUCAPI|NULIDAD|PROCEDIMIENTO|ADOPCI|CUSTODIA|PATRIA|PRESCRIPCI|OTORGAMIENTO|CUMPLIMIENTO|REIVINDICA|RECTIFICA|INTERDIC/.test(ult.normalize('NFD').replace(/[̀-ͯ]/g, '')))
      return ult.replace(/[#*]/g, '').replace(/[.\-–:]+$/, '').trim();
    return null;
  };
  const encabezado = idx.length ? texto.slice(0, idx[0].pos) : texto;
  tipo = tipoDe(encabezado);
  for (let i = 0; i < idx.length; i++) {
    const ini = idx[i].pos;
    const fin = i + 1 < idx.length ? idx[i + 1].pos : texto.length;
    let bloque = texto.slice(ini, fin);
    const sig = tipoDe(bloque);
    if (sig && i + 1 < idx.length) bloque = bloque.slice(0, bloque.trim().lastIndexOf(sig.split(' ')[0]));
    const limpio = bloque.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const trasExp = limpio.replace(/^[^0-9]*\d+\s*\/\s*\d{4}\s*/i, '').replace(/^[.\-–\s]+/, '');
    const corte = trasExp.search(/\.\s*-|\.-/);
    const partes = (corte > 0 && corte < 400 ? trasExp.slice(0, corte) : trasExp.slice(0, 200)).trim();
    acuerdos.push({
      tipo_juicio: tipo,
      clase: idx[i].clase,
      expediente: normExpediente(idx[i].exp),
      partes,
      texto: limpio,
    });
    if (sig) tipo = sig;
  }
  return { encabezado: encabezado.replace(/\s+/g, ' ').trim().slice(0, 300), acuerdos };
}

// ---------- Descarga con caché ----------
// Límite GLOBAL de descargas al sitio oficial (compartido por todas las búsquedas a la vez),
// con una pausa mínima entre el inicio de cada descarga. Así se puede buscar mucho más rápido
// sin saturar el servidor del Poder Judicial.
export const MAX_DESCARGAS = Number(process.env.MAX_DESCARGAS || 4);
const PAUSA_MS = Number(process.env.PAUSA_MS || 250);
let enCurso = 0;
const fila = [];
let ultimo = 0;
async function turno() {
  if (enCurso >= MAX_DESCARGAS) await new Promise((r) => fila.push(r));
  enCurso++;
  const espera = PAUSA_MS - (Date.now() - ultimo);
  ultimo = Date.now() + Math.max(0, espera);
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
}
function liberar() {
  enCurso--;
  const sig = fila.shift();
  if (sig) sig();
}

// Si dos búsquedas piden la misma lista al mismo tiempo, se descarga una sola vez.
const pendientes = new Map();

async function leerCache(jsonPath) {
  try {
    const c = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    // se vuelve a separar desde el texto guardado, así una mejora del lector aplica a lo ya descargado
    if (c.estado === 'ok') Object.assign(c, separarAcuerdos(c.texto));
    return { ...c, cache: true };
  } catch { return null; }
}

async function descargar(codigo, fecha, url) {
  let ultimoError = '';
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
      const ct = r.headers.get('content-type') || '';
      // Solo un 404 significa "ese día no hubo lista". Una respuesta 200 que no es PDF (página de
      // mantenimiento, error del servidor) se trata como error para reintentarla después.
      if (r.status === 404) return { codigo, fecha, url, estado: 'sin_lista', detalle: 'HTTP 404' };
      if (r.ok && !ct.includes('pdf')) { ultimoError = `respuesta inesperada del sitio (${ct || 'sin tipo'})`; continue; }
      if (!r.ok) { ultimoError = `HTTP ${r.status}`; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      try {
        const { texto, paginas } = await pdfATexto(buf);
        return { codigo, fecha, url, estado: 'ok', paginas, texto, descargado: new Date().toISOString() };
      } catch (e) {
        // El PDF existe pero está dañado en el sitio oficial: se guarda así para no reintentarlo cada día.
        return { codigo, fecha, url, estado: 'danado', detalle: 'PDF dañado en la fuente oficial: ' + e.message };
      }
    } catch (e) {
      ultimoError = e.name === 'TimeoutError' ? 'el sitio oficial tardó demasiado' : e.message;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { codigo, fecha, url, estado: 'error', detalle: ultimoError };
}

// Descarga una lista sin usar el caché de archivos (la usa el descargador del archivo local).
// Respeta el mismo límite global de descargas.
export async function descargarDirecto(codigo, fecha) {
  const url = pdfUrl(codigo, fecha);
  await turno();
  let res;
  try { res = await descargar(codigo, fecha, url); } finally { liberar(); }
  if (res.estado === 'ok') return { ...res, ...separarAcuerdos(res.texto) };
  return res;
}

// incognito = true: no escribe nada en disco; solo usa lo que ya estaba guardado.
export async function obtenerLista(codigo, fecha, { incognito = false } = {}) {
  const nombre = codigo + ddmmaa(fecha);
  const jsonPath = path.join(CACHE, nombre + '.json');
  const url = pdfUrl(codigo, fecha);
  const enCache = await leerCache(jsonPath);
  if (enCache) return enCache;
  if (!pendientes.has(nombre)) {
    pendientes.set(nombre, (async () => {
      await turno();
      try { return await descargar(codigo, fecha, url); } finally { liberar(); }
    })().finally(() => pendientes.delete(nombre)));
  }
  const res = await pendientes.get(nombre);
  // Solo se guarda el texto (no el PDF) para ocupar poco espacio. La lista del día de hoy
  // sin publicar no se guarda, porque puede aparecer más tarde.
  if (!incognito && res.estado !== 'error' && (res.estado === 'ok' || fecha < hoyMexico())) {
    try {
      await fs.mkdir(CACHE, { recursive: true });
      await fs.writeFile(jsonPath, JSON.stringify(res));
    } catch {}
  }
  if (res.estado === 'ok') return { ...res, ...separarAcuerdos(res.texto) };
  return res;
}

// ---------- Búsqueda ----------
export function buscarEnLista(lista, { expedientes = [], nombres = [], enTexto = false }) {
  if (lista.estado !== 'ok') return [];
  const exps = new Set(expedientes.map(normExpediente).filter(Boolean));
  const noms = nombres.map(normalizar).filter((n) => n.length >= 3);
  const hallazgos = [];
  const coincideNombre = (txt) => {
    const t = ' ' + normalizar(txt) + ' ';
    // el nombre completo, con las palabras juntas, en orden normal o con los apellidos primero
    return noms.filter((n) => {
      const p = n.split(' ');
      return p.some((_, i) => t.includes(' ' + [...p.slice(i), ...p.slice(0, i)].join(' ') + ' '));
    });
  };
  for (const a of lista.acuerdos) {
    const motivos = [];
    if (a.expediente && exps.has(a.expediente)) motivos.push('expediente ' + a.expediente);
    for (const n of coincideNombre(enTexto ? a.texto : a.partes)) motivos.push('nombre: ' + n);
    if (motivos.length) hallazgos.push({ ...a, motivos });
  }
  // Respaldo: expedientes que no salieron como inicio de un acuerdo (listas con otro formato,
  // salas que escriben "EL TOCA 43/2026" a media frase) se buscan en el texto completo.
  if (lista.texto) {
    const plano = lista.texto.replace(/\n/g, ' ');
    const yaVistos = new Set(hallazgos.map((h) => h.expediente));
    for (const e of exps) {
      if (yaVistos.has(e)) continue;
      const [n, y] = e.split('/');
      const re = new RegExp(`(?<![\\d/])0*${n}\\s*/\\s*${y}(?!\\d)`, 'g');
      let m;
      while ((m = re.exec(plano))) hallazgos.push({
        tipo_juicio: null, clase: 'MENCIÓN EN TEXTO', expediente: e, partes: '(mención fuera del encabezado del acuerdo)',
        texto: plano.slice(Math.max(0, m.index - 300), m.index + 700), motivos: ['expediente ' + e + ' (en texto)'],
      });
    }
    if (!lista.acuerdos.length) {
      const pn = normalizar(plano);
      for (const n of noms) {
        const i = pn.indexOf(n);
        if (i >= 0) {
          const pos = Math.round(i * plano.length / pn.length);
          hallazgos.push({ tipo_juicio: null, clase: 'MENCIÓN EN TEXTO', expediente: null, partes: '(lista sin formato estándar)',
            texto: plano.slice(Math.max(0, pos - 300), pos + 700), motivos: ['nombre: ' + n + ' (en texto)'] });
        }
      }
    }
  }
  return hallazgos;
}
