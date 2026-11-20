// Alertas de Lechuza Legal: expedientes o nombres que se revisan cada día contra el archivo local
// (data/lechuza.db). Cuando aparece un acuerdo nuevo se guarda como "novedad" y se avisa por correo.
//
// Dos tipos:
//   - expediente: un número (NNN/AAAA), en uno o varios juzgados (o en todos)
//   - nombre:     una persona o empresa como parte del juicio (o en todo el texto, si se pide)
//
// Funciona donde existe el archivo local (la laptop). El correo se configura en app/.env:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM   (ver README)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as indice from './indice.js';
import { normalizar, normExpediente, hoyMexico, catalogo } from './slp.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(DIR, '.env')); } catch {}

export function prepararTablas(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS alertas (
      id INTEGER PRIMARY KEY,
      tipo TEXT NOT NULL CHECK (tipo IN ('expediente', 'nombre')),
      valor TEXT NOT NULL,
      etiqueta TEXT,
      juzgados TEXT,            -- códigos separados por coma; vacío = todos
      en_texto INTEGER DEFAULT 0,
      correo TEXT,
      activa INTEGER DEFAULT 1,
      creada TEXT NOT NULL,
      revisada_hasta TEXT NOT NULL,   -- última fecha de listas ya revisada
      ultima_novedad TEXT,
      novedades_total INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS novedades (
      id INTEGER PRIMARY KEY,
      alerta_id INTEGER NOT NULL REFERENCES alertas(id) ON DELETE CASCADE,
      acuerdo_id INTEGER,
      codigo TEXT, fecha TEXT, expediente TEXT, partes TEXT, texto TEXT, url TEXT,
      detectada TEXT NOT NULL,
      enviada TEXT,
      vista INTEGER DEFAULT 0,
      UNIQUE (alerta_id, acuerdo_id)
    );
    CREATE INDEX IF NOT EXISTS ix_novedades_fecha ON novedades(detectada);
  `);
}

const ayer = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const manana = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

// ---------- dueño de cada alerta ----------
// quien = { id, admin } del usuario con sesión, o null cuando no hay cuentas (modo abierto o clave única).
// Un usuario ve solo sus alertas; un administrador ve las suyas y las creadas antes de que hubiera cuentas.
function filtro(quien, alias = 'a') {
  if (!quien) return { sql: '1 = 1', args: [] };
  return quien.admin ? { sql: `(${alias}.usuario_id = ? OR ${alias}.usuario_id IS NULL)`, args: [quien.id] } : { sql: `${alias}.usuario_id = ?`, args: [quien.id] };
}
function verificarDueno(db, id, quien) {
  const a = db.prepare('SELECT * FROM alertas WHERE id = ?').get(id);
  if (!a) throw new Error('No existe esa alerta.');
  if (quien && !(a.usuario_id === quien.id || (quien.admin && a.usuario_id == null))) throw new Error('No existe esa alerta.');
  return a;
}
export function prepararDueno(db) {
  try { db.exec('ALTER TABLE alertas ADD COLUMN usuario_id INTEGER'); } catch {}
}

export function listar(db, quien = null) {
  const f = filtro(quien);
  return db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM novedades n WHERE n.alerta_id = a.id AND n.vista = 0) AS sin_ver
    FROM alertas a WHERE ${f.sql} ORDER BY COALESCE(a.ultima_novedad, a.creada) DESC`).all(...f.args).map((a) => ({ ...a }));
}

