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
        estiloUISync(true);
        estiloAbrir({ tirar: true });
        const abierto = document.getElementById('estilo-overlay').classList.contains('open');
        await new Promise(res => setTimeout(res, 1800));
        const listos = document.querySelectorAll('#estilo-reels .estilo-reel.listo').length;
        const cambio = S.pdfMono !== 'rombo' || S.pdfTheme !== 'elegante' || S.accentColor !== '#3b0764';
        estiloDeshacer();
        return { abierto, listos, cambio, vuelta: [S.pdfTheme, S.accentColor, S.accentColor2, S.pdfFont, S.pdfMono],
          cerrado: !document.getElementById('estilo-overlay').classList.contains('open'),
          nav: typeof NAV_OVERLAYS['estilo-overlay'] === 'function' };
      });
      check('I1 La máquina abre y los rodillos frenan en el valor sorteado', r.abierto && r.listos === 6, JSON.stringify(r));
      check('I2 "Dejar como estaba" vuelve al estilo anterior y cierra', r.cambio && r.cerrado && JSON.stringify(r.vuelta) === '["elegante","#3b0764","","inter","rombo"]', JSON.stringify(r.vuelta));
      check('I3 La ventana se cierra con "Atrás" (NAV_OVERLAYS)', r.nav);
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
