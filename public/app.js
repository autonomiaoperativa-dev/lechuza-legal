const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let JUZGADOS = [];
let ULTIMA = { hallazgos: [], listas: [], criterios: null };
let controlador = null;
let MAX_LISTAS = 1500, DESCARGAS = 4, ARCHIVO = null;

// ---------- pestañas ----------
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('activo', x === b));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('activo', p.id === b.dataset.tab));
  if (b.dataset.tab === 'fuentes') cargarFuentes();
}));

// ---------- fechas ----------
const iso = (d) => d.toISOString().slice(0, 10);
let HOY = iso(new Date());
function habilesAtras(n) {
  const out = []; let t = new Date(HOY + 'T12:00:00Z');
  while (out.length < n) { const w = t.getUTCDay(); if (w && w !== 6) out.push(iso(t)); t = new Date(t - 864e5); }
  return out;
}
function ponerUltimos(n) {
  const h = habilesAtras(n);
  $('#desde').value = h[h.length - 1]; $('#hasta').value = h[0]; calcular();
}
document.querySelectorAll('.chip[data-dias]').forEach((b) => b.addEventListener('click', () => ponerUltimos(+b.dataset.dias)));

// ---------- juzgados ----------
async function cargarJuzgados() {
  const est = await fetch('/api/estado').then((r) => r.json()).catch(() => null);
  if (est) { HOY = est.hoy; MAX_LISTAS = est.max_listas || MAX_LISTAS; DESCARGAS = est.descargas_a_la_vez || DESCARGAS; ARCHIVO = est.archivo; }
  pintarArchivo();
  $('#desde').max = $('#hasta').max = HOY;
  $('#desde').min = $('#hasta').min = '2010-11-03';
  ponerUltimos(5);
  JUZGADOS = await fetch('/api/juzgados').then((r) => r.json());
  const grupos = {};
  for (const j of JUZGADOS) (grupos[j.materia] ||= []).push(j);
  $('#juzgados').innerHTML = Object.entries(grupos).map(([m, js]) => `
    <details class="grupo" ${m === 'Juzgados Civiles' ? 'open' : ''}>
      <summary>${esc(m)} <span class="ayuda">(${js.length})</span><a href="#" class="todos" data-m="${esc(m)}">todos</a></summary>
      ${js.map((j) => `<label class="juz" data-txt="${esc((j.juzgado + ' ' + j.codigo + ' ' + m).toLowerCase())}"><input type="checkbox" value="${esc(j.codigo)}"> ${esc(j.juzgado)} <code>${esc(j.codigo)}</code></label>`).join('')}
    </details>`).join('');
  $('#juzgados').querySelector('input[value="1C"]').checked = true;
  $('#btnTodos').addEventListener('click', () => {
    const cajas = [...document.querySelectorAll('#juzgados input')];
    const marcar = cajas.some((c) => !c.checked);
    cajas.forEach((c) => (c.checked = marcar));
    $('#btnTodos').textContent = marcar ? 'Quitar todos' : 'Todos los juzgados';
    calcular();
  });
  $('#juzgados').addEventListener('change', calcular);
  $('#juzgados').addEventListener('click', (e) => {
    const a = e.target.closest('.todos'); if (!a) return;
    e.preventDefault();
    const cajas = [...a.closest('details').querySelectorAll('input')];
    const marcar = cajas.some((c) => !c.checked);
    cajas.forEach((c) => (c.checked = marcar)); calcular();
  });
  calcular();
}
$('#filtroJ').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll('.juz').forEach((l) => (l.style.display = !q || l.dataset.txt.includes(q) ? '' : 'none'));
  if (q) document.querySelectorAll('.grupo').forEach((g) => (g.open = true));
});
const fmtF = (f) => f ? f.split('-').reverse().join('/') : '';
function pintarArchivo() {
  const a = ARCHIVO, el = $('#archivo');
  if (!a || !a.listas) { el.hidden = true; return; }
  el.hidden = false;
  const d = a.descargador;
  el.innerHTML = `<strong>Archivo en esta computadora:</strong> ${a.listas.toLocaleString('es-MX')} listas (${a.acuerdos.toLocaleString('es-MX')} acuerdos) del ${fmtF(a.desde)} al ${fmtF(a.hasta)}. Lo que esté ahí sale al instante.`
    + (d ? `<br><span class="ayuda">Descargando más: va en el ${fmtF(d.fecha_en_curso)} · ${d.hechas.toLocaleString('es-MX')} de ${d.pendientes_al_inicio.toLocaleString('es-MX')} · faltan unas ${d.eta_horas ?? '?'} h.</span>` : '');
}
setInterval(async () => {
  const est = await fetch('/api/estado').then((r) => r.json()).catch(() => null);
  if (est) { ARCHIVO = est.archivo; pintarArchivo(); }
}, 60000);
const seleccion = () => [...document.querySelectorAll('#juzgados input:checked')].map((c) => c.value);
function diasHabiles(a, b) {
  let n = 0, t = new Date(a + 'T12:00:00Z'); const f = new Date((b > HOY ? HOY : b) + 'T12:00:00Z');
  while (t <= f && n < 7000) { const w = t.getUTCDay(); if (w && w !== 6) n++; t = new Date(+t + 864e5); }
  return n;
}
function calcular() {
  const s = seleccion().length;
  $('#contSel').textContent = s ? `${s} seleccionado${s > 1 ? 's' : ''}` : '';
  const d = $('#desde').value && $('#hasta').value ? diasHabiles($('#desde').value, $('#hasta').value) : 0;
  const total = s * d;
  // estimado: ~1.5 s por lista nueva entre las descargas simultáneas; las ya guardadas son instantáneas
  const seg = Math.round(total * 1.5 / DESCARGAS);
  const tiempo = seg < 60 ? 'menos de 1 minuto' : `unos ${Math.ceil(seg / 60)} minutos`;
  const nota = ARCHIVO && ARCHIVO.listas ? ' Las que ya estén en el archivo local no cuentan y salen al instante.' : '';
  $('#calculo').textContent = !total ? '' : (total > MAX_LISTAS && !nota)
    ? `Son ${total.toLocaleString('es-MX')} listas (${s} juzgado${s > 1 ? 's' : ''} × ${d} días hábiles). El máximo por búsqueda es ${MAX_LISTAS.toLocaleString('es-MX')}: reduce juzgados o fechas.`
    : nota ? `Se revisarán ${total.toLocaleString('es-MX')} listas (${s} juzgado${s > 1 ? 's' : ''} × ${d} día${d > 1 ? 's' : ''} hábil${d > 1 ? 'es' : ''}).${nota} Lo que falte se descarga (máximo ${MAX_LISTAS.toLocaleString('es-MX')}).`
    : `Se revisarán ${total.toLocaleString('es-MX')} listas (${s} juzgado${s > 1 ? 's' : ''} × ${d} día${d > 1 ? 's' : ''} hábil${d > 1 ? 'es' : ''}). Tiempo estimado: ${tiempo} (menos si ya se buscaron antes).`;
}
['#desde', '#hasta'].forEach((s) => $(s).addEventListener('change', calcular));

