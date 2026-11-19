// Lechuza Legal: historial de búsquedas, resumen de la búsqueda, CSV por expediente y alertas.
// Usa las funciones y variables globales de app.js ($, esc, fmtF, nombreJ, ULTIMA, GRUPOS, JUZGADOS, normExp…).
(function () {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const lineas = (t, sep) => String(t || '').split(sep || /[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const fmtFH = (iso) => { const d = new Date(iso); return d.toLocaleDateString('es-MX') + ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); };
  const nombresJ = (cods, max = 3) => !cods.length ? '—' : cods.length === JUZGADOS.length ? 'Todos los juzgados'
    : cods.slice(0, max).map(nombreJ).join(', ') + (cods.length > max ? ` y ${cods.length - max} más` : '');
  const plural = (n, s, p) => `${n.toLocaleString('es-MX')} ${n === 1 ? s : (p || s + 's')}`;
  const guardarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const leerLS = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };

  // ================= alertas: estado compartido =================
  let ALERTAS = { disponible: false, alertas: [] };
  async function cargarAlertas() {
    try { ALERTAS = await fetch('/api/alertas').then((r) => r.json()); } catch { ALERTAS = { disponible: false, alertas: [] }; }
    ALERTAS.alertas = ALERTAS.alertas || [];
    const sinVer = ALERTAS.alertas.reduce((s, a) => s + (a.sin_ver || 0), 0);
    $('#badgeAlertas').hidden = !sinVer;
    $('#badgeAlertas').textContent = sinVer > 99 ? '99+' : sinVer;
    return ALERTAS;
  }
  window.tieneAlerta = (tipo, valor, codigo) => ALERTAS.alertas.some((a) => a.tipo === tipo && (tipo === 'expediente'
    ? a.valor === normExp(valor) && (!a.juzgados || !codigo || a.juzgados.split(',').includes(codigo))
    : norm(a.valor) === norm(valor)));

  // ================= resumen de la búsqueda =================
  function datosBusqueda() {
    const c = ULTIMA.criterios || {};
    const ix = ULTIMA.indice;
    return {
      exps: lineas(c.expedientes), noms: lineas(c.nombres, /[\r\n;]+/), juzgados: c.juzgados || [],
      desde: c.desde, hasta: c.hasta, enTexto: !!c.enTexto, incognito: !!c.incognito,
      listas: ULTIMA.listas.length + (ix ? ix.listas : 0), expedientes: GRUPOS.length,
      // acuerdos de los expedientes encontrados; aparte, menciones o coincidencias en otros acuerdos
      acuerdos: GRUPOS.length ? GRUPOS.reduce((s, g) => s + g.total, 0) : ULTIMA.hallazgos.length,
      otros: GRUPOS.length ? Math.max(0, ULTIMA.hallazgos.length - GRUPOS.reduce((s, g) => s + g.total, 0)) : 0,
    };
  }
  window.textoResumenBusqueda = () => {
    const d = datosBusqueda();
    return `${nombresJ(d.juzgados, 2)} · ${plural(d.listas, 'lista revisada', 'listas revisadas')} · ${plural(d.acuerdos, 'acuerdo')} en ${plural(d.expedientes, 'expediente')}`;
  };
  function chipIdentidad(tipo, valor) {
    const con = window.tieneAlerta(tipo, valor);
    return `<span class="identidad"><span class="etq">${tipo === 'expediente' ? 'Exp.' : 'Nombre'}</span> <strong>${esc(valor)}</strong>
      ${con ? '<span class="etq alerta-si">Con alerta</span>' : `<button type="button" class="enlace crearAlertaDesde" data-tipo="${tipo}" data-valor="${esc(valor)}">+ alerta</button>`}</span>`;
  }
  function pintarResumenBusqueda() {
    const d = datosBusqueda();
    const g1 = GRUPOS.length === 1 ? GRUPOS[0] : null;
    const filas = [
      ['Identidad', [...d.exps.map((e) => chipIdentidad('expediente', e)), ...d.noms.map((n) => chipIdentidad('nombre', n))].join(' ') || '—'],
      ['Juzgado', esc(g1 ? g1.juzgado : nombresJ(d.juzgados))],
      ['Listas revisadas', esc(d.listas.toLocaleString('es-MX'))],
      ['Fecha', `${esc(fmtF(d.desde))} al ${esc(fmtF(d.hasta))}`],
    ];
    if (g1 && g1.actor) filas.push(['Actor', esc(g1.actor)]);
    if (g1 && g1.demandado) filas.push(['Demandado', esc(g1.demandado)]);
    filas.push(['Acuerdos', `${esc(plural(d.acuerdos, 'acuerdo'))}${GRUPOS.length ? ` en ${esc(plural(GRUPOS.length, 'expediente'))}` : ''}${g1 ? ` · último: ${esc(fmtF(g1.ultima))}` : ''}` +
      (d.otros ? `<br><span class="ayuda">y ${esc(plural(d.otros, 'mención', 'menciones'))} en otros acuerdos (ver "Coincidencias")</span>` : '')]);
    $('#resumenBusq').hidden = false;
    $('#resumenBusq').innerHTML = `<div class="fila-tit"><h2>Resumen de la búsqueda</h2>${d.incognito ? '<span class="etq incog-etq">incógnito: no se guarda en el historial</span>' : ''}</div>
      <dl class="resumen-dl">${filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  }
  $('#resumenBusq').addEventListener('click', (e) => {
    const b = e.target.closest('.crearAlertaDesde'); if (!b) return;
    const d = datosBusqueda();
    abrirCrearAlerta({ tipo: b.dataset.tipo, valor: b.dataset.valor, juzgados: d.juzgados.length === JUZGADOS.length ? [] : d.juzgados });
  });

  // ================= historial de búsquedas =================
  const LS_HIST = 'lechuza_historial';
  function agregarHistorial() {
    const d = datosBusqueda();
    const h = leerLS(LS_HIST, []);
    h.unshift({
      id: Date.now(), cuando: new Date().toISOString(), exps: d.exps, noms: d.noms, juzgados: d.juzgados,
      desde: d.desde, hasta: d.hasta, enTexto: d.enTexto, listas: d.listas, acuerdos: d.acuerdos,
      encontrados: GRUPOS.slice(0, 50).map((g) => ({ codigo: g.codigo, expediente: g.expediente, actor: g.actor, demandado: g.demandado, total: g.total, ultima: g.ultima })),
    });
    guardarLS(LS_HIST, h.slice(0, 300));
  }
  window.alTerminarBusqueda = () => {
    pintarResumenBusqueda();
    if (!(ULTIMA.criterios || {}).incognito) agregarHistorial();
  };
  function pintarHistorial() {
    const q = norm($('#filtroH').value);
    const h = leerLS(LS_HIST, []);
    const filas = h.filter((x) => !q || norm([x.exps, x.noms, x.juzgados.map(nombreJ), (x.encontrados || []).map((g) => [g.expediente, g.actor, g.demandado])].flat(3).join(' ')).includes(q));
    if (!h.length) { $('#tablaHist').innerHTML = '<p class="nota">Todavía no hay búsquedas guardadas.</p>'; return; }
    $('#tablaHist').innerHTML = `<table><thead><tr><th>Fecha</th><th>Identidad</th><th>Juzgados</th><th>Periodo</th><th>Listas</th><th>Resultados</th><th>Alerta</th><th></th></tr></thead><tbody>${
      filas.map((x) => {
        const ids = [...x.exps.map((e) => ['expediente', e]), ...x.noms.map((n) => ['nombre', n])];
        const conAlerta = ids.filter(([t, v]) => window.tieneAlerta(t, v));
        const enc = x.encontrados || [];
        return `<tr data-id="${x.id}">
          <td>${esc(fmtFH(x.cuando))}</td>
          <td>${ids.map(([t, v]) => `<div><span class="ayuda">${t === 'expediente' ? 'Exp.' : 'Nombre'}</span> ${esc(v)}</div>`).join('')}
            ${enc.length === 1 && enc[0].demandado ? `<div class="ayuda">${esc(enc[0].actor)} vs ${esc(enc[0].demandado)}</div>` : ''}</td>
          <td>${esc(nombresJ(x.juzgados, 2))}</td>
          <td>${esc(fmtF(x.desde))}<br>${esc(fmtF(x.hasta))}</td>
          <td>${x.listas.toLocaleString('es-MX')}</td>
          <td>${esc(plural(x.acuerdos, 'acuerdo'))}${enc.length ? `<br><span class="ayuda">${esc(plural(enc.length, 'expediente'))}</span>` : ''}</td>
          <td>${conAlerta.length ? '<span class="etq alerta-si">Sí</span>' : '<span class="ayuda">No</span>'}</td>
          <td class="acciones"><button class="enlace repetir" type="button">Repetir</button>
            ${ids.length === 1 && !conAlerta.length ? '<button class="enlace alertaH" type="button">Crear alerta</button>' : ''}
            <button class="enlace quitarH" type="button">Quitar</button></td></tr>`;
      }).join('')}</tbody></table>`;
  }
  $('#filtroH').addEventListener('input', pintarHistorial);
  $('#btnBorrarHist').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.dataset.seguro !== '1') { b.dataset.seguro = '1'; b.textContent = '¿Borrar todo? Clic otra vez'; setTimeout(() => { b.dataset.seguro = ''; b.textContent = 'Borrar historial'; }, 4000); return; }
    guardarLS(LS_HIST, []); b.dataset.seguro = ''; b.textContent = 'Borrar historial'; pintarHistorial();
  });
  $('#tablaHist').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const h = leerLS(LS_HIST, []);
    const x = h.find((i) => String(i.id) === tr.dataset.id); if (!x) return;
    if (e.target.closest('.quitarH')) { guardarLS(LS_HIST, h.filter((i) => i !== x)); pintarHistorial(); }
    else if (e.target.closest('.repetir')) repetirBusqueda(x);
    else if (e.target.closest('.alertaH')) {
      const [t, v] = x.exps.length ? ['expediente', x.exps[0]] : ['nombre', x.noms[0]];
      abrirCrearAlerta({ tipo: t, valor: v, juzgados: x.juzgados.length === JUZGADOS.length ? [] : x.juzgados });
    }
  });
  function irA(tab) { document.querySelector(`.tab[data-tab="${tab}"]`).click(); window.scrollTo(0, 0); }
  function repetirBusqueda(x) {
    $('#expedientes').value = x.exps.join('\n');
    $('#nombres').value = x.noms.join('\n');
    $('#enTexto').checked = !!x.enTexto;
    $('#desde').value = x.desde; $('#hasta').value = x.hasta;
    const set = new Set(x.juzgados);
    document.querySelectorAll('#juzgados input').forEach((c) => (c.checked = set.has(c.value)));
    calcular();
    irA('buscar');
    $('#form').requestSubmit();
  }

  // ================= CSV por expediente =================
  window.descargarCsvExpedientes = (grupos) => {
    const filas = [['expediente', 'juzgado', 'codigo_juzgado', 'tipo_juicio', 'actor', 'demandado', 'fecha', 'etiquetas', 'plazos', 'montos', 'resumen', 'lista_oficial']];
    for (const g of grupos) for (const a of g.acuerdos) {
      filas.push([g.expediente, g.juzgado, g.codigo, g.tipo_juicio, g.actor || '', g.demandado || (g.actor ? '' : g.partes), a.fecha,
        a.etiquetas.join(' | '), a.plazos.join(' | '), a.montos.join(' | '), a.resumen, a.url]);
    }
    const csv = '﻿' + filas.map((f) => f.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = grupos.length === 1 ? `acuerdos_${grupos[0].expediente.replace('/', '-')}_${grupos[0].codigo}.csv` : `acuerdos_expedientes_${HOY}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#btnCsvTodos').addEventListener('click', () => window.descargarCsvExpedientes(GRUPOS));

  // ================= pestaña Alertas =================
  let juzgadosFijos = null; // juzgados concretos cuando la alerta se crea desde una ficha
  let tipoLista = 'expediente';
  let orden = { col: 'ultima', dir: -1 };
  const LS_CORREO = 'lechuza_correo_alertas';

  function tipoForm() { return document.querySelector('input[name="tipoAlerta"]:checked').value; }
  function ajustarForm() {
    const t = tipoForm();
    $('#lblValor').textContent = t === 'expediente' ? 'Expediente' : 'Nombre de la persona o empresa';
    $('#ayudaValor').textContent = t === 'expediente' ? 'ej. 954/2014' : 'nombre y apellidos, como aparecen en las listas';
    $('#aEnTextoFila').hidden = t !== 'nombre';
    $('#aJuzN').textContent = `(${seleccion().length})`;
  }
  document.querySelectorAll('input[name="tipoAlerta"]').forEach((r) => r.addEventListener('change', ajustarForm));

  function abrirCrearAlerta({ tipo, valor, juzgados = [], etiqueta = '' }) {
    irA('alertas');
    document.querySelector(`input[name="tipoAlerta"][value="${tipo}"]`).checked = true;
    ajustarForm();
    $('#aValor').value = valor || '';
    $('#aEtiqueta').value = etiqueta || '';
    juzgadosFijos = juzgados && juzgados.length ? juzgados : null;
    const radios = document.querySelectorAll('input[name="aJuz"]');
    let fijo = document.querySelector('#aJuzFijo');
    if (juzgadosFijos) {
      if (!fijo) {
        const l = document.createElement('label'); l.className = 'check';
        l.innerHTML = '<input type="radio" name="aJuz" value="fijos" id="aJuzFijo"> <span id="aJuzFijoTxt"></span>';
        radios[radios.length - 1].closest('label').after(l);
        fijo = l.querySelector('input');
      }
      $('#aJuzFijoTxt').textContent = 'Solo: ' + nombresJ(juzgadosFijos, 4);
      fijo.closest('label').hidden = false; fijo.checked = true;
    } else if (fijo) { fijo.closest('label').hidden = true; radios[0].checked = true; }
    $('#aMsg').textContent = '';
    $('#aCorreo').value = $('#aCorreo').value || leerLS(LS_CORREO, '');
    $('#aValor').focus();
  }
  window.abrirCrearAlerta = abrirCrearAlerta;

  $('#formAlerta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const modo = document.querySelector('input[name="aJuz"]:checked').value;
    const juzgados = modo === 'fijos' ? juzgadosFijos : modo === 'marcados' ? seleccion() : [];
    const cuerpo = { tipo: tipoForm(), valor: $('#aValor').value, etiqueta: $('#aEtiqueta').value, juzgados, en_texto: $('#aEnTexto').checked, correo: $('#aCorreo').value };
    const r = await fetch('/api/alertas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const j = await r.json();
    if (!r.ok) { $('#aMsg').textContent = j.error || 'No se pudo crear la alerta.'; $('#aMsg').className = 'error'; return; }
    if (cuerpo.correo) guardarLS(LS_CORREO, cuerpo.correo);
    $('#aMsg').className = 'nota e-ok';
    $('#aMsg').textContent = `Alerta creada: ${j.etiqueta || j.valor}. Se revisará cada mañana a partir de hoy.`;
    $('#aValor').value = ''; $('#aEtiqueta').value = '';
    tipoLista = j.tipo;
    await refrescarAlertas();
    if (GRUPOS.length) pintarFichas(ULTIMA.hallazgos);
  });

  async function refrescarAlertas() {
    await cargarAlertas();
    if (!ALERTAS.disponible) {
      $('#alertasNoDisp').hidden = false; $('#alertasCont').hidden = true;
      $('#alertasNoDisp').textContent = ALERTAS.mensaje || 'Las alertas no están disponibles aquí.';
      return;
    }
    $('#alertasNoDisp').hidden = true; $('#alertasCont').hidden = false;
    $('#estadoCorreo').innerHTML = ALERTAS.correo
      ? 'Envío de correos: <strong class="e-ok">activo</strong>. Las novedades se envían a cada correo anotado.'
      : 'Envío de correos: <strong class="e-err">sin configurar</strong>. Las novedades se registran aquí; los correos saldrán cuando se configure la cuenta de envío.';
    pintarAlertas();
    pintarNovedades();
  }
  async function pintarNovedades() {
    const { novedades = [] } = await fetch('/api/novedades').then((r) => r.json()).catch(() => ({}));
    const R = window.Resumen;
    $('#listaNovedades').innerHTML = !novedades.length
      ? '<p class="nota">Sin novedades todavía. Cada mañana se revisan las listas nuevas contra tus alertas.</p>'
      : novedades.map((n) => `<div class="novedad ${n.vista ? '' : 'nueva'}">
          <div class="tl-cab"><strong>${esc(fmtF(n.fecha))}</strong> <span>${esc(nombreJ(n.codigo))}</span> <span class="exp">${esc(n.expediente || '')}</span>
            <span class="etq">${n.tipo === 'expediente' ? 'Exp.' : 'Nombre'}: ${esc(n.etiqueta || n.valor)}</span>
            ${R.etiquetas(n.texto || '').map((t) => `<span class="etq">${esc(t)}</span>`).join('')}</div>
          <div class="ayuda">${esc(n.partes)}</div>
          <div>${esc(R.resumirAcuerdo(n.texto, n.partes))}</div>
          <div class="ayuda">${n.enviada ? 'Correo enviado ' + esc(fmtFH(n.enviada)) : n.correo ? 'Correo pendiente a ' + esc(n.correo) : 'Sin correo anotado'} · <a href="${esc(n.url)}" target="_blank" rel="noopener">lista oficial</a></div>
        </div>`).join('');
  }
  function pintarAlertas() {
    const q = norm($('#filtroA').value);
    const todas = ALERTAS.alertas;
    $('#nExp').textContent = `(${todas.filter((a) => a.tipo === 'expediente').length})`;
    $('#nNom').textContent = `(${todas.filter((a) => a.tipo === 'nombre').length})`;
    document.querySelectorAll('.seg[data-tipo]').forEach((b) => b.classList.toggle('activo', b.dataset.tipo === tipoLista));
    const val = (a, col) => ({ etiqueta: (a.etiqueta || '').toLowerCase(), juzgado: a.juzgados ? nombresJ(a.juzgados.split(','), 1) : 'Todos', valor: norm(a.valor),
      creada: a.creada || '', ultima: a.ultima_novedad || '', novedades: a.novedades_total, correo: a.correo || '' })[col];
    const lista = todas.filter((a) => a.tipo === tipoLista)
      .filter((a) => !q || norm([a.etiqueta, a.valor, a.correo, 'san luis potosi', a.juzgados ? a.juzgados.split(',').map(nombreJ) : 'todos'].flat().join(' ')).includes(q))
      .sort((a, b) => { const x = val(a, orden.col), y = val(b, orden.col); return (x > y ? 1 : x < y ? -1 : 0) * orden.dir; });
    // quitar de la selección lo que ya no se ve
    const visibles = new Set(lista.map((a) => a.id));
    for (const id of [...seleccionadas]) if (!visibles.has(id)) seleccionadas.delete(id);
    const th = (col, txt) => `<th><button type="button" class="ordenar" data-col="${col}">${txt}${orden.col === col ? (orden.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    const fmtD = (iso) => iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    const juzTxt = (a) => esc(a.juzgados ? nombresJ(a.juzgados.split(','), 2) : 'Todos los juzgados');
    const esNombre = tipoLista === 'nombre';
    const todasSel = lista.length && lista.every((a) => seleccionadas.has(a.id));
    $('#barraSel').hidden = !seleccionadas.size;
    $('#nSel').textContent = `${seleccionadas.size} seleccionada${seleccionadas.size === 1 ? '' : 's'}`;
    $('#tablaAlertas').innerHTML = !lista.length ? `<p class="nota">No hay alertas por ${tipoLista}.</p>` :
      `<p class="nota">${plural(lista.length, 'alerta')} por ${tipoLista}</p>
      <table><thead><tr><th><input type="checkbox" id="selTodas" ${todasSel ? 'checked' : ''} aria-label="Seleccionar todas"></th>${
        esNombre
          ? th('valor', 'Persona') + th('juzgado', 'Entidad') + th('creada', 'Fecha de creación')
          : th('etiqueta', 'Nombre') + th('juzgado', 'Juzgado') + th('valor', 'Expediente') + th('creada', 'Creada')
      }${th('ultima', 'Última novedad')}${th('novedades', 'Novedades')}${th('correo', 'Correo')}<th>Activa</th><th></th></tr></thead><tbody>${
        lista.map((a) => `<tr data-id="${a.id}" class="${a.activa ? '' : 'pausada'}">
          <td><input type="checkbox" class="sel" ${seleccionadas.has(a.id) ? 'checked' : ''} aria-label="Seleccionar alerta"></td>
          ${esNombre
            ? `<td><strong>${esc(a.valor)}</strong>${a.etiqueta ? `<br><span class="ayuda">${esc(a.etiqueta)}</span>` : ''}${a.en_texto ? '<br><span class="ayuda">también en el texto</span>' : ''}</td>
               <td>San Luis Potosí<br><span class="ayuda">${juzTxt(a)}</span></td>
               <td>${esc(fmtD(a.creada))}</td>`
            : `<td>${esc(a.etiqueta || '—')}</td>
               <td>${juzTxt(a)}</td>
               <td><strong>${esc(a.valor)}</strong></td>
               <td>${esc(fmtD(a.creada))}</td>`}
          <td>${a.ultima_novedad ? esc(fmtFH(a.ultima_novedad)) : '<span class="ayuda">—</span>'}${a.sin_ver ? ` <span class="badge">${a.sin_ver}</span>` : ''}<br><span class="ayuda">revisada hasta ${esc(fmtF(a.revisada_hasta))}</span></td>
          <td>${a.novedades_total}</td>
          <td>${esc(a.correo || '—')}</td>
          <td><input type="checkbox" class="activa" ${a.activa ? 'checked' : ''} aria-label="Alerta activa"></td>
          <td class="acciones"><button class="enlace buscarA" type="button">Buscar</button> <button class="enlace borrarA" type="button">Borrar</button></td></tr>`).join('')}</tbody></table>`;
  }
  // ---- selección múltiple: pausar, activar o borrar varias a la vez ----
  const seleccionadas = new Set();
  async function enBloque(accion) {
    const ids = [...seleccionadas];
    for (const id of ids) {
      if (accion === 'borrar') await fetch('/api/alertas/' + id, { method: 'DELETE' });
      else await fetch('/api/alertas/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activa: accion === 'activar' }) });
    }
    seleccionadas.clear();
    await refrescarAlertas();
  }
  $('#btnSelPausar').addEventListener('click', () => enBloque('pausar'));
  $('#btnSelActivar').addEventListener('click', () => enBloque('activar'));
  $('#btnSelBorrar').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.dataset.seguro !== '1') { b.dataset.seguro = '1'; b.textContent = `¿Borrar ${seleccionadas.size}? Clic otra vez`; setTimeout(() => { b.dataset.seguro = ''; b.textContent = 'Borrar'; }, 4000); return; }
    b.dataset.seguro = ''; b.textContent = 'Borrar';
    enBloque('borrar');
  });
  document.querySelectorAll('.seg[data-tipo]').forEach((b) => b.addEventListener('click', () => { tipoLista = b.dataset.tipo; seleccionadas.clear(); pintarAlertas(); }));
  $('#filtroA').addEventListener('input', pintarAlertas);
  $('#tablaAlertas').addEventListener('click', async (e) => {
    const o = e.target.closest('.ordenar');
    if (o) { orden = { col: o.dataset.col, dir: orden.col === o.dataset.col ? -orden.dir : 1 }; pintarAlertas(); return; }
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const a = ALERTAS.alertas.find((x) => String(x.id) === tr.dataset.id);
    if (e.target.closest('.borrarA')) {
      const b = e.target.closest('.borrarA');
      if (b.dataset.seguro !== '1') { b.dataset.seguro = '1'; b.textContent = '¿Seguro?'; setTimeout(() => { b.dataset.seguro = ''; b.textContent = 'Borrar'; }, 4000); return; }
      await fetch('/api/alertas/' + a.id, { method: 'DELETE' }); await refrescarAlertas();
    } else if (e.target.closest('.buscarA')) {
      repetirBusqueda({ exps: a.tipo === 'expediente' ? [a.valor] : [], noms: a.tipo === 'nombre' ? [a.valor] : [], enTexto: !!a.en_texto,
        juzgados: a.juzgados ? a.juzgados.split(',') : JUZGADOS.map((j) => j.codigo), desde: habilesAtras(250).pop(), hasta: HOY });
    }
  });
  $('#tablaAlertas').addEventListener('change', async (e) => {
    if (e.target.id === 'selTodas') {
      document.querySelectorAll('#tablaAlertas tr[data-id]').forEach((tr) => { if (e.target.checked) seleccionadas.add(Number(tr.dataset.id)); else seleccionadas.delete(Number(tr.dataset.id)); });
      pintarAlertas(); return;
    }
    if (e.target.classList.contains('sel')) {
      const id = Number(e.target.closest('tr').dataset.id);
      if (e.target.checked) seleccionadas.add(id); else seleccionadas.delete(id);
      pintarAlertas(); return;
    }
    if (!e.target.classList.contains('activa')) return;
    const id = e.target.closest('tr').dataset.id;
    await fetch('/api/alertas/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activa: e.target.checked }) });
    await refrescarAlertas();
  });
  $('#btnRevisar').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Revisando…';
    try {
      const r = await fetch('/api/alertas/revisar', { method: 'POST' }).then((x) => x.json());
      $('#estadoCorreo').textContent = `Revisión: ${plural(r.revisadas || 0, 'alerta')}, ${plural(r.nuevas || 0, 'acuerdo nuevo', 'acuerdos nuevos')}.` +
        (r.correo ? (r.correo.correos ? ` Correos enviados: ${r.correo.correos}.` : ` Correos: ${r.correo.motivo || 'ninguno'}.`) : '');
      await cargarAlertas(); pintarAlertas(); pintarNovedades();
    } finally { b.disabled = false; b.textContent = 'Revisar ahora'; }
  });
  $('#btnVistas').addEventListener('click', async () => {
    await fetch('/api/novedades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await refrescarAlertas();
  });

  // pestañas: cargar al entrar
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tab === 'historial') pintarHistorial();
    if (b.dataset.tab === 'alertas') { ajustarForm(); refrescarAlertas(); }
  }));
  cargarAlertas();
})();
