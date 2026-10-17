// test/estilo-propio.test.cjs — Estilo propio: que dos colegas no manden el
// mismo PDF (v244).
//
// Pedido del dueño: le pasó la app a colegas de su zona que le cotizan a los
// mismos clientes, y con todo de fábrica los PDF salían iguales salvo el nombre
// de arriba (mismo diseño, mismo color y los mismos párrafos palabra por
// palabra). Lo que se vigila acá:
//   A. Primera apertura: la máquina sortea diseño + textos sola, nunca deja el
//      de fábrica, y avisa que todo se puede cambiar.
//   B. La máquina: solo valores válidos, nunca el juego 'original'.
//   C. Nunca pisa un texto que el usuario escribió.
//   D. El juego 'original' (los textos de antes) se puede elegir a mano.
//   E. DEF arranca con 'directo'; 'original' conserva los textos de la v243.
//   F. Documento: monograma con las iniciales y color de detalle, en los modos.
//   G. Sanitización y config global.
//   H. A quien ya tenía la app con el diseño de fábrica se le OFRECE una sola
//      vez, sin cambiarle nada; a quien ya personalizó, nada.
//   I. "Dejar como estaba" vuelve atrás lo que hizo la máquina.
//
// Uso:  node test/estilo-propio.test.cjs

const path = require('node:path');

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  console.error('Falta puppeteer-core. Corré .claude/hooks/session-start.sh');
  process.exit(2);
}
const EXEC = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_HEADLESS_SHELL;
if (!EXEC) { console.error('Falta $PUPPETEER_EXECUTABLE_PATH'); process.exit(2); }

const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');