// ---------- búsqueda ----------
const nombreJ = (c) => (JUZGADOS.find((j) => j.codigo === c) || {}).juzgado || c;
$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#error').textContent = '';
  const cuerpo = {
    expedientes: $('#expedientes').value, nombres: $('#nombres').value, enTexto: $('#enTexto').checked,
    desde: $('#desde').value, hasta: $('#hasta').value, juzgados: seleccion(),
    incognito: $('#incognito').checked,
  };
  $('#marcaIncog').hidden = !cuerpo.incognito;
  ULTIMA = { hallazgos: [], listas: [], criterios: cuerpo, indice: null };
  controlador = new AbortController();
  $('#btnBuscar').disabled = true;
  $('#vacio').hidden = true; $('#progresoCaja').hidden = false; $('#kpis').hidden = false; $('#resCaja').hidden = false;
  pintar(0);
  try {
    const r = await fetch('/api/buscar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: controlador.signal });
    if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Error'); }
    const lector = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; let total = 1;
    for (;;) {
      const { value, done } = await lector.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const linea = buf.slice(0, i); buf = buf.slice(i + 1); if (!linea) continue;
        const m = JSON.parse(linea);
        if (m.tipo === 'inicio') total = m.total;
        if (m.tipo === 'indice') { ULTIMA.indice = m; ULTIMA.hallazgos.push(...m.hallazgos); pintar(total); }
        if (m.tipo === 'lista') { ULTIMA.listas.push(m); ULTIMA.hallazgos.push(...m.hallazgos); pintarPronto(total); }
      }
    }
    pintar(total);
    const ix = ULTIMA.indice;
    $('#progresoTxt').textContent = `Listo: ${(ULTIMA.listas.length + (ix ? ix.listas : 0)).toLocaleString('es-MX')} listas revisadas` + (ix ? ` (${ix.listas.toLocaleString('es-MX')} en el archivo local, en ${(ix.ms / 1000).toFixed(1)} s)` : '') + (ix && ix.recortado ? '. Hay demasiadas coincidencias: se muestran las primeras 3,000.' : '.');
  } catch (err) {
    if (err.name === 'AbortError') $('#progresoTxt').textContent = 'Búsqueda cancelada.';
    else { $('#error').textContent = err.message; $('#progresoCaja').hidden = true; if (!ULTIMA.listas.length) { $('#kpis').hidden = true; $('#resCaja').hidden = true; $('#vacio').hidden = false; } }
  } finally { $('#btnBuscar').disabled = false; controlador = null; }
});
$('#btnCancelar').addEventListener('click', () => controlador && controlador.abort());

