// Precarga de la librería de Google (GIS) al iniciar.
//
// El botón "Conectar Google Calendar" abre un popup, y el navegador solo lo
// permite mientras dura el gesto del usuario. Si al tocarlo todavía hay que
// bajar accounts.google.com/gsi/client, el popup llega tarde y Chrome lo cierra
// → `popup_closed`, que parece falta de permisos y no lo es.
//
// Los dos caminos de init cortan antes de cargar GIS (Drive si ya hay datos
// locales; Calendar si no está conectado), así que sin preloadGIS() la primera
// conexión de Calendar arranca siempre con la librería fría. Este test fija ese
// comportamiento en el escenario real: Drive conectado CON presupuestos locales
// y Calendar sin conectar.
//
// Y fija la regla de CLAUDE.md: al abrir NUNCA se pide un token.

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = process.env.CHROME_PATH
  || '/root/.cache/cc-headless/chrome-headless-shell-linux64/chrome-headless-shell';
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

let fallos = 0;
function check(ok, nombre, detalle) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nombre + (detalle ? '  — ' + detalle : ''));
  if (!ok) fallos++;
}

// Stub de GIS: no salimos a la red. Registra si alguien pidió un token.
const GIS_STUB = `
  window.__gisLoaded = true;
  window.__tokenRequests = [];
  window.google = { accounts: { oauth2: {
    initTokenClient: (cfg) => ({
      requestAccessToken: (req) => { window.__tokenRequests.push({ scope: cfg.scope, req: req }); },
    }),
    revoke: () => {},
  } } };
`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);

  let pedidosGIS = 0;
  page.on('request', (req) => {
    if (req.url().indexOf('accounts.google.com/gsi/client') >= 0) {
      pedidosGIS++;
      return req.respond({ status: 200, contentType: 'text/javascript', body: GIS_STUB });
    }
    // Nada más sale a la red en este test.
    if (req.url().startsWith('file://')) return req.continue();
    return req.respond({ status: 204, body: '' });
  });

  // Escenario del usuario: Drive conectado, con presupuestos locales guardados,
  // y Calendar SIN conectar.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('pq_gdrive_on', '1');
    localStorage.setItem('pq_gdrive_email', 'test@example.com');
    localStorage.setItem('pq_history', JSON.stringify([
      { id: 1, quoteNumber: '0001', date: '2026-07-01', total: 100000, currency: 'ARS', snapshot: {} },
    ]));
    localStorage.removeItem('pq_gcal_on');
  });

  await page.goto(INDEX, { waitUntil: 'load' });

  // La precarga es diferida (requestIdleCallback con timeout 3000).
  await page.waitForFunction('window.__gisLoaded === true', { timeout: 10000 })
    .catch(() => {});

  const r = await page.evaluate(() => ({
    gisListo: !!(window.google && window.google.accounts && window.google.accounts.oauth2),
    tokens: (window.__tokenRequests || []).length,
    drive: localStorage.getItem('pq_gdrive_on'),
    gcal: localStorage.getItem('pq_gcal_on'),
    historial: JSON.parse(localStorage.getItem('pq_history') || '[]').length,
  }));

  check(r.drive === '1' && !r.gcal && r.historial === 1,
    'Escenario: Drive conectado con datos locales, Calendar sin conectar',
    'drive=' + r.drive + ' gcal=' + r.gcal + ' historial=' + r.historial);

  check(pedidosGIS > 0, 'Se precarga la librería de Google al iniciar', pedidosGIS + ' pedido(s)');
  check(r.gisListo, 'google.accounts.oauth2 quedó disponible antes de tocar "Conectar"');
  check(r.tokens === 0, 'Al abrir NUNCA se pide token (regla de CLAUDE.md)', r.tokens + ' pedidos de token');

  // Con GIS caliente, el tap en "Conectar" pide el token en el acto (sin red de
  // por medio, que es lo que mataba el popup).
  await page.evaluate(() => { window.__tokenRequests = []; gcalConnect(); });
  await page.waitForFunction('window.__tokenRequests.length > 0', { timeout: 3000 }).catch(() => {});
  const t = await page.evaluate(() => window.__tokenRequests[0] || null);

  check(!!t, 'Tocar "Conectar" pide el token de una (sin esperar la red)');
  check(!!t && /calendar\.app\.created/.test(t.scope), 'Pide el scope calendar.app.created',
    t ? t.scope : '(sin pedido)');
  // El primer pedido es SIN ventana a propósito (ver test/gcal-connect.test.cjs):
  // acá lo que se fija es que salga de una, sin esperar la red.
  check(!!t && t.req && t.req.prompt === 'none', 'Arranca por el pedido silencioso',
    t && t.req ? 'prompt=' + t.req.prompt : '(sin pedido)');

  // Y el camino frío: sin GIS, avisa y no dispara un popup condenado.
  const page2 = await browser.newPage();
  await page2.setRequestInterception(true);
  page2.on('request', (req) => {
    if (req.url().indexOf('accounts.google.com/gsi/client') >= 0) return req.abort();
    if (req.url().startsWith('file://')) return req.continue();
    return req.respond({ status: 204, body: '' });
  });
  await page2.goto(INDEX, { waitUntil: 'load' });
  const frio = await page2.evaluate(async () => {
    delete window.google;
    await gcalConnect();
    const t = document.querySelector('#toast-container .toast');
    return t ? t.textContent : '';
  });
  check(/volvé a tocar/i.test(frio), 'Librería fría: pide un segundo toque en vez de fallar', frio.slice(0, 60));

  await browser.close();
  console.log(fallos ? '\n✗ ' + fallos + ' CHECK(S) FALLARON' : '\n✓ TODOS LOS CHECKS OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
