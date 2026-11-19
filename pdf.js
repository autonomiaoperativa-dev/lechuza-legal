// PDF del resumen por expediente. Se genera al momento con lo que manda la pantalla y se entrega
// directo al navegador: no se guarda nada en el servidor.
import PDFDocument from 'pdfkit';

const AZUL = '#16324a', GRIS = '#5b6b7b', CLARO = '#dde3ea', ACENTO = '#2f6f9f';

// Las fuentes estándar del PDF solo tienen caracteres latinos: se limpia lo demás.
const limpio = (s) => String(s ?? '').normalize('NFC')
  .replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”…€\n]/g, ' ')
  .replace(/[ \t]+/g, ' ').trim();
const fmtF = (f) => (f ? f.split('-').reverse().join('/') : '');

// bloques (opcional, para reportes como el de antecedentes): [{ titulo, texto, filas: [[etiqueta, valor]],
//   tabla: { columnas: [...], filas: [[...]] } }] se dibujan antes de los expedientes.
export function generarResumenPdf(res, { grupos = [], incluirTexto = false, criterios = '', titulo, bloques = [], nombreArchivo }) {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 60, left: 54, right: 54 }, bufferPages: true,
    info: { Title: (titulo || 'Resumen de expedientes') + ' - Lechuza Legal', Author: 'Lechuza Legal', Creator: 'Lechuza Legal' } });
  const nombre = nombreArchivo ? (nombreArchivo.endsWith('.pdf') ? nombreArchivo : nombreArchivo + '.pdf')
    : grupos.length === 1 ? `resumen_${grupos[0].expediente.replace('/', '-')}_${grupos[0].codigo}.pdf` : `resumen_expedientes_${new Date().toISOString().slice(0, 10)}.pdf`;
  const compacto = bloques.length > 0; // en reportes, los expedientes van seguidos (sin una hoja por cada uno)
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}"`, 'Cache-Control': 'no-store' });
  doc.pipe(res);
  const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const izq = doc.page.margins.left;

  // ---- encabezado ----
  doc.rect(0, 0, doc.page.width, 8).fill(AZUL);
  doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(18).text(limpio(titulo || ('Resumen de expediente' + (grupos.length > 1 ? 's' : ''))), izq, 30);
  doc.font('Helvetica').fontSize(9).fillColor(GRIS)
    .text(`Lechuza Legal · Listas de acuerdos del Poder Judicial del Estado de San Luis Potosí · generado el ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`);
  if (criterios) doc.text(limpio(`Búsqueda: ${criterios}`));
  doc.moveDown(0.4).fontSize(8).fillColor(GRIS)
    .text('Resumen automático: cada línea toma frases del texto oficial publicado en la lista de acuerdos. Es información de apoyo, no asesoría legal, y no sustituye la revisión del expediente.', { width: ancho });
  doc.moveDown(0.8);

  // ---- bloques del reporte ----
  const espacio = (n) => { if (doc.y > doc.page.height - doc.page.margins.bottom - n) doc.addPage(); };
  for (const b of bloques) {
    espacio(90);
    doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(12).text(limpio(b.titulo || ''), izq, doc.y, { width: ancho });
    doc.moveDown(0.25);
    if (b.texto) doc.font('Helvetica').fontSize(9.5).fillColor('#1b2733').text(limpio(b.texto), { width: ancho });
    if (Array.isArray(b.filas)) for (const [k, v] of b.filas) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1b2733').text(limpio(k) + ': ', { continued: true }).font('Helvetica').text(limpio(v), { width: ancho });
    }
    if (b.tabla && Array.isArray(b.tabla.columnas)) {
      const cols = b.tabla.columnas, n = cols.length;
      const anchos = cols.map((_, i) => (i === 0 ? ancho * 0.4 : (ancho * 0.6) / Math.max(1, n - 1)));
      const filaT = (celdas, negrita) => {
        espacio(30);
        const y = doc.y;
        let x = izq, alto = 0;
        celdas.forEach((c, i) => {
          doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(negrita ? GRIS : '#1b2733');
          const h = doc.heightOfString(limpio(c), { width: anchos[i] - 6 });
          doc.text(limpio(c), x, y, { width: anchos[i] - 6 });
          alto = Math.max(alto, h); x += anchos[i];
        });
        doc.y = y + alto + 3;
        doc.moveTo(izq, doc.y).lineTo(izq + ancho, doc.y).lineWidth(0.4).strokeColor(CLARO).stroke();
        doc.y += 3;
      };
      filaT(cols, true);
      for (const f of b.tabla.filas || []) filaT(f.map(String), false);
      doc.x = izq;
    }
    doc.moveDown(0.8);
  }

  grupos.forEach((g, gi) => {
    if (gi > 0) { if (compacto) { doc.moveDown(0.6); espacio(160); } else doc.addPage(); }
    // ---- ficha del expediente ----
    const y0 = doc.y;
    doc.roundedRect(izq, y0, ancho, 6, 2).fill(ACENTO);
    doc.moveDown(0.6);
    doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(14).text(limpio(`Expediente ${g.expediente}`), izq, doc.y, { continued: true })
      .font('Helvetica').fontSize(11).fillColor(GRIS).text(limpio(`  ·  ${g.juzgado} (${g.codigo})`));
    doc.moveDown(0.3).fontSize(10).fillColor('#1b2733');
    const fila = (et, val) => { if (!val) return; doc.font('Helvetica-Bold').text(et + ': ', { continued: true }).font('Helvetica').text(limpio(val), { width: ancho }); };
    fila('Rol de la persona', g.rol);
    fila('Materia', g.materia);
    fila('Tipo de juicio', g.tipo_juicio);
    if (g.actor || g.demandado) { fila('Actor', g.actor); fila('Demandado', g.demandado); }
    else fila('Partes', g.partes);
    fila('Acuerdos encontrados', `${g.total} (del ${fmtF(g.primera)} al ${fmtF(g.ultima)})`);
    doc.moveDown(0.6);

    // ---- línea de tiempo ----
    for (const a of g.acuerdos) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 90) doc.addPage();
      const yA = doc.y;
      doc.moveTo(izq, yA).lineTo(izq + ancho, yA).lineWidth(0.5).strokeColor(CLARO).stroke();
      doc.moveDown(0.35);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(AZUL).text(fmtF(a.fecha), izq, doc.y, { continued: !!(a.etiquetas && a.etiquetas.length) });
      if (a.etiquetas && a.etiquetas.length) doc.font('Helvetica').fontSize(9).fillColor(ACENTO).text('   ' + limpio(a.etiquetas.join(' · ')));
      doc.font('Helvetica').fontSize(10).fillColor('#1b2733').text(limpio(a.resumen), izq, doc.y + 2, { width: ancho, align: 'left' });
      const extra = [];
      if (a.plazos && a.plazos.length) extra.push('Plazos mencionados: ' + a.plazos.join(', '));
      if (a.montos && a.montos.length) extra.push('Montos: ' + a.montos.join(', '));
      if (extra.length) doc.font('Helvetica-Bold').fontSize(9).fillColor('#7a4b00').text(limpio(extra.join('   ·   ')), { width: ancho });
      if (a.url) doc.font('Helvetica').fontSize(8).fillColor(ACENTO).text('Lista oficial: ' + a.url, { width: ancho, link: a.url, underline: false });
      if (incluirTexto && a.texto) {
        doc.moveDown(0.2).font('Helvetica').fontSize(8).fillColor(GRIS).text(limpio(a.texto), { width: ancho, align: 'justify' });
      }
      doc.moveDown(0.5);
    }
  });

  // ---- pie con número de página ----
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    // el pie va dentro del margen inferior: se quita el margen un momento para que no cree otra hoja
    const margen = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const yPie = doc.page.height - 40;
    doc.font('Helvetica').fontSize(8).fillColor(GRIS)
      .text(`Lechuza Legal · Página ${i + 1} de ${rango.count}`, izq, yPie, { width: ancho, align: 'center', lineBreak: false });
    doc.page.margins.bottom = margen;
  }
  doc.end();
}