export function crear(db, { tipo, valor, etiqueta, juzgados, en_texto, correo }, quien = null) {
  if (!['expediente', 'nombre'].includes(tipo)) throw new Error('Tipo de alerta no válido.');
  let v = String(valor || '').trim();
  if (tipo === 'expediente') {
    v = normExpediente(v);
    if (!v) throw new Error('Escribe el expediente como NNN/AAAA, por ejemplo 954/2014.');
  } else if (normalizar(v).split(' ').filter((w) => w.length >= 2).length < 2) {
    throw new Error('Escribe al menos nombre y apellido (o el nombre de la empresa).');
  }
  const cods = (Array.isArray(juzgados) ? juzgados : String(juzgados || '').split(',')).map((s) => s.trim()).filter((c) => /^[A-Z0-9]{1,6}$/.test(c));
  const mail = String(correo || '').trim();
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new Error('El correo no parece válido.');
  const f = filtro(quien);
  const ya = db.prepare(`SELECT id FROM alertas a WHERE tipo = ? AND valor = ? AND COALESCE(juzgados, '') = ? AND ${f.sql}`).get(tipo, v, cods.join(','), ...f.args);
  if (ya) throw new Error('Ya tienes una alerta igual.');
  const hoy = hoyMexico();
  // Arranca revisando desde hoy: lo anterior se puede ver con una búsqueda normal.
  const r = db.prepare(`INSERT INTO alertas (tipo, valor, etiqueta, juzgados, en_texto, correo, creada, revisada_hasta, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(tipo, v, String(etiqueta || '').trim().slice(0, 80) || null, cods.join(',') || null,
    en_texto ? 1 : 0, mail || null, new Date().toISOString(), ayer(hoy), quien ? quien.id : null);
  return db.prepare('SELECT * FROM alertas WHERE id = ?').get(r.lastInsertRowid);
}

export function actualizar(db, id, cambios, quien = null) {
  const a = verificarDueno(db, id, quien);
  const activa = cambios.activa === undefined ? a.activa : (cambios.activa ? 1 : 0);
  const etiqueta = cambios.etiqueta === undefined ? a.etiqueta : String(cambios.etiqueta).trim().slice(0, 80) || null;
  let correo = cambios.correo === undefined ? a.correo : String(cambios.correo).trim() || null;
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('El correo no parece válido.');
  db.prepare('UPDATE alertas SET activa = ?, etiqueta = ?, correo = ? WHERE id = ?').run(activa, etiqueta, correo, id);
  return db.prepare('SELECT * FROM alertas WHERE id = ?').get(id);
}

export function borrar(db, id, quien = null) {
  verificarDueno(db, id, quien);
  db.prepare('DELETE FROM novedades WHERE alerta_id = ?').run(id);
  db.prepare('DELETE FROM alertas WHERE id = ?').run(id);
}

export function novedades(db, { limite = 200 } = {}, quien = null) {
  const f = filtro(quien);
  return db.prepare(`SELECT n.*, a.tipo, a.valor, a.etiqueta, a.correo FROM novedades n JOIN alertas a ON a.id = n.alerta_id
    WHERE ${f.sql} ORDER BY n.fecha DESC, n.id DESC LIMIT ?`).all(...f.args, limite).map((r) => ({ ...r }));
}

export function marcarVistas(db, alertaId, quien = null) {
  const f = filtro(quien);
  if (alertaId) { verificarDueno(db, alertaId, quien); db.prepare('UPDATE novedades SET vista = 1 WHERE alerta_id = ?').run(alertaId); }
  else db.prepare(`UPDATE novedades SET vista = 1 WHERE alerta_id IN (SELECT a.id FROM alertas a WHERE ${f.sql})`).run(...f.args);
}

// Revisa cada alerta activa contra lo que hay en el archivo desde su última revisión.
export async function revisar(db, { hasta = hoyMexico() } = {}) {
  const todos = (await catalogo()).map((j) => j.codigo);
  const ins = db.prepare(`INSERT OR IGNORE INTO novedades (alerta_id, acuerdo_id, codigo, fecha, expediente, partes, texto, url, detectada)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const resumen = [];
  for (const a of db.prepare('SELECT * FROM alertas WHERE activa = 1').all()) {
    const desde = manana(a.revisada_hasta);
    if (desde > hasta) continue;
    const juzgados = a.juzgados ? a.juzgados.split(',') : todos;
    const { hallazgos } = indice.buscar(db, {
      juzgados, desde, hasta,
      expedientes: a.tipo === 'expediente' ? [a.valor] : [],
      nombres: a.tipo === 'nombre' ? [a.valor] : [],
      enTexto: !!a.en_texto,
    });
    // en alertas por expediente solo cuentan los acuerdos del propio expediente (no menciones en otros)
    const validos = a.tipo === 'expediente' ? hallazgos.filter((h) => h.expediente === a.valor) : hallazgos;
    let nuevas = 0;
    const ahora = new Date().toISOString();
    for (const h of validos) {
      const r = ins.run(a.id, h.id ?? null, h.codigo, h.fecha, h.expediente, h.partes, h.texto, h.url, ahora);
      if (r.changes) nuevas++;
    }
    // Solo se avanza hasta la última fecha que ya está completa en el archivo (para no saltarse listas
    // que se publiquen tarde); la lista de hoy se vuelve a revisar mañana.
    const revisadaHasta = hasta >= hoyMexico() ? ayer(hoyMexico()) : hasta;
    db.prepare(`UPDATE alertas SET revisada_hasta = MAX(revisada_hasta, ?), novedades_total = novedades_total + ?,
      ultima_novedad = CASE WHEN ? > 0 THEN ? ELSE ultima_novedad END WHERE id = ?`)
      .run(revisadaHasta, nuevas, nuevas, ahora, a.id);
    resumen.push({ id: a.id, tipo: a.tipo, valor: a.valor, etiqueta: a.etiqueta, nuevas });
  }
  return resumen;
}

// ---------- correo ----------
export function correoConfigurado() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let Resumen = null;
function cargarResumen() {
  if (Resumen) return Resumen;
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(DIR, 'public', 'resumen.js'), 'utf8'), ctx);
  return (Resumen = ctx.window.Resumen);
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtF = (f) => (f ? f.split('-').reverse().join('/') : '');

