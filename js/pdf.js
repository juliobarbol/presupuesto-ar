'use strict';

// ═══════════════════════════════════════
// PDF.JS — Construcción del documento para impresión/PDF
// ═══════════════════════════════════════

// ─── ÍCONOS SVG DE LÍNEA (reemplazan emojis para un look formal) ───
// Trazo fino, heredan el color del texto (currentColor). Se alinean
// con el texto vía vertical-align. Tamaño por defecto 1em.
const PDF_ICONS = {
  phone: '<svg class="pdf-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  email: '<svg class="pdf-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>',
  location: '<svg class="pdf-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  warning: '<svg class="pdf-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  camera: '<svg class="pdf-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
};
function pdfIcon(name) { return PDF_ICONS[name] || ''; }

function printDoc() {
  syncFromUI();
  // Último control antes de que el presupuesto salga del teléfono: si
  // quedó un [X] sin completar, avisar. No bloquea — solo pregunta.
  const pend = huecosPendientes();
  if (pend.length) { confirmarHuecos('Imprimir igual').then(ok => { if (ok) _printDocGo(); }); return; }
  _printDocGo();
}

function _printDocGo() {
  toast('Generando presupuesto…', 'info', 1500);
  syncFromUI();
  autoSaveToHistory();
  buildDoc();
  // El título es el nombre de archivo del PDF: "Presupuesto 2026-0049 - Cliente.pdf"
  const client = (S.clientName||'').trim().replace(/[^\w\sáéíóúñüÁÉÍÓÚÑÜ-]/g,'').trim();
  const num    = S.quoteNumber || '';
  document.title = ('Presupuesto' + (num ? ' ' + num : '') + (client ? ' - ' + client : '')).trim();
  setTimeout(()=>{
    window.print();
    _restoreDocTitleWhenBack(S.coName ? ('Presupuestos — ' + S.coName) : 'Presupuestos');
    // Opción B: ofrecer marcar como enviado tras generar el PDF, pero
    // solo si el presupuesto sigue en borrador. Un toque y listo.
    _ofrecerMarcarEnviado(num);
  }, 150);
}

// Restaura el título del documento (= nombre de archivo del PDF) recién
// cuando el usuario VUELVE del diálogo de impresión. En Android
// window.print() no bloquea y Chrome toma el nombre del archivo al momento
// de GUARDAR: un restore con timer corto hacía que el PDF se guardara como
// "Presupuestos" en vez del nombre armado. La vuelta del diálogo se detecta
// con visibilitychange (el diálogo de impresión es otra pantalla del
// sistema); fallback de 5 min para desktop, donde print() sí bloquea y la
// página puede no ocultarse nunca.
let _titleRestorePending = null;
function _restoreDocTitleWhenBack(title) {
  if (_titleRestorePending) { _titleRestorePending.title = title; return; }
  const p = { title };
  _titleRestorePending = p;
  let t = null;
  const done = () => {
    if (_titleRestorePending !== p) return;
    _titleRestorePending = null;
    document.removeEventListener('visibilitychange', onVis);
    if (t) clearTimeout(t);
    document.title = p.title;
  };
  const onVis = () => {
    // Al volver del diálogo, un respiro extra por si el sistema todavía
    // está terminando de generar/guardar el PDF.
    if (document.visibilityState === 'visible') setTimeout(done, 1000);
  };
  document.addEventListener('visibilitychange', onVis);
  t = setTimeout(done, 300000);
}

// Muestra un toast accionable "¿Marcar como enviado?" si el presupuesto
// está en borrador. Si ya avanzó de estado, no molesta.
function _ofrecerMarcarEnviado(quoteNumber) {
  if (!quoteNumber) return;
  const h = (typeof getH === 'function') ? getH() : [];
  const e = h.find(x => x.quoteNumber === quoteNumber);
  if (!e) return;
  if (e.estado && e.estado !== 'borrador') return; // ya enviado/aceptado/etc.

  const c = document.getElementById('toast-container');
  if (!c) return;
  // Toast con botón. Se autocierra a los 8s si no se toca.
  const el = document.createElement('div');
  el.className = 'toast toast-info toast-action';
  el.innerHTML = `<span>¿Marcar como enviado?</span>
    <button type="button" class="toast-btn">Sí, enviado</button>`;
  c.appendChild(el);
  requestAnimationFrame(()=>{ requestAnimationFrame(()=>el.classList.add('show')); });
  const close = () => { el.classList.remove('show'); setTimeout(()=>el.remove(), 300); };
  el.querySelector('.toast-btn').onclick = () => {
    if (typeof marcarComoEnviado === 'function') marcarComoEnviado(quoteNumber);
    close();
  };
  setTimeout(close, 8000);
}

// Construye el HTML del <tbody> de la tabla de ítems para una lista
// específica. Se usa tanto para el modo normal como para los dos
// bloques de escenarios A/B.
// Celda de precio de un trabajo: cerrado ("a ojo") o, si se cobra por
// unidad, el desglose "40 m × $ 3.000" encima del total. Con unidad el
// desglose sale SIEMPRE: es lo que el cliente necesita para entender el total.
function _trabajoPrecioCellHTML(item, cur) {
  if (item.price === '' || item.price == null) return '—';
  if (!itemUnidad(item)) return fmtMDoc(item.price, cur);
  return `<span class="qty-breakdown">${esc(itemCantTxt(item))} × ${fmtMDoc(item.price, cur)}</span><strong>${fmtMDoc(itemTotal(item), cur)}</strong>`;
}

// Título del documento según modo y rubro. El override de un trabajo sin
// presupuesto (_docTrabajo) gana, como siempre.
function _docTituloHTML(est) {
  if (!est && _docTrabajo && _docTrabajo.titulo) return esc(_docTrabajo.titulo);
  const jard = esJardineria();
  const t = est
    ? (jard ? (S.docTitleEstJard || DEF.docTitleEstJard) : (S.docTitleEst || DEF.docTitleEst))
    : (jard ? (S.docTitleJard || DEF.docTitleJard) : (S.docTitle || DEF.docTitle));
  return esc(t);
}

function _buildItemsRowsHTML(arr, color, cur) {
  if (!arr || !arr.length) {
    return `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:18px;font-style:italic">Sin ítems agregados</td></tr>`;
  }
  let rows = ''; let n = 0;
  arr.forEach(item => {
    if(item.type==='tree'){
      n++;
      const p = _trabajoPrecioCellHTML(item, cur);
      rows+=`<tr>
        <td class="td-n">${n}</td>
        <td class="td-sp" style="color:${color}">${esc(item.species||'Sin especificar')}</td>
        <td class="td-wk">${esc(item.desc||'').replace(/\n/g,'<br>')}</td>
        <td class="td-pr">${p}</td></tr>`;
    } else if(item.type==='service'){
      n++;
      const qty      = parseInt(item.qty) || 1;
      const total    = itemTotal(item);
      const hasPrice = item.price !== '' && item.price !== null;
      let pCell;
      if(!hasPrice){
        pCell = '—';
      } else if(item.showQty && qty > 1){
        // qty-breakdown: gris claro chiquito (CSS), MUY débil
        // strong: subtotal real, peso completo
        pCell = `<span class="qty-breakdown">${qty} × ${fmtMDoc(item.price,cur)}</span><strong>${fmtMDoc(total,cur)}</strong>`;
      } else {
        pCell = fmtMDoc(total, cur);
      }
      rows+=`<tr>
        <td class="td-n">${n}</td>
        <td class="td-sp" style="color:${color}">Servicio</td>
        <td class="td-wk">${esc(item.desc||'').replace(/\n/g,'<br>')}</td>
        <td class="td-pr">${pCell}</td></tr>`;
    } else {
      rows+=`<tr class="nrow"><td></td><td colspan="3">${esc(item.desc||'').replace(/\n/g,'<br>')}</td></tr>`;
    }
  });
  return rows;
}