// ---------- incógnito ----------
$('#incognito').addEventListener('change', (e) => document.body.classList.toggle('incognito', e.target.checked));
function borrarResultados() {
  if (controlador) controlador.abort();
  ULTIMA = { hallazgos: [], listas: [], criterios: null, indice: null };
  $('#resultados').innerHTML = ''; $('#consultadas').innerHTML = ''; $('#comparacion').innerHTML = '';
  $('#fichas').innerHTML = ''; $('#fichasCaja').hidden = true; GRUPOS = [];
  $('#progresoCaja').hidden = true; $('#kpis').hidden = true; $('#resCaja').hidden = true; $('#vacio').hidden = false;
  if ($('#incognito').checked) { $('#expedientes').value = ''; $('#nombres').value = ''; $('#buho').value = ''; }
}
$('#btnBorrar').addEventListener('click', borrarResultados);

function resaltar(texto, motivos) {
  let h = esc(texto);
  for (const m of motivos) {
    const v = m.replace(/^(expediente|nombre:)\s*/, '').replace(/\s*\(en texto\)$/, '');
    if (!v) continue;
    const patron = v.includes('/') ? v.replace(/^(\d+)\/(\d{4})$/, '0*$1\\s*/\\s*$2')
      : v.split(' ').map((w) => w.replace(/[aeiou]/g, (c) => `[${c}${{ a: 'á', e: 'é', i: 'í', o: 'ó', u: 'úü' }[c]}]`)).join('[\\s,.]+');
    try { h = h.replace(new RegExp(`(${patron})`, 'gi'), '<mark>$1</mark>'); } catch {}
  }
  return h;
}
let temporizador = null;
function pintarPronto(total) {
  // en búsquedas de cientos de listas se redibuja como máximo 3 veces por segundo
  if (temporizador) return;
  temporizador = setTimeout(() => { temporizador = null; pintar(total); }, 300);
}
const ordenar = (a, b) => (b.fecha || '').localeCompare(a.fecha || '') || nombreJ(a.codigo).localeCompare(nombreJ(b.codigo));
function pintar(total) {
  const L = [...ULTIMA.listas].sort(ordenar), H = [...ULTIMA.hallazgos].sort(ordenar);
  const IX = ULTIMA.indice || { listas: 0, sin_lista: 0 };
  $('#kListas').textContent = (L.length + IX.listas).toLocaleString('es-MX');
  $('#kSin').textContent = (L.filter((l) => l.estado === 'sin_lista').length + IX.sin_lista).toLocaleString('es-MX');
  $('#kErr').textContent = L.filter((l) => l.estado === 'error').length;
  $('#kHall').textContent = H.length;
  if (total) { $('#barra').style.width = Math.round(100 * L.length / total) + '%'; $('#progresoTxt').textContent = `Descargando ${L.length} de ${total} listas que faltan…`; }
  else if (ULTIMA.indice) $('#barra').style.width = '100%';
  pintarFichas(H);
  $('#resultados').innerHTML = H.length ? H.map((h) => `
    <div class="hall">
      <div class="cab"><span class="exp">${esc(h.expediente || 's/n')}</span>
        <span>${esc(nombreJ(h.codigo))}</span><span class="etq">${esc(h.fecha)}</span>
        ${window.Resumen.limpiarTipo(h.tipo_juicio) ? `<span class="etq">${esc(window.Resumen.limpiarTipo(h.tipo_juicio))}</span>` : ''}
        ${h.clase && h.clase !== 'EXPEDIENTE' ? `<span class="etq">${esc(h.clase)}</span>` : ''}
        ${h.motivos.map((m) => `<span class="etq motivo">${esc(m)}</span>`).join('')}
        <a href="${esc(h.url)}" target="_blank" rel="noopener">PDF oficial</a></div>
      <div class="partes">${resaltar(h.partes, h.motivos)}</div>
      <details><summary>Ver texto del acuerdo</summary><p class="txt">${resaltar(h.texto, h.motivos)}</p></details>
    </div>`).join('') : `<p class="nota">${L.length ? 'Sin coincidencias en las listas revisadas hasta ahora.' : ''}</p>`;
  const resumenIx = ULTIMA.indice ? `<p class="nota">Archivo local: ${ULTIMA.indice.listas.toLocaleString('es-MX')} listas revisadas al instante (${ULTIMA.indice.ok.toLocaleString('es-MX')} con acuerdos, ${ULTIMA.indice.sin_lista.toLocaleString('es-MX')} sin lista). Abajo, las que se descargaron ahora.</p>` : '';
  $('#consultadas').innerHTML = resumenIx + `<table><thead><tr><th>Fecha</th><th>Juzgado</th><th>Estado</th><th>Páginas</th><th>Acuerdos</th><th></th></tr></thead><tbody>${
    L.map((l) => `<tr><td>${esc(l.fecha)}</td><td>${esc(nombreJ(l.codigo))} <code>${esc(l.codigo)}</code></td>
      <td class="${l.estado === 'ok' ? 'e-ok' : l.estado === 'sin_lista' ? 'e-sin' : 'e-err'}">${l.estado === 'ok' ? 'leída' : l.estado === 'sin_lista' ? 'sin lista' : 'error: ' + esc(l.detalle)}${l.cache ? ' · guardada' : ''}</td>
      <td>${l.paginas ?? ''}</td><td>${l.estado === 'ok' ? l.acuerdos : ''}</td><td><a href="${esc(l.url)}" target="_blank" rel="noopener">PDF</a></td></tr>`).join('')}</tbody></table>`;
}