// Envía un correo por destinatario con las novedades aún no enviadas. Devuelve cuántos correos salieron.
export async function enviarPendientes(db) {
  const pend = db.prepare(`SELECT n.*, a.tipo, a.valor, a.etiqueta, a.correo FROM novedades n JOIN alertas a ON a.id = n.alerta_id
    WHERE n.enviada IS NULL AND a.correo IS NOT NULL ORDER BY a.id, n.fecha`).all();
  if (!pend.length) return { correos: 0, novedades: 0, motivo: 'sin novedades por enviar' };
  if (!correoConfigurado()) return { correos: 0, novedades: pend.length, motivo: 'correo no configurado (ver app/.env)' };
  const { default: nodemailer } = await import('nodemailer');
  // SMTP_HOST=prueba arma los correos sin enviarlos (para revisar el contenido)
  const t = process.env.SMTP_HOST === 'prueba'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  const enviados_prueba = [];
  const nombres = Object.fromEntries((await catalogo()).map((j) => [j.codigo, j.juzgado]));
  const R = cargarResumen();
  const porCorreo = new Map();
  for (const n of pend) { if (!porCorreo.has(n.correo)) porCorreo.set(n.correo, []); porCorreo.get(n.correo).push(n); }
  let enviados = 0;
  const marcar = db.prepare('UPDATE novedades SET enviada = ? WHERE id = ?');
  for (const [correo, lista] of porCorreo) {
    const porAlerta = new Map();
    for (const n of lista) { const k = n.alerta_id; if (!porAlerta.has(k)) porAlerta.set(k, []); porAlerta.get(k).push(n); }
    let html = `<div style="font-family:Arial,sans-serif;color:#1b2733;max-width:720px">
      <h2 style="color:#16324a;margin:0 0 4px">Lechuza Legal · ${lista.length} acuerdo${lista.length > 1 ? 's' : ''} nuevo${lista.length > 1 ? 's' : ''}</h2>
      <p style="color:#5b6b7b;font-size:13px;margin:0 0 16px">Listas de acuerdos del Poder Judicial del Estado de San Luis Potosí. Resumen automático; no es asesoría legal.</p>`;
    for (const items of porAlerta.values()) {
      const a = items[0];
      html += `<h3 style="color:#16324a;border-top:3px solid #2f6f9f;padding-top:8px;margin:18px 0 6px">${esc(a.etiqueta || a.valor)}
        <span style="font-weight:normal;color:#5b6b7b;font-size:13px"> · alerta por ${a.tipo} ${esc(a.valor)}</span></h3>`;
      for (const n of items) {
        const r = R.resumirAcuerdo(n.texto, n.partes);
        const et = R.etiquetas(n.texto || '');
        const pl = R.plazos(n.texto || '');
        html += `<div style="border-bottom:1px solid #dde3ea;padding:8px 0">
          <b>${fmtF(n.fecha)}</b> · ${esc(nombres[n.codigo] || n.codigo)} · Exp. <b>${esc(n.expediente || 's/n')}</b>
          ${et.length ? `<span style="color:#2f6f9f;font-size:12px"> · ${esc(et.join(' · '))}</span>` : ''}<br>
          <span style="color:#5b6b7b;font-size:13px">${esc(n.partes)}</span><br>
          <span style="font-size:14px">${esc(r)}</span>
          ${pl.length ? `<br><b style="color:#a8640b;font-size:13px">Plazos mencionados: ${esc(pl.join(', '))}</b>` : ''}
          <br><a href="${esc(n.url)}" style="font-size:12px;color:#2f6f9f">Lista oficial (PDF)</a></div>`;
      }
    }
    html += `<p style="color:#5b6b7b;font-size:12px;margin-top:18px">Recibes este correo porque estás anotado en una alerta de Lechuza Legal.</p></div>`;
    const info = await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER, to: correo,
      subject: `Lechuza Legal: ${lista.length} acuerdo${lista.length > 1 ? 's' : ''} nuevo${lista.length > 1 ? 's' : ''} en tus alertas`,
      html,
    });
    if (process.env.SMTP_HOST === 'prueba') { enviados_prueba.push({ correo, html, info }); continue; } // en prueba no se marca como enviado
    const ahora = new Date().toISOString();
    for (const n of lista) marcar.run(ahora, n.id);
    enviados++;
  }
  return { correos: enviados, novedades: pend.length, prueba: enviados_prueba };
}