// Construye el bloque completo de UNA sección de ítems (psec + ptotals).
// label opcional: si viene, va arriba como subtítulo del escenario.
// Tabla de ítems ("Detalles del Trabajo"). Sin el total: en el presupuesto
// normal el total es una sección aparte y reordenable (ver buildDoc).
function _buildSceneTableHTML(arr, label, color, cur) {
  const rows = _buildItemsRowsHTML(arr, color, cur);
  const sectionTitle = label
    ? `<span style="display:block;font-size:13pt;font-weight:700;color:var(--c-text);line-height:1.2;margin-bottom:2px">${esc(label)}</span><span style="display:block;font-size:8.5pt;font-weight:600;color:var(--c-muted);text-transform:uppercase;letter-spacing:.04em">Detalles del Trabajo</span>`
    : 'Detalles del Trabajo';
  return `
    <div class="psec">
      <div class="psec-t">${sectionTitle}</div>
      <table class="ptable">
        <thead><tr>
          <th style="width:18pt">#</th>
          <th style="width:100pt">${esJardineria() ? 'Planta / Sector' : 'Especie/s'}</th>
          <th>Trabajo a realizar</th>
          <th class="thr">Valor</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Caja del total (con subtotal/descuento si corresponde).
function _buildSceneTotalsHTML(arr, label, color, cur, includeDisc) {
  const {subtotal, discAmt, total} = calcTotals(arr);
  const discLabel = S.docDiscountLabel || 'Descuento';
  const discH = (includeDisc && S.discount > 0) ? `
    <div class="pdisc-row"><span>Subtotal:</span><span>${fmtMDoc(subtotal,cur)}</span></div>
    <div class="pdisc-row" style="color:#dc2626"><span>${esc(discLabel)} (${S.discount}%):</span><span>− ${fmtMDoc(discAmt,cur)}</span></div>
    ${S.docDiscountNote ? `<div class="pdisc-note">${esc(S.docDiscountNote)}</div>` : ''}` : '';
  return `
    <div class="ptotals">
      ${discH}
      <div class="ptotal-box" style="color:${color};border-color:${color};background:${color}12">
        <div class="ptotal-lbl" style="color:${color}">Total del trabajo</div>
        <div class="ptotal-amt" style="color:${color}">${fmtMDoc(total,cur)}</div>
      </div>
    </div>`;
}

// Bloque completo (tabla + total). Se usa en modo escenarios A/B, donde cada
// opción debe llevar su total pegado a su tabla (no se pueden reordenar por
// separado dos totales distintos).
function _buildSceneBlockHTML(arr, label, color, cur, includeDisc) {
  return _buildSceneTableHTML(arr, label, color, cur)
    + '\n\n' + _buildSceneTotalsHTML(arr, label, color, cur, includeDisc);
}

// Construye el HTML del header del documento según el tema activo.
// badgeLabel: texto de la etiqueta del número (ej. 'Presupuesto N°').
// badgeDate: string de fecha opcional (null = no mostrar).
// showPlaceholder: true en Risk/Est docs para mostrar recuadro LOGO si no hay logo.
// Atributos de la <table class="pdoc"> que envuelve los 4 documentos (normal,
// riesgo, estimativo, recibo): tema, densidad, tipografía, color principal y,
// si hay, el color de DETALLE (v244). El detalle es una clase aparte
// (`pdoc-det` + --pdoc-det) que solo existe cuando el usuario eligió uno: sin
// él el documento sale exactamente como antes.
function _pdocAttrs(theme, color) {
  const det = sanColor2(S.accentColor2);
  // Elementos del documento (v245): cada uno es una clase pdoc-<eje>-<valor>,
  // solo si no es 'auto'. Dos excepciones: el tema Lateral ya tiene su propio
  // encabezado (banda vertical), y el informe de riesgo ya numera sus
  // secciones (sumarle "Numerados" daría "01 1. Árbol evaluado").
  const hd  = theme === 'lateral' ? 'auto' : _pdocEncabezado();
  const tit = sanEnum(S.pdfTitulos, PDF_TITULOS, 'auto');
  const tb  = sanEnum(S.pdfTabla,   PDF_TABLAS,  'auto');
  const to  = sanEnum(S.pdfTotal,   PDF_TOTALES, 'auto');
  const cls = 'pdoc pdoc-theme-' + theme
    + (S.pdfCompact ? ' pdoc-compact' : '')
    + (S.pdfFont && S.pdfFont !== 'auto' ? ' pdoc-font-' + S.pdfFont : '')
    + (det && det.toLowerCase() !== String(color).toLowerCase() ? ' pdoc-det' : '')
    + (hd  !== 'auto' ? ' pdoc-hd-' + hd : '')
    + (tit !== 'auto' && !(tit === 'numerado' && S.isRisk) ? ' pdoc-tit-' + tit : '')
    + (tb  !== 'auto' ? ' pdoc-tb-' + tb : '')
    + (to  !== 'auto' ? ' pdoc-to-' + to : '');
  const fondo = _fondoURL(color);
  // Tonos claros del principal (y del detalle), calculados acá y no con
  // color-mix(): "Compartir imagen" pasa por html2canvas, que no lo entiende.
  const rgb = _hexToRgb(color) || [6, 78, 59];
  const rgbD = det ? (_hexToRgb(det) || rgb) : rgb;
  const tono = (c, p) => _mixWhite(c[0], c[1], c[2], 1 - p);
  const vars = `--pdoc-accent:${color};--pdoc-tint1:${tono(rgb, .07)};--pdoc-tint2:${tono(rgb, .12)};--pdoc-line:${tono(rgb, .3)}`
    + (det ? `;--pdoc-det:${det};--pdoc-det-soft:${tono(rgbD, .45)}` : '');
  return `class="${cls}${fondo ? ' pdoc-fondo-' + fondo.tipo : ''}" style="${vars}${fondo ? ';--pdoc-fondo:' + fondo.url : ''}"`;
}

// Iniciales del negocio para el monograma: primera letra de las dos primeras
// palabras ("Arbolado Norte" → "AN"). Sin nombre no hay monograma: un círculo
// con una "P" inventada no identifica a nadie.
function _monoIniciales(nombre) {
  const w = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return (w[0].charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase();
}

// Monograma del encabezado (v244): para el que no tiene logo, una marca propia
// con las iniciales dentro de una forma (PDF_MONOS). `fill` es el color de la
// forma y `ink` el de las letras (en la banda del tema Lateral van invertidos).
// SVG inline: sale igual en la vista previa, la impresión y la imagen.
function _monoSVG(forma, nombre, fill, ink, cls) {
  const f = sanEnum(forma, PDF_MONOS, 'ninguno');
  const ini = _monoIniciales(nombre);
  if (f === 'ninguno' || !ini) return '';
  const fl = safeColor(fill), ik = safeColor(ink);
  const formas = {
    circulo: `<circle cx="50" cy="50" r="46" fill="${fl}"/>`,
    escudo:  `<path d="M50 4 L90 16 V48 C90 72 72 88 50 96 C28 88 10 72 10 48 V16 Z" fill="${fl}"/>`,
    hoja:    `<path d="M50 4 C82 18 96 44 88 70 C80 92 58 98 50 96 C42 98 20 92 12 70 C4 44 18 18 50 4 Z" fill="${fl}"/>`,
    rombo:   `<path d="M50 3 L97 50 L50 97 L3 50 Z" fill="${fl}"/>`,
    sello:   `<circle cx="50" cy="50" r="47" fill="none" stroke="${fl}" stroke-width="3"/><circle cx="50" cy="50" r="40" fill="${fl}"/>`,
  };
  const fs = ini.length > 1 ? 36 : 44;
  // width/height como ATRIBUTOS (no solo por CSS): html2canvas ("Compartir
  // imagen") dibuja el SVG como imagen y, sin tamaño propio, no lo dibuja.
  const lado = cls === 'ph-band-mono' ? 52 : 50;
  return `<svg class="${cls || 'ph-mono'}" width="${lado}" height="${lado}" viewBox="0 0 100 100" aria-hidden="true">${formas[f]}`
    + `<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-family="'DM Serif Display',Georgia,serif" font-size="${fs}" fill="${ik}">${esc(ini)}</text></svg>`;
}

// Pie del documento (v245). `orig` es el pie de siempre de cada documento
// (sale tal cual con "Según diseño"); `derecha` el dato de la punta derecha
// (número · fecha · tipo) que llevan el estimativo y el riesgo.
//   franja  → banda del color con la firma y los datos de contacto.
//   eslogan → la frase del negocio (S.coEslogan) arriba de la firma; sin
//             eslogan escrito cae al pie de siempre (no hay frase que mostrar).
// Respeta "Mostrar pie de página" (S.showFooter) como siempre.
function _pieDoc(color, orig, derecha) {
  if (!S.showFooter) return '';
  const pie = sanEnum(S.pdfPie, PDF_PIES, 'auto');
  const esl = (S.coEslogan || '').trim();
  const firma = esc(S.coFooter || '');
  if (pie === 'franja') {
    const datos = [S.coWhatsapp ? 'WhatsApp ' + S.coWhatsapp : '', S.coEmail, S.coCity]
      .map(x => String(x || '').trim()).filter(Boolean).map(esc).join(' · ');
    return `<div class="pfoot pfoot-franja">
      <span class="pfoot-l">${firma || esc(S.coName || '')}</span>
      <span class="pfoot-r">${datos || esc(derecha || '')}</span>
    </div>`;
  }
  if (pie === 'eslogan' && esl) {
    return `<div class="pfoot pfoot-eslogan">
      <span class="pfoot-esl" style="color:${safeColor(color)}">${esc(esl)}</span>
      ${firma ? `<span class="pfoot-l">${firma}</span>` : ''}
      ${derecha ? `<span class="pfoot-r">${esc(derecha)}</span>` : ''}
    </div>`;
  }
  return orig;
}

// Fondo del documento (v246): un dibujo muy suave del color principal detrás de
// la hoja. Devuelve {tipo, url} o null (liso). La transparencia va DENTRO del
// SVG porque CSS no deja bajarle la opacidad a un background-image. Va como
// data URI con encodeURIComponent y comillas dobles adentro: el resultado se
// mete en un style="…" y no puede llevar ni comillas dobles ni saltos.
//   hojas/curvas/veta → mosaico que cubre todas las hojas.
//   marca → el monograma grande y casi transparente, una vez, detrás de la
//           primera hoja (repetirlo por página dependería de cómo pagina cada
//           navegador). Sin nombre del negocio no hay iniciales: queda liso.
function _fondoURL(color) {
  const tipo = sanEnum(S.pdfFondo, PDF_FONDOS, 'auto');
  if (tipo === 'auto') return null;
  const c = safeColor(color);
  let svg = '';
  if (tipo === 'hojas') {
    const hoja = (x, y, r) => `<path transform="translate(${x} ${y}) rotate(${r})" d="M0 -14 C9 -8 10 6 0 14 C-10 6 -9 -8 0 -14 Z M0 -12 V12" fill="none" stroke="${c}" stroke-width="1.2"/>`;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><g stroke-opacity=".10">${hoja(30, 30, -30)}${hoja(105, 62, 40)}${hoja(58, 115, 10)}${hoja(132, 134, -60)}</g></svg>`;
  } else if (tipo === 'curvas') {
    let p = '';
    for (let i = 0; i < 9; i++) {
      const y = 20 + i * 26;
      p += `<path d="M-10 ${y} C 60 ${y - 18}, 120 ${y + 22}, 200 ${y - 6} S 330 ${y + 14}, 430 ${y}" fill="none" stroke="${c}" stroke-width="1"/>`;
    }
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="234"><g stroke-opacity=".12">${p}</g></svg>`;
  } else if (tipo === 'veta') {
    let p = '';
    for (let i = 0; i < 7; i++) {
      const x = 12 + i * 24;
      p += `<path d="M${x} 0 C ${x + 14} 70, ${x - 12} 140, ${x + 6} 210 S ${x - 8} 350, ${x} 420" fill="none" stroke="${c}" stroke-width="1.1"/>`;
    }
    p += `<ellipse cx="84" cy="210" rx="9" ry="24" fill="none" stroke="${c}" stroke-width="1"/>`;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="420"><g stroke-opacity=".14">${p}</g></svg>`;
  } else if (tipo === 'logo') {
    // El logo del negocio (PNG/JPG ya achicado por compressLogoDataUrl, hasta
    // 900×500) dentro de un SVG con la opacidad en el <image>: así sirve igual
    // de fondo que los demás dibujos. Sin logo cargado queda liso. Se escapa
    // aunque safeImgSrc ya exige data:image/: un logo de un backup ajeno no
    // puede romper el SVG.
    const src = safeImgSrc(S.logo);
    if (!src) return null;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><image href="${esc(src)}" x="0" y="0" width="400" height="400" preserveAspectRatio="xMidYMid meet" opacity=".07"/></svg>`;
  } else if (tipo === 'marca') {
    const forma = (S.pdfMono && S.pdfMono !== 'ninguno') ? S.pdfMono : 'circulo';
    const mono = _monoSVG(forma, S.coName, c, '#ffffff', '');
    if (!mono) return null;
    svg = mono.replace(/^<svg class="[^"]*" width="\d+" height="\d+" /, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" ')
      .replace('aria-hidden="true">', 'aria-hidden="true"><g opacity=".06">').replace('</svg>', '</g></svg>');
  }
  // encodeURIComponent deja pasar la comilla simple (la tipografía del
  // monograma la usa) y cortaría el url('…').
  return { tipo, url: `url('data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}')` };
}

// Recuadros translúcidos (v249). Pedido del dueño con la marca de agua del
// logo puesta: "las partes que son totalmente opacas y no dejan traslucir el
// logo, que sean un poco transparentes — no del todo". Cada tema pinta sus
// recuadros con su propio tono (y algunos con !important), así que en vez de
// una regla CSS por tema se hace DESPUÉS de armar el documento: cada elemento
// del cuerpo con fondo CLARO pasa a ese mismo color con alfa
// ESTILO_TRANSL_ALFA (inline + important, le gana a todo). Y al revés: con la
// opción APAGADA, lo que venía translúcido de fábrica (el total) queda sólido,
// así el interruptor manda en los dos sentidos (v251). Los fondos fuertes
// del color principal (total en banda, píldoras, cebra) quedan sólidos: si se
// lavaran, el diseño perdería carácter. Solo con un fondo puesto (sin fondo no
// hay nada que dejar ver) y solo en el <tbody>: el encabezado se repite en
// cada hoja y no tiene marca detrás. Inline, viaja en el innerHTML que copian
// la vista previa y "Compartir imagen"; rgba() lo entiende html2canvas.
const ESTILO_TRANSL_ALFA = 0.4;
const ESTILO_TRANSL_CLARO = 190;   // canal mínimo para considerar "claro" un fondo
const ESTILO_TRANSL_FILO = 20;     // cuánto más oscuro que el relleno es el filo que completa el recuadro
function _docTranslucido() {
  const doc = document.getElementById('doc-a4');
  const t = doc && doc.querySelector('table.pdoc');
  // Sin fondo no hay nada que tapar ni que dejar ver: el documento queda como
  // siempre.
  if (!t || !/\bpdoc-fondo-/.test(t.className)) return;
  const cuerpo = t.querySelector(':scope > tbody');
  if (!cuerpo) return;
  const transl = !!S.pdfTransl;
  cuerpo.querySelectorAll('*').forEach(el => {
    const m = getComputedStyle(el).backgroundColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (!m) return;
    const a = m[4] === undefined ? 1 : +m[4];
    if (a < 0.02) return;                       // transparente: nada que hacer
    // El tono que se ve sobre papel blanco. Algunos recuadros ya traen alfa de
    // fábrica (el del total es el color principal al 7 %): sobre blanco no se
    // notaba, pero con un fondo detrás dejaba verlo aunque "Recuadros
    // translúcidos" estuviera APAGADO (reporte del dueño, v251). Por eso todo
    // se lleva primero a su tono sólido sobre blanco.
    const sobreBlanco = c => Math.round(+c * a + 255 * (1 - a));
    const r = sobreBlanco(m[1]), g = sobreBlanco(m[2]), b = sobreBlanco(m[3]);
    if (Math.min(r, g, b) < ESTILO_TRANSL_CLARO) return;   // fuerte: no se toca
    if (!transl) {
      // Apagado: los que venían translúcidos pasan a sólidos; los sólidos ya
      // están bien.
      if (a < 0.99) el.style.setProperty('background-color', `rgb(${r},${g},${b})`, 'important');
      return;
    }
    el.style.setProperty('background-color', `rgba(${r},${g},${b},${ESTILO_TRANSL_ALFA})`, 'important');
    // Recuadros que solo tienen la raya de color a la izquierda (plan,
    // criterios, cómo pagar, vigencia): su relleno casi blanco era lo único
    // que los dibujaba, y translúcido el recuadro "desaparecía" (reporte del
    // dueño: "el plan de trabajo quedó totalmente transparente", mientras el
    // de cliente, que tiene borde completo, se veía bien). Se completan los
    // lados que faltan con un filo de su mismo tono, un poco más oscuro —el
    // mismo gris del borde del recuadro de cliente—. La raya de color no se toca.
    const cs = getComputedStyle(el);
    const tieneBorde = ['Top', 'Right', 'Bottom', 'Left'].some(l => cs['border' + l + 'Style'] !== 'none');
    if (!tieneBorde) return;
    const filo = `1px solid rgb(${Math.max(0, r - ESTILO_TRANSL_FILO)},${Math.max(0, g - ESTILO_TRANSL_FILO)},${Math.max(0, b - ESTILO_TRANSL_FILO)})`;
    ['Top', 'Right', 'Bottom', 'Left'].forEach(l => {
      if (cs['border' + l + 'Style'] === 'none') el.style.setProperty('border-' + l.toLowerCase(), filo, 'important');
    });
  });
}

// Encabezado elegido (v245), validado. Lo usan _pdocAttrs (la clase) y
// _buildDocHeader (el monograma va invertido sobre la banda de color).
function _pdocEncabezado() { return sanEnum(S.pdfEncabezado, PDF_ENCABEZADOS, 'auto'); }

function _buildDocHeader(theme, S, color, contacts, badgeLabel, badgeDate, showPlaceholder) {
  // Sobre el encabezado en banda, el monograma va blanco con letras del color:
  // del color de la banda no se vería.
  const enBanda = theme !== 'lateral' && _pdocEncabezado() === 'banda';
  const monoHTML = S.logo ? '' : _monoSVG(S.pdfMono, S.coName, enBanda ? '#ffffff' : color, enBanda ? color : '#ffffff');
  const logoHTML = S.logo
    ? `<img src="${safeImgSrc(S.logo)}" class="ph-logo" alt="Logo">`
    : monoHTML ? monoHTML : (showPlaceholder
      ? `<div style="width:60px;height:60px;background:#f8faf9;border:1px dashed #cbd5e1;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:8pt;color:#94a3b8">LOGO</div>`
      : ``);
  const contactsHTML = contacts.map(c => `<span class="ph-contact">${c}</span>`).join('');
  const nameStr = esc(S.coName);
  const subStr  = esc(S.coSubtitle || 'Poda en Altura y Extracción de Árboles');
  const numStr  = esc(S.quoteNumber || '—');

  if (theme === 'profesional') {
    const dateHTML = badgeDate ? `<div class="ph-badge-date" style="color:rgba(255,255,255,.65)">${badgeDate}</div>` : '';
    return `
    <div class="ph" style="border-bottom:1.5pt solid #d1d5db">
      ${logoHTML}
      <div class="ph-co">
        <div class="ph-name" style="color:${color}">${nameStr}</div>
        <div class="ph-sub">${subStr}</div>
        <div class="ph-contacts">${contactsHTML}</div>
      </div>
      <div class="ph-badge" style="background:${color};padding:8pt 10pt">
        <div class="ph-badge-lbl" style="color:rgba(255,255,255,.75)">${esc(badgeLabel)}</div>
        <div class="ph-badge-num" style="color:#fff">${numStr}</div>
        ${dateHTML}
      </div>
    </div>`;
  }

  if (theme === 'minimalista') {
    const dateHTML = badgeDate ? `<div class="ph-badge-date">${badgeDate}</div>` : '';
    return `
    <div class="ph" style="border-bottom:1pt solid #d1d5db">
      ${logoHTML}
      <div class="ph-co">
        <div class="ph-name" style="color:${color}">${nameStr}</div>
        <div class="ph-sub">${subStr}</div>
        <div class="ph-contacts">${contactsHTML}</div>
      </div>
      <div class="ph-badge" style="border-left:2pt solid ${color};padding-left:10pt">
        <div class="ph-badge-lbl">${esc(badgeLabel)}</div>
        <div class="ph-badge-num" style="color:${color}">${numStr}</div>
        ${dateHTML}
      </div>
    </div>`;
  }

  if (theme === 'lateral') {
    // Banda de color a la izquierda (look de estudio/consultora). Dentro de la
    // banda va el logo sobre un chip blanco (para que cualquier logo se lea
    // bien sobre el color) o, si no hay logo, la inicial del emisor en blanco.
    const dateHTML = badgeDate ? `<div class="ph-badge-date" style="color:rgba(255,255,255,.7)">${badgeDate}</div>` : '';
    const initial  = esc(((S.coName || 'P').trim().charAt(0) || 'P').toUpperCase());
    // Con monograma elegido, va en la banda invertido (forma blanca, letras del
    // color) en lugar de la inicial suelta.
    const bandMono = _monoSVG(S.pdfMono, S.coName, '#ffffff', color, 'ph-band-mono');
    const bandInner = S.logo
      ? `<img src="${safeImgSrc(S.logo)}" class="ph-band-logo" alt="Logo">`
      : (bandMono || `<span class="ph-band-initial">${initial}</span>`);
    return `
    <div class="ph">
      <div class="ph-band" style="background:${color}">${bandInner}</div>
      <div class="ph-co">
        <div class="ph-name" style="color:${color}">${nameStr}</div>
        <div class="ph-sub">${subStr}</div>
        <div class="ph-contacts">${contactsHTML}</div>
      </div>
      <div class="ph-badge" style="background:${color};padding:8pt 10pt">
        <div class="ph-badge-lbl" style="color:rgba(255,255,255,.75)">${esc(badgeLabel)}</div>
        <div class="ph-badge-num" style="color:#fff">${numStr}</div>
        ${dateHTML}
      </div>
    </div>`;
  }

  // Clásico, Cálido, Técnico y Elegante: misma estructura; el CSS de cada tema
  // (tipografía, paleta, reglas) se ocupa del resto.
  const dateHTML = badgeDate ? `<div class="ph-badge-date">${badgeDate}</div>` : '';
  return `
  <div class="ph" style="border-top:5px solid ${color}">
    ${logoHTML}
    <div class="ph-co">
      <div class="ph-name" style="color:${color}">${nameStr}</div>
      <div class="ph-sub">${subStr}</div>
      <div class="ph-contacts">${contactsHTML}</div>
    </div>
    <div class="ph-badge">
      <div class="ph-badge-lbl">${esc(badgeLabel)}</div>
      <div class="ph-badge-num" style="color:${color}">${numStr}</div>
      ${dateHTML}
    </div>
  </div>`;
}

// Construye la sección "Plan de Trabajo / Lo que incluye". Se muestra ANTES del
// precio para encuadrar el importe como valor (qué recibe el cliente) y no como
// un gasto. Bullets desde S.workPlan (uno por línea), o desde el override por
// presupuesto (S.workPlanCustom) si está activado. Devuelve '' si está
// desactivada (S.showWorkPlan === false) o si no hay líneas.
// Franja "Tiempo estimado de trabajo". Bloque opcional: si S.workDuration está
// vacío, devuelve '' y no se renderiza nada. Misma en los 3 modos (normal,
// estimativo, riesgo). Color neutro (no es un aviso como vigencia).
function _buildDurationHTML(){
  const d = (S.workDuration || '').trim();
  if (!d) return '';
  return `<div class="pdur">Tiempo estimado de trabajo: <span class="pdur-val">${esc(d)}</span></div>`;
}

// Bloque "Cómo pagar": los datos de cobro del titular (Empresa → Mi negocio).
// A diferencia de "Condiciones de pago" —que se escribe por presupuesto— esto
// es configuración fija del negocio, así que no se tipea en cada trabajo.
// Devuelve '' si no hay alias cargado: sin dato no hay sección, igual que
// duración o notas. `color` opcional pinta el borde en los modos estimativo y
// riesgo, que arman su HTML sin depender del tema.
function _buildPagoHTML(color){
  const alias = (S.coAliasPago || '').trim();
  const cbu   = (S.coCbu || '').trim();
  // Sin ninguna de las dos claves de transferencia no hay nada que mostrar:
  // titular y banco solos no sirven para pagar.
  if (!alias && !cbu) return '';
  // Orden: primero con qué se transfiere, después a quién. `mono` marca los
  // datos que el cliente tipea a mano en el homebanking.
  const filas = [
    { lbl:'Alias',   val:alias,                        mono:true },
    { lbl:'CBU / CVU', val:cbu,                        mono:true },
    { lbl:'Titular', val:(S.coAliasTitular||'').trim()           },
    { lbl:'Banco',   val:(S.coBanco||'').trim()                  },
  ].filter(f => f.val);
  const style = color ? ` style="color:${color};border-color:${color}"` : '';
  return `
    <div class="pcond">
      <div class="pcond-t"${style}>Cómo pagar</div>
      <div class="ppago-rows">
        ${filas.map(f => `<div class="ppago-row${f.mono ? ' ppago-alias' : ''}">
          <span class="ppago-lbl">${esc(f.lbl)}</span>
          <span class="ppago-val">${esc(f.val)}</span>
        </div>`).join('')}
      </div>
    </div>`;
}

// Bloque "Disposición de leña y residuos": lo acordado con el cliente sobre
// dónde queda el material del trabajo, con las fotos del lugar señalado.
// Puesto por escrito (y con foto) en el presupuesto, es lo que evita la
// discusión del día de la ejecución. Devuelve '' si el usuario lo apagó o si
// no hay ni texto ni fotos disponibles. `color` opcional pinta el título en
// los modos estimativo y riesgo, que arman su HTML sin el mapa de secciones.
//
// UBICACIÓN: va DESPUÉS del Registro Fotográfico, casi al pie del documento
// (antes de las firmas). Por eso no está en DOC_SECTIONS: las secciones
// reordenables son las del cuerpo y todas caen ARRIBA de las fotos, y acá el
// orden relativo a las fotos de los árboles es justamente el punto. La foto
// del rincón donde va la leña es el dato menos importante de la hoja: no
// puede meterse entre el precio y las condiciones, ni empujar para abajo las
// fotos de los árboles, que son las que el cliente mira.
function _buildDispoHTML(color){
  if (S.dispoEnDoc === false) return '';
  const nota = (S.dispoNota || '').trim();
  // Las fotos que no estén en este dispositivo (ref de un equipo sin restaurar)
  // se omiten: en el PDF del cliente una imagen rota queda peor que ninguna.
  const fotos = dispoPhotoRefs().map(r => safeImgSrc(getPhotoData(r))).filter(Boolean);
  if (!nota && !fotos.length) return '';
  const style = color ? ` style="color:${color}"` : '';
  return `
    <div class="pdispo">
      <div class="pdispo-t"${style}>Disposición de leña y residuos</div>
      ${nota ? `<div class="pdispo-txt">${esc(nota).replace(/\n/g,'<br>')}</div>` : ''}
      ${fotos.length ? `<div class="pdispo-grid">${fotos.map(src =>
        `<figure class="pdispo-photo"><img src="${src}" alt="Lugar acordado para la leña y los residuos"></figure>`
      ).join('')}</div>` : ''}
    </div>`;
}

// Línea "Actualiza el presupuesto N° X del DD/MM/AAAA", debajo de la fecha de
// emisión. Es la convención de las revisiones de obra (Rev. B "reemplaza a la
// anterior") y resuelve una duda concreta del cliente que recibe el segundo
// PDF: si son dos trabajos distintos o el mismo con otro precio. Se puede
// apagar por presupuesto (S.versionEnDoc) cuando conviene que no se note.
// Va en los 3 modos, junto a la fecha de emisión.
function _buildVersionNotaHTML(){
  if (S.versionEnDoc === false) return '';
  const num = (S.versionDeNum || '').trim();
  if (!num) return '';
  const f = S.versionDeFecha ? ` del ${fmtD(S.versionDeFecha)}` : '';
  return `<div class="pgrid-sub">Actualiza el presupuesto N° ${esc(num)}${f}</div>`;
}

function _buildWorkPlanHTML(color){
  if (S.showWorkPlan === false) return '';
  const useCustom = !!S.workPlanOverride;
  const titleSrc = useCustom ? (S.workPlanCustomTitle || S.workPlanTitle) : S.workPlanTitle;
  const bodySrc  = useCustom ? S.workPlanCustom : S.workPlan;
  const lines = (bodySrc || '').split('\n')
    .map(l => l.replace(/^[•\-–]\s*/, '').trim())
    .filter(Boolean);
  if (!lines.length) return '';
  const items = lines.map(l => `<li>${esc(l)}</li>`).join('');
  return `
    <div class="pplan">
      <div class="pplan-t">${esc(titleSrc || 'Plan de Trabajo')}</div>
      <div class="pplan-box" style="color:${color}">
        <ol class="pplan-list">${items}</ol>
      </div>
    </div>`;
}

// Parsea las líneas de "criterios de costeo" (S.docCriteria). Cada línea puede
// ser "Subtítulo | descripción" (dos partes) o solo texto. Devuelve [{s,p}]
// (s = subtítulo opcional, p = descripción). Se usa en el presupuesto normal
// (grilla Cómo Trabajamos) y en el estimativo (factores).
function parseCriteria(text){
  return (text||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
    const i = l.indexOf('|');
    return i >= 0 ? { s: l.slice(0,i).trim(), p: l.slice(i+1).trim() } : { s: '', p: l };
  });
}

// ─── Piezas comunes de los documentos ───
// Presupuesto, informe de riesgo, estimativo y recibo las tenían copiadas.

// Contactos del encabezado (teléfono, email, ciudad, CUIT).
function _docContactos() {
  const contacts = [];
  if(S.coWhatsapp) contacts.push(`${pdfIcon('phone')} ${esc(S.coWhatsapp)}`);
  if(S.coEmail)    contacts.push(`${pdfIcon('email')} ${esc(S.coEmail)}`);
  if(S.coCity)     contacts.push(`${pdfIcon('location')} ${esc(S.coCity)}`);
  if(S.coCuit)     contacts.push(`CUIT: ${esc(S.coCuit)}`);
  return contacts;
}

// Todo documento va dentro de una <table class="pdoc">: el <thead> lleva el
// encabezado (logo + emisor + número) y el navegador lo REPITE en cada hoja
// impresa —la técnica más confiable entre navegadores; position:fixed no se
// dibuja bien en muchos móviles—. El <tbody> lleva el resto.
function _docEnvoltura(theme, color, cabecera, cuerpo) {
  return `
    <table ${_pdocAttrs(theme, color)}>
      <thead>
        <tr><td>
          ${cabecera}
        </td></tr>
      </thead>
      <tbody>
        <tr><td>${cuerpo}</td></tr>
      </tbody>
    </table>`;
}

// Al armar el documento se recuerdan el cliente y las especies para el
// autocompletar, como hacía cada modo por su cuenta (el estimativo no lleva
// especies; el riesgo, solo las de sus ítems).
function _docRecordarAutocompletar() {
  if (S.clientName) saveClientToDB(S.clientName, S.clientContact, S.workAddress, S.workMapLink);
  if (S.isEstimative && !S.isRisk) return;
  (S.items||[]).forEach(it=>{ if(it.type==='tree'&&it.species) saveSpeciesToDB(it.species); });
  if (!S.isRisk && S.scenariosEnabled) {
    (S.itemsB||[]).forEach(it=>{ if(it.type==='tree'&&it.species) saveSpeciesToDB(it.species); });
  }
}

function buildDoc() {
  _docRecordarAutocompletar();
  if (S.isRisk)       { buildRiskDoc(); _docTranslucido(); return; }
  if (S.isEstimative) { buildEstDoc(); _docTranslucido(); return; }

  const color = safeColor(S.accentColor);
  const cur   = S.currency;

  const contacts = _docContactos();

  // Detalles (tabla) y Total son secciones separadas y reordenables. En modo
  // escenarios A/B cada opción lleva su total pegado a su tabla, así que el
  // bloque va combinado en "details" y la sección "total" queda vacía.
  let detailsH, totalH;
  if (S.scenariosEnabled) {
    detailsH =
      _buildSceneBlockHTML(S.items,  S.scenarioLabelA || 'Opción A', color, cur, true) +
      _buildSceneBlockHTML(S.itemsB, S.scenarioLabelB || 'Opción B', color, cur, true);
    totalH = '';
  } else {
    detailsH = _buildSceneTableHTML(S.items, '', color, cur);
    totalH   = _buildSceneTotalsHTML(S.items, '', color, cur, true);
  }


  const tl = (S.coTechNotes||'').split('\n').filter(l=>l.trim());
  const techH = tl.map(l=>`<li>${esc(l.replace(/^[•\-–]\s*/,''))}</li>`).join('');

  // ── Registro fotográfico ──────────────────────────────────────────
  // Recorre los ítems que tengan foto y arma una grilla al final del
  // documento. Cada foto se etiqueta con la especie (árbol) o la
  // descripción (servicio) del ítem al que pertenece. Si ningún ítem
  // tiene foto, no se renderiza nada (el documento queda igual que hoy).
  // Resolvemos cada foto a su dataURL (vía IndexedDB/caché o embebida). Las que
  // no estén disponibles localmente (ID de un equipo aún no restaurado) se
  // omiten: en un PDF para el cliente un placeholder roto quedaría peor.
  const fotosH = buildPhotoRegistroHTML(S.items);

  // La grilla se arma desde S.docCriteria (editable), no de texto fijo. Cada
  // línea puede ser "Subtítulo | descripción" o solo texto (ver parseCriteria).
  const critItems = parseCriteria(S.docCriteria).map(c =>
    `<div class="pcrit-item">${c.s ? `<span class="pcrit-s">${esc(c.s)}</span>` : ''}<span class="pcrit-p">${esc(c.p)}</span></div>`
  ).join('');
  const critH = (S.showCriteria && critItems) ? `
    <div class="pcrit">
      <div class="pcrit-t">${esc(S.docCriteriaTitle||'Cómo Trabajamos')}</div>
      <div class="pcrit-box">
        <div class="pcrit-intro">${esc(S.docCriteriaIntro||'Cada trabajo es evaluado en función de sus condiciones reales. El costo refleja la complejidad técnica de cada situación:')}</div>
        <div class="pcrit-grid">${critItems}</div>
      </div>
    </div>` : '';

  let sigH = '';
  if(S.showSigOwner||S.showSigClient){
    let sx = '';
    if(S.showSigOwner)  sx+=`<div class="psig-box"><div class="psig-lbl">Firma del Titular</div><div class="psig-name">${esc(S.coOwner||S.coName||'')}</div></div>`;
    if(S.showSigClient) sx+=`<div class="psig-box"><div class="psig-lbl">Conformidad del Cliente</div><div class="psig-name">${esc(S.clientName||'')}</div></div>`;
    sigH = `<div class="psigs">${sx}</div>`;
  }

  const obsH = S.observations ? `<div class="pobs">
      <div class="pobs-t">Observaciones</div>
      <div class="pobs-txt">${esc(S.observations).replace(/\n/g,'<br>')}</div>
    </div>` : '';
  const payH = S.paymentConditions ? `<div class="pcond">
      <div class="pcond-t">Condiciones de Pago</div>
      <div class="pcond-txt">${esc(S.paymentConditions).replace(/\n/g,'<br>')}</div>
    </div>` : '';
  const validH = S.showExpiry !== false ? `<div class="pvalid">
      <span>${pdfIcon('warning')} PRESUPUESTO CON ${S.validityDays} DÍAS DE VIGENCIA</span>
      <span class="pvalid-date">Vence el ${fmtD(S.dateExpiry)}</span>
    </div>` : '';
  const notesH = (S.showTechNotes && techH) ? `<div class="pnotes">
      <div class="pnotes-t">Notas Adicionales</div>
      <ul>${techH}</ul>
    </div>` : '';
  // Cuerpo del presupuesto en el ORDEN elegido por el usuario (Empresa →
  // Textos del PDF → "Orden de las secciones"). El encabezado/cliente van
  // arriba y fotos/firmas/pie quedan fijos al final.
  const _sectionMap = {
    duration:     _buildDurationHTML(),
    details:      detailsH,
    total:        totalH,
    plan:         _buildWorkPlanHTML(color),
    criteria:     critH,
    observations: obsH,
    payment:      payH,
    pago:         _buildPagoHTML(),
    validity:     validH,
    notes:        notesH,
  };
  // El documento de un trabajo sin presupuesto recorta este orden: nunca lleva
  // vigencia (no vence) y la colaboración además se queda solo con su detalle
  // (ver `doc.secciones` en TRABAJO_CFG). Sin override, sale el orden completo.
  let _orden = sanitizeSectionOrder(S.docSectionOrder);
  // Jardinería no lleva plan de trabajo ni "Cómo Trabajamos" (pedido del
  // usuario): son argumentario del trabajo en altura.
  if (esJardineria()) _orden = _orden.filter(id => id !== 'plan' && id !== 'criteria');
  if (_docTrabajo) {
    _orden = _orden.filter(id => id !== 'validity'
      && (!_docTrabajo.secciones || _docTrabajo.secciones.includes(id)));
  }
  const bodyOrderedH = _orden.map(id => _sectionMap[id] || '').join('\n\n');

  const theme = S.pdfTheme || 'clasico';
  const doc = document.getElementById('doc-a4'); if(!doc) return;
  doc.innerHTML = _docEnvoltura(theme, color, _buildDocHeader(theme, S, color, contacts, (_docTrabajo && _docTrabajo.badge) || 'Presupuesto N°', null, false), `

    <div class="ptitle-bar">
      <div class="ptitle" style="color:${color};border-color:${color}">${_docTituloHTML(false)}</div>
      <div class="pgrid">
        <div>
          <div class="pgrid-lbl">${esc((_docTrabajo && _docTrabajo.quien) || 'Cliente')}</div>
          <div class="pgrid-val">${esc(S.clientName||'—')}</div>
          ${S.clientContact?`<div class="pgrid-sub">${esc(S.clientContact)}</div>`:''}
        </div>
        <div class="pgrid-r">
          <div class="pgrid-lbl">Lugar del trabajo</div>
          <div class="pgrid-val">${esc(S.workAddress||'—')}</div>
          <div class="pgrid-sub">Fecha de emisión: ${fmtD(S.dateIssue)}</div>
          ${_buildVersionNotaHTML()}
        </div>
      </div>
    </div>

    ${bodyOrderedH}

    ${fotosH}

    ${_buildDispoHTML()}

    ${sigH}

    ${_pieDoc(color, `<div class="pfoot">
      <span class="pfoot-l">${esc(S.coFooter)}</span>
    </div>`)}

        `);
  _docTranslucido();
}

// ─── BUILD RISK DOC ──────────────────────────────────────────────────────────
function buildRiskDoc() {

  const color  = safeColor(S.accentColor);
  const cur    = S.currency;
  const rd     = S.riskData || {};
  const {subtotal, discAmt, total} = calcTotals();

  // ── Encabezado de contacto ──
  const contacts = _docContactos();

  // ── Nivel de riesgo calculado ──
  // riskEval decide la matriz: un informe anterior a la v243 ('v1') sale con
  // la suya y con su encabezado de siempre, para que no cambie lo entregado.
  const ev          = riskEval(rd);
  const isa         = ev.metodo === 'isa2';
  const riskLevel   = ev.nivel;
  const riskLabel   = riskLevel ? (RISK_LABELS.riskLevel[riskLevel] || riskLevel.toUpperCase()) : '—';
  const riskColor   = riskLevel ? (RISK_COLORS[riskLevel] || color) : '#94a3b8';
  const plazoTxt    = riskPlazoTxt(rd.plazo || '12');
  // Círculo SVG relleno con el color del nivel (reemplaza el emoji 🟢🟡🟠🔴).
  // Mantiene el código de color, que es información relevante en la
  // evaluación, pero con un acabado formal y nítido en el PDF.
  const dotSvg = c => `<svg class="pdf-ic-dot" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="${c}" stroke="rgba(0,0,0,.12)" stroke-width="1"/></svg>`;
  const riskIcon    = dotSvg(riskColor);

  // Secciones numeradas solo si salen (el alcance no existe en un informe v1).
  // Los bloques se arman en otro orden que el de la hoja, así que el número se
  // pone al final, recorriendo el documento ya armado (_numerar).
  const SEC_MARK = '\u0001SEC';
  const secT = t => `<div class="psec-t" style="color:${color};border-color:${color}">${SEC_MARK}. ${t}</div>`;
  const _numerar = html => { let n = 0; return html.split(SEC_MARK).reduce((acc, part, i) => i ? acc + (++n) + part : part, ''); };

  // ── Defectos (con altura, orientación y sus fotos) ──
  const defects = riskDefectList(S);
  const defectsHtml = defects.length ? defects.map((d, i) => {
    const extra = [];
    if (d.location) extra.push(esc(_riskOptLabel(RISK_DEFECT_LOC, d.location)));
    if (d.altura)   extra.push(`a ${esc(d.altura)} m`);
    if (d.orient)   extra.push(`orientación ${esc(d.orient)}`);
    const fotos = (Array.isArray(d.photos) ? d.photos : [])
      .map(ref => safeImgSrc(getPhotoData(ref))).filter(Boolean);
    return `
    <div class="prisk-defect">
      <div class="prisk-defect-header" style="color:${color}">
        ${i+1}. ${esc(_riskOptLabel(RISK_DEFECT_TYPES, d.type) || 'Sin tipo')}
        ${extra.length ? `<span class="prisk-defect-loc">· ${extra.join(' · ')}</span>` : ''}
      </div>
      ${d.desc ? `<div class="prisk-defect-desc">${esc(d.desc).replace(/\n/g,'<br>')}</div>` : ''}
      ${fotos.length ? `<div class="prisk-defect-photos">${fotos.map(src =>
        `<figure class="pphoto"><img src="${src}" alt="Defecto ${i+1}"></figure>`).join('')}</div>` : ''}
    </div>`;
  }).join('')
  : `<div class="prisk-none">No se registraron defectos estructurales.</div>`;

  // ── Fila de dato arbóreo ──
  const dataRow = (label, value, full) => value
    ? `<div class="prisk-data-row${full ? ' prisk-full' : ''}"><span class="prisk-data-lbl">${label}</span><span class="prisk-data-val">${esc(value).replace(/\n/g,'<br>')}</span></div>`
    : '';

  // ── Alcance de la inspección (solo ISA) ──
  const tecTxt = (Array.isArray(rd.tecnicas) ? rd.tecnicas : [])
    .map(k => _riskOptLabel(RISK_TECNICAS, k)).filter(Boolean).join(' · ');
  const alcanceH = isa ? `
    <div class="psec">
      ${secT('Alcance de la Inspección')}
      <div class="prisk-data-grid">
        ${dataRow('Fecha de inspección', fmtD(S.dateIssue))}
        ${dataRow('Nivel de evaluación', RISK_LABELS.nivel[rd.nivel] || '')}
        ${dataRow('Plazo que cubre la evaluación', plazoTxt)}
        ${dataRow('Técnicas usadas', tecTxt, true)}
        ${dataRow('Evaluador', S.coEvaluador || '', true)}
      </div>
    </div>` : '';

  // ── Evaluación ──
  const evalHint = isa
    ? { f:`Que el árbol o una parte falle en ${plazoTxt}, con el clima habitual de la zona`,
        i:'Que la falla alcance a personas o bienes, según cuánto se ocupa la zona de caída',
        c:'Gravedad del daño si la falla ocurriera' }
    : { f:'Posibilidad de que el árbol o parte de él falle',
        i:'Probabilidad de que la falla afecte a personas o bienes',
        c:'Gravedad del daño si la falla ocurriera' };
  const evalH = `
    <div class="psec">
      ${secT(isa ? 'Evaluación de Riesgo' : 'Evaluación de Riesgo (Método ISA Basic)')}
      ${isa ? `<div class="prisk-metodo">Basada en la metodología de evaluación de riesgo de la ISA (International Society of Arboriculture), <em>Best Management Practices: Tree Risk Assessment</em>, 2ª ed. El nivel resulta de combinar la probabilidad de falla con la de impacto, y ese resultado con las consecuencias.</div>` : ''}

      <div class="prisk-eval-grid">
        <div class="prisk-eval-cell">
          <div class="prisk-eval-label">Probabilidad de falla</div>
          <div class="prisk-eval-value" style="color:${color}">${esc(RISK_LABELS.failureProbability[rd.failureProbability]||rd.failureProbability||'—')}</div>
          <div class="prisk-eval-hint">${evalHint.f}</div>
        </div>
        <div class="prisk-eval-cell">
          <div class="prisk-eval-label">Probabilidad de impacto</div>
          <div class="prisk-eval-value" style="color:${color}">${esc(RISK_LABELS.impactProbability[rd.impactProbability]||rd.impactProbability||'—')}</div>
          <div class="prisk-eval-hint">${evalHint.i}</div>
        </div>
        <div class="prisk-eval-cell">
          <div class="prisk-eval-label">Consecuencias potenciales</div>
          <div class="prisk-eval-value" style="color:${color}">${esc(RISK_LABELS.consequences[rd.consequences]||rd.consequences||'—')}</div>
          <div class="prisk-eval-hint">${evalHint.c}</div>
        </div>
      </div>

      <!-- Resultado del nivel de riesgo -->
      <div class="prisk-result" style="border-color:${riskColor};background:${riskColor}12">
        <div class="prisk-result-icon">${riskIcon}</div>
        <div class="prisk-result-body">
          <div class="prisk-result-lbl">Nivel de Riesgo Resultante</div>
          <div class="prisk-result-level" style="color:${riskColor}">${riskLabel}</div>
          ${isa && ev.combinada ? `<div class="prisk-result-sub">Probabilidad de falla e impacto: <strong>${esc(RISK_LABELS.combinada[ev.combinada])}</strong></div>` : ''}
        </div>
      </div>
      ${isa && riskLevel ? `<div class="prisk-significa"><strong>Qué significa:</strong> ${esc(RISK_SIGNIFICA[riskLevel] || '')}</div>` : ''}
    </div>`;

  // ── Mitigación, riesgo residual y reinspección ──
  const resColor = ev.residual ? (RISK_COLORS[ev.residual] || color) : '';
  const pill = (lvl, c, lbl) => `<div class="prisk-res-pill" style="border-color:${c};background:${c}12">
      ${dotSvg(c)}<div><div class="prisk-result-lbl">${lbl}</div><div class="prisk-res-level" style="color:${c}">${RISK_LABELS.riskLevel[lvl] || ''}</div></div></div>`;
  const residualH = (isa && riskLevel && ev.residual) ? `
      <div class="prisk-res-row">
        ${pill(riskLevel, riskColor, 'Riesgo actual')}
        <span class="prisk-res-arrow" aria-hidden="true">→</span>
        ${pill(ev.residual, resColor, 'Riesgo residual, después del trabajo')}
      </div>` : '';
  const reinspH = (isa && rd.reinsp) ? `<div class="prisk-reinsp"><strong>Reinspección recomendada:</strong> en ${esc(riskPlazoTxt(rd.reinsp))}, o antes si hay un temporal fuerte, obras cerca de las raíces o cambios visibles en el árbol.</div>` : '';
  const mitigH = (rd.mitigationGoals || residualH || reinspH) ? `
    <div class="psec">
      ${secT(isa ? 'Mitigación y Riesgo Residual' : 'Objetivos de Mitigación')}
      ${rd.mitigationGoals ? `<div class="prisk-mitigation">${esc(rd.mitigationGoals).replace(/\n/g,'<br>')}</div>` : ''}
      ${residualH}
      ${reinspH}
    </div>` : '';

  // ── Limitaciones (solo ISA): las de esta inspección + el descargo general ──
  const limGen = (S.docRiskLimits || '').trim();
  const limH = (isa && (rd.limitaciones || limGen)) ? `
    <div class="prisk-limits">
      <div class="prisk-limits-t">Limitaciones</div>
      ${rd.limitaciones ? `<p class="prisk-limits-esp">${esc(rd.limitaciones).replace(/\n/g,'<br>')}</p>` : ''}
      ${limGen ? `<p>${esc(limGen).replace(/\n/g,'<br>')}</p>` : ''}
    </div>` : '';

  // ── Ítems del presupuesto ──
  let rows = ''; let n = 0;
  if (!S.items.length) {
    rows = `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:18px;font-style:italic">Sin ítems agregados</td></tr>`;
  } else {
    S.items.forEach(item => {
      if (item.type === 'tree') {
        n++;
        const p = _trabajoPrecioCellHTML(item, cur);
        rows += `<tr>
          <td class="td-n">${n}</td>
          <td class="td-sp" style="color:${color}">${esc(item.species||'Sin especificar')}</td>
          <td class="td-wk">${esc(item.desc||'').replace(/\n/g,'<br>')}</td>
          <td class="td-pr">${p}</td></tr>`;
      } else if (item.type === 'service') {
        n++;
        const qty      = parseInt(item.qty) || 1;
        const itTotal  = itemTotal(item);
        const hasPrice = item.price !== '' && item.price !== null;
        let pCell;
        if (!hasPrice) {
          pCell = '—';
        } else if (item.showQty && qty > 1) {
          pCell = `<span style="font-size:8pt;color:#64748b">${qty} × ${fmtMDoc(item.price,cur)}</span><br><strong>${fmtMDoc(itTotal,cur)}</strong>`;
        } else {
          pCell = fmtMDoc(itTotal, cur);
        }
        rows += `<tr>
          <td class="td-n">${n}</td>
          <td class="td-sp" style="color:${color}">Servicio</td>
          <td class="td-wk">${esc(item.desc||'').replace(/\n/g,'<br>')}</td>
          <td class="td-pr">${pCell}</td></tr>`;
      } else {
        rows += `<tr class="nrow"><td></td><td colspan="3">${esc(item.desc||'').replace(/\n/g,'<br>')}</td></tr>`;
      }
    });
  }

  const discLabel = S.docDiscountLabel || 'Descuento';
  const discH = S.discount > 0 ? `
    <div class="pdisc-row"><span>Subtotal:</span><span>${fmtMDoc(subtotal,cur)}</span></div>
    <div class="pdisc-row" style="color:#dc2626"><span>${esc(discLabel)} (${S.discount}%):</span><span>− ${fmtMDoc(discAmt,cur)}</span></div>
    ${S.docDiscountNote ? `<div class="pdisc-note">${esc(S.docDiscountNote)}</div>` : ''}` : '';

  let sigH = '';
  if (S.showSigOwner || S.showSigClient) {
    let sx = '';
    if (S.showSigOwner)  sx += `<div class="psig-box"><div class="psig-lbl">Firma del Titular</div><div class="psig-name">${esc(S.coOwner||S.coName||'')}</div></div>`;
    if (S.showSigClient) sx += `<div class="psig-box"><div class="psig-lbl">Conformidad del Cliente</div><div class="psig-name">${esc(S.clientName||'')}</div></div>`;
    sigH = `<div class="psigs">${sx}</div>`;
  }

  const tl = (S.coTechNotes||'').split('\n').filter(l=>l.trim());
  const techH = tl.map(l=>`<li>${esc(l.replace(/^[•\-–]\s*/,''))}</li>`).join('');

  // Registro fotográfico (los ítems del modo riesgo son los normales, S.items).
  const fotosH = buildPhotoRegistroHTML(S.items);

  const theme = S.pdfTheme || 'clasico';
  const doc = document.getElementById('doc-a4'); if (!doc) return;
  doc.innerHTML = _numerar(_docEnvoltura(theme, color, _buildDocHeader(theme, S, color, contacts, 'Informe / Presupuesto N°', `Fecha: ${fmtD(S.dateIssue)}`, true), `

    <!-- ══ TÍTULO Y CLIENTE ══ -->
    <div class="ptitle-bar">
      <div class="ptitle" style="color:${color};border-color:${color}">${esc(S.docTitleRisk||'Informe Técnico de Riesgo Arbóreo y Propuesta de Trabajo')}</div>
      <div class="pgrid">
        <div>
          <div class="pgrid-lbl">Cliente</div>
          <div class="pgrid-val">${esc(S.clientName||'—')}</div>
          ${S.clientContact ? `<div class="pgrid-sub">${esc(S.clientContact)}</div>` : ''}
        </div>
        <div class="pgrid-r">
          <div class="pgrid-lbl">Lugar del trabajo</div>
          <div class="pgrid-val">${esc(S.workAddress||'—')}</div>
          <div class="pgrid-sub">Fecha de emisión: ${fmtD(S.dateIssue)}</div>
          ${_buildVersionNotaHTML()}
        </div>
      </div>
    </div>

    ${_buildDurationHTML()}

    ${alcanceH}

    <!-- ══ ÁRBOL EVALUADO ══ -->
    <div class="psec">
      ${secT('Árbol Evaluado')}
      <div class="prisk-data-grid">
        ${dataRow('Especie', rd.species)}
        ${dataRow('Altura estimada', rd.height ? rd.height + ' m' : '')}
        ${dataRow('DAP (Diám. a 1,30 m)', rd.dap ? rd.dap + ' cm' : '')}
        ${dataRow('Ubicación en el predio', rd.location)}
        ${dataRow('Vitalidad', RISK_LABELS.vitalidad[rd.vitalidad] || '')}
        ${dataRow('Inclinación del árbol', RISK_LABELS.inclination[rd.inclination]||rd.inclination)}
      </div>
    </div>

    <!-- ══ DEFECTOS ══ -->
    <div class="psec">
      ${secT('Defectos Detectados')}
      <div class="prisk-defects-list">${defectsHtml}</div>
    </div>

    <!-- ══ SITIO Y BLANCOS ══ -->
    <div class="psec">
      ${secT(isa ? 'Sitio y Blancos' : 'Factores Ambientales y del Sitio')}
      <div class="prisk-data-grid">
        ${dataRow('Blancos en la zona de caída', rd.target, true)}
        ${dataRow('Exposición al viento', RISK_LABELS.windExposure[rd.windExposure]||rd.windExposure)}
        ${dataRow('Condición del suelo', RISK_LABELS.soilCondition[rd.soilCondition]||rd.soilCondition)}
        ${dataRow('Intervenciones previas', rd.priorInterventions)}
      </div>
    </div>

    ${evalH}

    ${mitigH}

    ${rd.riskObservations ? `
    <div class="pobs prisk-obs">
      <div class="pobs-t" style="color:${color};border-color:${color}">Observaciones del Informe</div>
      <div class="pobs-txt" style="border-color:${color}60">${esc(rd.riskObservations).replace(/\n/g,'<br>')}</div>
    </div>` : ''}

    ${limH}

    <!-- ══ SEPARADOR ══ -->
    <div class="prisk-section-divider" style="border-color:${color}">
      <span style="background:white;padding:0 12px;color:${color};font-weight:600;font-size:9pt;letter-spacing:.04em">PROPUESTA DE TRABAJO</span>
    </div>

    <!-- ══ TABLA DE ÍTEMS ══ -->
    <div class="psec">
      <div class="psec-t" style="color:${color};border-color:${color}">Detalle del Trabajo Propuesto</div>
      <table class="ptable">
        <thead><tr>
          <th style="width:18pt">#</th>
          <th style="width:100pt">Especie/s</th>
          <th>Trabajo a realizar</th>
          <th class="thr">Valor</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <!-- ══ TOTALES ══ -->
    <div class="ptotals">
      ${discH}
      <div class="ptotal-box" style="color:${color};border-color:${color};background:${color}12">
        <div class="ptotal-lbl" style="color:${color}">Total del trabajo</div>
        <div class="ptotal-amt" style="color:${color}">${fmtMDoc(total,cur)}</div>
      </div>
    </div>

    ${S.observations ? `<div class="pobs">
      <div class="pobs-t" style="color:${color};border-color:${color}">Observaciones</div>
      <div class="pobs-txt" style="border-color:${color}60">${esc(S.observations).replace(/\n/g,'<br>')}</div>
    </div>` : ''}

    ${S.paymentConditions ? `<div class="pcond">
      <div class="pcond-t" style="color:${color};border-color:${color}">Condiciones de Pago</div>
      <div class="pcond-txt">${esc(S.paymentConditions).replace(/\n/g,'<br>')}</div>
    </div>` : ''}

    ${_buildPagoHTML(color)}

    ${S.showExpiry !== false ? `<div class="pvalid">
      <span>${pdfIcon('warning')} PRESUPUESTO CON ${S.validityDays} DÍAS DE VIGENCIA</span>
      <span class="pvalid-date">Vence el ${fmtD(S.dateExpiry)}</span>
    </div>` : ''}

    ${S.showTechNotes && techH ? `<div class="pnotes">
      <div class="pnotes-t" style="color:${color};border-color:${color}">Notas Adicionales</div>
      <ul>${techH}</ul>
    </div>` : ''}

    ${fotosH}

    ${_buildDispoHTML(color)}

    ${sigH}

    ${_pieDoc(color, `<div class="pfoot" style="border-color:${color}30">
      <span class="pfoot-l" style="color:${color}">${esc(S.coFooter)}</span>
      <span class="pfoot-r">${esc(S.quoteNumber||'')} · ${fmtD(S.dateIssue)} · Informe de Riesgo</span>
    </div>`, `${S.quoteNumber||''} · ${fmtD(S.dateIssue)} · Informe de Riesgo`)}

        `));
}

