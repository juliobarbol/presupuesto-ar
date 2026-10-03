// test/revision-fallas.test.cjs — Fallas técnicas de la revisión de octubre 2026.
//
// Lo que se protege:
//
//   1. Backup a Drive: la subida tiene tiempo según el tamaño
//      (gdriveTimeoutSubida) y su fallo no abre el cortacircuitos (sinCorte).
//      Antes salía con el corte general de 12 s: un backup de 15 MB no
//      llegaba a subir con datos móviles. Y una subida a la vez.
//   2. Service Worker — notificación tocada con la app abierta: el destino
//      viaja por mensaje (`pq-go`) y la página lo resuelve (irDestino).
//   3. Service Worker — navegación con un 5xx: se entrega la copia guardada,
//      no la página de error. Una redirección (status 0) pasa tal cual.
//   4. Service Worker — html2pdf vive en una caché aparte (pq-vendor) que el
//      activate de una versión nueva no borra.
//   5. index.html sin bytes NUL (grep lo leía como binario).
//
// Las partes del SW se prueban en node con un `self` falso: el SW real no se
// puede registrar desde file://. El ciclo real del SW lo cubre test/pwa.test.cjs.
//
// Uso:  node test/revision-fallas.test.cjs

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (_) {}
const EXEC = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_HEADLESS_SHELL;

const ROOT = path.resolve(__dirname, '..');
const APP = 'file://' + path.join(ROOT, 'index.html');

