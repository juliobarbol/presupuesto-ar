// test/push-avisos.test.cjs — Notificaciones con la app cerrada (v237).
//
// El reporte: "nunca las he podido utilizar bien, ni me han aparecido". Había
// tres huecos: (1) solo existían avisos de seguimiento y vencimiento — trabajos,
// visitas y recordatorios con hora nunca salían con la app cerrada; (2) nada
// decía si el circuito andaba ni dejaba probarlo; (3) si la suscripción se
// perdía, el interruptor seguía prendido y no llegaba nada.
//
// Parte A — Worker (push-worker/index.js) con KV y fetch simulados:
//   A1. /subscribe guarda los avisos con horario saneados y la zona horaria.
//   A2. runDue manda el aviso a su hora local, una sola vez, y no manda los
//       que tienen más de 3 h de atraso ni los futuros.
//   A3. Seguimientos/vencimientos salen solo en las franjas 9/14/19 h locales.
//   A4. Un 410 del servicio de push borra la suscripción muerta.
//   A5. /ping manda la prueba SOLO a ese dispositivo y frena la repetición.
//   A6. Cada tipo de aviso viaja con su tag (no se pisan entre sí).
// Parte B — App:
//   B1. _buildPushAvisos arma "Mañana" (19 h del día anterior), "Hoy" (7:30)
//       y el recordatorio 1 h antes de una visita con hora; las hechas no.
//   B2. Los tipos se apagan desde la config y sanitizeFollowup los conserva.
//   B3. La campanita invita a activar los avisos, y "Ahora no" la esconde.
//   B4. La sección de Configuración muestra el estado y los tipos.
//
// Uso:  node test/push-avisos.test.cjs

const path = require('node:path');
const { webcrypto } = require('node:crypto');

