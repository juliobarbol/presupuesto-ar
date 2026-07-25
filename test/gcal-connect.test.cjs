// "Conectar Google Calendar" intenta SIN ventana antes de abrir el popup.
//
// Por qué importa: el popup es la parte frágil del flujo. Si Google muestra un
// error adentro (pasó de verdad: la Calendar API estaba deshabilitada), o si en
// la app instalada (manifest display:standalone) la ventana se abre afuera, GIS
// solo reporta `popup_closed` — que parece falta de permisos y no lo es.
// Cuando la cuenta ya otorgó el permiso, el pedido silencioso (prompt:'none')
// devuelve el token sin abrir nada y esa fragilidad desaparece.

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

// Stub de GIS. `window.__silentOK` decide si el pedido silencioso funciona
// (cuenta que ya dio el permiso) o falla (permiso nunca otorgado).
const GIS_STUB = `
  window.__prompts = [];
  window.google = { accounts: { oauth2: {
    initTokenClient: (cfg) => ({
      requestAccessToken: (req) => {
        window.__prompts.push(req.prompt);
        setTimeout(() => {
          if (req.prompt === 'none' && !window.__silentOK) {
            cfg.callback({ error: 'interaction_required' });
          } else {
            cfg.callback({ access_token: 'tok_' + req.prompt, expires_in: 3600, scope: cfg.scope });
          }
        }, 0);
      },
    }),
    revoke: () => {},
  } } };
`;

// La página corre en file:// (origen opaco), así que las respuestas simuladas
// necesitan CORS o el navegador las descarta antes de que las vea la app.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};
const JSONRES = (obj) => ({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) });

async function nuevaPagina(browser, silentOK) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.indexOf('accounts.google.com/gsi/client') >= 0) {
      return req.respond({ status: 200, contentType: 'text/javascript', body: GIS_STUB });
    }
    // Preflight de los POST/PATCH con Content-Type: application/json.
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS, body: '' });
    if (u.indexOf('/oauth2/v3/userinfo') >= 0) return req.respond(JSONRES({ email: 'test@example.com' }));
    if (/\/calendar\/v3\/calendars\/[^/]+\/events/.test(u)) return req.respond(JSONRES({ items: [] }));
    if (/\/calendar\/v3\/calendars$/.test(u)) return req.respond(JSONRES({ id: 'cal_123' }));
    if (/\/calendar\/v3\/calendars\//.test(u)) return req.respond(JSONRES({ id: 'cal_123' }));
    if (u.startsWith('file://')) return req.continue();
    return req.respond({ status: 204, headers: CORS, body: '' });
  });
  await page.evaluateOnNewDocument((ok) => {
    window.__silentOK = ok;
    localStorage.setItem('pq_gdrive_email', 'test@example.com');
    localStorage.removeItem('pq_gcal_on');
    localStorage.removeItem('pq_gcal_tok');
  }, silentOK);
  await page.goto(INDEX, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.google && window.google.accounts)', { timeout: 10000 }).catch(() => {});
  return page;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  // 1) La cuenta YA tiene el permiso (el caso de "antes se conectaba").
  const p1 = await nuevaPagina(browser, true);
  const r1 = await p1.evaluate(async () => {
    window.__prompts = [];
    await gcalConnect();
    return {
      prompts: window.__prompts,
      on: localStorage.getItem('pq_gcal_on'),
      calId: localStorage.getItem('pq_gcal_id'),
    };
  });
  check(r1.prompts[0] === 'none', 'Se intenta primero sin ventana (prompt=none)', 'prompts=' + JSON.stringify(r1.prompts));
  check(r1.prompts.indexOf('consent') < 0, 'Con el permiso ya otorgado NO se abre ningún popup', 'prompts=' + JSON.stringify(r1.prompts));
  check(r1.on === '1', 'Queda conectado', 'pq_gcal_on=' + r1.on);
  check(r1.calId === 'cal_123', 'Guarda el calendarId', 'pq_gcal_id=' + r1.calId);

  // 2) La cuenta NO tiene el permiso: recién ahí se abre la ventana.
  const p2 = await nuevaPagina(browser, false);
  const r2 = await p2.evaluate(async () => {
    window.__prompts = [];
    await gcalConnect();
    return { prompts: window.__prompts, on: localStorage.getItem('pq_gcal_on') };
  });
  check(r2.prompts[0] === 'none' && r2.prompts[1] === 'consent',
    'Sin permiso previo, recién ahí se pide con ventana', 'prompts=' + JSON.stringify(r2.prompts));
  check(r2.on === '1', 'Y también termina conectado', 'pq_gcal_on=' + r2.on);

  // 3) El mensaje de popup_closed reconoce la app instalada.
  const msgs = await p2.evaluate(() => {
    const e = new Error('popup_closed');
    const real = _esAppInstalada;
    window._esAppInstalada = () => true;
    const instalada = _gcalErrMsg(e);
    window._esAppInstalada = () => false;
    const navegador = _gcalErrMsg(e);
    window._esAppInstalada = real;
    return { instalada, navegador };
  });
  check(/Calendar API/.test(msgs.instalada) && /Chrome/.test(msgs.instalada),
    "App instalada: el mensaje ofrece los dos caminos (API y Chrome)", msgs.instalada.slice(0, 70));
  check(/Reintentá/.test(msgs.navegador) && !/Chrome/.test(msgs.navegador),
    'En el navegador: mensaje normal de ventana cerrada', msgs.navegador.slice(0, 60));

  await browser.close();
  console.log(fallos ? '\n✗ ' + fallos + ' CHECK(S) FALLARON' : '\n✓ TODOS LOS CHECKS OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
