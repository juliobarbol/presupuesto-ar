// Mapa: lectura de estados, conversión, tramos de ruta y la barra de totales.
// (docs/mapa-ideas.md, puntos 4, 5, 9 y 10.)
//
//   A) Enviado VENCIDO: pin hueco. Vigente o "vence hoy": pin lleno.
//   B) Paleta propia del mapa + símbolo (✓ realizado, ojo en "Ir a ver").
//      Los colores oscuros de ESTADO_COLORS se confundían sobre el verde.
//   C) Conversión de zona: solo lo decidido (aceptado + realizado + perdido).
//      Antes los enviados contaban como decididos y la bajaban.
//   D) Ruta: Google Maps acepta 3 paradas intermedias en el navegador del
//      celular. Con más, se parte en tramos de hasta 4 paradas.
//   E) La barra de totales no aparece en otra pestaña si el usuario se movió
//      antes de que termine el arranque.

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

function isoEnDias(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function historial() {
  const h = [];
  let id = 5000;
  const alta = (lat, estado, cli, venceEn) => h.push({
    id: id++, quoteNumber: '2026-' + id, clientName: cli, estado, total: 10000000, currency: 'ARS',
    savedAt: '2026-09-10T12:00:00.000Z',
    snapshot: { clientName: cli, dateIssue: '2026-09-10', dateExpiry: venceEn == null ? '' : isoEnDias(venceEn),
      workMapLink: lat + ',-64.3000', items: [] },
  });
  alta(-31.2000, 'enviado',   'Felipe vencido', -30);
  alta(-31.2050, 'enviado',   'Enviado vigente', 10);
  alta(-31.2100, 'enviado',   'Vence hoy', 0);
  alta(-31.2150, 'aceptado',  'Aceptado vencido', -30);
  alta(-31.2200, 'realizado', 'Realizado', null);
  alta(-31.2250, 'por_ver',   'Ir a ver', null);
  alta(-31.2300, 'perdido',   'Perdido', null);
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
    localStorage.setItem('pq_mapa_vista', JSON.stringify({ lat: -31.215, lng: -64.3, z: 18 }));
  }, historial());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));
  await page.evaluate(() => switchTab('mapa'));
  await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));

  // ── A) Vencido ────────────────────────────────────────────────────────
  const a = await page.evaluate(() => {
    const por = (cli) => getH().find(e => e.clientName === cli);
    return {
      felipe: mapaEsVencido(por('Felipe vencido')),
      vigente: mapaEsVencido(por('Enviado vigente')),
      hoy: mapaEsVencido(por('Vence hoy')),
      aceptado: mapaEsVencido(por('Aceptado vencido')),
      huecos: document.querySelectorAll('#map-canvas .mapa-pin.is-venc').length,
    };
  });
  check(a.felipe && !a.vigente && !a.hoy && !a.aceptado,
    'Vencido = enviado con la vigencia pasada ("vence hoy" sigue vigente)', JSON.stringify(a));
  check(a.huecos === 1, 'El enviado vencido se dibuja hueco, y solo ese', a.huecos + ' pin(es) hueco(s)');

  // ── B) Paleta y símbolos ──────────────────────────────────────────────
  const b = await page.evaluate(() => {
    const colorDe = (cli) => {
      const m = []; _mapaLayer.eachLayer(x => { if (x._entries && x._entries[0].clientName === cli) m.push(x); });
      const el = m[0] && m[0].getElement && m[0].getElement();
      const sp = el && el.querySelector('span');
      return sp ? { bg: getComputedStyle(sp).backgroundColor, svg: !!sp.querySelector('svg') } : null;
    };
    const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
    return {
      realizado: colorDe('Realizado'), porVer: colorDe('Ir a ver'), perdido: colorDe('Perdido'),
      esperado: { realizado: rgb(MAPA_PIN_COLORS.realizado), por_ver: rgb(MAPA_PIN_COLORS.por_ver) },
      viejo: rgb(ESTADO_COLORS.realizado[0]),
      distintos: new Set(Object.values(MAPA_PIN_COLORS)).size === Object.keys(MAPA_PIN_COLORS).length,
      todos: ESTADOS.every(s => MAPA_PIN_COLORS[s]),
      filtroDot: getComputedStyle(document.querySelector('.mapa-filter-dot')).backgroundColor,
      filtroEsperado: rgb(MAPA_PIN_COLORS[ESTADOS[0]]),
    };
  });
  check(b.todos && b.distintos, 'Cada estado tiene su color de pin, sin repetir');
  check(b.realizado && b.realizado.bg === b.esperado.realizado && b.realizado.bg !== b.viejo,
    'El pin usa la paleta del mapa, no el color de texto del chip', JSON.stringify(b.realizado));
  check(b.realizado.svg && b.porVer.svg && !b.perdido.svg, 'Símbolo en realizado (✓) e "Ir a ver" (ojo); los demás sin símbolo');
  check(b.filtroDot === b.filtroEsperado, 'Los puntos de los filtros usan la misma paleta que los pins');

  // ── C) Conversión ─────────────────────────────────────────────────────
  const c = await page.evaluate(async () => {
    _mapa.setView([-31.215, -64.3], 12, { animate: false });
    await new Promise((r) => setTimeout(r, 200));
    return document.getElementById('mapa-zonastats').textContent.replace(/\s+/g, ' ').trim();
  });
  // Decididos: aceptado 1 + realizado 1 + perdido 1 + 1 enviado vencido = 4;
  // ganados 2 → 50%. Los 2 enviados vigentes (uno vence hoy) quedan afuera.
  // v231 contaba los 3 enviados (2/6 = 33%); v232 no contaba ninguno (2/3).
  check(/Conversión: 50% \(2\/4\)/.test(c), 'Conversión: el enviado vencido cuenta como decidido; el vigente no', c.slice(0, 120));
  check(/Enviado 3 · 1 vencido/.test(c), 'La franja dice cuántos enviados están vencidos', c);

  // El caso del reporte: 0 perdidos, muchos vencidos. Daba "Conversión: 100%".
  const c2 = await page.evaluate(async () => {
    const h = getH();
    const vencido = h.find(e => e.clientName === 'Felipe vencido');
    const base = JSON.parse(JSON.stringify(vencido));
    const extra = [];
    for (let i = 0; i < 5; i++) extra.push(Object.assign(JSON.parse(JSON.stringify(base)), { id: 6100 + i, clientName: 'Vencido ' + i }));
    const sinPerdido = h.filter(e => e.estado !== 'perdido').concat(extra);
    const prev = JSON.stringify(h);
    setH(sinPerdido);
    mapaRefresh();
    await new Promise((r) => setTimeout(r, 200));
    const txt = document.getElementById('mapa-zonastats').textContent.replace(/\s+/g, ' ').trim();
    setH(JSON.parse(prev));
    mapaRefresh();
    return txt;
  });
  // Ganados 2 (aceptado + realizado); decididos 2 + 6 vencidos = 8 → 25%.
  check(/Conversión: 25% \(2\/8\)/.test(c2), 'Sin perdidos y con vencidos la conversión no da 100%', c2.slice(0, 120));

  // ── D) Tramos de ruta ─────────────────────────────────────────────────
  const d = await page.evaluate(() => {
    const P = (n) => Array.from({ length: n }, (_, i) => ({ q: 'p' + (i + 1), nombre: 'C' + (i + 1) }));
    const t4 = _mapaRutaTramos('o', P(4), MAPA_RUTA_INTERMEDIAS);
    const t6 = _mapaRutaTramos('o', P(6), MAPA_RUTA_INTERMEDIAS);
    const t9 = _mapaRutaTramos('o', P(9), MAPA_RUTA_INTERMEDIAS);
    const wpsDe = (url) => { const m = url.match(/waypoints=([^&]*)/); return m ? m[1].split('%7C').length : 0; };
    const urls = t9.map(_mapaRutaUrl);
    const sinOrigen = _mapaRutaUrl(_mapaRutaTramos('', P(2), 3)[0]);
    return {
      t4: t4.length, t6: t6.map(t => t.paradas.length), t6o2: t6[1].origen,
      t9: t9.map(t => t.paradas.length), maxWps: Math.max(...urls.map(wpsDe)),
      origenes: t9.map(t => t.origen), sinOrigen,
    };
  });
  check(d.t4 === 1, 'Hasta 4 paradas: un solo recorrido, como antes');
  check(JSON.stringify(d.t6) === '[4,2]' && d.t6o2 === 'p4', '6 paradas: dos tramos, el segundo arranca en la última del primero', JSON.stringify(d));
  check(d.maxWps <= 3 && JSON.stringify(d.t9) === '[4,4,1]' && JSON.stringify(d.origenes) === '["o","p4","p8"]',
    'Ningún tramo pasa de 3 paradas intermedias', JSON.stringify({ t9: d.t9, maxWps: d.maxWps }));
  check(!/origin=/.test(d.sinOrigen), 'Sin origen, el link deja que Maps arranque desde el teléfono');

  // "Cerca mío" con 6 pendientes: el panel lista los tramos.
  const d2 = await page.evaluate(() => {
    const abiertas = [];
    const prev = window.open; window.open = (u) => { abiertas.push(u); return null; };
    _mapaUserLatLng = [-31.2, -64.3];
    _mapaCercaList = Array.from({ length: 6 }, (_, i) => ({
      e: { id: 9000 + i, clientName: 'Cliente <b>' + i, snapshot: { workMapLink: (-31.2 - i * 0.01) + ',-64.3' } },
      ll: [-31.2 - i * 0.01, -64.3], dist: i,
    }));
    mapaRenderCerca(_mapaCercaList);
    mapaArmarRuta();
    const btns = [...document.querySelectorAll('#mapa-tramos .mapa-tramo-btn')];
    const escapado = !document.querySelector('#mapa-tramos b');
    btns[1].click();
    window.open = prev;
    return { n: btns.length, txt: btns.map(x => x.textContent.replace(/\s+/g, ' ').trim()), abiertas, escapado };
  });
  check(d2.n === 2 && d2.abiertas.length === 1 && /origin=-31\.23/.test(d2.abiertas[0]),
    '"Cerca mío" con 6 pendientes ofrece 2 tramos y cada botón abre el suyo', JSON.stringify(d2));
  check(d2.escapado, 'Los nombres de los tramos van escapados');

  // "Ruta del día" con 6 trabajos: aviso con un botón por tramo.
  const d3 = await page.evaluate(() => {
    const prevT = getTrabajosDeHoy;
    getTrabajosDeHoy = () => Array.from({ length: 6 }, (_, i) => ({ snapshot: { workMapLink: (-31.2 - i * 0.01) + ',-64.3' } }));
    const abiertas = []; const prev = window.open; window.open = (u) => { abiertas.push(u); return null; };
    rutaDelDiaMaps();
    const toastEl = [...document.querySelectorAll('.toast-action')].pop();
    const btns = toastEl ? [...toastEl.querySelectorAll('.toast-btn')].map(b => b.textContent) : [];
    getTrabajosDeHoy = () => Array.from({ length: 3 }, (_, i) => ({ snapshot: { workMapLink: (-31.2 - i * 0.01) + ',-64.3' } }));
    rutaDelDiaMaps();
    getTrabajosDeHoy = prevT; window.open = prev;
    return { btns, abiertas };
  });
  check(JSON.stringify(d3.btns) === '["Tramo 1","Tramo 2"]', '"Ruta del día" con 6 paradas ofrece los tramos', JSON.stringify(d3.btns));
  check(d3.abiertas.length === 1 && !/origin=/.test(d3.abiertas[0]), '"Ruta del día" con 3 paradas abre directo, como antes');

  // ── E) Barra de totales y el arranque ─────────────────────────────────
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
  await p2.setRequestInterception(true);
  p2.on('request', (req) => { if (req.url().startsWith('file://')) req.continue(); else req.abort(); });
  // El usuario toca "Mapa" antes de que termine el arranque: este listener
  // corre antes que el init de la app (se registra primero).
  await p2.evaluateOnNewDocument(() => {
    document.addEventListener('DOMContentLoaded', () => { try { switchTab('mapa'); } catch (_) {} });
  });
  await p2.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await p2.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
  const e = await p2.evaluate(() => ({
    mapa: document.getElementById('panel-mapa').classList.contains('active'),
    sticky: getComputedStyle(document.getElementById('sticky-totals')).display,
    clase: document.body.classList.contains('has-sticky-totals'),
  }));
  check(e.mapa && e.sticky === 'none' && !e.clase, 'Cambiar de pestaña durante el arranque no deja la barra de totales encima', JSON.stringify(e));
  // Y en el arranque normal, en el Editor, la barra está.
  const p3 = await browser.newPage();
  await p3.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await p3.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
  const e2 = await p3.evaluate(() => getComputedStyle(document.getElementById('sticky-totals')).display);
  check(e2 !== 'none', 'En el arranque normal la barra de totales se ve en el Editor', e2);

  check(errores.length === 0, 'Sin errores de JavaScript', errores.join(' | '));

  if (process.env.SNAP) {
    await page.evaluate(async () => { _mapa.setView([-31.215, -64.3], 14, { animate: false }); await new Promise(r => setTimeout(r, 200)); });
    await page.screenshot({ path: process.env.SNAP });
  }

  await browser.close();
  console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
