// Lechuza Legal: búsqueda de antecedentes legales de una persona física o moral.
// Busca el nombre en el archivo local (todas las listas de acuerdos de SLP del periodo elegido) y arma un
// reporte con rol (actor/demandado), materias, juzgados, expedientes y fuentes. Usa globales de app.js.
(function () {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const plural = (n, s, p) => `${n.toLocaleString('es-MX')} ${n === 1 ? s : (p || s + 's')}`;
  const fmtFH = (iso) => { const d = new Date(iso); return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) + ' a las ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); };
  const leerLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const guardarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const LS = 'lechuza_hist_antecedentes';
  let REPORTE = null;

  // ---------- formulario ----------
  const tipoPersona = () => document.querySelector('input[name="antTipo"]:checked').value;
  function ajustar() {
    const moral = tipoPersona() === 'moral';
    document.querySelectorAll('.ant-fisica').forEach((e) => (e.hidden = moral));
    document.querySelectorAll('.ant-moral').forEach((e) => (e.hidden = !moral));
    $('#antNombres').required = !moral; $('#antPaterno').required = !moral; $('#antRazon').required = moral;
  }
  document.querySelectorAll('input[name="antTipo"]').forEach((r) => r.addEventListener('change', ajustar));

  // ---------- materia y rol ----------
  function materiaDe(codigo) {
    const j = JUZGADOS.find((x) => x.codigo === codigo) || {};
    const m = j.materia || '', n = j.juzgado || '';
    if (/Civil|Menores/.test(m) && !/Penal/.test(n)) return 'Civil';
    if (/Mercantil|Oralidad/.test(m)) return 'Mercantil';
    if (/Familiar|Especializados/.test(m)) return 'Familiar';
    if (/Penal|Ejecuci|Justicia Penal/.test(m) || /Penal/.test(n)) return 'Penal';
    if (/Laboral/.test(m)) return 'Laboral';
    if (/Salas/.test(m)) return 'Segunda instancia';
    if (/Interior/.test(m)) return /Penal/.test(n) ? 'Penal' : 'Civil / Familiar (interior)';
    return 'Otros';
  }
  function rolDe(g, palabras) {
    // el nombre completo con las palabras juntas, en orden normal o con los apellidos primero
    const tiene = (t) => { const x = ' ' + norm(t) + ' '; return palabras.some((_, i) => x.includes(' ' + [...palabras.slice(i), ...palabras.slice(0, i)].join(' ') + ' ')); };
    if (g.actor && tiene(g.actor)) return 'Actor';
    if (g.demandado && tiene(g.demandado)) return 'Demandado';
    if (tiene(g.partes)) return 'Parte';
    return 'Mencionado en el texto';
  }

  // ---------- búsqueda ----------
  $('#formAnt').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cuerpo = {
      tipo_persona: tipoPersona(), nombres: $('#antNombres').value, ap_paterno: $('#antPaterno').value, ap_materno: $('#antMaterno').value,
      razon_social: $('#antRazon').value, periodo: Number($('#antPeriodo').value), en_texto: $('#antEnTexto').checked,
      rfc: $('#antRfc').value.trim(),
    };
    await buscar(cuerpo, { curp: $('#antCurp').value.trim(), rfc: $('#antRfc').value.trim(), detalle: $('#antDetalle').checked, guardar: true });
  });

  async function buscar(cuerpo, extra) {
    const btn = $('#btnAnt'); btn.disabled = true; btn.textContent = 'Buscando…';
    $('#antError').textContent = '';
    try {
      const r = await fetch('/api/antecedentes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'No se pudo buscar.');
      if (!j.disponible) { $('#antError').textContent = j.mensaje; return; }
      const grupos = window.Resumen.agrupar(j.hallazgos, nombreJ).map((g) => ({ ...g, materia: materiaDe(g.codigo), rol: rolDe(g, j.palabras) }));
      const sinFormato = j.hallazgos.filter((h) => !h.expediente).length;
      REPORTE = { ...j, cuerpo, extra, grupos, sinFormato, cuando: new Date().toISOString() };
      pintarReporte();
      if (extra.guardar) {
        const h = leerLS(LS, []);
        h.unshift({ id: Date.now(), cuando: REPORTE.cuando, criterio: j.criterio, cuerpo, extra: { ...extra, guardar: false }, resultados: grupos.length, anios: j.anios });
        guardarLS(LS, h.slice(0, 1000));
      }
      pintarHistorial();
      $('#reporteAnt').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { $('#antError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = 'Realizar búsqueda'; }
  }

  // ---------- SAT (69-B y 69) ----------
  const SITUACION_69B = {
    'definitivo': 'no desvirtuó la presunción: el SAT lo publica en definitiva',
    'presunto': 'el SAT presume operaciones inexistentes; aún puede desvirtuarlo',
    'desvirtuado': 'desvirtuó la presunción ante el SAT',
    'sentencia favorable': 'obtuvo sentencia favorable',
  };
  function textosSat(R) {
    const S = R.sat || {};
    const fecha69b = ((S.listados || []).find((l) => l.id === '69B') || {}).actualizado_al;
    const descargado = (S.listados || []).map((l) => l.descargado).filter(Boolean).sort().pop();
    return {
      S, fecha69b, descargado,
      efosTxt: !S.disponible ? 'Los listados del SAT aún no se han descargado en esta computadora.'
        : S.efos.length ? `Se encontraron ${S.efos.length} coincidencia(s) en el listado de contribuyentes con operaciones presuntamente inexistentes (artículo 69-B CFF).`
        : `No se encontraron coincidencias en el listado de contribuyentes con operaciones presuntamente inexistentes (artículo 69-B CFF${fecha69b ? ', actualizado al ' + fecha69b : ''}).`,
      cancTxt: !S.disponible ? '' : (S.cancelados.length + S.condonados.length)
        ? `Se encontraron ${S.cancelados.length} registro(s) de créditos cancelados y ${S.condonados.length} de créditos condonados (artículo 69 CFF).`
        : 'No se encontraron coincidencias en los listados de contribuyentes con créditos cancelados y condonados (artículo 69 CFF).',
      nota: R.extra.rfc ? 'Se buscó por nombre completo y por RFC.' : 'Se buscó por nombre completo; sin RFC, una coincidencia puede ser un homónimo.',
    };
  }
  function htmlSat(R, tabla) {
    const t = textosSat(R), S = t.S;
    const efosFilas = (S.efos || []).map((r) => [esc(r.rfc), esc(r.nombre), `<strong>${esc(r.situacion || '')}</strong><br><span class="ayuda">${esc(SITUACION_69B[norm(r.situacion)] || '')}</span>`, esc(r.fecha || ''), esc(r.por)]);
    const otrosFilas = [...(S.cancelados || []), ...(S.condonados || [])].map((r) => [esc(r.rfc), esc(r.nombre), esc(r.listado_nombre), esc((r.situacion || '').slice(0, 90)), esc(r.fecha || ''), esc(r.monto ? '$' + r.monto : ''), esc(r.entidad || ''), esc(r.por)]);
    return `<h3>Situación ante el SAT</h3>
      <h4>Operaciones presuntamente inexistentes (EFOS, art. 69-B)</h4><p>${esc(t.efosTxt)}</p>
      ${efosFilas.length ? tabla(['RFC', 'Nombre', 'Situación', 'Oficio / fecha', 'Por'], efosFilas) : ''}
      ${S.disponible ? `<h4>Contribuyentes con créditos cancelados y condonados (art. 69)</h4><p>${esc(t.cancTxt)}</p>
      ${otrosFilas.length ? tabla(['RFC', 'Nombre', 'Listado', 'Supuesto', 'Fecha', 'Monto', 'Entidad', 'Por'], otrosFilas) : ''}` : ''}
      <p class="nota">${esc(t.nota)} Fuente: Datos Abiertos del SAT${t.descargado ? ', descargados el ' + esc(new Date(t.descargado).toLocaleDateString('es-MX')) : ''}.</p>`;
  }

  // ---------- reporte ----------
  function contar(lista, f) { const m = new Map(); for (const x of lista) { const k = f(x); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); }
  function datosReporte() {
    const R = REPORTE, G = R.grupos;
    const roles = contar(G, (g) => g.rol);
    const n = (rol) => (roles.find(([k]) => k === rol) || [, 0])[1];
    const fechas = G.flatMap((g) => [g.primera, g.ultima]).sort();
    return {
      G, roles, materias: contar(G, (g) => g.materia), juzgados: contar(G, (g) => g.juzgado),
      demandado: n('Demandado'), actor: n('Actor'), otro: n('Parte') + n('Mencionado en el texto'),
      primera: fechas[0], ultima: fechas[fechas.length - 1], periodo: `Últimos ${R.anios} año${R.anios > 1 ? 's' : ''}`,
    };
  }
  function pintarReporte() {
    const R = REPORTE, d = datosReporte();
    const tabla = (cols, filas) => `<table class="tabla-mini"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const otras = [
      ['Cédulas profesionales', 'Registro Nacional de Profesionistas (SEP)'],
      ['Edictos', 'Periódico Oficial del Estado de San Luis Potosí'],
      ['Verificación del CURP', 'Registro Nacional de Población'],
    ];
    const ref = [R.extra.curp && 'CURP ' + R.extra.curp, R.extra.rfc && 'RFC ' + R.extra.rfc].filter(Boolean).join(' · ');
    const exp = (g) => `<div class="ficha">
      <div class="fila-tit"><div><span class="exp">${esc(g.expediente)}</span> <span>${esc(g.juzgado)}</span></div>
        <span class="botones"><span class="etq rol rol-${norm(g.rol).replace(/ /g, '-')}">${esc(g.rol)}</span><span class="etq">${esc(g.materia)}</span></span></div>
      <div class="ficha-datos">${g.tipo_juicio ? `<span class="etq">${esc(g.tipo_juicio)}</span>` : ''}<span class="etq">${plural(g.total, 'acuerdo')} · ${esc(fmtF(g.primera))} a ${esc(fmtF(g.ultima))}</span></div>
      ${g.actor || g.demandado ? `<div class="partes-tabla"><div><span class="ayuda">Actor</span> ${esc(g.actor || '—')}</div><div><span class="ayuda">Demandado</span> ${esc(g.demandado || '—')}</div></div>` : `<div class="partes">${esc(g.partes)}</div>`}
      <details><summary>Ver acuerdos</summary><ol class="linea-tiempo">${[...g.acuerdos].reverse().map((a) => `<li><div class="tl-cab"><strong>${esc(fmtF(a.fecha))}</strong>${a.etiquetas.map((t) => `<span class="etq">${esc(t)}</span>`).join('')}</div><div>${esc(a.resumen)}</div><a class="ayuda" href="${esc(a.url)}" target="_blank" rel="noopener">lista oficial</a></li>`).join('')}</ol></details>
    </div>`;
    $('#reporteAnt').hidden = false;
    $('#reporteAnt').innerHTML = `
      <div class="fila-tit"><h2>Reporte de antecedentes legales</h2>
        <span class="botones"><button type="button" class="secundario" id="antNueva">Nueva búsqueda</button>
        <button type="button" class="secundario" id="antCsv">CSV</button>
        <button type="button" class="primario-chico" id="antPdf">Descargar PDF</button></span></div>
      <p class="nota">Resultado de buscar el nombre en todas las listas de acuerdos del Poder Judicial del Estado de San Luis Potosí (fuero común) guardadas en el archivo local. Información de apoyo, no asesoría legal.</p>
      <h3>Resumen de la consulta</h3>
      ${tabla(['Fecha y hora', 'Criterio', 'Periodo', 'Entidad', 'Resultados'], [[esc(fmtFH(R.cuando)), `<strong>${esc(R.criterio)}</strong>${ref ? `<br><span class="ayuda">${esc(ref)} (referencia)</span>` : ''}`, esc(d.periodo), 'San Luis Potosí (fuero común)', `<strong>${d.G.length}</strong>`]])}
      <div class="kpis kpis-ant">
        <div class="kpi destacado"><span>${d.G.length}</span>expedientes</div>
        <div class="kpi"><span>${d.demandado}</span>como demandado</div>
        <div class="kpi"><span>${d.actor}</span>como actor</div>
        <div class="kpi"><span>${d.otro}</span>otra participación</div>
      </div>
      <h3>Análisis de homonimia</h3>
      <p>${d.G.length
        ? `El nombre aparece en <strong>${plural(d.G.length, 'expediente')}</strong> de <strong>${plural(d.juzgados.length, 'juzgado')}</strong>${d.primera ? `, entre el ${esc(fmtF(d.primera))} y el ${esc(fmtF(d.ultima))}` : ''}. Las listas publican nombres, no identidades: ${d.juzgados.length > 3 || d.G.length > 5 ? 'con tantos registros en juzgados distintos <strong>es probable que haya homónimos</strong>; ' : ''}confirma con datos del expediente (domicilio, CURP, RFC, contraparte) antes de concluir que se trata de la misma persona.`
        : 'No se encontró el nombre en el periodo revisado. Esto no garantiza que no existan juicios: los asuntos reservados no se publican y los nombres pueden aparecer escritos de otra forma.'}</p>
      ${htmlSat(R, tabla)}
      <h3>Otras fuentes</h3>
      ${tabla(['Fuente', 'Estado'], otras.map(([a, b]) => [esc(a), `<span class="ayuda">No consultado en esta versión · ${esc(b)}</span>`]))}
      <h3>Resultados de antecedentes legales</h3>
      ${d.G.length ? `<div class="dos-col">
          <div><h4>Por materia</h4>${tabla(['Materia', 'Expedientes'], d.materias.map(([k, v]) => [esc(k), v]))}</div>
          <div><h4>Por juzgado</h4>${tabla(['Juzgado', 'Expedientes'], d.juzgados.map(([k, v]) => [esc(k), v]))}</div>
        </div>
        <h4>Expedientes (${d.G.length})</h4>${d.G.map(exp).join('')}`
        : '<p class="nota">Sin resultados en las listas de acuerdos del periodo.</p>'}
      ${R.sinFormato ? `<p class="nota">Además hay ${plural(R.sinFormato, 'mención', 'menciones')} en listas sin formato estándar (por ejemplo, listas reservadas); se pueden ver con la búsqueda normal por nombre.</p>` : ''}
      <h3>Fuentes consultadas</h3>
      <p class="nota">Listas de acuerdos del Poder Judicial del Estado de San Luis Potosí (${R.fuentes.juzgados} juzgados y salas, fuero común): ${R.fuentes.listas_revisadas.toLocaleString('es-MX')} listas del periodo, del ${esc(fmtF(R.fuentes.archivo_desde))} al ${esc(fmtF(R.fuentes.archivo_hasta))}, revisadas en ${(R.ms / 1000).toFixed(1)} s. Fuente: stjslp.gob.mx/Acuerdos. Los juzgados federales todavía no están incluidos.</p>
      <p><button type="button" class="enlace" id="antAlerta">+ Crear alerta por nombre para "${esc(R.criterio)}"</button></p>`;
  }

  $('#reporteAnt').addEventListener('click', (e) => {
    if (e.target.id === 'antNueva') { $('#formAnt').reset(); ajustar(); $('#reporteAnt').hidden = true; window.scrollTo(0, 0); $('#antNombres').focus(); }
    if (e.target.id === 'antPdf') descargarPdf(e.target);
    if (e.target.id === 'antCsv') descargarCsv();
    if (e.target.id === 'antAlerta') window.abrirCrearAlerta({ tipo: 'nombre', valor: REPORTE.criterio, etiqueta: 'Antecedentes ' + REPORTE.criterio });
  });

  function descargarCsv() {
    const filas = [['criterio', 'expediente', 'juzgado', 'materia', 'rol', 'tipo_juicio', 'actor', 'demandado', 'fecha', 'etiquetas', 'resumen', 'lista_oficial']];
    for (const g of REPORTE.grupos) for (const a of g.acuerdos) filas.push([REPORTE.criterio, g.expediente, g.juzgado, g.materia, g.rol, g.tipo_juicio, g.actor || '', g.demandado || '', a.fecha, a.etiquetas.join(' | '), a.resumen, a.url]);
    const csv = '﻿' + filas.map((f) => f.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `antecedentes_${norm(REPORTE.criterio).replace(/ /g, '_')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function descargarPdf(boton) {
    const R = REPORTE, d = datosReporte();
    const ref = [R.extra.curp && 'CURP ' + R.extra.curp, R.extra.rfc && 'RFC ' + R.extra.rfc].filter(Boolean).join(' · ');
    const bloques = [
      { titulo: 'Resumen de la consulta', tabla: { columnas: ['Criterio', 'Fecha y hora', 'Periodo', 'Entidad', 'Resultados'],
        filas: [[R.criterio + (ref ? ` (${ref}, referencia)` : ''), fmtFH(R.cuando), d.periodo, 'San Luis Potosí (fuero común)', String(d.G.length)]] } },
      { titulo: 'Participación', filas: [['Expedientes', String(d.G.length)], ['Como demandado', String(d.demandado)], ['Como actor', String(d.actor)], ['Otra participación', String(d.otro)],
        ...(d.primera ? [['Primer y último registro', `${fmtF(d.primera)} al ${fmtF(d.ultima)}`]] : [])] },
      { titulo: 'Análisis de homonimia', texto: d.G.length
        ? `El nombre aparece en ${d.G.length} expediente(s) de ${d.juzgados.length} juzgado(s). Las listas publican nombres, no identidades; confirme con datos del expediente (domicilio, CURP, RFC, contraparte) antes de concluir que se trata de la misma persona.`
        : 'No se encontró el nombre en el periodo revisado. Esto no garantiza que no existan juicios: los asuntos reservados no se publican y los nombres pueden aparecer escritos de otra forma.' },
      ...(() => {
        const t = textosSat(R), S = t.S, b = [];
        b.push({ titulo: 'Situación ante el SAT: operaciones presuntamente inexistentes (EFOS, art. 69-B)', texto: t.efosTxt });
        if ((S.efos || []).length) b.push({ titulo: '', tabla: { columnas: ['Nombre', 'RFC', 'Situación', 'Oficio / fecha'], filas: S.efos.map((r) => [r.nombre, r.rfc, r.situacion || '', r.fecha || '']) } });
        if (S.disponible) {
          b.push({ titulo: 'Situación ante el SAT: créditos cancelados y condonados (art. 69)', texto: t.cancTxt });
          const otros = [...S.cancelados, ...S.condonados];
          if (otros.length) b.push({ titulo: '', tabla: { columnas: ['Nombre', 'RFC', 'Listado', 'Fecha', 'Monto'], filas: otros.map((r) => [r.nombre, r.rfc, r.listado_nombre, r.fecha || '', r.monto ? '$' + r.monto : '']) } });
        }
        b.push({ titulo: '', texto: t.nota + ' Fuente: Datos Abiertos del SAT (' + R.sat_fuente + ').' });
        return b;
      })(),
      { titulo: 'Otras fuentes', texto: 'No consultadas en esta versión: cédulas profesionales (SEP), edictos (Periódico Oficial de SLP) y verificación de CURP (RENAPO).' },
      ...(d.G.length ? [
        { titulo: 'Resultados por materia', tabla: { columnas: ['Materia', 'Expedientes'], filas: d.materias.map(([k, v]) => [k, String(v)]) } },
        { titulo: 'Resultados por juzgado', tabla: { columnas: ['Juzgado', 'Expedientes'], filas: d.juzgados.map(([k, v]) => [k, String(v)]) } },
      ] : []),
      { titulo: 'Fuentes consultadas', texto: `Listas de acuerdos del Poder Judicial del Estado de San Luis Potosí (${R.fuentes.juzgados} juzgados y salas, fuero común), ${R.fuentes.listas_revisadas.toLocaleString('es-MX')} listas del ${fmtF(R.fuentes.archivo_desde)} al ${fmtF(R.fuentes.archivo_hasta)}. Fuente oficial: https://www.stjslp.gob.mx/Acuerdos/Index. Juzgados federales no incluidos.` },
      ...(d.G.length ? [{ titulo: `Expedientes encontrados (${d.G.length})`, texto: '' }] : []),
    ];
    const original = boton.textContent; boton.disabled = true; boton.textContent = 'Generando…';
    try {
      const r = await fetch('/api/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        titulo: 'Reporte de antecedentes legales', bloques, grupos: d.G, incluirTexto: !!R.extra.detalle,
        criterios: `Criterio: ${R.criterio} · ${d.periodo} · San Luis Potosí`, nombreArchivo: 'antecedentes_' + norm(R.criterio).replace(/ /g, '_') }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo generar el PDF');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'antecedentes_' + norm(R.criterio).replace(/ /g, '_') + '.pdf'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { $('#antError').textContent = e.message; }
    finally { boton.disabled = false; boton.textContent = original; }
  }

  // ---------- historial de antecedentes ----------
  function pintarHistorial() {
    const q = norm($('#filtroAntH').value);
    const h = leerLS(LS, []);
    const filas = h.filter((x) => !q || norm(x.criterio + ' san luis potosi').includes(q));
    $('#nAntH').textContent = plural(h.length, 'búsqueda realizada', 'búsquedas realizadas');
    $('#tablaAntH').innerHTML = !h.length ? '<p class="nota">Todavía no hay búsquedas de antecedentes.</p>' :
      `<table><thead><tr><th>#</th><th>Descripción</th><th>Resultados</th><th>Entidad</th><th>Fecha de búsqueda</th><th></th></tr></thead><tbody>${
        filas.map((x, i) => `<tr data-id="${x.id}"><td>${i + 1}</td><td><strong>${esc(x.criterio)}</strong><br><span class="ayuda">${x.cuerpo.tipo_persona === 'moral' ? 'Persona moral' : 'Persona física'} · últimos ${x.anios} años</span></td>
          <td>${plural(x.resultados, 'resultado')}</td><td>San Luis Potosí (fuero común)</td><td>${esc(fmtFH(x.cuando))}</td>
          <td class="acciones"><button type="button" class="enlace verAnt">Ver resultados</button> <button type="button" class="enlace quitarAnt">Quitar</button></td></tr>`).join('')}</tbody></table>`;
  }
  $('#filtroAntH').addEventListener('input', pintarHistorial);
  $('#limpiarAntH').addEventListener('click', () => { $('#filtroAntH').value = ''; pintarHistorial(); });
  $('#tablaAntH').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const h = leerLS(LS, []);
    const x = h.find((i) => String(i.id) === tr.dataset.id); if (!x) return;
    if (e.target.closest('.quitarAnt')) { guardarLS(LS, h.filter((i) => i !== x)); pintarHistorial(); }
    if (e.target.closest('.verAnt')) buscar(x.cuerpo, x.extra);
  });
  $('#linkHistAnt').addEventListener('click', (e) => { e.preventDefault(); $('#histAnt').scrollIntoView({ behavior: 'smooth' }); });

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { if (b.dataset.tab === 'antecedentes') { ajustar(); pintarHistorial(); } }));
})();