let allOk = true;
const check = (name, ok, extra) => {
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

// ── Service Worker en un `self` falso ──
function cargarSW({ fetchImpl, cachesImpl, clientsImpl }) {
  const handlers = {};
  const self = {
    addEventListener: (t, fn) => { handlers[t] = fn; },
    location: { origin: 'https://app.test' },
    registration: { showNotification: async () => {} },
    skipWaiting: async () => {},
  };
  self.clients = clientsImpl;
  const ctx = vm.createContext({
    self, caches: cachesImpl, clients: clientsImpl, fetch: fetchImpl,
    navigator: {}, Request, Response, URL, AbortController, setTimeout, clearTimeout,
    Promise, console, indexedDB: undefined,
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx);
  return handlers;
}
// Caché falsa: Map por nombre → Map por URL.
function cachesFalsas(semilla) {
  const stores = new Map();
  const abrir = (n) => { if (!stores.has(n)) stores.set(n, new Map()); return stores.get(n); };
  Object.entries(semilla || {}).forEach(([n, urls]) => {
    const st = abrir(n); Object.entries(urls).forEach(([u, body]) => st.set(u, body));
  });
  const key = (r) => (typeof r === 'string' ? new URL(r, 'https://app.test/').href : r.url);
  const api = {
    stores,
    open: async (n) => {
      const st = abrir(n);
      return {
        match: async (r) => (st.has(key(r)) ? new Response(st.get(key(r)), { status: 200 }) : undefined),
        put: async (r, res) => { st.set(key(r), await res.text()); },
        add: async () => {},
      };
    },
    match: async (r) => {
      for (const st of stores.values()) if (st.has(key(r))) return new Response(st.get(key(r)), { status: 200 });
      return undefined;
    },
    keys: async () => [...stores.keys()],
    delete: async (n) => stores.delete(n),
  };
  return api;
}
async function disparar(h, tipo, ev) {
  let promesa = null;
  const e = Object.assign({ respondWith: (p) => { promesa = p; }, waitUntil: (p) => { promesa = p; } }, ev);
  h[tipo](e);
  return promesa ? await promesa : undefined;
}

(async () => {

  // ── 2: notificación tocada con la app abierta ──
  {
    const mensajes = [], enfocadas = [], abiertas = [];
    const ventana = { focus: async () => { enfocadas.push(1); }, postMessage: (m) => mensajes.push(m) };
    const h = cargarSW({ fetchImpl: async () => new Response(''), cachesImpl: cachesFalsas(),
      clientsImpl: { matchAll: async () => [ventana], openWindow: async (u) => abiertas.push(u), claim: async () => {} } });
    await disparar(h, 'notificationclick', { notification: { close() {}, data: { go: 'historial' } } });
    check('Con la app abierta, la notificación manda el destino por mensaje',
      mensajes.length === 1 && mensajes[0].type === 'pq-go' && mensajes[0].go === 'historial', JSON.stringify(mensajes));
    check('…y trae la app al frente sin abrir otra', enfocadas.length === 1 && abiertas.length === 0);
    const h2 = cargarSW({ fetchImpl: async () => new Response(''), cachesImpl: cachesFalsas(),
      clientsImpl: { matchAll: async () => [], openWindow: async (u) => abiertas.push(u), claim: async () => {} } });
    await disparar(h2, 'notificationclick', { notification: { close() {}, data: { go: 'historial' } } });
    check('Con la app cerrada, la abre en el destino', abiertas[0] === './?go=historial', abiertas[0]);
  }

  // ── 3: navegación con error del servidor ──
  {
    const C = 'presupuesto-' + /CACHE_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'))[1].replace(/^presupuesto-/, '');
    const nav = (status) => cargarSW({
      fetchImpl: async () => new Response(status === 0 ? null : 'error', { status: status === 0 ? 200 : status }),
      cachesImpl: cachesFalsas({ [C]: { 'https://app.test/index.html': 'APP GUARDADA' } }),
      clientsImpl: { matchAll: async () => [], claim: async () => {} } });
    const req = new Request('https://app.test/', { mode: 'same-origin' });
    Object.defineProperty(req, 'mode', { value: 'navigate' });
    const r503 = await disparar(nav(503), 'fetch', { request: req });
    check('Un 503 en la navegación entrega la copia guardada', (await r503.text()) === 'APP GUARDADA');
    const r200 = await disparar(nav(200), 'fetch', { request: req });
    check('Un 200 entrega la versión nueva', (await r200.text()) === 'error');  // el cuerpo falso del 200
  }

  // ── 4: html2pdf sobrevive al cambio de versión ──
  {
    const caches = cachesFalsas({ 'pq-vendor': { 'https://app.test/vendor/html2pdf.bundle.min.js': 'LIB' },
      'presupuesto-v1': { 'https://app.test/index.html': 'vieja' } });
    const h = cargarSW({ fetchImpl: async () => { throw new Error('sin señal'); }, cachesImpl: caches,
      clientsImpl: { matchAll: async () => [], claim: async () => {} } });
    await disparar(h, 'activate', {});
    const quedan = [...caches.stores.keys()];
    check('Al activar una versión nueva, la caché de html2pdf no se borra',
      quedan.includes('pq-vendor') && !quedan.includes('presupuesto-v1'), quedan.join(', '));
    const req = new Request('https://app.test/vendor/html2pdf.bundle.min.js');
    const r = await disparar(h, 'fetch', { request: req });
    check('Sin señal, html2pdf sale de su caché', r && (await r.text()) === 'LIB');
    // Con señal y caché vacía, se guarda en pq-vendor (no en la de la versión).
    const caches2 = cachesFalsas();
    const h2 = cargarSW({ fetchImpl: async () => new Response('LIB2', { status: 200 }), cachesImpl: caches2,
      clientsImpl: { matchAll: async () => [], claim: async () => {} } });
    await disparar(h2, 'fetch', { request: new Request('https://app.test/vendor/html2pdf.bundle.min.js') });
    await new Promise((r) => setTimeout(r, 20));
    check('La primera descarga queda en pq-vendor',
      caches2.stores.has('pq-vendor') && caches2.stores.get('pq-vendor').size === 1);
  }

  // ── 5: sin bytes NUL ──
  {
    const buf = fs.readFileSync(path.join(ROOT, 'index.html'));
    check('index.html no tiene bytes NUL', buf.indexOf(0) === -1);
  }

  // ── 1 y 2 (lado página): en el navegador ──
  if (!puppeteer || !EXEC) {
    console.log('SKIP  partes en el navegador (falta puppeteer-core o el ejecutable)');
  } else {
    const browser = await puppeteer.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
      await page.goto(APP, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 1000));
      const r = await page.evaluate(async () => {
        const out = {};
        out.t1 = gdriveTimeoutSubida(1000);
        out.t15 = gdriveTimeoutSubida(15e6);
        out.t100 = gdriveTimeoutSubida(100e6);
        // gdriveUpload con un backup de 5 MB: qué le pasa a netFetch.
        const orig = { netFetch, gdriveGetToken, gdriveFindFile, buildBackupObject };
        const llamadas = [];
        netFetch = async (url, opts, o) => { llamadas.push({ url, o }); return new Response('{}', { status: 200 }); };
        gdriveGetToken = async () => 'tok';
        gdriveFindFile = async () => ({ id: 'abc' });
        buildBackupObject = () => ({ relleno: 'x'.repeat(5e6) });
        await gdriveUpload();
        // Solo las subidas (desde la v230 antes se pide la lista de fotos de Drive).
        out.subida = llamadas.filter((l) => /\/upload\//.test(l.url)).map((l) => l.o);
        netFetch = orig.netFetch; gdriveGetToken = orig.gdriveGetToken;
        gdriveFindFile = orig.gdriveFindFile; buildBackupObject = orig.buildBackupObject;
        // sinCorte: un timeout no suma fallos de red; uno común sí.
        const fetchOrig = window.fetch;
        window.fetch = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
        NET._fails = 0;
        try { await netFetch('https://x.test/', {}, { timeout: 30, sinCorte: true }); } catch (_) {}
        out.failsSinCorte = NET._fails;
        try { await netFetch('https://x.test/', {}, { timeout: 30 }); } catch (_) {}
        out.failsComun = NET._fails;
        window.fetch = fetchOrig; NET._fails = 0; NET._corteHasta = 0;
        // Una subida a la vez.
        let soltar; let corridas = 0;
        const upOrig = gdriveUpload;
        gdriveUpload = () => { corridas++; return new Promise((r) => { soltar = r; }); };
        const p1 = gdriveAutoUpload();
        const p2 = gdriveAutoUpload();
        out.mismaPromesa = p1 === p2;
        out.corridasEnCurso = corridas;
        out.repetir = GDRIVE._repetir === true;
        const schedOrig = scheduleGdriveBackup; let reprogramada = false;
        scheduleGdriveBackup = () => { reprogramada = true; };
        soltar(); await p1;
        out.reprogramada = reprogramada;
        out.libre = GDRIVE._subiendo === null;
        gdriveUpload = upOrig; scheduleGdriveBackup = schedOrig;
        // Destino de una notificación con la app abierta.
        switchTab('editor');
        irDestino('historial');
        out.destino = document.querySelector('.tab-panel.active').id;
        return out;
      });
      check('El tiempo de subida crece con el tamaño (30 s de base, techo 10 min)',
        r.t1 === 31000 && r.t15 > 300000 && r.t100 === 600000, `1KB=${r.t1} 15MB=${r.t15} 100MB=${r.t100}`);
      check('La subida a Drive usa ese tiempo y no abre el cortacircuitos',
        r.subida.length === 1 && r.subida[0] && r.subida[0].sinCorte === true && r.subida[0].timeout >= 155000,
        JSON.stringify(r.subida));
      check('Con sinCorte, un timeout no cuenta como fallo de red', r.failsSinCorte === 0);
      check('Sin sinCorte, el timeout sí cuenta (el cortacircuitos sigue andando)', r.failsComun === 1);
      check('Una subida a Drive a la vez', r.mismaPromesa && r.corridasEnCurso === 1 && r.repetir,
        JSON.stringify({ misma: r.mismaPromesa, corridas: r.corridasEnCurso, repetir: r.repetir }));
      check('Lo que cambió durante la subida sale en otra al terminar', r.reprogramada && r.libre);
      check('irDestino lleva a la pestaña de la notificación', r.destino === 'panel-historial', r.destino);
      await page.close();
    } finally {
      await browser.close();
    }
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