let allOk = true;
const check = (name, ok, extra) => {
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function parteWorker() {
  const subtle = webcrypto.subtle;
  // Claves VAPID y de la suscripción reales: el Worker cifra de verdad.
  const vapid = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapidPub = b64u(await subtle.exportKey('raw', vapid.publicKey));
  const vapidPriv = (await subtle.exportKey('jwk', vapid.privateKey)).d;
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sub = {
    endpoint: 'https://push.example/abc',
    keys: { p256dh: b64u(await subtle.exportKey('raw', ua.publicKey)), auth: b64u(webcrypto.getRandomValues(new Uint8Array(16))) },
  };

  const kv = new Map();
  const env = {
    VAPID_PUBLIC_KEY: vapidPub, VAPID_PRIVATE_KEY: vapidPriv, VAPID_SUBJECT: 'mailto:x@y.z',
    PUSH_KV: {
      get: async (k) => kv.has(k) ? kv.get(k) : null,
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }),
    },
  };
  // Lo que "llega" al servicio de push: se descifra el título para verificar.
  let enviados = [];
  let respuesta = 201;
  global.fetch = async (url, opts) => { enviados.push({ url, opts }); return { ok: respuesta < 300, status: respuesta }; };

  const W = (await import(path.resolve(__dirname, '..', 'push-worker', 'index.js'))).default;
  const { runDue } = await import(path.resolve(__dirname, '..', 'push-worker', 'index.js'));
  const ORIGIN = 'https://presupuesto-ar.juliobarribolbo.workers.dev';
  const req = (p, method, body) => new Request('https://w.dev' + p, {
    method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: body ? JSON.stringify(body) : undefined,
  });
  const DEV = 'pq-1700000000000-abc123';

  // A1
  const r1 = await W.fetch(req('/subscribe', 'POST', {
    deviceId: DEV, subscription: sub, tz: 180,
    followups: [{ id: 1, clientName: 'García', date: '2026-10-01', diasDesdeEnvio: 12 }],
    expiries: [],
    avisos: [
      { k: 'man:2026-10-10', at: '2026-10-09T19:00', title: 'Mañana: 1 trabajo', body: 'Trabajo · García', go: 'agenda', tag: 'pq-manana' },
      { k: 'hoy:2026-10-10', at: '2026-10-10T07:30', title: 'Hoy: 1 trabajo', body: '', go: 'agenda', tag: 'pq-hoy' },
      { k: 'viejo', at: '2026-10-09T10:00', title: 'Viejo', body: '' },
      { k: 'mal<script>', at: '2026-10-09T19:00', title: 'x' },
      { k: 'sinhora', at: 'mañana', title: 'x' },
      { k: 'go-raro', at: '2026-10-11T08:00', title: 'Go raro', go: 'javascript:alert(1)', tag: 'a b' },
    ],
  }), env);
  const rec = JSON.parse(kv.get('sub:' + DEV) || '{}');
  check('A1 /subscribe responde 200 y guarda la suscripción', r1.status === 200 && !!rec.subscription);
  check('A1 descarta avisos con clave u hora inválida', rec.avisos.map(a => a.k).join(',') === 'man:2026-10-10,hoy:2026-10-10,viejo,go-raro', rec.avisos.map(a => a.k).join(','));
  const raro = rec.avisos.find(a => a.k === 'go-raro');
  check('A1 go y tag fuera de lista vuelven al default', raro.go === 'agenda' && raro.tag === 'pq-agenda');
  check('A1 guarda la zona horaria', rec.tz === 180);

  // A2 — 19:05 hora Argentina del 9/10 = 22:05 UTC.
  const t1905 = Date.UTC(2026, 9, 9, 22, 5);
  enviados = [];
  await runDue(env, t1905);
  const tags = enviados.map(e => e.opts.headers);
  check('A2 a las 19:05 sale "Mañana" (y no el de 7:30 ni el de hace 9 h)', enviados.length === 2, 'envíos: ' + enviados.length);
  // Segundo envío = seguimiento (franja 19 h). Ver A3.
  enviados = [];
  await runDue(env, t1905 + 10 * 60000);
  check('A2 no se repite en la corrida siguiente', enviados.length === 0, 'envíos: ' + enviados.length);
  enviados = [];
  await runDue(env, Date.UTC(2026, 9, 10, 10, 35));   // 7:35 local del 10
  check('A2 a las 7:35 del día sale "Hoy"', enviados.length === 1);

  // A3 — 11:00 local: fuera de franja, el seguimiento no sale aunque esté vencido.
  const r = JSON.parse(kv.get('sub:' + DEV)); r.notified = {}; kv.set('sub:' + DEV, JSON.stringify(r));
  enviados = [];
  await runDue(env, Date.UTC(2026, 9, 10, 14, 0));
  check('A3 seguimiento fuera de franja (11 h) no sale', enviados.length === 0);
  enviados = [];
  await runDue(env, Date.UTC(2026, 9, 10, 17, 0));   // 14 h local
  check('A3 seguimiento en franja (14 h) sale', enviados.length === 1);

  // A6 — el payload va cifrado; el tag se comprueba en el Worker con un spy.
  // (Se verifica en el código: cada envío pasa su tag.)
  const src = require('node:fs').readFileSync(path.resolve(__dirname, '..', 'push-worker', 'index.js'), 'utf8');
  check('A6 seguimiento y vencimiento llevan tag propio', /tag:'pq-seguimiento'/.test(src) && /tag:'pq-vencimiento'/.test(src));
  const sw = require('node:fs').readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');
  check('A6 el SW usa el tag del aviso', /data\.tag/.test(sw) && /pushsubscriptionchange/.test(sw));

  // A5 — /ping
  enviados = [];
  const p1 = await W.fetch(req('/ping', 'POST', { deviceId: DEV }), env);
  const p2 = await W.fetch(req('/ping', 'POST', { deviceId: DEV }), env);
  const p3 = await W.fetch(req('/ping', 'POST', { deviceId: 'pq-1700000000000-otro' }), env);
  check('A5 /ping manda la prueba a ese equipo', p1.status === 200 && enviados.length === 1 && enviados[0].url === sub.endpoint);
  check('A5 /ping seguido se frena (429)', p2.status === 429);
  check('A5 /ping de un equipo sin suscripción da 404', p3.status === 404);
  check('A5 CORS solo para el origen de la app', p1.headers.get('Access-Control-Allow-Origin') === ORIGIN);


  // A7 — el teléfono tiene que poder DESCIFRAR lo que manda el Worker (RFC 8291).
  // Hasta la v237 el Worker armaba mal la clave (un 0x01 de más en el info del
  // HKDF): el servicio de push aceptaba el mensaje y el teléfono lo tiraba.
  {
    const nc = require('node:crypto');
    const uaE = nc.createECDH('prime256v1'); uaE.generateKeys();
    const authB = nc.randomBytes(16);
    const sub7 = { endpoint: 'https://push.example/a7', keys: { p256dh: b64u(uaE.getPublicKey()), auth: b64u(authB) } };
    let cuerpo = null;
    respuesta = 201;
    global.fetch = async (url, opts) => { cuerpo = Buffer.from(opts.body); return { ok: true, status: 201 }; };
    const DEV7 = 'pq-1700000000000-desc7';
    kv.set('sub:' + DEV7, JSON.stringify({ subscription: sub7 }));
    await W.fetch(req('/ping', 'POST', { deviceId: DEV7 }), env);
    let texto = '';
    try {
      const salt = cuerpo.subarray(0, 16), idlen = cuerpo[20], asPub = cuerpo.subarray(21, 21 + idlen), ct = cuerpo.subarray(21 + idlen);
      const ikm = Buffer.from(nc.hkdfSync('sha256', uaE.computeSecret(asPub), authB, Buffer.concat([Buffer.from('WebPush: info\0'), uaE.getPublicKey(), asPub]), 32));
      const cek = Buffer.from(nc.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(nc.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const d = nc.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
      const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      texto = pt.subarray(0, pt.length - 1).toString();
    } catch (e) { texto = 'ERROR ' + e.message; }
    check('A7 el teléfono puede descifrar el push (RFC 8291)', /prueba/.test(texto), texto.slice(0, 80));
    global.fetch = async (url, opts) => { enviados.push({ url, opts }); return { ok: respuesta < 300, status: respuesta }; };
  }

  // A4 — 410: suscripción muerta.
  const r4 = JSON.parse(kv.get('sub:' + DEV));
  r4.avisos.push({ k: 'x410', at: '2026-10-12T09:00', title: 'Prueba', body: '', go: 'agenda', tag: 'pq-hoy' });
  kv.set('sub:' + DEV, JSON.stringify(r4));
  respuesta = 410;
  await runDue(env, Date.UTC(2026, 9, 12, 12, 5));
  check('A4 un 410 borra la suscripción del KV', !kv.has('sub:' + DEV));
}

async function parteApp() {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch (e) { console.error('Falta puppeteer-core. Corré .claude/hooks/session-start.sh'); process.exit(2); }
  const EXEC = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_HEADLESS_SHELL;
  if (!EXEC) { console.error('Falta $PUPPETEER_EXECUTABLE_PATH'); process.exit(2); }
  const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await puppeteer.launch({ executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1200));

    const r = await page.evaluate(() => {
      const hoy = today();
      const man = _calAddDays(hoy, 1);
      const pas = _calAddDays(hoy, 2);
      setNotes([
        { id: 101, fecha: man, tipo: 'visita', texto: 'Ver eucalipto', cliente: 'López', hora: '10:30' },
        { id: 102, fecha: man, tipo: 'nota', texto: 'Comprar cadena' },
        { id: 103, fecha: pas, tipo: 'visita', texto: 'Hecha', hora: '09:00', hecho: true },
      ]);
      const h = getH();
      h.push({ id: 5001, estado: 'aceptado', clientName: 'García', fechasTrabajo: [man], snapshot: {} });
      setH(h);
      const now = new Date(); now.setHours(12, 0, 0, 0);
      const av = _buildPushAvisos(getFollowupCfg(), now);
      const cfgOff = Object.assign({}, getFollowupCfg(), { pushAgenda: false });
      const avOff = _buildPushAvisos(cfgOff, now);
      const san = sanitizeFollowup({ pushAgenda: false, pushHora: 'x' });
      return { hoy, man, pas, av, avOff, san };
    });
    const k = (p) => r.av.find(a => a.k.startsWith(p));
    const manana = r.av.find(a => a.k === 'man:' + r.man);
    check('B1 "Mañana" a las 19 h del día anterior', manana && manana.at === r.hoy + 'T19:00', manana && manana.at);
    check('B1 "Mañana" resume trabajo + visita (no la nota)', manana && manana.title === 'Mañana: 1 trabajo y 1 visita', manana && manana.title);
    const hoyAv = r.av.find(a => a.k === 'hoy:' + r.man);
    check('B1 "Hoy" a las 7:30 incluye el recordatorio', hoyAv && hoyAv.at === r.man + 'T07:30' && /1 recordatorio/.test(hoyAv.title), hoyAv && hoyAv.title);
    const hr = k('hr:101:');
    check('B1 visita con hora: aviso 1 h antes', hr && hr.at === r.man + 'T09:30' && hr.title === 'Visita a las 10:30', hr && (hr.at + ' ' + hr.title));
    check('B1 lo marcado como hecho no avisa', !r.av.some(a => a.k.includes(r.pas)));
    check('B1 todos van a la Agenda', r.av.every(a => a.go === 'agenda'));
    check('B2 sin "Trabajos y visitas" queda solo el de la hora', r.avOff.length === 1 && r.avOff[0].k.startsWith('hr:'), r.avOff.map(a => a.k).join(','));
    check('B2 sanitizeFollowup conserva los tipos como booleanos', r.san.pushAgenda === false && r.san.pushHora === true);

    // B3 / B4 — simular un navegador con push.
    const ui = await page.evaluate(() => {
      window.pushDisponible = () => true;
      try { Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true }); } catch (_) {}
      S.pushEnabled = false;
      notifOpen();
      const cta = !!document.querySelector('#notif-dlg-body .nt-push-cta');
      pushCtaNo();
      const cta2 = !!document.querySelector('#notif-dlg-body .nt-push-cta');
      notifClose();
      localStorage.setItem(LS.PUSH_ESTADO, JSON.stringify({ ok: new Date().toISOString(), n: 4 }));
      S.pushEnabled = true;
      document.getElementById('push-section').style.display = '';
      loadFollowupUI();
      return {
        cta, cta2,
        estado: document.getElementById('push-estado').textContent,
        tipos: !document.getElementById('push-tipos').hidden,
        probar: !document.getElementById('push-probar').hidden,
        ag: document.getElementById('push-agenda').checked,
      };
    });
    check('B3 la campanita invita a activar los avisos', ui.cta);
    check('B3 "Ahora no" esconde la invitación', !ui.cta2);
    check('B4 estado: activos con avisos programados', /4 avisos programados/.test(ui.estado), ui.estado);
    check('B4 se ven los tipos y el botón Probar', ui.tipos && ui.probar && ui.ag);
  } finally { await browser.close(); }
}

(async () => {
  try { await parteWorker(); } catch (e) { allOk = false; console.log('FAIL  parte Worker —', e.stack || e.message); }
  try { await parteApp(); } catch (e) { allOk = false; console.log('FAIL  parte App —', e.stack || e.message); }
  console.log(allOk ? '\nOK — notificaciones' : '\nFALLÓ');
  process.exit(allOk ? 0 : 1);
})();