let allOk = true;
const check = (name, ok, extra) => {
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const espera = ms => new Promise(r => setTimeout(r, ms));

// Abre la app con el localStorage que deje `preparar` (corre en la página,
// después de un localStorage.clear()) y recarga, así el arranque lo ve.
async function abrirCon(browser, preparar) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Esperar a que el PRIMER arranque termine: si se borra el localStorage
  // mientras corre, el arranque vuelve a marcar la bienvenida como vista y la
  // recarga ya no es una "primera apertura".
  await page.waitForFunction(() => { try { return !!localStorage.getItem('pq_onboarded'); } catch (_) { return false; } }, { timeout: 15000 });
  await espera(1000);
  await page.evaluate(preparar || (() => { localStorage.clear(); }));
  // Al recargar, la app guarda su estado en memoria al salir (pagehide): eso
  // pisaría lo preparado. Se repone después, en 'unload', que corre último.
  await page.evaluate(() => {
    const foto = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); foto[k] = localStorage.getItem(k); }
    window.addEventListener('unload', () => {
      localStorage.clear();
      Object.keys(foto).forEach(k => localStorage.setItem(k, foto[k]));
    });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await espera(1500);
  return page;
}
const toastsTxt = page => page.evaluate(() =>
  [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent).join(' | '));

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
  try {
    // ── A. Primera apertura ────────────────────────────────────────────────
    {
      const page = await abrirCon(browser);
      const r = await page.evaluate(() => ({
        fab: estiloEsDeFabrica(),
        mono: S.pdfMono,
        juego: textosJuegoActual(),
        oferta: localStorage.getItem(LS.ESTILO_OFERTA),
        bienvenida: !!document.querySelector('#moverlay.open'),
        guardado: JSON.parse(localStorage.getItem(LS.STATE) || '{}').pdfMono,
        uiTitulo: document.getElementById('doc-title').value === S.docTitle,
      }));
      check('A1 Primera apertura: la máquina deja un diseño que NO es el de fábrica', !r.fab && r.mono !== 'ninguno', JSON.stringify(r));
      check('A2 Primera apertura: textos de un juego nuevo (nunca el original)', ['directo','tecnico','cercano'].includes(r.juego), r.juego);
      check('A3 Primera apertura: queda guardado y en los campos de Textos', r.guardado === r.mono && r.uiTitulo);
      check('A4 Primera apertura: la bienvenida sigue saliendo', r.bienvenida);
      check('A5 Primera apertura: no se ofrece después lo que ya se hizo', r.oferta === '1');
      // El aviso espera a que se cierre la bienvenida (colaAviso).
      const antes = await toastsTxt(page);
      await page.evaluate(() => closeModal());
      await espera(1500);
      const despues = await toastsTxt(page);
      check('A6 El aviso "todo se puede cambiar" sale DESPUÉS de la bienvenida',
        !/estilo propio/.test(antes) && /estilo propio/.test(despues), despues);
      await page.close();
    }

    const page = await abrirCon(browser, () => {
      localStorage.clear();
      localStorage.setItem('pq_onboarded', '1');
      localStorage.setItem('pq_estilo_oferta', '1');
    });

    // ── B. La máquina ──────────────────────────────────────────────────────
    {
      const r = await page.evaluate(() => {
        const temas = new Set(), juegos = new Set(), monos = new Set();
        let malos = [];
        for (let i = 0; i < 400; i++) {
          const x = estiloSortear(true);
          temas.add(x.pdfTheme); juegos.add(x.juego); monos.add(x.pdfMono);
          if (!PDF_THEMES.includes(x.pdfTheme) || !PDF_FONTS.includes(x.pdfFont) || !PDF_MONOS.includes(x.pdfMono)
              || safeColor(x.accentColor) !== x.accentColor || sanColor2(x.accentColor2) !== x.accentColor2
              || x.juego === 'original' || x.pdfMono === 'ninguno' || estiloEsDeFabrica(x)) malos.push(x);
        }
        return { temas: temas.size, juegos: [...juegos].sort(), monos: monos.size, malos: malos.length, sinTextos: 'juego' in estiloSortear(false) };
      });
      check('B1 Sorteos: solo valores válidos, nunca de fábrica ni el juego original', r.malos === 0, JSON.stringify(r));
      check('B2 Sorteos: salen los 7 diseños y las 5 formas de monograma', r.temas === 7 && r.monos === 5);
      check('B3 Sorteos: los tres juegos nuevos', JSON.stringify(r.juegos) === '["cercano","directo","tecnico"]');
      check('B4 Sin textos, la máquina no toca los textos', !r.sinTextos);
    }

    // ── C. Textos propios ──────────────────────────────────────────────────
    {
      const r = await page.evaluate(() => {
        S.docGreeting = 'Un abrazo, Julio';
        S.docTitle = TEXTOS_JUEGOS.original.t.docTitle;
        S.workPlanTitle = 'Lo que hacemos nosotros';
        _textosAlUI();
        for (let i = 0; i < 20; i++) _estiloAplicar(estiloSortear(true));
        syncFromUI();
        return { g: S.docGreeting, t: S.docTitle, w: S.workPlanTitle, fab: textoEsDeFabrica('docTitle', S.docTitle) };
      });
      check('C1 La máquina no pisa los textos que escribió el usuario', r.g === 'Un abrazo, Julio' && r.w === 'Lo que hacemos nosotros', JSON.stringify(r));
      check('C2 La máquina sí reemplaza los que siguen de fábrica (y no por el original)',
        r.t !== 'Presupuesto de Servicio de Poda en Altura y Extracción de Árboles' && r.fab, r.t);
    }

    // ── D. Original a mano ─────────────────────────────────────────────────
    {
      const r = await page.evaluate(async () => {
        TEXTOS_CAMPOS.forEach(c => { S[c] = TEXTOS_JUEGOS.directo.t[c]; });
        _textosAlUI(); textosJuegosSync();
        const chips = [...document.querySelectorAll('#textos-juegos [data-juego]')].map(b => b.dataset.juego);
        await elegirJuegoTextos('original');
        syncFromUI();
        return { chips, juego: textosJuegoActual(), ui: document.getElementById('doc-title').value, greet: S.docGreeting };
      });
      check('D1 Los cuatro juegos se ofrecen en Textos del PDF, el original último', JSON.stringify(r.chips) === '["directo","tecnico","cercano","original"]', JSON.stringify(r.chips));
      check('D2 Elegido a mano, el original queda aplicado (y sobrevive a syncFromUI)',
        r.juego === 'original' && r.ui === 'Presupuesto de Servicio de Poda en Altura y Extracción de Árboles' && r.greet === 'Saludos,', JSON.stringify(r));
      // Con textos propios, pide confirmación y no cambia si se cancela.
      const r2 = await page.evaluate(async () => {
        S.docGreeting = 'Un abrazo'; _textosAlUI();
        const p = elegirJuegoTextos('cercano');
        await new Promise(res => setTimeout(res, 100));
        const abierto = document.getElementById('confirm-overlay').classList.contains('open');
        document.getElementById('confirm-cancel').click();
        await p;
        return { abierto, greet: S.docGreeting };
      });
      check('D3 Con textos propios, pide confirmación y cancelar no cambia nada', r2.abierto && r2.greet === 'Un abrazo', JSON.stringify(r2));
    }

    // ── E. Defaults ────────────────────────────────────────────────────────
    {
      const r = await page.evaluate(() => ({
        def: TEXTOS_CAMPOS.every(c => DEF[c] === TEXTOS_JUEGOS.directo.t[c]),
        orig: TEXTOS_JUEGOS.original.t.docCriteriaTitle === 'Cómo Trabajamos' && TEXTOS_JUEGOS.original.t.workPlanTitle === 'Plan de Trabajo',
        distintos: TEXTOS_CAMPOS.every(c => new Set(Object.keys(TEXTOS_JUEGOS).map(k => TEXTOS_JUEGOS[k].t[c])).size === 4),
        mig: migrateState({ docCriteria: 'La altura del árbol y el acceso al sitio.\nEl volumen de material a extraer: ramas, troncos y restos vegetales.\nLa proximidad a estructuras sensibles: edificaciones, tendido eléctrico u otras instalaciones.\nLa especie, el estado fitosanitario y la complejidad estructural del árbol.' }).docCriteria === TEXTOS_JUEGOS.original.t.docCriteria,
      }));
      check('E1 DEF arranca con el juego Directo', r.def);
      check('E2 El juego Original conserva los textos de antes', r.orig);
      check('E3 Los cuatro juegos son distintos en cada texto', r.distintos);
      check('E4 La migración de criterios viejísimos va al Original (su época)', r.mig);
    }

    // ── F. Documento ───────────────────────────────────────────────────────
    {
      const r = await page.evaluate(() => {
        const doc = () => document.getElementById('doc-a4');
        S.isEstimative = false; S.isRisk = false;
        S.coName = 'Arbolado Norte'; S.logo = ''; S.pdfTheme = 'clasico';
        S.pdfMono = 'escudo'; S.accentColor = '#1e3a5f'; S.accentColor2 = '#b08d3c';
        // Elementos en "Según diseño": la primera apertura pudo sortear, p. ej., un
        // encabezado en banda, que saca el filete a propósito.
        S.pdfEncabezado = 'auto'; S.pdfTitulos = 'auto'; S.pdfTabla = 'auto'; S.pdfTotal = 'auto'; S.pdfPie = 'auto'; S.pdfFondo = 'auto'; S.pdfFont = 'auto';
        S.items = [{ id: 1, type: 'tree', species: 'Fresno', price: '100000', qty: 1 }];
        noSync = true; restoreUI(); noSync = false;
        buildDoc();
        const mono = doc().querySelector('svg.ph-mono');
        const tabla = doc().querySelector('table.pdoc');
        const out = {
          mono: !!mono, ini: mono ? mono.textContent : '',
          det: tabla.classList.contains('pdoc-det'), detVar: tabla.style.getPropertyValue('--pdoc-det'),
          borde: getComputedStyle(doc().querySelector('.ph')).borderTopColor,
        };
        S.accentColor2 = ''; buildDoc();
        out.sinDet = !doc().querySelector('table.pdoc').classList.contains('pdoc-det');
        S.accentColor2 = '#1e3a5f'; buildDoc();
        out.igualNoDet = !doc().querySelector('table.pdoc').classList.contains('pdoc-det');
        S.pdfTheme = 'lateral'; buildDoc();
        out.banda = !!doc().querySelector('.ph-band svg.ph-band-mono') && !doc().querySelector('.ph-band-initial');
        S.pdfTheme = 'clasico'; S.logo = 'data:image/png;base64,iVBORw0KGgo='; buildDoc();
        out.conLogo = !doc().querySelector('svg.ph-mono') && !!doc().querySelector('img.ph-logo');
        S.logo = ''; S.pdfMono = 'ninguno'; buildDoc();
        out.sinMono = !doc().querySelector('svg.ph-mono');
        S.pdfMono = 'circulo'; S.coName = '<img src=x onerror=alert(1)>'; buildDoc();
        out.xss = !doc().querySelector('svg.ph-mono img') && !doc().querySelector('img[src="x"]');
        S.coName = 'Arbolado Norte'; S.accentColor2 = '#b08d3c';
        S.isEstimative = true; buildDoc();
        out.est = doc().querySelector('table.pdoc').classList.contains('pdoc-det') && !!doc().querySelector('svg.ph-mono');
        S.isEstimative = false; S.isRisk = true; buildDoc();
        out.riesgo = doc().querySelector('table.pdoc').classList.contains('pdoc-det') && !!doc().querySelector('svg.ph-mono');
        S.isRisk = false;
        return out;
      });
      check('F1 Monograma con las iniciales en el encabezado', r.mono && r.ini === 'AN', JSON.stringify(r));
      check('F2 Color de detalle: clase y variable en el documento, y pinta el filete', r.det && r.detVar === '#b08d3c' && r.borde === 'rgb(176, 141, 60)', r.borde);
      check('F3 Sin color de detalle (o igual al principal) el documento queda como antes', r.sinDet && r.igualNoDet);
      check('F4 Tema Lateral: el monograma va en la banda en lugar de la inicial', r.banda);
      check('F5 Con logo manda el logo; sin forma elegida no hay monograma', r.conLogo && r.sinMono);
      check('F6 El nombre del negocio se escapa dentro del monograma', r.xss);
      check('F7 Estimativo y riesgo también llevan monograma y detalle', r.est && r.riesgo);
    }

    // ── G. Sanitización y config global ───────────────────────────────────
    {
      const r = await page.evaluate(() => {
        const s = sanitizeStateObj({ pdfMono: '"><script>', accentColor2: 'red;background:url(x)' });
        const ok = sanitizeStateObj({ pdfMono: 'hoja', accentColor2: '#ABCDEF' });
        S.pdfMono = 'sello'; S.accentColor2 = '#c2410c';
        const t = {}; Object.assign(t, S);
        assignSnapshot(t, { pdfMono: 'ninguno', accentColor2: '' });
        return { malo: [s.pdfMono, s.accentColor2], bueno: [ok.pdfMono, ok.accentColor2],
          cfg: CFG_GLOBAL_FIELDS.includes('pdfMono') && CFG_GLOBAL_FIELDS.includes('accentColor2'),
          snap: [t.pdfMono, t.accentColor2] };
      });
      check('G1 Valores basura de un backup caen a "sin monograma" y "sin detalle"', r.malo[0] === 'ninguno' && r.malo[1] === '', JSON.stringify(r.malo));
      check('G2 Valores válidos pasan', r.bueno[0] === 'hoja' && r.bueno[1] === '#ABCDEF');
      check('G3 Son config del negocio: abrir un presupuesto viejo no los pisa', r.cfg && r.snap[0] === 'sello' && r.snap[1] === '#c2410c', JSON.stringify(r.snap));
    }

    // ── I. Dejar como estaba ───────────────────────────────────────────────
    {
      const r = await page.evaluate(async () => {
        S.pdfTheme = 'elegante'; S.accentColor = '#3b0764'; S.accentColor2 = ''; S.pdfFont = 'inter'; S.pdfMono = 'rombo';
        S.pdfEncabezado = 'centrado'; S.pdfTitulos = 'auto'; S.pdfTabla = 'grilla'; S.pdfTotal = 'auto'; S.pdfPie = 'auto';
        estiloUISync(true);
        estiloAbrir({ tirar: true });
        const abierto = document.getElementById('estilo-overlay').classList.contains('open');
        await new Promise(res => setTimeout(res, 2600));
        const listos = document.querySelectorAll('#estilo-reels .estilo-reel.listo').length;
        const cambio = S.pdfMono !== 'rombo' || S.pdfTheme !== 'elegante' || S.accentColor !== '#3b0764';
        estiloDeshacer();
        return { abierto, listos, total: _ESTILO_REELS.length, cambio,
          vuelta: [S.pdfTheme, S.accentColor, S.accentColor2, S.pdfFont, S.pdfMono, S.pdfEncabezado, S.pdfTabla],
          cerrado: !document.getElementById('estilo-overlay').classList.contains('open'),
          nav: typeof NAV_OVERLAYS['estilo-overlay'] === 'function' };
      });
      check('I1 La máquina abre y los rodillos frenan en el valor sorteado', r.abierto && r.total === 12 && r.listos === 12, JSON.stringify(r));
      check('I2 "Dejar como estaba" vuelve al estilo anterior y cierra', r.cambio && r.cerrado && JSON.stringify(r.vuelta) === '["elegante","#3b0764","","inter","rombo","centrado","grilla"]', JSON.stringify(r.vuelta));
      check('I3 La ventana se cierra con "Atrás" (NAV_OVERLAYS)', r.nav);
    }

    // ── J. Elementos del documento (v245) ─────────────────────────────────
    {
      const r = await page.evaluate(() => {
        const doc = () => document.getElementById('doc-a4');
        const tabla = () => doc().querySelector('table.pdoc');
        const base = () => {
          S.isEstimative = false; S.isRisk = false; S.logo = ''; S.coName = 'Arbolado Norte';
          S.pdfTheme = 'clasico'; S.accentColor = '#1e3a5f'; S.accentColor2 = ''; S.pdfMono = 'escudo';
          S.pdfEncabezado = 'auto'; S.pdfTitulos = 'auto'; S.pdfTabla = 'auto'; S.pdfTotal = 'auto'; S.pdfPie = 'auto'; S.pdfFondo = 'auto';
          S.showFooter = true; S.coFooter = 'Julián Pérez'; S.coEslogan = ''; S.coWhatsapp = '11 5555-0142'; S.coCity = 'San Isidro'; S.coEmail = '';
          S.items = [{ id: 1, type: 'tree', species: 'Fresno', price: '100000', qty: 1 }, { id: 2, type: 'tree', species: 'Tilo', price: '50000', qty: 1 }];
        };
        const out = {};
        base(); buildDoc();
        out.autoSinClases = !/pdoc-(hd|tit|tb|to)-/.test(tabla().className) && !doc().querySelector('.pfoot-franja, .pfoot-eslogan');
        out.tintes = /--pdoc-tint1:\s*rgb\(/.test(tabla().getAttribute('style'));
        S.pdfEncabezado = 'banda'; S.pdfTitulos = 'pildora'; S.pdfTabla = 'cebra'; S.pdfTotal = 'banda'; S.pdfPie = 'franja';
        buildDoc();
        const cls = tabla().className;
        out.clases = ['pdoc-hd-banda','pdoc-tit-pildora','pdoc-tb-cebra','pdoc-to-banda'].every(c => cls.includes(c));
        out.bandaFondo = getComputedStyle(doc().querySelector('.ph')).backgroundColor;
        const mono = doc().querySelector('svg.ph-mono');
        out.monoInvertido = !!mono && mono.querySelector('path').getAttribute('fill') === '#ffffff';
        out.pildora = getComputedStyle(doc().querySelector('.psec-t')).backgroundColor;
        out.cebraTh = getComputedStyle(doc().querySelector('.ptable thead th')).backgroundColor;
        out.totalBanda = getComputedStyle(doc().querySelector('.ptotal-box')).backgroundColor;
        const pie = doc().querySelector('.pfoot.pfoot-franja');
        out.franja = !!pie && /Julián Pérez/.test(pie.textContent) && /WhatsApp 11 5555-0142 · San Isidro/.test(pie.textContent);
        S.pdfPie = 'eslogan'; buildDoc();
        out.esloganSinTexto = !doc().querySelector('.pfoot-eslogan') && !!doc().querySelector('.pfoot');
        S.coEslogan = 'Tu árbol en <b>buenas</b> manos'; buildDoc();
        const esl = doc().querySelector('.pfoot-eslogan .pfoot-esl');
        out.eslogan = !!esl && esl.textContent === 'Tu árbol en <b>buenas</b> manos' && !esl.querySelector('b');
        S.showFooter = false; buildDoc();
        out.pieApagado = !doc().querySelector('.pfoot');
        S.showFooter = true;
        S.pdfTheme = 'lateral'; buildDoc();
        out.lateralSinHd = !tabla().className.includes('pdoc-hd-');
        S.pdfTheme = 'clasico'; S.pdfTitulos = 'numerado'; S.isRisk = true; buildDoc();
        out.riesgoSinNumerar = !tabla().className.includes('pdoc-tit-numerado');
        S.isRisk = false; buildDoc();
        out.numerado = tabla().className.includes('pdoc-tit-numerado') && /counter\(pqsec/.test(getComputedStyle(doc().querySelector('.psec-t'), '::before').content);
        S.isEstimative = true; S.pdfPie = 'franja'; buildDoc();
        out.estimativo = tabla().className.includes('pdoc-tit-numerado') && !!doc().querySelector('.pfoot-franja');
        S.isEstimative = false;
        // Sorteo: nunca más de 2 elementos "fuertes", Lateral sin encabezado
        // propio, y el pie con eslogan solo si hay frase.
        S.coEslogan = '';
        let malos = 0, vistos = new Set();
        for (let i = 0; i < 400; i++) {
          const x = estiloSortear(false);
          ESTILO_ELEMENTOS.forEach(e => vistos.add(e.k + ':' + x[e.k]));
          if (estiloFuertes(x) > ESTILO_MAX_FUERTES || (x.pdfTheme === 'lateral' && x.pdfEncabezado !== 'auto') || x.pdfPie === 'eslogan') malos++;
        }
        out.sorteo = malos === 0;
        out.variedad = vistos.size;
        S.coEslogan = 'Algo';
        let conEsl = 0;
        for (let i = 0; i < 300; i++) if (estiloSortear(false).pdfPie === 'eslogan') conEsl++;
        out.conEslogan = conEsl > 0;
        // Fábrica, sanitización y config global
        base();
        S.accentColor = '#064e3b'; S.pdfMono = 'ninguno'; S.pdfFont = 'auto';
        out.fabrica = estiloEsDeFabrica();
        S.pdfTabla = 'lineas';
        out.yaNoFabrica = !estiloEsDeFabrica();
        const san = sanitizeStateObj({ pdfEncabezado: 'x', pdfTitulos: '"><img>', pdfTabla: 1, pdfTotal: null, pdfPie: 'franja', coEslogan: 'a'.repeat(500) });
        out.san = [san.pdfEncabezado, san.pdfTitulos, san.pdfTabla, san.pdfTotal, san.pdfPie, san.coEslogan.length];
        out.cfg = ['pdfEncabezado','pdfTitulos','pdfTabla','pdfTotal','pdfPie','coEslogan'].every(k => CFG_GLOBAL_FIELDS.includes(k));
        // Controles de Estilo
        estiloUISync(false);
        out.chips = ESTILO_ELEMENTOS.every(e => document.querySelectorAll('#el-' + e.k + ' [data-el]').length === e.opts.length);
        document.querySelector('#el-pdfTotal [data-el="grande"]').click();
        out.chipAplica = S.pdfTotal === 'grande' && document.querySelector('#el-pdfTotal .is-active').dataset.el === 'grande';
        base();
        return out;
      });
      check('J1 "Según diseño" en todo: el documento no cambia', r.autoSinClases, JSON.stringify(r));
      check('J2 Los tonos claros se calculan (sin color-mix, por html2canvas)', r.tintes);
      check('J3 Cada elemento elegido pone su clase en el documento', r.clases);
      check('J4 Encabezado en banda: fondo del color y monograma invertido', r.bandaFondo === 'rgb(30, 58, 95)' && r.monoInvertido, r.bandaFondo);
      check('J5 Títulos en píldora, tabla cebra y total en banda se pintan', r.pildora === 'rgb(30, 58, 95)' && r.cebraTh === 'rgb(30, 58, 95)' && r.totalBanda === 'rgb(30, 58, 95)',
        [r.pildora, r.cebraTh, r.totalBanda].join(' / '));
      check('J6 Pie en franja con la firma y los datos de contacto', r.franja);
      check('J7 Pie con eslogan: escapado, y sin frase cae al pie de siempre', r.eslogan && r.esloganSinTexto);
      check('J8 "Mostrar pie de página" apagado sigue mandando', r.pieApagado);
      check('J9 Lateral conserva su encabezado; el riesgo no se numera dos veces', r.lateralSinHd && r.riesgoSinNumerar);
      check('J10 Numerados cuenta las secciones, también en el estimativo', r.numerado && r.estimativo);
      check('J11 Sorteo: a lo sumo 2 elementos fuertes, Lateral sin encabezado, eslogan solo con frase', r.sorteo && r.conEslogan, 'variedad=' + r.variedad);
      check('J12 El sorteo recorre todas las opciones', r.variedad >= 18, 'variedad=' + r.variedad);
      check('J13 Con un elemento elegido ya no es el diseño de fábrica', r.fabrica && r.yaNoFabrica);
      check('J14 Basura de un backup cae a "Según diseño"; eslogan acotado', JSON.stringify(r.san) === '["auto","auto","auto","auto","franja",120]', JSON.stringify(r.san));
      check('J15 Son config del negocio (CFG_GLOBAL_FIELDS)', r.cfg);
      check('J16 Chips de Estilo: todas las opciones y aplican al tocar', r.chips && r.chipAplica);
    }

    // ── K. Fondos y marca de agua (v246) ──────────────────────────────────
    {
      const r = await page.evaluate(() => {
        const doc = () => document.getElementById('doc-a4');
        const tabla = () => doc().querySelector('table.pdoc');
        const svgDe = () => {
          const m = (tabla().getAttribute('style') || '').match(/--pdoc-fondo:url\('data:image\/svg\+xml,([^']*)'\)/);
          return m ? decodeURIComponent(m[1]) : null;
        };
        const valido = svg => !!svg && !new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror');
        Object.assign(S, { isEstimative: false, isRisk: false, logo: '', coName: 'Arbolado Norte', pdfTheme: 'clasico',
          accentColor: '#1e3a5f', accentColor2: '', pdfMono: 'escudo', pdfEncabezado: 'auto', pdfTitulos: 'auto',
          pdfTabla: 'auto', pdfTotal: 'auto', pdfPie: 'auto', pdfFondo: 'auto',
          items: [{ id: 1, type: 'tree', species: 'Fresno', price: '100000', qty: 1 }] });
        const out = {};
        buildDoc();
        out.liso = !/pdoc-fondo-/.test(tabla().className) && !/--pdoc-fondo/.test(tabla().getAttribute('style'));
        out.tipos = {};
        ['hojas', 'curvas', 'veta', 'marca'].forEach(t => {
          S.pdfFondo = t; buildDoc();
          out.tipos[t] = tabla().classList.contains('pdoc-fondo-' + t) && valido(svgDe())
            && /data:image\/svg\+xml/.test(getComputedStyle(tabla()).backgroundImage);
        });
        S.pdfFondo = 'marca'; S.pdfMono = 'ninguno'; buildDoc();
        out.marcaSinForma = valido(svgDe()) && /<circle/.test(svgDe());
        S.coName = '<script>alert(1)</script> Sur'; S.pdfMono = 'rombo'; buildDoc();
        out.marcaEscapada = valido(svgDe()) && !/<script/i.test(svgDe());
        S.coName = ''; buildDoc();
        out.marcaSinNombre = !/pdoc-fondo-/.test(tabla().className);
        S.coName = 'Arbolado Norte'; S.pdfTheme = 'lateral'; S.pdfFondo = 'hojas'; buildDoc();
        const bg = getComputedStyle(tabla()).backgroundImage;
        out.lateral = /linear-gradient/.test(bg) && /data:image\/svg\+xml/.test(bg);
        S.pdfTheme = 'clasico'; S.pdfFondo = 'auto'; S.pdfMono = 'escudo'; buildDoc();
        const mono = doc().querySelector('svg.ph-mono');
        out.monoTam = !!mono && mono.getAttribute('width') === '50' && mono.getAttribute('height') === '50';
        out.san = sanitizeStateObj({ pdfFondo: 'url(x)' }).pdfFondo;
        out.cfg = CFG_GLOBAL_FIELDS.includes('pdfFondo');
        S.coName = '';
        let marcaSinNombre = 0, fondos = new Set(), fuertes = 0;
        for (let i = 0; i < 400; i++) {
          const x = estiloSortear(false);
          fondos.add(x.pdfFondo);
          if (x.pdfFondo === 'marca') marcaSinNombre++;
          if (estiloFuertes(x) > ESTILO_MAX_FUERTES) fuertes++;
        }
        S.coName = 'Arbolado Norte';
        let conMarca = 0;
        for (let i = 0; i < 400; i++) if (estiloSortear(false).pdfFondo === 'marca') conMarca++;
        out.sorteo = { marcaSinNombre, fondos: [...fondos].sort(), fuertes, conMarca };
        estiloUISync(false);
        out.chips = document.querySelectorAll('#el-pdfFondo [data-el]').length === 5;
        S.pdfFondo = 'auto';
        return out;
      });
      check('K1 Liso: el documento no lleva fondo', r.liso, JSON.stringify(r));
      check('K2 Hojas, curvas, veta y marca: clase, SVG válido y se pinta', Object.values(r.tipos).every(Boolean), JSON.stringify(r.tipos));
      check('K3 Marca de agua sin forma elegida usa el círculo', r.marcaSinForma);
      check('K4 El nombre se escapa dentro de la marca de agua', r.marcaEscapada);
      check('K5 Sin nombre del negocio no hay marca de agua (queda liso)', r.marcaSinNombre);
      check('K6 Lateral: la banda y el fondo conviven (dos capas)', r.lateral);
      check('K7 El monograma tiene tamaño propio (html2canvas lo dibuja)', r.monoTam);
      check('K8 Basura de un backup cae a liso; es config del negocio', r.san === 'auto' && r.cfg);
      check('K9 Sorteo: marca solo con nombre, salen todos los fondos, nunca más de 2 fuertes',
        r.sorteo.marcaSinNombre === 0 && r.sorteo.conMarca > 0 && r.sorteo.fuertes === 0
        && JSON.stringify(r.sorteo.fondos) === '["auto","curvas","hojas","veta"]', JSON.stringify(r.sorteo));
      check('K10 Chips de Fondo en Estilo', r.chips);
    }

    // ── L. Mis estilos (v247) ─────────────────────────────────────────────
    {
      const r = await page.evaluate(async () => {
        const out = {};
        const items = () => [...document.querySelectorAll('#eg-lista .eg-item')];
        localStorage.removeItem(LS.ESTILOS);
        switchSubtab('estilo');
        estiloUISync(false);
        out.vacio = !!document.querySelector('#eg-lista .eg-vacio');
        // Un estilo "que me gusta", con textos y eslogan propios.
        Object.assign(S, { pdfTheme: 'elegante', accentColor: '#3b0764', accentColor2: '#b08d3c', pdfFont: 'plex', pdfMono: 'sello',
          pdfEncabezado: 'centrado', pdfTitulos: 'versalitas', pdfTabla: 'grilla', pdfTotal: 'grande', pdfPie: 'eslogan', pdfFondo: 'curvas',
          pdfCompact: true, coEslogan: 'Poda segura desde 2005', docGreeting: 'Un abrazo, Julio' });
        estiloUISync(true);
        const foto = JSON.stringify(_estiloDatosActuales());
        estiloGuardarAbrir();
        document.getElementById('eg-nombre').value = '  El de   siempre ';
        await estiloGuardar();
        out.guardado = getEstilos().length === 1 && getEstilos()[0].nombre === 'El de siempre';
        out.enUso = items().length === 1 && items()[0].classList.contains('is-uso') && !items()[0].querySelector('[data-eg="usar"]');
        // Guardar otra vez lo mismo no duplica.
        estiloGuardarAbrir(); document.getElementById('eg-nombre').value = 'Otro nombre';
        await estiloGuardar();
        out.sinDuplicar = getEstilos().length === 1;
        // La máquina cambia todo; como el estilo estaba guardado, no hace falta "El anterior".
        estiloAbrir({ tirar: true, textos: true });
        estiloCerrar();
        out.sinAnteriorSiEstabaGuardado = !getEstilos().some(e => e.auto);
        out.cambio = JSON.stringify(_estiloDatosActuales()) !== foto;
        const sorteado = JSON.stringify(_estiloDatosActuales());
        // Usar el guardado: vuelve EXACTO (textos, eslogan, compacto incluidos)
        // y lo sorteado queda como "El anterior".
        estiloUsar(getEstilos()[0].id);
        syncFromUI();
        out.vuelve = JSON.stringify(_estiloDatosActuales()) === foto && S.docGreeting === 'Un abrazo, Julio'
          && document.getElementById('co-eslogan').value === 'Poda segura desde 2005' && document.getElementById('pdf-compact').checked === true;
        const auto = getEstilos().find(e => e.auto);
        out.anterior = !!auto && JSON.stringify(auto.datos) === sorteado && items().length === 2 && items()[1].classList.contains('is-auto');
        // "Usar" El anterior vuelve a lo sorteado (y lo de antes queda guardado igual).
        estiloUsar('anterior');
        out.ida = JSON.stringify(_estiloDatosActuales()) === sorteado;
        estiloUsar(getEstilos().find(e => !e.auto).id);
        // Un estilo nuevo sin guardar + máquina → "El anterior" lo rescata.
        S.pdfTheme = 'tecnico'; S.accentColor = '#0369a1'; estiloUISync(true);
        const sinGuardar = JSON.stringify(_estiloDatosActuales());
        estiloAbrir({ tirar: true }); estiloCerrar();
        const a2 = getEstilos().find(e => e.auto);
        out.rescata = !!a2 && JSON.stringify(a2.datos) === sinGuardar && getEstilos().filter(e => e.auto).length === 1;
        // Mismo nombre, otro estilo: pide confirmación y reemplaza.
        estiloGuardarAbrir(); document.getElementById('eg-nombre').value = 'el de siempre';
        const p = estiloGuardar();
        await new Promise(res => setTimeout(res, 100));
        out.confirma = document.getElementById('confirm-overlay').classList.contains('open');
        document.getElementById('confirm-ok').click();
        await p;
        const m = getEstilos().filter(e => !e.auto);
        out.reemplaza = m.length === 1 && JSON.stringify(m[0].datos) === JSON.stringify(_estiloDatosActuales());
        // Borrar y deshacer.
        const antesBorrar = JSON.stringify(getEstilos());
        estiloBorrar(m[0].id);
        out.borrado = !getEstilos().some(e => e.id === m[0].id);
        const t = [...document.querySelectorAll('#toast-container .toast')].pop();
        t.querySelector('.toast-btn').click();
        out.deshecho = JSON.stringify(getEstilos()) === antesBorrar;
        // Tope de 12 con nombre.
        const doce = []; for (let i = 0; i < 12; i++) doce.push({ id: 'x' + i, nombre: 'E' + i, datos: { pdfTheme: 'clasico' } });
        setEstilos(doce);
        S.accentColor = '#1c1917'; estiloUISync(true);
        estiloGuardarAbrir(); document.getElementById('eg-nombre').value = 'El 13';
        await estiloGuardar();
        out.tope = getEstilos().filter(e => !e.auto).length === 12;
        // Datos ajenos: ids, nombres, campos y duplicados.
        const raro = sanitizeEstilos([
          { id: 'ok1', nombre: '<img src=x onerror=alert(1)>', datos: { pdfTheme: 'x', accentColor: 'red', accentColor2: 'url(x)', pdfFondo: '"><svg>', pdfCompact: 'si', textos: { docTitle: 7, docGreeting: 'Hola' } } },
          { id: 'ok1', nombre: 'Duplicado', datos: {} },
          { id: '"><b>', nombre: 'Id malo', datos: {} },
          { id: 'ok2', nombre: '   ', datos: {} },
          { id: 'a1', nombre: 'A1', auto: true, datos: {} }, { id: 'a2', nombre: 'A2', auto: true, datos: {} },
          'basura', null,
        ]);
        out.san = raro.map(e => e.id).join(',') === 'ok1,a1'
          && raro[0].datos.pdfTheme === 'clasico' && raro[0].datos.accentColor === '#064e3b' && raro[0].datos.accentColor2 === ''
          && raro[0].datos.pdfFondo === 'auto' && raro[0].datos.pdfCompact === false
          && !('docTitle' in raro[0].datos.textos) && raro[0].datos.textos.docGreeting === 'Hola';
        setEstilos(raro);
        estiloUISync(false);
        out.escapado = !document.querySelector('#eg-lista img') && /&lt;img|<img/.test(document.getElementById('eg-lista').textContent);
        // Backup: sale, se valida y se aplica.
        const bk = buildBackupObject();
        out.backup = Array.isArray(bk.estilos) && bk.estilos.length === 2;
        const sb = sanitizeBackup({ estilos: [{ id: 'z', nombre: 'Del colega', datos: { pdfTheme: 'lateral' } }, { id: 'bad id', nombre: 'x' }] });
        out.sanBackup = sb.estilos.length === 1 && sb.estilos[0].datos.pdfTheme === 'lateral';
        localStorage.removeItem(LS.ESTILOS);
        estiloUISync(false);
        return out;
      });
      check('L1 Sin estilos guardados, la lista lo dice', r.vacio, JSON.stringify(r));
      check('L2 "Guardar el actual" guarda con nombre y lo marca "En uso"', r.guardado && r.enUso);
      check('L3 Guardar dos veces el mismo estilo no lo duplica', r.sinDuplicar);
      check('L4 "Usar" vuelve exacto: diseño, elementos, fondo, compacto, eslogan y textos', r.cambio && r.vuelve);
      check('L5 Lo que había queda como "El anterior" (y no si ya estaba guardado)', r.sinAnteriorSiEstabaGuardado && r.anterior && r.ida);
      check('L6 La máquina rescata un estilo sin guardar en "El anterior" (uno solo)', r.rescata);
      check('L7 Mismo nombre: confirma y reemplaza', r.confirma && r.reemplaza);
      check('L8 Borrar deja Deshacer', r.borrado && r.deshecho);
      check('L9 Tope de 12 estilos con nombre', r.tope);
      check('L10 Datos ajenos: ids, nombres, campos y duplicados validados; nombre escapado', r.san && r.escapado);
      check('L11 Viajan en el backup y se validan al importar', r.backup && r.sanBackup);
    }
    await page.close();

    // ── H. Usuarios que ya tenían la app ──────────────────────────────────
    {
      // Diseño de fábrica: se ofrece una vez y no se cambia nada solo.
      const fab = await abrirCon(browser, () => {
        localStorage.clear();
        localStorage.setItem('pq_onboarded', '1');
        localStorage.setItem(LS.STATE, JSON.stringify(Object.assign({}, S, {
          pdfTheme: 'clasico', accentColor: '#064e3b', pdfFont: 'auto', pdfMono: 'ninguno', accentColor2: '',
          pdfEncabezado: 'auto', pdfTitulos: 'auto', pdfTabla: 'auto', pdfTotal: 'auto', pdfPie: 'auto', pdfFondo: 'auto',
          docTitle: TEXTOS_JUEGOS.original.t.docTitle })));
      });
      await espera(1500);
      const r1 = await fab.evaluate(() => ({ fab: estiloEsDeFabrica(), titulo: S.docTitle, flag: localStorage.getItem(LS.ESTILO_OFERTA) }));
      const t1 = await toastsTxt(fab);
      check('H1 Diseño de fábrica: se ofrece armar uno propio', /diseño de fábrica/.test(t1), t1);
      check('H2 La oferta no cambia nada sola', r1.fab && r1.titulo === 'Presupuesto de Servicio de Poda en Altura y Extracción de Árboles', JSON.stringify(r1));
      await fab.reload({ waitUntil: 'domcontentloaded' });
      await espera(2500);
      const t2 = await toastsTxt(fab);
      check('H3 La oferta sale una sola vez', r1.flag === '1' && !/diseño de fábrica/.test(t2), t2);
      await fab.close();

      // Ya personalizado: ni oferta ni cambios.
      const pers = await abrirCon(browser, () => {
        localStorage.clear();
        localStorage.setItem('pq_onboarded', '1');
        localStorage.setItem(LS.STATE, JSON.stringify(Object.assign({}, S, { pdfTheme: 'tecnico', accentColor: '#7c2d12', pdfMono: 'ninguno', accentColor2: '' })));
      });
      await espera(1500);
      const r3 = await pers.evaluate(() => [S.pdfTheme, S.accentColor, S.pdfMono]);
      const t3 = await toastsTxt(pers);
      check('H4 Quien ya personalizó no recibe oferta ni cambios', !/diseño de fábrica/.test(t3) && JSON.stringify(r3) === '["tecnico","#7c2d12","ninguno"]', JSON.stringify(r3));
      await pers.close();
    }
  } catch (e) {
    console.error(e);
    allOk = false;
  } finally {
    await browser.close();
  }
  console.log(allOk ? '\nOK — estilo propio' : '\nFALLÓ — estilo propio');
  process.exit(allOk ? 0 : 1);
})();