// ─── BUILD EST DOC ────────────────────────────────────────────────────────────
function buildEstDoc() {

  const color = safeColor(S.accentColor);
  const cur   = S.currency;

  const workItems    = (S.estItems||[]).filter(i=>i.type==='work');
  const serviceItems = (S.estItems||[]).filter(i=>i.type==='service');
  const noteItems    = (S.estItems||[]).filter(i=>i.type==='note');
  const allItems     = S.estItems||[];

  const _estT = calcEstTotals(allItems);
  const estSubtotal = _estT.work;
  const svcSubtotal = _estT.svc;
  const grandTotal  = _estT.total;

  const contacts = _docContactos();

  let workRows = ''; let workN = 0;
  allItems.forEach(item => {
    if (item.type === 'work') {
      workN++;
      const hasPrice = item.price !== '' && item.price !== null && item.price !== undefined && item.price !== 0;
      workRows += `
        <div class="pest-item">
          <div class="pest-item-num" style="color:${color}">${workN}. Trabajo Estimado</div>
          <div class="pest-item-desc">${esc(item.desc||'Sin descripción').replace(/\n/g,'<br>')}</div>
          ${hasPrice ? `<div class="pest-item-price" style="color:${color}">Valor estimado: ${fmtMDoc(item.price,cur)}</div>` : ''}
        </div>`;
    } else if (item.type === 'note') {
      workRows += `
        <div class="pest-item" style="font-style:italic;color:#64748b;font-size:9pt;padding:6px 0;border-bottom:.5pt solid #f1f5f4">
          ${esc(item.desc||'').replace(/\n/g,'<br>')}
        </div>`;
    }
  });
  if (!workRows && !serviceItems.length) workRows = `<div style="padding:14px 0;color:#94a3b8;font-style:italic;font-size:9.5pt">Sin ítems agregados.</div>`;

  let svcRows = '';
  serviceItems.forEach(item => {
    const qty      = parseInt(item.qty) || 1;
    const total    = itemTotal(item);
    const hasPrice = item.price !== '' && item.price !== null && item.price !== undefined;
    let priceHtml;
    if(!hasPrice){
      priceHtml = '—';
    } else if(item.showQty && qty > 1){
      priceHtml = `<span style="font-size:8pt;color:#64748b;display:block">${qty} × ${fmtMDoc(item.price,cur)}</span><strong>${fmtMDoc(total,cur)}</strong>`;
    } else {
      priceHtml = fmtMDoc(total, cur);
    }
    svcRows += `
      <div class="pest-svc-row">
        <span class="pest-svc-desc">${esc(item.desc||'Servicio sin descripción')}</span>
        <span class="pest-svc-price" style="color:${color};text-align:right">${priceHtml}</span>
      </div>`;
  });

  let totalsHtml = '';
  if (grandTotal > 0) {
    const showBreakdown = workItems.length > 0 && serviceItems.length > 0;
    totalsHtml = `<div class="ptotals">`;
    if (showBreakdown) {
      totalsHtml += `
        <div class="pdisc-row"><span>Trabajos estimados:</span><span>${fmtMDoc(estSubtotal,cur)}</span></div>
        <div class="pdisc-row"><span>Servicios / costos fijos:</span><span>${fmtMDoc(svcSubtotal,cur)}</span></div>`;
    }
    totalsHtml += `
      <div class="ptotal-box" style="color:${color};border-color:${color};background:${color}12">
        <div class="ptotal-lbl" style="color:${color}">Total${workItems.length>0?' (Estimado)':' Confirmado'}</div>
        <div class="ptotal-amt" style="color:${color}">${fmtMDoc(grandTotal,cur)}</div>
      </div>
    </div>`;
  }

  const tl = (S.coTechNotes||'').split('\n').filter(l=>l.trim());
  const techH = tl.map(l=>`<li>${esc(l.replace(/^[•\-–]\s*/,''))}</li>`).join('');

  // Registro fotográfico de los ítems estimativos (trabajos y servicios).
  const fotosH = buildPhotoRegistroHTML(S.estItems);

  const theme = S.pdfTheme || 'clasico';
  const doc = document.getElementById('doc-a4'); if (!doc) return;
  doc.innerHTML = _docEnvoltura(theme, color, _buildDocHeader(theme, S, color, contacts, 'Presupuesto Estimativo N°', `Fecha: ${fmtD(S.dateIssue)}`, true), `

    <div class="pest-header-bar" style="color:${color};border-color:${color}">
      <span class="pest-header-icon">${pdfIcon('camera')}</span>
      <div>
        <div class="pest-header-lbl" style="color:${color}">${esc(S.docEstBanner||'Presupuesto Estimativo — Basado en fotos y/o videos')}</div>
        <div class="pest-header-sub">Para: ${esc(S.clientName||'—')}${S.workAddress?' · '+esc(S.workAddress):''}</div>
      </div>
    </div>

    <div class="ptitle-bar">
      <div class="ptitle" style="color:${color};border-color:${color}">${_docTituloHTML(true)}</div>
      <div class="pgrid">
        <div>
          <div class="pgrid-lbl">Cliente</div>
          <div class="pgrid-val">${esc(S.clientName||'—')}</div>
          ${S.clientContact?`<div class="pgrid-sub">${esc(S.clientContact)}</div>`:''}
        </div>
        <div class="pgrid-r">
          <div class="pgrid-lbl">Lugar del trabajo</div>
          <div class="pgrid-val">${esc(S.workAddress||'—')}</div>
          <div class="pgrid-sub">Fecha de emisión: ${fmtD(S.dateIssue)}</div>
          ${_buildVersionNotaHTML()}
        </div>
      </div>
    </div>

    ${_buildDurationHTML()}

    ${(workItems.length > 0 || noteItems.length > 0) ? `
    <div class="psec">
      <div class="psec-t" style="color:${color};border-color:${color}">Trabajos Estimados</div>
      ${workRows}
    </div>` : ''}

    ${serviceItems.length > 0 ? `
    <div class="pest-services-section">
      <div class="pest-services-t">Servicios / Costos Fijos Confirmados</div>
      ${svcRows}
      ${svcSubtotal > 0 && workItems.length > 0 ? `<div style="display:flex;justify-content:flex-end;padding-top:5px;font-size:8.5pt;color:#64748b">Subtotal servicios: <strong style="margin-left:8px;color:#374151">${fmtMDoc(svcSubtotal,cur)}</strong></div>` : ''}
    </div>` : ''}

    ${totalsHtml}

    ${esJardineria() ? '' : _buildWorkPlanHTML(color)}

    <div class="pest-disclaimer">
      <div class="pest-disclaimer-title">Importante</div>
      ${workItems.length > 0
        ? esc(S.docDisclaimer||'Este presupuesto es estimativo y se basa en las fotos y/o videos enviados. El valor final puede ajustarse luego de una inspección presencial, ya que hay aspectos que solo pueden evaluarse en el lugar.')
        : 'Los costos informados corresponden a servicios confirmados con proveedores.'}
      ${serviceItems.length > 0 && workItems.length > 0
        ? ' ' + esc(S.docDisclaimerSvc||'Los costos de servicios adicionales (camión, volquetes, etc.) son valores consultados con los proveedores al momento de la emisión de este presupuesto.')
        : ''}
    </div>

    ${S.estObservations ? `
    <div class="pobs">
      <div class="pobs-t" style="color:${color};border-color:${color}">Observaciones</div>
      <div class="pobs-txt" style="border-color:${color}60">${esc(S.estObservations).replace(/\n/g,'<br>')}</div>
    </div>` : ''}

    ${workItems.length > 0 && !esJardineria() ? `
    <div class="pest-factors">
      <div class="pest-factors-t" style="color:${color};border-color:${color}">Para estimar el costo se consideran</div>
      <div class="pest-factors-grid">
        ${parseCriteria(S.docCriteria).map(c=>`<div class="pest-factor" style="color:${color}">${c.s?`<strong>${esc(c.s)}:</strong> `:''}${esc(c.p)}</div>`).join('')}
      </div>
    </div>` : ''}

    ${S.showTechNotes&&techH?`<div class="pnotes">
      <div class="pnotes-t" style="color:${color};border-color:${color}">Notas Adicionales</div>
      <ul>${techH}</ul>
    </div>`:''}

    ${fotosH}

    ${_buildPagoHTML(color)}

    ${_buildDispoHTML(color)}

    <div class="pest-greeting">
      ${esc(S.docGreeting||'Saludos,')}
      <span class="pest-greeting-name">${esc(S.coOwner||S.coName)}</span>
    </div>

    ${_pieDoc(color, `<div class="pfoot" style="border-color:${color}30">
      <span class="pfoot-l" style="color:${color}">${esc(S.coFooter)}</span>
      <span class="pfoot-r">${esc(S.quoteNumber||'')} · ${fmtD(S.dateIssue)} · Estimativo</span>
    </div>`, `${S.quoteNumber||''} · ${fmtD(S.dateIssue)} · Estimativo`)}

        `);
}

