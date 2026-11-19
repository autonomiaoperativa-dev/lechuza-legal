// Resumen automático por expediente (se calcula en el navegador, no se guarda en ningún lado).
// Es EXTRACTIVO: toma frases del propio texto oficial del acuerdo, no inventa ni interpreta.
(function () {
  // Etiquetas por palabras clave del auto. El orden importa: la primera que coincide va primero.
  const REGLAS = [
    ['Sentencia / resolución', /sentencia\s+(definitiva|interlocutoria)|puntos\s+resolutivos|\bse\s+resuelve\b|\bRESUELVE\b|\bresolutivos?\b/i],
    ['Citación para resolver', /cita(n|r)?\s+(a\s+las\s+partes\s+)?para\s+(oír|oir|dictar|resolver)/i],
    ['Admisión', /\bse\s+admite|admítase|admite\s+a\s+trámite|se\s+tiene\s+por\s+admitid/i],
    ['Emplazamiento', /empl[aá]c|emplaz/i],
    ['Audiencia', /\baudiencia\b/i],
    ['Pruebas', /\bpruebas?\b|desahog/i],
    ['Embargo', /\bembargo/i],
    ['Recurso', /recurso\s+de\s+(apelaci[oó]n|queja|revocaci[oó]n|reposici[oó]n)|\bapelaci[oó]n\b|\bamparo\b/i],
    ['Requerimiento', /requi[eé]r|requerimiento|apercib/i],
    ['Convenio', /\bconvenio\b/i],
    ['Exhorto', /\bexhorto\b/i],
    ['Ejecución / remate', /\bremate\b|\badjudicaci[oó]n\b|ejecuci[oó]n\s+de\s+sentencia/i],
    ['Archivo / caducidad', /\barch[ií]vese\b|\bcaducidad\b|\bconcluido\b/i],
  ];

  const NUMEROS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30 };

// Un "tipo de juicio" válido nombra una vía o materia; se descartan restos como "NOTIFÍQUESE" o "LISTA."
  const VIA = /JUICIO|ORDINARIO|EXTRAORDINARIO|EJECUTIVO|ESPECIAL|SUMARI|HIPOTECARIO|MERCANTIL|CIVIL|FAMILIAR|SUCESORIO|INTESTAMENTARIO|TESTAMENTARIO|DIVORCIO|ALIMENTOS|CONTROVERSIA|JURISDICCI|DILIGENCIAS|PENAL|LABORAL|INCIDENTE|ARRENDAMIENTO|USUCAPI|REIVINDICATORI|NULIDAD|PROCEDIMIENTO|ADOPCI|GUARDA|CUSTODIA|PATRIA POTESTAD|PERDIDA|RECTIFICACI|INTERDICCI|DESAHUCIO|PRESCRIPCI|OTORGAMIENTO|CUMPLIMIENTO/;
  function limpiarTipo(t) {
    if (!t) return null;
    const s = t.replace(/\s+/g, ' ').trim();
    const sinEsp = s.replace(/\s/g, '');
    if (/NOTIF|LISTA|PERSONALMENTE|PARTE|PUBL[IÍ]QUESE|CUMPLASE|CÚMPLASE/.test(sinEsp)) return null;
    if (!VIA.test(s.normalize('NFD').replace(/[̀-ͯ]/g, ''))) return null;
    return s.replace(/[.\-–:]+$/, '').trim();
  }

  function etiquetas(texto) {
    return REGLAS.filter(([, re]) => re.test(texto)).map(([n]) => n).slice(0, 4);
  }

  // "en término de 03 tres días", "dentro del plazo de cinco días hábiles"
  function plazos(texto) {
    const out = new Set();
    const re = /(t[ée]rmino|plazo)\s+(?:legal\s+)?de\s+(\d{1,3}|[a-záéíóú]+)(?:\s+[a-záéíóú]+)?\s+d[ií]as(\s+h[áa]biles)?/gi;
    let m;
    while ((m = re.exec(texto))) {
      const n = /^\d+$/.test(m[2]) ? Number(m[2]) : NUMEROS[m[2].toLowerCase()];
      if (n) out.add(`${n} día${n > 1 ? 's' : ''}${m[3] ? ' hábiles' : ''}`);
    }
    return [...out].slice(0, 3);
  }

  function montos(texto) {
    return [...new Set((texto.match(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g) || []).map((s) => s.replace(/\s/g, '')))].slice(0, 4);
  }

  // Una o dos frases del auto, sin el encabezado "Expediente: NNN/AAAA.- Actor VS Demandado.-"
  function resumirAcuerdo(texto, partes) {
    let t = (texto || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^[^0-9]{0,40}\d+\s*\/\s*\d{4}\s*/, '');
    t = t.replace(/^[\s.\-–:]+/, '');
    // el encabezado "Actor VS Demandado" termina en ".-": se quita para que el resumen empiece con lo acordado
    if (partes && t.startsWith(partes)) t = t.slice(partes.length);
    else {
      const fin = t.search(/\.\s*-\s*/);
      if (fin > 0 && fin < 400) t = t.slice(fin);
    }
    t = t.replace(/^[\s.\-–:]+/, '');
    // fórmulas de inicio que no dicen nada: el número repetido y "San Luis Potosí, S.L.P., a 10 de noviembre de 2026."
    t = t.replace(/^\d+\s*\/\s*\d{4}\s*/, '');
    t = t.replace(/^(En la ciudad de\s+)?San Lu[ií]s Potos[ií][^.]{0,160}?\s(de|del)\s+(\d{4}|dos mil(\s+[a-záéíóú]+){1,2})\s*[.;,]?\s*/i, '');
    const frases = t.split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ¿])/);
    let r = '';
    for (const f of frases) {
      if (r && (r + ' ' + f).length > 340) break;
      r += (r ? ' ' : '') + f;
      if (r.length > 160) break;
    }
    if (r.length > 360) r = r.slice(0, 357).replace(/\s+\S*$/, '') + '…';
    return r || t.slice(0, 300);
  }

  // "BANCO X VS JUAN PÉREZ" -> actor / demandado. Si no hay "VS", no se separa.
  function separarPartes(partes) {
    const p = String(partes || '').replace(/\s+/g, ' ').replace(/[.\-–\s]+$/, '').trim();
    const m = p.split(/\s+(?:VS\.?|V\.S\.|V\/S|vs\.?|contra)\s+/);
    if (m.length >= 2 && m[0].length > 1 && m[1].length > 1) return { actor: m[0].trim(), demandado: m.slice(1).join(' / ').trim() };
    return { actor: null, demandado: null };
  }

  // Agrupa los hallazgos por juzgado + expediente y arma la ficha de cada uno.
  function agrupar(hallazgos, nombreJ) {
    const grupos = new Map();
    for (const h of hallazgos) {
      if (!h.expediente || h.clase === 'MENCIÓN EN TEXTO' || h.clase === 'LISTA COMPLETA') continue;
      if (h.motivos.every((m) => m.includes('(en texto)'))) continue; // solo menciones: no es "su" acuerdo
      const k = h.codigo + '|' + h.expediente;
      if (!grupos.has(k)) grupos.set(k, { clave: k, codigo: h.codigo, juzgado: nombreJ(h.codigo), expediente: h.expediente, acuerdos: [], vistos: new Set() });
      const g = grupos.get(k);
      const firma = h.fecha + '|' + (h.texto || '').slice(0, 80);
      if (g.vistos.has(firma)) continue;
      g.vistos.add(firma);
      g.acuerdos.push({
        fecha: h.fecha, clase: h.clase, tipo_juicio: h.tipo_juicio, partes: h.partes, url: h.url,
        etiquetas: etiquetas(h.texto || ''), plazos: plazos(h.texto || ''), montos: montos(h.texto || ''),
        resumen: resumirAcuerdo(h.texto, h.partes), texto: h.texto || '', motivos: h.motivos,
      });
    }
    const lista = [...grupos.values()].map((g) => {
      g.acuerdos.sort((a, b) => a.fecha.localeCompare(b.fecha)); // del más antiguo al más reciente
      const ult = g.acuerdos[g.acuerdos.length - 1];
      const tipos = [...new Set(g.acuerdos.map((a) => limpiarTipo(a.tipo_juicio)).filter(Boolean))];
      // las partes más completas (el texto más largo) suelen ser las del encabezado
      const partes = g.acuerdos.map((a) => a.partes || '').sort((a, b) => b.length - a.length)[0] || '';
      delete g.vistos;
      const { actor, demandado } = separarPartes(partes);
      return { ...g, tipo_juicio: tipos.join(' / ') || null, partes, actor, demandado, primera: g.acuerdos[0].fecha, ultima: ult.fecha, total: g.acuerdos.length };
    });
    // primero los expedientes con movimiento más reciente
    return lista.sort((a, b) => b.ultima.localeCompare(a.ultima));
  }

  window.Resumen = { agrupar, etiquetas, plazos, montos, resumirAcuerdo, limpiarTipo, separarPartes };
})();
