// test/push-detalle.test.cjs — Notificaciones que se leen sin abrir la app (v240).
//
// El pedido: "A veces no tengo tiempo para ponerme a ver, pero si veo la
// notificación y la puedo leer directamente sin tocarla, me sirve." Hasta la
// v239 decían "Trabajo · García" y "Vencido: Pérez": había que abrir la app
// para saber qué trabajo, dónde, por cuánto, o cómo venía el día.
//
// Parte W — Worker: línea de pronóstico (días lindos también), zonas juntas,
//           el clima en el resumen de la mañana y el tope de tamaño del push.
// Parte A — App: cada renglón dice qué, dónde y cuánto; seguimientos y vencidos
//           con número, monto y antigüedad; el recordatorio con hora, quién y dónde.
//
// Uso:  node test/push-detalle.test.cjs

const path = require('node:path');
const nc = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');

let allOk = true;
const check = (name, ok, extra) => {
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function descifrar(cuerpo, uaE, authB) {
  const salt = cuerpo.subarray(0, 16), idlen = cuerpo[20], asPub = cuerpo.subarray(21, 21 + idlen), ct = cuerpo.subarray(21 + idlen);
  const ikm = Buffer.from(nc.hkdfSync('sha256', uaE.computeSecret(asPub), authB, Buffer.concat([Buffer.from('WebPush: info\0'), uaE.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(nc.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(nc.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = nc.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(pt.subarray(0, pt.length - 1).toString());
}

async function parteWorker() {
  const mod = await import(path.join(ROOT, 'push-worker', 'index.js'));

  // W1 — línea de pronóstico
  const linda = mod.climaLinea({ code: 0, tmin: 13.6, tmax: 24.2, pp: 5, mm: 0, gust: 20 }, 'García');
  check('W1 día lindo: emoji, temperaturas y "sin lluvia"', !linda.mala && linda.txt === '☀️ 14–24 °C · sin lluvia — García', linda.txt);
  const llovizna = mod.climaLinea({ code: 3, tmin: 10, tmax: 15, pp: 40, mm: 0.5, gust: 38 }, '');
  check('W1 probabilidad baja y ráfaga moderada: se dicen sin alarmar', !llovizna.mala && llovizna.txt === '☁️ 10–15 °C · lluvia 40 % · ráfagas de 38 km/h', llovizna.txt);
  const fea = mod.climaLinea({ code: 3, tmin: 9, tmax: 17, pp: 20, gust: 58 }, 'García y López');
  check('W1 día feo: ⚠️ adelante, con la temperatura', fea.mala && fea.viento && fea.txt === '⚠️ Ráfagas de 58 km/h · 9–17 °C — García y López', fea.txt);

  // W2 — tamaño del push
  const largo = Array.from({ length: 40 }, (_, i) => `🌳 Cliente número ${i} — Eucalipto y Pino · Av. Siempre Viva ${i} · $ 450.000`).join('\n');
  const p = mod.payloadDe({ k: 'hoy:x', title: 'Hoy: 40 trabajos', body: largo, go: 'agenda', tag: 'pq-hoy',
    acts: [{ a: 'maps', url: 'https://www.google.com/maps/dir/?api=1&destination=' + 'x'.repeat(500) }, { a: 'posponer' }] }, 'pq-1-a');
  const bytes = Buffer.byteLength(JSON.stringify(p));
  check('W2 un cuerpo enorme se recorta a lo que entra en un push', bytes <= 3500, bytes + ' bytes');
  check('W2 …por renglones enteros', p.body.split('\n').every(l => /^🌳 Cliente número \d+ — Eucalipto y Pino · Av\. Siempre Viva \d+ · \$ 450\.000$/.test(l)));

  // W3 — runDue: el resumen de la mañana con el pronóstico, zonas juntas.
  const subtle = nc.webcrypto.subtle;
  const vapid = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const uaE = nc.createECDH('prime256v1'); uaE.generateKeys();
  const authB = nc.randomBytes(16);
  const sub = { endpoint: 'https://push.example/v240', keys: { p256dh: b64u(uaE.getPublicKey()), auth: b64u(authB) } };
  const kv = new Map();
  const env = {
    VAPID_PUBLIC_KEY: b64u(await subtle.exportKey('raw', vapid.publicKey)),
    VAPID_PRIVATE_KEY: (await subtle.exportKey('jwk', vapid.privateKey)).d, VAPID_SUBJECT: 'mailto:x@y.z',
    PUSH_KV: {
      get: async (k) => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }),
    },
  };
  let payloads = [], meteo = 0;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.open-meteo.com/')) {
      meteo++;
      const d = new URL(url).searchParams.get('start_date');
      return { ok: true, status: 200, json: async () => ({ daily: { time: [d], weather_code: [1], precipitation_probability_max: [10],
        precipitation_sum: [0], wind_speed_10m_max: [12], wind_gusts_10m_max: [22], temperature_2m_max: [24.4], temperature_2m_min: [13.5] } }) };
    }
    payloads.push(descifrar(Buffer.from(opts.body), uaE, authB));
    return { ok: true, status: 201 };
  };
  const DEV = 'pq-1700000000000-v240a';
  await mod.default.fetch(new Request('https://w.dev/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://presupuesto-ar.juliobarribolbo.workers.dev' },
    body: JSON.stringify({ deviceId: DEV, subscription: sub, tz: 180, followups: [], expiries: [], avisos: [
      { k: 'hoy:2026-10-12', at: '2026-10-12T07:30', title: 'Hoy: 2 trabajos', tag: 'pq-hoy', go: 'agenda:2026-10-12',
        body: '🌳 García — Eucalipto · Av. Mitre 1234 · $ 450.000\n🌳 López — Pino · $ 200.000',
        clima: { d: '2026-10-12', pts: [{ la: -34.46, lo: -58.91, n: 'García' }, { la: -34.46, lo: -58.91, n: 'López' }] } },
    ] }),
  }), env);
  await mod.runDue(env, Date.UTC(2026, 9, 12, 10, 35));   // 7:35 local
  const p3 = payloads[0] || {};
  check('W3 el resumen de la mañana suma el pronóstico al final', p3.title === 'Hoy: 2 trabajos'
    && p3.body === '🌳 García — Eucalipto · Av. Mitre 1234 · $ 450.000\n🌳 López — Pino · $ 200.000\n🌤️ 14–24 °C · sin lluvia — García y López', JSON.stringify(p3.body));
  check('W3 dos trabajos en la misma zona: una sola consulta', meteo === 1, 'consultas: ' + meteo);
}

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

    const r = await page.evaluate(() => {
      const hoy = today();
      const dia = (n) => _calAddDays(hoy, n);
      const ts = (iso) => iso + 'T12:00:00.000Z';
      const cfg = Object.assign({}, getFollowupCfg(), { enabled: true, expiryEnabled: true, estados: ['enviado'], days: 10,
        pushAgenda: true, pushHora: true, pushClima: true, pushSemana: false, pushSilencio: [] });
      setNotes([
        { id: 'n_vis', fecha: dia(1), tipo: 'visita', texto: 'Ver pino', cliente: 'López', hora: '10:30', ubic: 'Barrio Norte, Pilar' },
        { id: 'n_coord', fecha: dia(1), tipo: 'visita', texto: '', cliente: 'Ruiz', hora: '16:00', ubic: '-34.6037,-58.3816' },
      ]);
      setH([
        { id: 8001, estado: 'aceptado', clientName: 'García', total: 450000, currency: 'ARS', fechasTrabajo: [dia(1), dia(2)],
          snapshot: { workAddress: 'Av. Mitre 1234, Pilar', workMapLink: '-34.4567,-58.9123',
            items: [{ type: 'tree', species: 'Eucalipto', price: 300000 }, { type: 'tree', species: 'Pino, eucalipto', price: 150000 }, { type: 'service', desc: 'Camión' }] } },
        { id: 8002, estado: 'enviado', clientName: 'Pérez', quoteNumber: '2026-0002', total: 500000, currency: 'ARS', enviadoEn: ts(dia(-20)),
          snapshot: { dateExpiry: dia(-1) } },
        { id: 8003, estado: 'enviado', clientName: 'Gómez', quoteNumber: '2026-0003', total: 320000, currency: 'ARS', enviadoEn: ts(dia(-10)),
          snapshot: { dateExpiry: dia(20) } },
      ]);
      const now = new Date(); now.setHours(5, 0, 0, 0);
      return { hoy, d1: dia(1), d2: dia(2), d7: dia(7), av: _buildPushAvisos(cfg, now) };
    });
    const k = (kk) => r.av.find(a => a.k === kk) || {};
    const man = k('man:' + r.d1);
    const lineas = (man.body || '').split('\n');
    check('A1 trabajo: quién, qué (especies sin repetir), dónde, cuánto y qué día', lineas[0] === '🌳 García — Eucalipto y Pino · Av. Mitre 1234, Pilar · $ 450.000 · día 1 de 2', lineas[0]);
    check('A1 visita: hora, qué, con quién y la dirección', lineas.includes('👁️ 10:30 Ver pino — López · Barrio Norte, Pilar'), JSON.stringify(lineas));
    check('A1 coordenadas no se muestran como lugar', lineas.includes('👁️ 16:00 Ruiz'), JSON.stringify(lineas));
    check('A1 el trabajo va primero (es lo que se ve sin desplegar)', /^🌳/.test(lineas[0]));

    const hoyAv = k('hoy:' + r.hoy);
    check('A2 seguimiento: número, monto y desde cuándo', /📨 Seguimiento: Gómez · N° 2026-0003 · \$ 320\.000 · enviado hace 10 días/.test(hoyAv.body || ''), hoyAv.body);
    check('A2 vencido: número, monto y "venció ayer"', /⌛ Vencido: Pérez · N° 2026-0002 · \$ 500\.000 · venció ayer/.test(hoyAv.body || ''), hoyAv.body);
    const rep = k('hoy:' + r.d7);
    check('A2 el recordatorio de la semana dice cuánto hace', /venció hace 8 días/.test(rep.body || ''), rep.body);

    const hr = r.av.find(a => a.k.startsWith('hr:n_vis:')) || {};
    check('A3 recordatorio con hora: el título dice con quién', hr.title === 'Visita a las 10:30 · López', hr.title);
    check('A3 …y el cuerpo, qué y dónde', hr.body === '📝 Ver pino\n📍 Barrio Norte, Pilar', JSON.stringify(hr.body));
    const hrc = r.av.find(a => a.k.startsWith('hr:n_coord:')) || {};
    check('A3 con coordenadas: remite al botón en vez de mostrarlas', hrc.title === 'Visita a las 16:00 · Ruiz' && /tocá "Cómo llegar"/.test(hrc.body || ''), hrc.title + ' | ' + hrc.body);

    const hoyD1 = k('hoy:' + r.d1);
    check('A4 el resumen del día lleva los puntos para el pronóstico', hoyD1.clima && hoyD1.clima.d === r.d1 && hoyD1.clima.pts.some(p => p.n === 'García') && hoyD1.clima.pts.some(p => p.n === 'López') && !hoyD1.clima.pts.some(p => p.n === 'Ver pino'), JSON.stringify(hoyD1.clima));
    check('A4 sin trabajos ni visitas ese día, no hay clima que pedir', !hoyAv.clima);
  } finally { await browser.close(); }
}

(async () => {
  for (const [n, f] of [['Worker', parteWorker], ['App', parteApp]]) {
    try { await f(); } catch (e) { allOk = false; console.log(`FAIL  parte ${n} —`, e.stack || e.message); }
  }
  console.log(allOk ? '\nOK — notificaciones con detalle' : '\nFALLÓ');
  process.exit(allOk ? 0 : 1);
})();