$('#btnCsv').addEventListener('click', () => {
  const filas = [['fecha', 'codigo_juzgado', 'juzgado', 'expediente', 'tipo_juicio', 'clase', 'partes', 'motivos', 'pdf']];
  for (const h of ULTIMA.hallazgos) filas.push([h.fecha, h.codigo, nombreJ(h.codigo), h.expediente, h.tipo_juicio, h.clase, h.partes, h.motivos.join(' | '), h.url]);
  const csv = '﻿' + filas.map((f) => f.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `busqueda_slp_${HOY}.csv`; a.click(); URL.revokeObjectURL(a.href);
});

// ---------- comparar ----------
const normExp = (s) => { const m = String(s).match(/(\d+)\s*\/\s*(\d{4})/); return m ? `${+m[1]}/${m[2]}` : null; };
function normFecha(s) {
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
$('#btnComparar').addEventListener('click', () => {
  const lineas = $('#buho').value.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const buho = lineas.map((l) => ({ exp: normExp(l.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, '')), fecha: normFecha(l), linea: l })).filter((b) => b.exp);
  const conFecha = buho.some((b) => b.fecha);
  const clave = (exp, fecha) => (conFecha ? `${exp}@${fecha}` : exp);
  const nuestros = new Map();
  for (const h of ULTIMA.hallazgos) if (h.expediente) nuestros.set(clave(h.expediente, h.fecha), h);
  const deBuho = new Map(buho.map((b) => [clave(b.exp, b.fecha), b]));
  const ambos = [...deBuho.keys()].filter((k) => nuestros.has(k));
  const soloBuho = [...deBuho.keys()].filter((k) => !nuestros.has(k));
  const soloNos = [...nuestros.keys()].filter((k) => !deBuho.has(k));
  const pct = deBuho.size ? Math.round(100 * ambos.length / deBuho.size) : 0;
  const li = (k) => `<li>${esc(k.replace('@', ' · '))}${nuestros.get(k) ? ` <span class="ayuda">${esc(nombreJ(nuestros.get(k).codigo))}</span>` : ''}</li>`;
  $('#comparacion').innerHTML = !ULTIMA.listas.length ? '<p class="error">Primero haz una búsqueda en la pestaña Buscar.</p>' : `
    <p><strong>Coincidencia: ${pct}%</strong> de lo que reporta Buholegal también lo encontró este programa (${ambos.length} de ${deBuho.size}). Comparación por ${conFecha ? 'expediente y fecha' : 'expediente'}.</p>
    <div class="cols3">
      <div class="col"><h3 class="e-ok">En ambos (${ambos.length})</h3><ul>${ambos.map(li).join('')}</ul></div>
      <div class="col"><h3 class="e-err">Solo Buholegal (${soloBuho.length})</h3><ul>${soloBuho.map(li).join('')}</ul>
        <p class="ayuda">Revisa si el juzgado y la fecha estaban en tu búsqueda; si sí, puede ser una falla del lector.</p></div>
      <div class="col"><h3 class="e-sin">Solo este programa (${soloNos.length})</h3><ul>${soloNos.map(li).join('')}</ul></div>
    </div>`;
});

// ---------- fuentes ----------
let FUENTES = null;
async function cargarFuentes() {
  if (!FUENTES) FUENTES = await fetch('/api/fuentes').then((r) => r.json()).catch(() => []);
  const q = ($('#filtroF').value || '').toLowerCase();
  const filas = FUENTES.filter((f) => !q || JSON.stringify(f).toLowerCase().includes(q));
  $('#tablaFuentes').innerHTML = !FUENTES.length ? '<p class="nota">La investigación de fuentes todavía no está lista.</p>' :
    `<table><thead><tr><th>Grupo</th><th>Estado</th><th>Institución</th><th>¿Abre?</th><th>Login</th><th>Datos que solicita</th><th>Página de búsqueda</th><th>Formato</th><th>Notas</th></tr></thead><tbody>${
      filas.map((f) => `<tr><td>${esc(f.grupo)}</td><td>${esc(f.estado)}</td><td><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.institucion || f.url)}</a></td>
        <td class="${f.cargo_ok ? 'e-ok' : 'e-err'}">${f.cargo_ok ? 'sí' : 'no'} <span class="ayuda">${esc(f.status_code ?? '')}</span></td>
        <td>${f.requiere_login === true ? 'sí' : f.requiere_login === false ? 'no' : '¿?'}</td>
        <td>${esc((f.datos_que_solicita || []).join('; '))}</td>
        <td>${f.pagina_busqueda_url ? `<a href="${esc(f.pagina_busqueda_url)}" target="_blank" rel="noopener">abrir</a>` : ''}</td>
        <td>${esc(f.formato_resultado)}</td><td>${esc(f.notas)}</td></tr>`).join('')}</tbody></table>`;
}
$('#filtroF').addEventListener('input', cargarFuentes);

