// Conexión de Google Calendar por REDIRECCIÓN (sin ventana emergente).
//
// El flujo con popup falla en algunos dispositivos: Google devuelve
// `popup_closed` tanto en la app instalada como en una pestaña del navegador,
// y ahí no hay forma de conectar. El camino por redirección no usa ventanas:
// la app navega a Google y vuelve con el token en el fragmento de la URL.
//
// Corre sobre HTTP real (no file://) porque hace falta history.replaceState y
// un origin de verdad para armar la URI de retorno.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8700 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}/index.html`;

const puppeteer = require('puppeteer-core');
const EXEC = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_HEADLESS_SHELL
  || '/root/.cache/cc-headless/chrome-headless-shell-linux64/chrome-headless-shell';

let fallos = 0;
function check(ok, nombre, detalle) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nombre + (detalle ? '  — ' + detalle : ''));
  if (!ok) fallos++;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};
const JSONRES = (obj) => ({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) });

async function nuevaPagina(browser) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  const navegaciones = [];
  page.on('request', (req) => {
    const u = req.url();
    // La ida a Google: la registramos y la cortamos (no salimos a internet).
    if (u.indexOf('accounts.google.com/o/oauth2') >= 0) {
      navegaciones.push(u);
      return req.abort();
    }
    if (u.indexOf('accounts.google.com/gsi/client') >= 0) {
      return req.respond({ status: 200, contentType: 'text/javascript', body: 'window.__gis=1;' });
    }
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS, body: '' });
    if (u.indexOf('/oauth2/v3/userinfo') >= 0) return req.respond(JSONRES({ email: 'test@example.com' }));
    if (/\/calendar\/v3\/calendars\/[^/]+\/events/.test(u)) return req.respond(JSONRES({ items: [] }));
    if (/\/calendar\/v3\/calendars/.test(u)) return req.respond(JSONRES({ id: 'cal_redir' }));
    if (u.indexOf('127.0.0.1') >= 0) return req.continue();
    return req.respond({ status: 204, headers: CORS, body: '' });
  });
  page.__navegaciones = navegaciones;
  return page;
}

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  const browser = await puppeteer.launch({ executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  try {
    // ── 1) La ida: se arma la URL de Google con lo que corresponde ──
    const p1 = await nuevaPagina(browser);
    await p1.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p1.evaluate(() => { localStorage.setItem('pq_gdrive_email', 'test@example.com'); });
    await p1.evaluate(() => { gcalConnectRedirect(); }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));

    const ida = p1.__navegaciones[0] || '';
    const u = ida ? new URL(ida) : null;
    check(!!u, 'Navega a Google (sin abrir ninguna ventana)', ida.slice(0, 60));
    check(!!u && u.searchParams.get('response_type') === 'token', 'response_type=token (sin client_secret)');
    check(!!u && /calendar\.app\.created/.test(u.searchParams.get('scope') || ''), 'Pide el scope calendar.app.created');
    check(!!u && u.searchParams.get('redirect_uri') === `http://127.0.0.1:${PORT}/`,
      'La URI de retorno es el origen de la app', u ? u.searchParams.get('redirect_uri') : '');
    check(!!u && u.searchParams.get('login_hint') === 'test@example.com', 'Manda login_hint con la cuenta recordada');
    const state = u ? u.searchParams.get('state') : '';
    check(!!state && /^gcal_/.test(state), 'Manda un state propio', state);

    // La navegación a Google se abortó, así que el documento quedó en el error:
    // volvemos a la app (misma pestaña) para leer el sessionStorage.
    await p1.goto(BASE, { waitUntil: 'domcontentloaded' });
    const guardado = await p1.evaluate(() => sessionStorage.getItem('pq_gcal_state'));
    check(guardado === state, 'Guarda el state para validar la vuelta', guardado);

    // ── 2) La vuelta: token en el fragmento ──
    const p2 = await nuevaPagina(browser);
    await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p2.evaluate((st) => { sessionStorage.setItem('pq_gcal_state', st); }, state);
    const r2 = await p2.evaluate(async (st) => {
      location.hash = 'access_token=tok_redir&expires_in=3600&state=' + st +
        '&scope=' + encodeURIComponent('https://www.googleapis.com/auth/calendar.app.created openid email');
      const manejado = gcalHandleRedirectReturn();
      await new Promise((r) => setTimeout(r, 500));
      return {
        manejado,
        hash: location.hash,
        on: localStorage.getItem('pq_gcal_on'),
        calId: localStorage.getItem('pq_gcal_id'),
        state: sessionStorage.getItem('pq_gcal_state'),
      };
    }, state);

    check(r2.manejado === true, 'Reconoce la vuelta de Google');
    check(r2.on === '1', 'Queda conectado sin ninguna ventana', 'pq_gcal_on=' + r2.on);
    check(r2.calId === 'cal_redir', 'Sincroniza y guarda el calendarId', 'pq_gcal_id=' + r2.calId);
    check(r2.hash === '', 'Saca el token de la barra de direcciones', 'hash="' + r2.hash + '"');
    check(!r2.state, 'Consume el state (no se puede reusar)');

    // ── 3) Un fragmento con state ajeno NO se acepta ──
    const p3 = await nuevaPagina(browser);
    await p3.goto(BASE, { waitUntil: 'domcontentloaded' });
    const r3 = await p3.evaluate(() => {
      localStorage.removeItem('pq_gcal_on');   // limpiar lo que dejó el caso anterior
      sessionStorage.setItem('pq_gcal_state', 'gcal_el_nuestro');
      location.hash = 'access_token=tok_ajeno&expires_in=3600&state=gcal_otro';
      const manejado = gcalHandleRedirectReturn();
      return { manejado, on: localStorage.getItem('pq_gcal_on') };
    });
    check(r3.manejado === false, 'Ignora un fragmento con state que no pedimos');
    check(!r3.on, 'Y no conecta nada', 'pq_gcal_on=' + r3.on);

    // ── 4) Si Google devuelve error, se muestra ──
    const p4 = await nuevaPagina(browser);
    await p4.goto(BASE, { waitUntil: 'domcontentloaded' });
    const r4 = await p4.evaluate(() => {
      localStorage.removeItem('pq_gcal_on');
      sessionStorage.setItem('pq_gcal_state', 'gcal_err');
      location.hash = 'error=access_denied&error_description=User+denied&state=gcal_err';
      const manejado = gcalHandleRedirectReturn();
      const t = document.querySelector('#toast-container .toast');
      return { manejado, texto: t ? t.textContent : '', on: localStorage.getItem('pq_gcal_on') };
    });
    check(r4.manejado === true && /access_denied/.test(r4.texto),
      'Un error de Google se muestra con su código', r4.texto.slice(0, 70));
    check(!r4.on, 'Y no queda marcado como conectado');
  } finally {
    await browser.close();
    srv.kill();
  }

  console.log(fallos ? '\n✗ ' + fallos + ' CHECK(S) FALLARON' : '\n✓ TODOS LOS CHECKS OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
