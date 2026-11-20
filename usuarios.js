// Cuentas de usuario de Lechuza Legal: usuario y contraseña, roles (admin / usuario), vencimiento de
// acceso (para suscripciones) y sesiones. Se guardan en el archivo local (lechuza.db).
// Las contraseñas nunca se guardan tal cual: se guarda un hash scrypt con sal aleatoria.
import crypto from 'node:crypto';

const DIAS_SESION = 30;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ahora = () => new Date().toISOString();
const hoyMx = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

export function prepararTablas(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY,
      usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
      nombre TEXT, correo TEXT,
      hash TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'usuario' CHECK (rol IN ('admin', 'usuario')),
      activo INTEGER NOT NULL DEFAULT 1,
      vence TEXT,                    -- fecha AAAA-MM-DD; vacío = sin vencimiento
      debe_cambiar INTEGER NOT NULL DEFAULT 0,
      creado TEXT NOT NULL, ultimo_acceso TEXT
    );
    CREATE TABLE IF NOT EXISTS sesiones (
      token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, creada TEXT NOT NULL, expira TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS uso (
      id INTEGER PRIMARY KEY, usuario_id INTEGER, tipo TEXT NOT NULL, detalle TEXT, fecha TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_uso_usuario ON uso(usuario_id, fecha);
  `);
}

// ---------- contraseñas ----------
export function hashContrasena(p) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(p, sal, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}
export function verificarContrasena(p, guardado) {
  const [alg, salHex, hHex] = String(guardado || '').split('$');
  if (alg !== 'scrypt' || !salHex || !hHex) return false;
  const h = crypto.scryptSync(String(p || ''), Buffer.from(salHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const esperado = Buffer.from(hHex, 'hex');
  return h.length === esperado.length && crypto.timingSafeEqual(h, esperado);
}
export function validarContrasena(p) {
  if (typeof p !== 'string' || p.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(p) || !/\d/.test(p)) return 'La contraseña debe combinar letras y números.';
  return null;
}
export function contrasenaTemporal() {
  // 12 caracteres fáciles de dictar (sin 0/O, 1/l)
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(12);
  let s = '';
  for (const x of b) s += abc[x % abc.length];
  return /\d/.test(s) ? s : s.slice(0, 11) + '7';
}

// ---------- usuarios ----------
const publico = (u) => u && ({ id: u.id, usuario: u.usuario, nombre: u.nombre, correo: u.correo, rol: u.rol, activo: !!u.activo,
  vence: u.vence, debe_cambiar: !!u.debe_cambiar, creado: u.creado, ultimo_acceso: u.ultimo_acceso });

export function hayUsuarios(db) {
  return db.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0;
}
export function crear(db, { usuario, nombre, correo, rol = 'usuario', vence, contrasena, debeCambiar = false }) {
  usuario = String(usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) throw new Error('El usuario debe tener de 3 a 40 letras, números, punto, guion o guion bajo (sin espacios ni acentos).');
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(correo).trim())) throw new Error('El correo no parece válido.');
  if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) throw new Error('La fecha de vencimiento no es válida.');
  const err = validarContrasena(contrasena);
  if (err) throw new Error(err);
  if (db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(usuario)) throw new Error('Ese usuario ya existe.');
  const r = db.prepare(`INSERT INTO usuarios (usuario, nombre, correo, hash, rol, vence, debe_cambiar, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(usuario, String(nombre || '').trim() || null, String(correo || '').trim() || null, hashContrasena(contrasena),
      rol === 'admin' ? 'admin' : 'usuario', vence || null, debeCambiar ? 1 : 0, ahora());
  return publico(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(r.lastInsertRowid));
}
export function listar(db) {
  return db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM uso WHERE usuario_id = u.id AND fecha >= ?) AS uso_30d
    FROM usuarios u ORDER BY u.rol, u.usuario`).all(new Date(Date.now() - 30 * 864e5).toISOString())
    .map((u) => ({ ...publico(u), uso_30d: u.uso_30d }));
}
export function actualizar(db, id, cambios, quien) {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!u) throw new Error('No existe ese usuario.');
  const activo = cambios.activo === undefined ? u.activo : (cambios.activo ? 1 : 0);
  const rol = cambios.rol === undefined ? u.rol : (cambios.rol === 'admin' ? 'admin' : 'usuario');
  // que no se quede el sistema sin ningún administrador activo
  if ((u.rol === 'admin' && (rol !== 'admin' || !activo))
    && db.prepare("SELECT COUNT(*) n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id != ?").get(id).n === 0) {
    throw new Error('Debe quedar al menos un administrador activo.');
  }
  if (quien && quien.id === id && !activo) throw new Error('No puedes desactivar tu propia cuenta.');
  const vence = cambios.vence === undefined ? u.vence : (cambios.vence || null);
  if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) throw new Error('La fecha de vencimiento no es válida.');
  const nombre = cambios.nombre === undefined ? u.nombre : String(cambios.nombre).trim() || null;
  const correo = cambios.correo === undefined ? u.correo : String(cambios.correo).trim() || null;
  db.prepare('UPDATE usuarios SET activo = ?, rol = ?, vence = ?, nombre = ?, correo = ? WHERE id = ?').run(activo, rol, vence, nombre, correo, id);
  if (!activo) db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id); // cierra sus sesiones
  return publico(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id));
}
// El administrador genera una contraseña temporal; el usuario debe cambiarla al entrar.
export function restablecer(db, id) {
  const temporal = contrasenaTemporal();
  const r = db.prepare('UPDATE usuarios SET hash = ?, debe_cambiar = 1 WHERE id = ?').run(hashContrasena(temporal), id);
  if (!r.changes) throw new Error('No existe ese usuario.');
  db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id);
  return temporal;
}
export function cambiarContrasena(db, id, actual, nueva) {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!u || !verificarContrasena(actual, u.hash)) throw new Error('La contraseña actual no es correcta.');
  const err = validarContrasena(nueva);
  if (err) throw new Error(err);
  if (actual === nueva) throw new Error('La nueva contraseña debe ser distinta.');
  db.prepare('UPDATE usuarios SET hash = ?, debe_cambiar = 0 WHERE id = ?').run(hashContrasena(nueva), id);
}

// ---------- sesiones ----------
export function entrar(db, usuario, contrasena) {
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(String(usuario || '').trim().toLowerCase());
  // se verifica igual aunque el usuario no exista, para no revelar cuáles existen por el tiempo de respuesta
  const ok = verificarContrasena(contrasena, u ? u.hash : 'scrypt$00$00');
  if (!u || !ok) throw new Error('Usuario o contraseña incorrectos.');
  if (!u.activo) throw new Error('Esta cuenta está suspendida. Contacta al administrador.');
  if (u.vence && u.vence < hoyMx()) throw new Error('El acceso de esta cuenta venció el ' + u.vence.split('-').reverse().join('/') + '. Contacta al administrador.');
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DIAS_SESION * 864e5).toISOString();
  db.prepare('INSERT INTO sesiones (token_hash, usuario_id, creada, expira) VALUES (?, ?, ?, ?)').run(sha256(token), u.id, ahora(), expira);
  db.prepare('UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?').run(ahora(), u.id);
  db.prepare('DELETE FROM sesiones WHERE expira < ?').run(ahora());
  return { token, usuario: publico(u), dias: DIAS_SESION };
}
export function sesion(db, token) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const s = db.prepare(`SELECT u.*, s.expira FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!s || s.expira < ahora() || !s.activo || (s.vence && s.vence < hoyMx())) return null;
  return publico(s);
}
export function salir(db, token) {
  if (token) db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(sha256(token));
}
export function registrarUso(db, usuarioId, tipo, detalle) {
  try { db.prepare('INSERT INTO uso (usuario_id, tipo, detalle, fecha) VALUES (?, ?, ?, ?)').run(usuarioId ?? null, tipo, String(detalle || '').slice(0, 200), ahora()); } catch {}
}