cargarJuzgados();

// ---------- resumen por expediente y PDF ----------
let GRUPOS = [];
function pintarFichas(H) {
  GRUPOS = window.Resumen.agrupar(H, nombreJ);
  $('#fichasCaja').hidden = !GRUPOS.length;
  $('#contFichas').textContent = GRUPOS.length ? `(${GRUPOS.length})` : '';
  $('#fichas').innerHTML = GRUPOS.map((g, i) => {
    const filas = [...g.acuerdos].reverse(); // en pantalla, lo más reciente arriba
    const fila = (a) => `<li>
        <div class="tl-cab"><strong>${esc(fmtF(a.fecha))}</strong>${a.etiquetas.map((e) => `<span class="etq">${esc(e)}</span>`).join('')}</div>
        <div>${esc(a.resumen)}</div>
        ${a.plazos.length || a.montos.length ? `<div class="tl-extra">${a.plazos.length ? 'Plazos: ' + esc(a.plazos.join(', ')) : ''}${a.plazos.length && a.montos.length ? ' · ' : ''}${a.montos.length ? 'Montos: ' + esc(a.montos.join(', ')) : ''}</div>` : ''}
        <a href="${esc(a.url)}" target="_blank" rel="noopener" class="ayuda">lista oficial</a></li>`;
    return `<div class="ficha">
      <div class="fila-tit"><div><span class="exp">${esc(g.expediente)}</span> <span>${esc(g.juzgado)}</span></div>
        <button class="secundario btnPdf" type="button" data-i="${i}">Descargar PDF</button></div>
      <div class="ficha-datos">${g.tipo_juicio ? `<span class="etq">${esc(g.tipo_juicio)}</span> ` : ''}<span class="etq">${g.total} acuerdo${g.total > 1 ? 's' : ''} · ${esc(fmtF(g.primera))} a ${esc(fmtF(g.ultima))}</span></div>
      <div class="partes">${esc(g.partes)}</div>
      <ol class="linea-tiempo">${filas.slice(0, 5).map(fila).join('')}</ol>
      ${filas.length > 5 ? `<details><summary>Ver los otros ${filas.length - 5} acuerdos</summary><ol class="linea-tiempo">${filas.slice(5).map(fila).join('')}</ol></details>` : ''}
    </div>`;
  }).join('');
}
async function descargarPdf(grupos, boton) {
  const original = boton.textContent;
  boton.disabled = true; boton.textContent = 'Generando PDF…';
  try {
    const c = ULTIMA.criterios || {};
    const lineas = (t) => t.split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean).join(', ');
    const criterios = [c.expedientes && 'expedientes: ' + lineas(c.expedientes),
      c.nombres && 'nombres: ' + lineas(c.nombres),
      c.desde && `del ${fmtF(c.desde)} al ${fmtF(c.hasta)}`].filter(Boolean).join(' · ');
    const r = await fetch('/api/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grupos, incluirTexto: $('#pdfTexto').checked, criterios }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo generar el PDF');
    const blob = await r.blob();
    const nombre = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'resumen.pdf';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { alertaSuave(e.message); }
  finally { boton.disabled = false; boton.textContent = original; }
}
function alertaSuave(m) { $('#error').textContent = m; }
$('#fichas').addEventListener('click', (e) => {
  const b = e.target.closest('.btnPdf'); if (!b) return;
  descargarPdf([GRUPOS[+b.dataset.i]], b);
});
$('#btnPdfTodos').addEventListener('click', (e) => descargarPdf(GRUPOS, e.currentTarget));
