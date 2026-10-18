// test/push-v239.test.cjs — Notificaciones a medida (v239).
//
// El pedido, después de ver las opciones: "quiero que implementemos todo".
//   1. Horarios a medida (resumen, noche anterior, anticipación) y días sin avisos.
//   2. Un resumen por día en vez de avisos sueltos.
//   3. Seguimientos/vencidos: el día que tocan y una vez más a la semana (antes,
//      todos los días hasta marcarlos).
//   4. Botones en la notificación: "Cómo llegar", "WhatsApp", "Posponer 1 h".
//   5. Clima con la app cerrada: el Worker mira el pronóstico la noche anterior.
//   6. Los lunes: la semana, lo que espera respuesta y el tope de facturación.
//
// Parte W — Worker (push-worker/index.js) con KV, Open-Meteo y push simulados.
// Parte S — Service Worker (sw.js) cargado en un entorno falso.
// Parte A — App en navegador headless.
//
// Uso:  node test/push-v239.test.cjs

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const nc = require('node:crypto');

let allOk = true;
const check = (name, ok, extra) => {
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ROOT = path.resolve(__dirname, '..');

function descifrar(cuerpo, uaE, authB) {
  const salt = cuerpo.subarray(0, 16), idlen = cuerpo[20], asPub = cuerpo.subarray(21, 21 + idlen), ct = cuerpo.subarray(21 + idlen);
  const ikm = Buffer.from(nc.hkdfSync('sha256', uaE.computeSecret(asPub), authB, Buffer.concat([Buffer.from('WebPush: info\0'), uaE.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(nc.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(nc.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = nc.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(pt.subarray(0, pt.length - 1).toString());
}

// ─────────────────────────────── Worker ───────────────────────────────
async function parteWorker() {
  const mod = await import(path.join(ROOT, 'push-worker', 'index.js'));
  const W = mod.default;

  // W1 — botones
  const acts = mod.actsValidos([
    { a: 'maps', url: 'https://www.google.com/maps/dir/?api=1&destination=-34.6,-58.4' },
    { a: 'posponer' }, { a: 'wa', url: 'https://wa.me/5491112345678' },
  ]);
  check('W1 botones: dos como mucho, en orden', acts.length === 2 && acts[0].a === 'maps' && acts[1].a === 'posponer', JSON.stringify(acts));
  const malos = [
    { a: 'maps', url: 'javascript:alert(1)' }, { a: 'maps', url: 'http://www.google.com/maps/x' },
    { a: 'maps', url: 'https://evil.com/maps/' }, { a: 'wa', url: 'https://wa.me/abc' },
    { a: 'wa', url: 'https://wa.me/123?text=hola' }, { a: 'borrar' },
  ];
  check('W1 botones: URLs ajenas a Maps/WhatsApp se descartan', malos.every(x => mod.actsValidos([x]).length === 0));

  // W2 — puntos de clima
  const cv = mod.climaValido({ d: '2026-10-12', pts: Array.from({ length: 8 }, (_, i) => ({ la: -34.4567 - i, lo: -58.9123, n: 'Cliente ' + i })) });
  check('W2 clima: redondea a 2 decimales y corta en 5 puntos', cv && cv.pts.length === 5 && cv.pts[0].la === -34.46 && cv.pts[0].lo === -58.91, JSON.stringify(cv && cv.pts[0]));
  check('W2 clima: fecha o puntos inválidos → nada', mod.climaValido({ d: 'mañana', pts: [{ la: 1, lo: 1 }] }) === null && mod.climaValido({ d: '2026-10-12', pts: [{ la: 'x', lo: 1 }] }) === null);

  // W3 — umbrales (mismos que la app)
  check('W3 umbral: 60 % de lluvia es lluvia', !!(mod.climaMotivo({ pp: 60 }) || {}).lluvia);
  check('W3 umbral: ráfaga de 50 km/h es viento', !!(mod.climaMotivo({ gust: 50 }) || {}).viento);
  check('W3 umbral: día tranquilo no avisa', mod.climaMotivo({ pp: 10, mm: 0, gust: 20, code: 2 }) === null);

  // Entorno: KV + Open-Meteo + servicio de push.
  const subtle = nc.webcrypto.subtle;
  const vapid = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const uaE = nc.createECDH('prime256v1'); uaE.generateKeys();
  const authB = nc.randomBytes(16);
  const sub = { endpoint: 'https://push.example/v239', keys: { p256dh: b64u(uaE.getPublicKey()), auth: b64u(authB) } };
  const kv = new Map();
  const env = {
    VAPID_PUBLIC_KEY: b64u(await subtle.exportKey('raw', vapid.publicKey)),
    VAPID_PRIVATE_KEY: (await subtle.exportKey('jwk', vapid.privateKey)).d, VAPID_SUBJECT: 'mailto:x@y.z',
    PUSH_KV: {
      get: async (k) => kv.has(k) ? kv.get(k) : null,
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }),
    },
  };
  let payloads = [], meteo = [], pronostico = { gust: 55, pp: 10, mm: 0, code: 2, wind: 30 }, meteoFalla = false;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.open-meteo.com/')) {
      meteo.push(String(url));
      if (meteoFalla) throw new Error('sin señal');
      const d = new URL(url).searchParams.get('start_date');
      return { ok: true, status: 200, json: async () => ({ daily: {
        time: [d], weather_code: [pronostico.code], precipitation_probability_max: [pronostico.pp],
        precipitation_sum: [pronostico.mm], wind_speed_10m_max: [pronostico.wind], wind_gusts_10m_max: [pronostico.gust],
      } }) };
    }
    payloads.push(descifrar(Buffer.from(opts.body), uaE, authB));
    return { ok: true, status: 201 };
  };
  const ORIGIN = 'https://presupuesto-ar.juliobarribolbo.workers.dev';
  const req = (p, body) => new Request('https://w.dev' + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body),
  });
  const DEV = 'pq-1700000000000-v239a';
  // 19:05 del 11/10 en Argentina = 22:05 UTC.
  const T = Date.UTC(2026, 9, 11, 22, 5);
  const suscribir = (avisos) => W.fetch(req('/subscribe', { deviceId: DEV, subscription: sub, tz: 180, followups: [], expiries: [], avisos }), env);
  const pts = [{ la: -34.4567, lo: -58.9123, n: 'García' }];

  // W4 — "Mañana" con clima feo: sale con el clima adelante.
  await suscribir([
    { k: 'man:2026-10-12', at: '2026-10-11T19:00', title: 'Mañana: 1 trabajo', body: 'Trabajo · García', go: 'agenda:2026-10-12', tag: 'pq-manana',
      clima: { d: '2026-10-12', pts }, acts: [{ a: 'wa', url: 'https://wa.me/5491112345678' }] },
  ]);
  payloads = []; meteo = [];
  await mod.runDue(env, T);
  const p4 = payloads[0] || {};
  check('W4 "Mañana" con ráfagas: título con 💨 y el clima en el cuerpo', /^💨 Mañana: 1 trabajo/.test(p4.title || '') && /Ráfagas de 55 km\/h — García/.test(p4.body || '') && /Trabajo · García/.test(p4.body || ''), JSON.stringify(p4));
  check('W4 consulta Open-Meteo con coordenadas redondeadas y el día', meteo.length === 1 && /latitude=-34.46&longitude=-58.91/.test(meteo[0]) && /start_date=2026-10-12/.test(meteo[0]), meteo[0]);
  check('W4 el botón viaja en el payload', Array.isArray(p4.acts) && p4.acts[0].a === 'wa' && !p4.k, JSON.stringify(p4.acts));

  // W5 — "solo si hay clima feo": día lindo → no sale y no se vuelve a consultar.
  kv.clear();
  await suscribir([{ k: 'clima:2026-10-12', at: '2026-10-11T19:00', title: 'Mañana: 1 trabajo', body: '', go: 'agenda:2026-10-12', tag: 'pq-clima', clima: { d: '2026-10-12', pts }, soloSiClima: true }]);
  pronostico = { gust: 20, pp: 5, mm: 0, code: 1, wind: 10 };
  payloads = []; meteo = [];
  await mod.runDue(env, T);
  await mod.runDue(env, T + 15 * 60000);
  check('W5 solo-clima con día lindo: no suena', payloads.length === 0, 'envíos: ' + payloads.length);
  check('W5 …y no vuelve a consultar el pronóstico', meteo.length === 1, 'consultas: ' + meteo.length);

  // W6 — sin pronóstico: no sale y se reintenta en la corrida siguiente.
  kv.clear();
  await suscribir([{ k: 'clima:2026-10-12', at: '2026-10-11T19:00', title: 'Mañana: 1 trabajo', body: '', go: 'agenda:2026-10-12', tag: 'pq-clima', clima: { d: '2026-10-12', pts }, soloSiClima: true }]);
  meteoFalla = true; payloads = [];
  await mod.runDue(env, T);
  meteoFalla = false; pronostico = { gust: 30, pp: 90, mm: 12, code: 63, wind: 20 };
  await mod.runDue(env, T + 15 * 60000);
  check('W6 sin señal no avisa; al volver, con lluvia, sí', payloads.length === 1 && /^🌧️ /.test(payloads[0].title) && /Lluvia \(90 %\)/.test(payloads[0].body), JSON.stringify(payloads[0]));

  // W7/W8 — Posponer
  kv.clear();
  await suscribir([{ k: 'hr:n_v1:2026-10-11:2000', at: '2026-10-11T19:00', title: 'Visita a las 20:00', body: 'López', go: 'agenda:2026-10-11:n_v1', tag: 'pq-hora-n_v1',
    acts: [{ a: 'maps', url: 'https://www.google.com/maps/dir/?api=1&destination=-34.6,-58.4' }, { a: 'posponer' }] }]);
  payloads = [];
  await mod.runDue(env, T);
  const p7 = payloads[0] || {};
  check('W7 con "Posponer", el payload dice qué aviso y de qué equipo', p7.k === 'hr:n_v1:2026-10-11:2000' && p7.dev === DEV && p7.acts.length === 2, JSON.stringify(p7));
  const realNow = Date.now;
  Date.now = () => T + 60000;    // se toca "Posponer" a las 19:06
  const r8 = await W.fetch(req('/posponer', { deviceId: DEV, k: p7.k }), env);
  Date.now = realNow;
  const reg8 = JSON.parse(kv.get('sub:' + DEV));
  check('W8 /posponer agenda el mismo aviso una hora después', r8.status === 200 && reg8.pospuestos.length === 1 && reg8.pospuestos[0].at === '2026-10-11T20:06' && reg8.pospuestos[0].title === 'Visita a las 20:00', JSON.stringify(reg8.pospuestos));
  check('W8 /posponer responde CORS a la app', r8.headers.get('Access-Control-Allow-Origin') === ORIGIN);
  const r8b = await W.fetch(req('/posponer', { deviceId: DEV, k: 'no-existe' }), env);
  const r8c = await W.fetch(req('/posponer', { deviceId: DEV, k: 'mal<k>' }), env);
  const r8d = await W.fetch(req('/posponer', { deviceId: 'otro', k: p7.k }), env);
  check('W8 /posponer rechaza aviso desconocido (404), clave mala y equipo inválido (400)', r8b.status === 404 && r8c.status === 400 && r8d.status === 400, [r8b.status, r8c.status, r8d.status].join(','));
  // Re-sincronizar la app no lo pierde.
  await suscribir(reg8.avisos);
  check('W8 /subscribe conserva lo pospuesto', JSON.parse(kv.get('sub:' + DEV)).pospuestos.length === 1);
  payloads = [];
  await mod.runDue(env, T + 30 * 60000);
  const antes = payloads.length;
  await mod.runDue(env, T + 61 * 60000);
  check('W8 el pospuesto suena a su hora (y no antes), con sus botones', antes === 0 && payloads.length === 1 && payloads[0].title === 'Visita a las 20:00' && payloads[0].acts.length === 2, `antes=${antes} después=${payloads.length}`);
  await mod.runDue(env, T + 2 * 86400000);
  check('W8 los pospuestos viejos se limpian', JSON.parse(kv.get('sub:' + DEV)).pospuestos.length === 0);
}

// ─────────────────────────── Service Worker ───────────────────────────
async function parteSW() {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const html = require('./_fuente.cjs').fuenteApp();
  const urlSW = (src.match(/const PUSH_WORKER_URL = '([^']+)'/) || [])[1];
  const urlApp = (html.match(/const PUSH_WORKER_URL = '([^']+)'/) || [])[1];
  check('S0 el SW apunta al mismo Worker que la app', urlSW && urlSW === urlApp, `${urlSW} / ${urlApp}`);

  const handlers = {};
  const mostradas = [], abiertas = [], posts = [];
  let fetchOk = true;
  const ctx = {
    console, URL, Promise, JSON, String, Array, Object, Error,
    self: {
      addEventListener: (t, fn) => { handlers[t] = fn; },
      registration: { showNotification: async (t, o) => { mostradas.push({ t, o }); } },
      location: { origin: 'https://presupuesto-ar.juliobarribolbo.workers.dev' },
    },
    clients: { matchAll: async () => [], openWindow: async (u) => { abiertas.push(u); } },
    fetch: async (u, o) => { posts.push({ u, body: o && o.body }); return { ok: fetchOk, status: fetchOk ? 200 : 404 }; },
    caches: {},
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const correr = async (tipo, ev) => { let p = null; ev.waitUntil = (x) => { p = x; }; handlers[tipo](ev); await p; };

  await correr('push', { data: { json: () => ({
    title: 'Visita a las 10:30', body: 'López', go: 'agenda:2026-10-12:n_v1', tag: 'pq-hora-n_v1', k: 'hr:n_v1:x', dev: 'pq-1-a',
    acts: [{ a: 'maps', url: 'https://www.google.com/maps/dir/?api=1&destination=-34.6,-58.4' }, { a: 'posponer' }],
  }) } });
  const n1 = mostradas[0] || { o: {} };
  check('S1 la notificación lleva los botones "Cómo llegar" y "Posponer 1 h"', JSON.stringify(n1.o.actions) === JSON.stringify([{ action: 'maps', title: 'Cómo llegar' }, { action: 'posponer', title: 'Posponer 1 h' }]), JSON.stringify(n1.o.actions));

  await correr('push', { data: { json: () => ({ title: 'x', acts: [{ a: 'maps', url: 'javascript:alert(1)' }, { a: 'wa', url: 'https://evil.com' }] }) } });
  check('S2 una URL que no es de Maps/WhatsApp no se vuelve botón', (mostradas[1].o.actions || []).length === 0);

  const notif = (data) => ({ close() {}, data });
  await correr('notificationclick', { action: 'maps', notification: notif(n1.o.data) });
  check('S3 "Cómo llegar" abre la ruta en Maps directo', abiertas[0] === 'https://www.google.com/maps/dir/?api=1&destination=-34.6,-58.4', abiertas[0]);

  await correr('notificationclick', { action: 'posponer', notification: notif(n1.o.data) });
  const post = posts[0] || {};
  check('S4 "Posponer" le avisa al Worker qué aviso y de qué equipo', post.u === urlApp + '/posponer' && JSON.parse(post.body).k === 'hr:n_v1:x' && JSON.parse(post.body).deviceId === 'pq-1-a', JSON.stringify(post));
  fetchOk = false;
  const antes = mostradas.length;
  await correr('notificationclick', { action: 'posponer', notification: notif(n1.o.data) });
  check('S4 si no se pudo posponer, lo dice en otra notificación', mostradas.length === antes + 1 && /No se pudo posponer/.test(mostradas[antes].t));

  await correr('notificationclick', { action: '', notification: notif({ go: 'agenda:2026-10-12' }) });
  check('S5 tocar la notificación (no un botón) sigue abriendo la app en su destino', /\?go=agenda%3A2026-10-12$/.test(abiertas[abiertas.length - 1] || ''), abiertas[abiertas.length - 1]);
}

// ──────────────────────────────── App ────────────────────────────────
async function parteApp() {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch (e) { console.error('Falta puppeteer-core. Corré .claude/hooks/session-start.sh'); process.exit(2); }
  const EXEC = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_HEADLESS_SHELL;
  if (!EXEC) { console.error('Falta $PUPPETEER_EXECUTABLE_PATH'); process.exit(2); }
  const browser = await puppeteer.launch({ executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
    await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1200));

    // A1 — config saneada
    const san = await page.evaluate(() => sanitizeFollowup({
      pushHoraResumen: '06:15', pushHoraNoche: '25:00', pushAntesMin: 45, pushSilencio: [0, 9, 'x', 3, 3], pushClima: 0, pushSemana: 'si',
    }));
    check('A1 sanitizeFollowup: hora válida sí, hora rota no', san.pushHoraResumen === '06:15' && !('pushHoraNoche' in san), JSON.stringify(san));
    check('A1 sanitizeFollowup: anticipación fuera de lista → 1 h; días 0–6 sin repetir', san.pushAntesMin === 60 && JSON.stringify(san.pushSilencio) === '[0,3]', JSON.stringify(san));
    check('A1 sanitizeFollowup: clima y semana como booleanos', san.pushClima === false && san.pushSemana === true);

    const r = await page.evaluate(() => {
      const hoy = today();
      const dia = (n) => _calAddDays(hoy, n);
      const ts = (iso) => iso + 'T12:00:00.000Z';
      const cfg0 = Object.assign({}, getFollowupCfg(), { enabled: true, expiryEnabled: true, estados: ['enviado'], days: 10,
        pushAgenda: true, pushHora: true, pushClima: true, pushSemana: false, pushSilencio: [] });
      setNotes([
        { id: 'n_vis', fecha: dia(2), tipo: 'visita', texto: 'Ver pino', cliente: 'López', hora: '10:30', ubic: '-34.6037,-58.3816', tel: '11 2345-6789' },
        { id: 'n_tel', fecha: dia(3), tipo: 'nota', texto: 'Llamar', cliente: 'Ruiz', hora: '09:00', tel: '11 5555-1234' },
      ]);
      setH([
        // Trabajo pasado mañana, con lugar y teléfono.
        { id: 7001, estado: 'aceptado', clientName: 'García', fechasTrabajo: [dia(1)], snapshot: { workMapLink: '-34.4567,-58.9123', clientContact: '11 4444-0000' } },
        // Vencido: dateExpiry ayer → aviso hoy (y a la semana).
        { id: 7002, estado: 'enviado', clientName: 'Pérez', quoteNumber: '2026-0002', enviadoEn: ts(dia(-3)), snapshot: { dateExpiry: dia(-1), clientContact: '11 3333-0000' } },
        // Seguimiento: enviado hace 10 días → toca hoy.
        { id: 7003, estado: 'enviado', clientName: 'Gómez', quoteNumber: '2026-0003', enviadoEn: ts(dia(-10)), snapshot: { dateExpiry: dia(20) } },
      ]);
      const now = new Date(); now.setHours(5, 0, 0, 0);
      const av = (extra) => _buildPushAvisos(Object.assign({}, cfg0, extra || {}), now);
      const base = av();
      const horas = av({ pushHoraResumen: '06:15', pushHoraNoche: '20:30', pushAntesMin: 30 });
      // Silencio el día de mañana: su resumen no sale, y la noche de hoy
      // (que avisa por mañana) solo sale si el clima está feo.
      const dowMan = new Date(dia(1) + 'T12:00').getDay();
      const sil = av({ pushSilencio: [dowMan] });
      const dowHoy = new Date(hoy + 'T12:00').getDay();
      const silHoy = av({ pushSilencio: [dowHoy] });
      const sinAg = av({ pushAgenda: false });
      const sinClima = av({ pushClima: false });
      // Semana: el próximo lunes del horizonte.
      let lunes = hoy; while (new Date(lunes + 'T12:00').getDay() !== 1) lunes = _calAddDays(lunes, 1);
      setFacturas([{ id: 1, fecha: hoy, monto: Math.round(getTope() * 0.9), concepto: 'x' }]);
      const sem = av({ pushSemana: true });
      return { hoy, dia1: dia(1), dia2: dia(2), dia3: dia(3), dia7: dia(7), dia8: dia(8), lunes, base, horas, sil, silHoy, sinAg, sinClima, sem };
    });
    const k = (lista, kk) => lista.find(a => a.k === kk);

    // A2 — horarios
    check('A2 por defecto: resumen 7:30 y noche 19 h', (k(r.base, 'hoy:' + r.hoy) || {}).at === r.hoy + 'T07:30' && (k(r.base, 'man:' + r.dia2) || {}).at === r.dia1 + 'T19:00');
    check('A2 horarios elegidos: resumen 6:15, noche 20:30', (k(r.horas, 'hoy:' + r.hoy) || {}).at === r.hoy + 'T06:15' && (k(r.horas, 'man:' + r.dia2) || {}).at === r.dia1 + 'T20:30');
    const hr30 = r.horas.find(a => a.k.startsWith('hr:n_vis:'));
    check('A2 visita con hora, 30 min antes', hr30 && hr30.at === r.dia2 + 'T10:00', hr30 && hr30.at);

    // A3 — resumen y cadencia
    const hoyAv = k(r.base, 'hoy:' + r.hoy) || {};
    check('A3 el resumen de hoy junta seguimiento y vencido', /1 seguimiento y 1 vencido/.test(hoyAv.title || '') && /Seguimiento: Gómez/.test(hoyAv.body || '') && /Vencido: Pérez/.test(hoyAv.body || ''), hoyAv.title + ' | ' + hoyAv.body);
    const venc = (d) => /Pérez/.test((k(r.base, 'hoy:' + d) || {}).body || '');
    check('A3 el vencido avisa hoy y a la semana, no todos los días', venc(r.hoy) && !venc(r.dia1) && !venc(r.dia3) && venc(r.dia7) && !venc(r.dia8));
    check('A3 ya no viajan seguimientos/vencidos sueltos (todo va en el resumen)', /const followups = \[\], expiries = \[\]/.test(require('./_fuente.cjs').fuenteApp()));
    check('A3 resumen con seguimiento + vencido va al Historial con el banner', hoyAv.go === 'historial:venc', hoyAv.go);

    // A4 — días sin avisos
    check('A4 día de silencio: no hay resumen ese día', !k(r.sil, 'hoy:' + r.dia1));
    const manSil = k(r.sil, 'man:' + r.dia2);
    check('A4 la noche anterior que cae en silencio sale solo si el clima está feo', !k(r.silHoy, 'hoy:' + r.hoy) && (k(r.silHoy, 'man:' + r.dia1) || {}).soloSiClima === true, JSON.stringify(k(r.silHoy, 'man:' + r.dia1)));
    check('A4 lo que tocaba en silencio pasa al resumen siguiente', /Pérez/.test((k(r.silHoy, 'hoy:' + r.dia1) || {}).body || ''), (k(r.silHoy, 'hoy:' + r.dia1) || {}).body);
    check('A4 los recordatorios con hora llegan igual', r.sil.some(a => a.k.startsWith('hr:n_vis:')) && !!manSil);

    // A5 — botones
    const hrVis = r.base.find(a => a.k.startsWith('hr:n_vis:')) || {};
    check('A5 visita con ubicación: "Cómo llegar" (ruta) + "Posponer"', hrVis.acts && hrVis.acts[0].a === 'maps' && /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-34\.6037,-58\.3816$/.test(hrVis.acts[0].url) && hrVis.acts[1].a === 'posponer', JSON.stringify(hrVis.acts));
    const hrTel = r.base.find(a => a.k.startsWith('hr:n_tel:')) || {};
    check('A5 recordatorio sin lugar y con teléfono: "WhatsApp" + "Posponer"', hrTel.acts && hrTel.acts[0].a === 'wa' && /^https:\/\/wa\.me\/\d{6,15}$/.test(hrTel.acts[0].url) && hrTel.acts[1].a === 'posponer', JSON.stringify(hrTel.acts));
    const man1 = k(r.base, 'man:' + r.dia1) || {};
    check('A5 noche anterior de un trabajo: WhatsApp al cliente', man1.acts && man1.acts.length === 1 && man1.acts[0].a === 'wa', JSON.stringify(man1.acts));
    check('A5 el resumen siempre ofrece "Posponer"', (hoyAv.acts || []).some(x => x.a === 'posponer'));

    // A6 — clima
    check('A6 la noche anterior manda los puntos para el clima (redondeados)', man1.clima && man1.clima.d === r.dia1 && man1.clima.pts[0].la === -34.46 && man1.clima.pts[0].lo === -58.91 && man1.clima.pts[0].n === 'García', JSON.stringify(man1.clima));
    check('A6 sin clima: el aviso no lleva puntos', !(k(r.sinClima, 'man:' + r.dia1) || {}).clima);
    const soloClima = k(r.sinAg, 'clima:' + r.dia1);
    check('A6 con la Agenda apagada queda un aviso "solo si el clima está feo"', soloClima && soloClima.soloSiClima === true && !k(r.sinAg, 'man:' + r.dia1), JSON.stringify(soloClima));

    // A7 — lunes
    const lun = k(r.sem, 'hoy:' + r.lunes) || {};
    check('A7 los lunes el resumen suma la semana y el tope', /espera(n)? respuesta/.test(lun.body || '') && /Facturación: 90 % del tope anual/.test(lun.body || ''), lun.body);
    check('A7 sin lunes de por medio, nada de eso', !Object.values(r.base).some(a => /Facturación/.test(a.body || '')));

    // A8 — UI
    const ui = await page.evaluate(() => {
      document.getElementById('push-section').style.display = '';
      document.getElementById('push-tipos').hidden = false;
      setFollowupCfg(Object.assign({}, getFollowupCfg(), { pushHoraResumen: '06:45', pushAntesMin: 60, pushSilencio: [] }));
      loadFollowupUI();
      const r0 = {
        resumen: document.getElementById('push-h-resumen').value,
        antes: document.querySelector('#push-antes [aria-pressed="true"]')?.dataset.min,
      };
      pushAntesSet(120);
      pushSilToggle(0);
      document.getElementById('push-h-noche').value = '21:15';
      pushTiposSave();
      const c = getFollowupCfg();
      return Object.assign(r0, {
        antes2: document.querySelector('#push-antes [aria-pressed="true"]')?.dataset.min,
        dom: document.querySelector('#push-silencio [data-dow="0"]').getAttribute('aria-pressed'),
        cfg: { antes: c.pushAntesMin, sil: c.pushSilencio, noche: c.pushHoraNoche, resumen: c.pushHoraResumen },
      });
    });
    check('A8 la sección muestra la hora y la anticipación guardadas', ui.resumen === '06:45' && ui.antes === '60', JSON.stringify(ui));
    check('A8 tocar "2 h antes", el domingo y la hora de la noche lo guarda', ui.antes2 === '120' && ui.dom === 'true' && ui.cfg.antes === 120 && JSON.stringify(ui.cfg.sil) === '[0]' && ui.cfg.noche === '21:15' && ui.cfg.resumen === '06:45', JSON.stringify(ui));
  } finally { await browser.close(); }
}

(async () => {
  for (const [n, f] of [['Worker', parteWorker], ['SW', parteSW], ['App', parteApp]]) {
    try { await f(); } catch (e) { allOk = false; console.log(`FAIL  parte ${n} —`, e.stack || e.message); }
  }
  console.log(allOk ? '\nOK — notificaciones a medida' : '\nFALLÓ');
  process.exit(allOk ? 0 : 1);
})();
