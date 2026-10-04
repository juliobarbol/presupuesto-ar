// Mapa: pins cercanos agrupados, mapa a pantalla completa y última vista.
//
// El caso real (docs/mapa-ideas.md, capturas del uso diario en Sierras
// Chicas): a zoom de provincia los pins formaban una mancha y un grupo "3"
// quedaba tapado; el mapa abría a zoom de provincia porque el encuadre
// incluía los trabajos aislados (Jesús María, La Falda, Malagueño); y los
// filtros ocupaban un cuarto de pantalla con las estadísticas de la zona
// escondidas debajo del mapa.
//
//   A) Primer encuadre: el núcleo, sin los aislados (_mapaNucleo).
//   B) Pins cercanos se juntan en un círculo con la cantidad; tocarlo acerca.
//   C) El grupo del MISMO punto sigue como estaba ("N trabajos en este lugar").
//   D) Las stats de zona cuentan cada punto por su ubicación real.
//   E) Diseño: el mapa ocupa el alto, la franja de zona va ENCIMA, los
//      filtros detrás de un botón con contador y atajos de fecha.
//   F) La última vista se guarda y el mapa vuelve a abrir ahí.

const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = process.env.CHROME_PATH
  || '/root/.cache/cc-headless/chrome-headless-shell-linux64/chrome-headless-shell';
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

let fallos = 0;
function check(ok, nombre, detalle) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nombre + (detalle ? '  — ' + detalle : ''));
  if (!ok) fallos++;
}

// Núcleo: 12 trabajos en Sierras Chicas (Unquillo / Mendiolaza / Villa
// Allende), dos de ellos en el MISMO punto. Aislados: Jesús María, La Falda,
// Malagueño.
const NUCLEO = [
  [-31.2310, -64.3160], [-31.2335, -64.3190], [-31.2290, -64.3120],
  [-31.2400, -64.3050], [-31.2550, -64.2950], [-31.2620, -64.3010],
  [-31.2950, -64.2950], [-31.2980, -64.2900], [-31.2100, -64.3300],
  [-31.2150, -64.3250], [-31.2200, -64.3180],
];
const MISMO = [-31.2450, -64.3100];
const AISLADOS = [[-30.9810, -64.0940], [-31.0920, -64.4790], [-31.4610, -64.3590]];