// ─── RECIBO DE PAGO (desde la pestaña Facturación) ───────────────────────────
// Comprobante NO fiscal del pago recibido: la factura oficial se emite por
// ARCA; esto es la constancia que se le entrega al cliente. Usa la misma
// maquinaria visual del presupuesto (tema pdoc, header repetible, caja de
// total), así el recibo sale con el mismo membrete y diseño elegido.
// r = { fecha, monto, cliente, concepto, trabajos[], quoteNumber }
// El número de recibo se muestra vía S.quoteNumber (el llamador lo setea
// temporalmente antes de llamar, con backup/restore de S — ver factRecibo).
function buildReciboDoc(r) {
  const color = safeColor(S.accentColor);
  const contacts = _docContactos();

  // Monto: con centavos solo si los hay (los recibos suelen ser redondos)
  const tieneCentavos = moneyToCents(r.monto) % 100 !== 0;
  const montoStr = tieneCentavos ? fmtARSd(r.monto) : fmtARS(r.monto);
  const letras = (typeof montoEnLetras === 'function') ? montoEnLetras(r.monto) : '';

  const trabajosH = (r.trabajos && r.trabajos.length) ? `
    <div class="pnotes">
      <div class="pnotes-t">Detalle del trabajo realizado</div>
      <ul>${r.trabajos.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>
    </div>` : '';

  const theme = S.pdfTheme || 'clasico';
  const doc = document.getElementById('doc-a4'); if(!doc) return;
  doc.innerHTML = _docEnvoltura(theme, color, _buildDocHeader(theme, S, color, contacts, 'Recibo N°', null, false), `

    <div class="ptitle-bar">
      <div class="ptitle" style="color:${color};border-color:${color}">Recibo de Pago</div>
      <div class="pgrid">
        <div>
          <div class="pgrid-lbl">Recibí de</div>
          <div class="pgrid-val">${esc(r.cliente||'—')}</div>
          ${r.quoteNumber?`<div class="pgrid-sub">Presupuesto ${esc(r.quoteNumber)}</div>`:''}
        </div>
        <div class="pgrid-r">
          <div class="pgrid-lbl">Lugar y fecha</div>
          <div class="pgrid-val">${esc(S.coCity||'')}${S.coCity?', ':''}${fmtD(r.fecha)}</div>
        </div>
      </div>
    </div>

    <div class="pobs">
      <div class="pobs-t">Concepto</div>
      <div class="pobs-txt">Recibí de <strong>${esc(r.cliente||'—')}</strong> la suma de ${letras?`pesos <strong>${esc(letras)}</strong> `:''}(<strong>${montoStr}</strong>) en concepto de: ${esc(r.concepto||'—')}.</div>
    </div>

    ${trabajosH}

    <div class="ptotals">
      <div class="ptotal-box" style="color:${color};border-color:${color};background:${color}12">
        <div class="ptotal-lbl" style="color:${color}">Total recibido</div>
        <div class="ptotal-amt" style="color:${color}">${montoStr}</div>
      </div>
    </div>

    <div class="psigs">
      <div class="psig-box" style="max-width:45%"><div class="psig-lbl">Firma y aclaración</div><div class="psig-name">${esc(S.coOwner||S.coName||'')}</div></div>
    </div>

    <div class="precibo-legal">Documento no fiscal — comprobante de pago. No reemplaza a la factura.</div>

    ${_pieDoc(color, `<div class="pfoot">
      <span class="pfoot-l">${esc(S.coFooter)}</span>
    </div>`)}

        `);
  _docTranslucido();
}