function historial() {
  const h = [];
  let id = 1000;
  const alta = (ll, estado, cli) => h.push({
    id: id++, quoteNumber: '2026-' + String(id).padStart(4, '0'), clientName: cli,
    estado, total: 10000000, currency: 'ARS', savedAt: '2026-09-10T12:00:00.000Z',
    snapshot: { quoteNumber: '', clientName: cli, dateIssue: '2026-09-10', workMapLink: ll[0] + ',' + ll[1], items: [] },
  });
  NUCLEO.forEach((ll, i) => alta(ll, i % 3 ? 'enviado' : 'aceptado', 'Cliente ' + i));
  alta(MISMO, 'aceptado', 'Mismo lugar A');
  alta(MISMO, 'realizado', 'Mismo lugar B');
  AISLADOS.forEach((ll, i) => alta(ll, 'enviado', 'Aislado ' + i));
  return h;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
  await page.setRequestInterception(true);
  page.on('request', (req) => { if (req.url().startsWith('file://')) req.continue(); else req.abort(); });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));

  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.evaluate((h) => {
    localStorage.clear();
    localStorage.setItem('pq_onboarded', '1');
    localStorage.setItem('pq_h', JSON.stringify(h));
  }, historial());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));

  // ── Funciones puras ───────────────────────────────────────────────────
  const puras = await page.evaluate((nuc, ais) => {
    const pts = nuc.concat(ais);
    const n = _mapaNucleo(pts);
    const pocos = _mapaNucleo(ais);
    // Agrupar: tres puntos a 10 px y uno lejos → 2 grupos; el de más
    // trabajos siembra.
    const P = (x, y, k) => ({ ll: [x, y], items: Array(k).fill(0), x, y });
    const gr = _mapaAgruparCercanos([P(0, 0, 1), P(10, 0, 1), P(0, 10, 3), P(500, 500, 1)],
      p => ({ x: p.x, y: p.y }), 46);
    return {
      nucleoSinAislados: ais.every(a => !n.some(p => p[0] === a[0] && p[1] === a[1])),
      nucleoCompleto: nuc.every(a => n.some(p => p[0] === a[0] && p[1] === a[1])),
      pocosIntactos: pocos.length === ais.length,
      grupos: gr.map(g => g.puntos.length).sort(),
      semilla: gr.find(g => g.puntos.length === 3).puntos[0].items.length,
    };
  }, NUCLEO, AISLADOS);
  check(puras.nucleoSinAislados && puras.nucleoCompleto, '_mapaNucleo descarta los aislados y deja el núcleo', JSON.stringify(puras));
  check(puras.pocosIntactos, '_mapaNucleo con menos de 5 puntos no descarta nada');
  check(JSON.stringify(puras.grupos) === '[1,3]' && puras.semilla === 3,
    '_mapaAgruparCercanos junta los cercanos y siembra el de más trabajos', JSON.stringify(puras.grupos));

  // ── A + E) Abrir el mapa ──────────────────────────────────────────────
  await page.evaluate(() => switchTab('mapa'));
  await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));

  const a = await page.evaluate((nuc, ais) => {
    const b = _mapa.getBounds();
    return {
      zoom: _mapa.getZoom(),
      nucleoAdentro: nuc.every(p => b.contains(p)),
      aisladosAfuera: ais.filter(p => !b.contains(p)).length,
      guardada: localStorage.getItem('pq_mapa_vista'),
    };
  }, NUCLEO, AISLADOS);
  check(a.nucleoAdentro, 'El primer encuadre muestra todo el núcleo', 'zoom ' + a.zoom);
  check(a.aisladosAfuera >= 2, 'Los trabajos aislados quedan fuera del primer encuadre', a.aisladosAfuera + ' de 3 afuera');

  const e = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const filtros = document.getElementById('mapa-filtros');
    return {
      canvasH: r('map-canvas').height, vh: window.innerHeight,
      franjaArriba: r('mapa-zonastats').bottom <= r('map-canvas').top + 1,
      franjaTxt: document.getElementById('mapa-zonastats').textContent.replace(/\s+/g, ' ').trim(),
      filtrosOcultos: filtros.hidden && getComputedStyle(filtros).display === 'none',
      contadorOculto: getComputedStyle(document.getElementById('mapa-filtros-n')).display === 'none',
      todoOn: !!document.querySelector('.mapa-periodo.is-on[data-per="todo"]'),
      anchoPagina: document.documentElement.scrollWidth,
    };
  });
  check(e.canvasH >= e.vh * 0.5, 'El mapa ocupa al menos la mitad del alto en un celular de 360×740',
    Math.round(e.canvasH) + ' px de ' + e.vh);
  check(e.franjaArriba && /En esta zona: \d+ presupuesto/.test(e.franjaTxt), 'La franja de la zona va ENCIMA del mapa', e.franjaTxt.slice(0, 90));
  check(e.filtrosOcultos && e.contadorOculto && e.todoOn, 'Los filtros arrancan plegados, sin contador y en "Todo"');
  check(e.anchoPagina <= 360, 'Sin scroll horizontal a 360 px', e.anchoPagina + ' px');

  // Abrir filtros, elegir "Este mes", cerrar: contador 1 y resumen al lado.
  const f = await page.evaluate(() => {
    mapaFiltrosToggle();
    const abierto = !document.getElementById('mapa-filtros').hidden
      && document.getElementById('mapa-filtros-btn').getAttribute('aria-expanded') === 'true';
    mapaPeriodo('mes');
    const desde = document.getElementById('mapa-desde').value;
    const n = document.getElementById('mapa-filtros-n').textContent;
    const res = document.getElementById('mapa-filtros-res').textContent;
    const on = document.querySelector('.mapa-periodo.is-on')?.dataset.per;
    mapaToggleFilter('enviado', false);
    const n2 = document.getElementById('mapa-filtros-n').textContent;
    mapaToggleFilter('enviado', true);
    mapaPeriodo('todo');
    const n3 = document.getElementById('mapa-filtros-n').hidden;
    mapaFiltrosToggle(false);
    return { abierto, desde, n, res, on, n2, n3, hoyMes: toLocalISODate(new Date()).slice(0, 8) + '01' };
  });
  check(f.abierto, 'El botón "Filtros" abre el panel');
  check(f.desde === f.hoyMes && f.on === 'mes' && f.n === '1' && /Este mes/.test(f.res),
    '"Este mes" llena Desde, marca el atajo y el contador dice 1', JSON.stringify(f));
  check(f.n2 === '2' && f.n3 === true, 'Ocultar un estado suma al contador; volver a "Todo" lo apaga');

  // ── B) Agrupar por zoom ───────────────────────────────────────────────
  const b = await page.evaluate(async (nuc) => {
    const total = () => document.querySelectorAll('#map-canvas .mapa-pin, #map-canvas .mapa-cluster, #map-canvas .mapa-zgrupo').length;
    _mapa.setView([-31.25, -64.31], 10, { animate: false });
    await new Promise((r) => setTimeout(r, 150));
    const z10 = { marcas: total(), zgrupos: document.querySelectorAll('#map-canvas .mapa-zgrupo').length,
      nums: [...document.querySelectorAll('#map-canvas .mapa-zgrupo .mapa-cluster-count')].map(x => +x.textContent) };
    // Tocar el grupo más grande acerca el mapa.
    const antes = _mapa.getZoom();
    const el = [...document.querySelectorAll('#map-canvas .mapa-zgrupo')]
      .sort((x, y) => +y.textContent - +x.textContent)[0];
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const despues = _mapa.getZoom();
    // A zoom de calle no se agrupa nada.
    _mapa.setView([-31.2450, -64.3100], 18, { animate: false });
    await new Promise((r) => setTimeout(r, 150));
    const z18 = { zgrupos: document.querySelectorAll('#map-canvas .mapa-zgrupo').length,
      mismo: [...document.querySelectorAll('#map-canvas .mapa-cluster .mapa-cluster-count')].map(x => x.textContent) };
    return { z10, antes, despues, z18 };
  }, NUCLEO);
  const sumaZ10 = b.z10.nums.reduce((x, y) => x + y, 0);
  check(b.z10.zgrupos >= 1 && b.z10.marcas < 13, 'A zoom 10 los pins cercanos se juntan en círculos', JSON.stringify(b.z10));
  check(sumaZ10 >= 10, 'El círculo cuenta trabajos, no puntos (el mismo punto suma 2)', 'suma ' + sumaZ10);
  check(b.despues > b.antes, 'Tocar el círculo acerca el mapa', b.antes + ' → ' + b.despues);
  check(b.z18.zgrupos === 0 && b.z18.mismo.includes('2'), 'A zoom de calle no se agrupa y el grupo del mismo punto sigue', JSON.stringify(b.z18));

  // ── D) Stats por ubicación real ───────────────────────────────────────
  const d = await page.evaluate(async () => {
    // Vista que deja el núcleo adentro y los aislados afuera, a un zoom
    // donde todo el núcleo es un solo círculo.
    _mapa.setView([-31.25, -64.31], 9, { animate: false });
    await new Promise((r) => setTimeout(r, 200));
    const txt = document.getElementById('mapa-zonastats').textContent;
    const m = txt.match(/En esta zona: (\d+)/);
    const b = _mapa.getBounds();
    const esperado = getH().filter(e => b.contains(entryLatLng(e))).length;
    return { dice: m ? +m[1] : null, esperado };
  });
  check(d.dice === d.esperado, 'La zona cuenta cada trabajo por su ubicación real', JSON.stringify(d));

  // ── F) Última vista ───────────────────────────────────────────────────
  await page.evaluate(async () => {
    _mapa.setView([-31.2300, -64.3200], 14, { animate: false });
    await new Promise((r) => setTimeout(r, 200));
  });
  const guardada = await page.evaluate(() => JSON.parse(localStorage.getItem('pq_mapa_vista') || 'null'));
  check(guardada && guardada.z === 14 && Math.abs(guardada.lat + 31.23) < 1e-4, 'Mover el mapa guarda centro y zoom', JSON.stringify(guardada));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));
  await page.evaluate(() => switchTab('mapa'));
  await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));
  const vuelta = await page.evaluate(() => ({ z: _mapa.getZoom(), c: _mapa.getCenter() }));
  check(vuelta.z === 14 && Math.abs(vuelta.c.lat + 31.23) < 1e-3 && Math.abs(vuelta.c.lng + 64.32) < 1e-3,
    'Al volver a abrir, el mapa está donde se dejó', JSON.stringify(vuelta));

  // Una vista guardada inválida (manipulada) se ignora sin romper.
  const inval = await page.evaluate(() => {
    const r = [];
    for (const v of ['{"lat":"x","lng":0,"z":5}', '{"lat":10,"lng":0,"z":40}', 'no-json', '[1,2,3]']) {
      localStorage.setItem('pq_mapa_vista', v);
      r.push(_mapaVistaLeer());
    }
    localStorage.setItem('pq_mapa_vista', '{"lat":-31.2,"lng":-64.3,"z":12}');
    r.push(_mapaVistaLeer());
    return r;
  });
  check(inval.slice(0, 4).every(x => x === null) && inval[4] && inval[4].z === 12, 'Una vista guardada inválida se descarta', JSON.stringify(inval));

  // La vista del mapa no viaja en el backup.
  const enBackup = await page.evaluate(() => JSON.stringify(buildBackupObject()).includes('pq_mapa_vista'));
  check(!enBackup, 'La última vista no va al backup');

  check(errores.length === 0, 'Sin errores de JavaScript', errores.join(' | '));

  if (process.env.SNAP) {
    await page.evaluate(async () => { localStorage.removeItem('pq_mapa_vista'); });
    await page.screenshot({ path: process.env.SNAP });
  }

  await browser.close();
  console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
