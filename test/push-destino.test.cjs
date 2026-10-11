// test/push-destino.test.cjs — Tocar la notificación lleva al LUGAR exacto (v238).
//
// El pedido: "que cuando uno toca las notificaciones te lleve directamente al
// lugar donde te notifica". Hasta la v237 el destino era solo la pestaña:
// "Presupuesto vencido: López" abría el Historial con los avisos plegados y nada
// hablaba de López; "Visita a las 10:30" abría la Agenda donde se la hubiera
// dejado (otro mes, otra semana).
//
// Parte A — Worker (push-worker/index.js):
//   A1. goValido acepta pestañas y destinos con detalle; rechaza lo demás.
//   A2. /subscribe conserva el destino con día/nota y tira el inválido.
//   A3. Un solo seguimiento/vencido viaja con `hist:<id>`; varios, con el banner.
// Parte B — App (navegador headless):
//   B1. _buildPushAvisos manda el día (y la nota, en el de la hora).
//   B2. agenda:<día>:<nota> para la Agenda en ese día y resalta la tarjeta,
//       en la vista Agenda (lista) y en la vista Mes.
//   B3. hist:<id> centra y resalta ese presupuesto; uno borrado cae en el Historial.
//   B4. historial:venc abre los avisos plegados y muestra el banner de vencidos.
//   B5. Un destino raro (inyección, fecha mal) no hace nada ni rompe.
//
// Uso:  node test/push-destino.test.cjs

const path = require('node:path');
const nc = require('node:crypto');

let allOk = true;
const check = (name, ok, extra) => {
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Descifra el cuerpo aes128gcm que arma el Worker (RFC 8291), como el teléfono.
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
  const mod = await import(path.resolve(__dirname, '..', 'push-worker', 'index.js'));
  const W = mod.default;

  // A1
  const buenos = ['agenda', 'historial', 'agenda:2026-10-12', 'agenda:2026-10-12:n_abc12', 'hist:1760000000000',
                  'historial:seg', 'historial:venc'];
  const malos = ['', 'javascript:alert(1)', 'agenda:mañana', 'agenda:2026-10-12:"]x', 'hist:abc', 'hist:-1',
                 'historial:otro', 'agenda:2026-10-12:' + 'a'.repeat(41), 'mapa:1'];
  check('A1 goValido acepta pestañas y destinos con detalle', buenos.every(mod.goValido), buenos.filter(g => !mod.goValido(g)).join(','));
  check('A1 goValido rechaza el resto', !malos.some(mod.goValido), malos.filter(mod.goValido).join(','));
  check('A1 goAvisos: uno solo → hist:<id>', mod.goAvisos([{ id: 42 }], 'venc') === 'hist:42');
  check('A1 goAvisos: varios → banner', mod.goAvisos([{ id: 1 }, { id: 2 }], 'seg') === 'historial:seg');
  check('A1 goAvisos: id no numérico → banner', mod.goAvisos([{ id: 'x' }], 'venc') === 'historial:venc');

  // A2 / A3 con suscripción real (el Worker cifra de verdad).
  const subtle = nc.webcrypto.subtle;
  const vapid = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const uaE = nc.createECDH('prime256v1'); uaE.generateKeys();
  const authB = nc.randomBytes(16);
  const sub = { endpoint: 'https://push.example/dest', keys: { p256dh: b64u(uaE.getPublicKey()), auth: b64u(authB) } };
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
  let payloads = [];
  global.fetch = async (url, opts) => { payloads.push(descifrar(Buffer.from(opts.body), uaE, authB)); return { ok: true, status: 201 }; };
  const DEV = 'pq-1700000000000-dest1';
  const req = (body) => new Request('https://w.dev/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://presupuesto-ar.juliobarribolbo.workers.dev' },
    body: JSON.stringify(body),
  });
  await W.fetch(req({
    deviceId: DEV, subscription: sub, tz: 180,
    followups: [{ id: 1760000000001, clientName: 'García', date: '2026-10-01', diasDesdeEnvio: 12 }],
    expiries: [{ id: 11, clientName: 'López', date: '2026-10-01' }, { id: 12, clientName: 'Pérez', date: '2026-10-02' }],
    avisos: [
      { k: 'hr:n_v1:2026-10-10:1030', at: '2026-10-10T09:30', title: 'Visita a las 10:30', go: 'agenda:2026-10-10:n_v1', tag: 'pq-hora-n_v1' },
      { k: 'raro', at: '2026-10-10T09:30', title: 'Raro', go: 'agenda:2026-10-10:<img>', tag: 'pq-hoy' },
    ],
  }), env);
  const rec = JSON.parse(kv.get('sub:' + DEV));
  check('A2 /subscribe conserva el destino con día y nota', rec.avisos[0].go === 'agenda:2026-10-10:n_v1', rec.avisos[0].go);
  check('A2 /subscribe cambia el destino inválido por la Agenda', rec.avisos[1].go === 'agenda', rec.avisos[1].go);

  payloads = [];
  await mod.runDue(env, Date.UTC(2026, 9, 10, 12, 35));   // 9:35 local: franja de las 9 + aviso de 9:30
  const por = (tag) => payloads.find(p => p.tag === tag);
  check('A3 un solo seguimiento → ese presupuesto', por('pq-seguimiento') && por('pq-seguimiento').go === 'hist:1760000000001', JSON.stringify(por('pq-seguimiento')));
  check('A3 varios vencidos → banner de vencidos', por('pq-vencimiento') && por('pq-vencimiento').go === 'historial:venc', JSON.stringify(por('pq-vencimiento')));
  check('A3 el de la hora viaja con día y nota', por('pq-hora-n_v1') && por('pq-hora-n_v1').go === 'agenda:2026-10-10:n_v1');
}

async function parteApp() {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch (e) { console.error('Falta puppeteer-core. Corré .claude/hooks/session-start.sh'); process.exit(2); }
  const EXEC = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_HEADLESS_SHELL;
  if (!EXEC) { console.error('Falta $PUPPETEER_EXECUTABLE_PATH'); process.exit(2); }
  const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await puppeteer.launch({ executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const espera = (ms) => new Promise(r => setTimeout(r, ms));
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 800 });
    page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await espera(1200);

    // Datos: una visita con hora dentro de 20 días (otro "lugar" del calendario),
    // un presupuesto viejo y dos enviados vencidos.
    const base = await page.evaluate(() => {
      const hoy = today();
      const dia = _calAddDays(hoy, 3);
      setNotes([
        { id: 'n_otra', fecha: dia, tipo: 'nota', texto: 'Comprar cadena' },
        { id: 'n_vis1', fecha: dia, tipo: 'visita', texto: 'Ver eucalipto', cliente: 'López', hora: '10:30' },
      ]);
      const h = getH();
      const viejo = _calAddDays(hoy, -40), vencio = _calAddDays(hoy, -5);
      h.push({ id: 5001, estado: 'aceptado', clientName: 'García', quoteNumber: '2026-0001', dateIssue: viejo, snapshot: { dateIssue: viejo } });
      h.push({ id: 5002, estado: 'enviado', clientName: 'Pérez', quoteNumber: '2026-0002', dateIssue: viejo, enviadoEn: viejo + 'T12:00:00', snapshot: { dateIssue: viejo, dateExpiry: vencio } });
      h.push({ id: 5003, estado: 'enviado', clientName: 'Gómez', quoteNumber: '2026-0003', dateIssue: viejo, enviadoEn: viejo + 'T12:00:00', snapshot: { dateIssue: viejo, dateExpiry: vencio } });
      setH(h);
      const now = new Date(); now.setHours(12, 0, 0, 0);
      const av = _buildPushAvisos(getFollowupCfg(), now);
      return { hoy, dia, av };
    });
    // B1
    const hr = base.av.find(a => a.k.startsWith('hr:n_vis1:'));
    check('B1 el aviso de la hora lleva día y nota', hr && hr.go === 'agenda:' + base.dia + ':n_vis1', hr && hr.go);
    const hoyAv = base.av.find(a => a.k === 'hoy:' + base.dia);
    check('B1 "Hoy" lleva su día', hoyAv && hoyAv.go === 'agenda:' + base.dia, hoyAv && hoyAv.go);

    // B2 — vista Agenda (lista).
    const enAgenda = async (vista) => {
      await page.evaluate((v) => {
        switchTab('editor');
        localStorage.setItem(LS.CAL_VIEW, v);
        _calView = v;
        // Dejar el calendario en otro mes para comprobar que el destino lo mueve.
        _calY = 2020; _calM = 0; _calAnchor = '2020-01-01'; _calSel = '2020-01-01';
      }, vista);
      await page.evaluate((go) => irDestino(go), 'agenda:' + base.dia + ':n_vis1');
      await espera(150);
      return page.evaluate(() => {
        const fl = document.querySelector('#panel-agenda .hitem-flash');
        return {
          tab: document.querySelector('.tab-panel.active')?.id,
          sel: _calSel, y: _calY, m: _calM,
          flashTxt: fl ? fl.textContent : '',
          flashVisible: !!fl && fl.offsetParent !== null,
        };
      });
    };
    const lista = await enAgenda('agenda');
    check('B2 lista: abre la Agenda', lista.tab === 'panel-agenda', lista.tab);
    check('B2 lista: resalta la visita (no la otra nota)', lista.flashVisible && /Ver eucalipto/.test(lista.flashTxt) && !/Comprar/.test(lista.flashTxt), lista.flashTxt.slice(0, 60));
    const mes = await enAgenda('mes');
    const [yy, mm] = base.dia.split('-').map(Number);
    check('B2 mes: el calendario salta al mes y al día del aviso', mes.sel === base.dia && mes.y === yy && mes.m === mm - 1, `${mes.sel} ${mes.y}-${mes.m}`);
    check('B2 mes: resalta la visita en el detalle del día', mes.flashVisible && /Ver eucalipto/.test(mes.flashTxt), mes.flashTxt.slice(0, 60));
    const tres = await enAgenda('3dias');
    check('B2 3 días: resalta la visita en su columna', tres.flashVisible && /Ver eucalipto/.test(tres.flashTxt) && tres.sel === base.dia, tres.flashTxt.slice(0, 60));

    // B3 — un presupuesto.
    const h1 = await page.evaluate(async () => {
      switchTab('editor');
      // El "Atrás" de nav.js que consume la capa de pestaña es asíncrono.
      await new Promise(r => setTimeout(r, 150));
      irDestino('hist:5001');
      await new Promise(r => setTimeout(r, 150));
      const fl = document.querySelector('.hitem.hitem-flash');
      return { tab: document.querySelector('.tab-panel.active')?.id, id: fl && fl.dataset.id };
    });
    check('B3 hist:<id> abre el Historial y resalta ese presupuesto', h1.tab === 'panel-historial' && h1.id === '5001', JSON.stringify(h1));
    const h2 = await page.evaluate(async () => {
      switchTab('editor'); await new Promise(r => setTimeout(r, 150));
      irDestino('hist:999'); await new Promise(r => setTimeout(r, 150));
      return document.querySelector('.tab-panel.active')?.id;
    });
    check('B3 presupuesto borrado: queda en el Historial', h2 === 'panel-historial', h2);

    // B4 — banner de vencidos, con los avisos plegados.
    const b4 = await page.evaluate(async () => {
      histAvisosToggle(false);
      switchTab('editor');
      await new Promise(r => setTimeout(r, 150));
      irDestino('historial:venc');
      await new Promise(r => setTimeout(r, 150));
      const ban = document.getElementById('expiry-banner');
      return {
        tab: document.querySelector('.tab-panel.active')?.id,
        abierto: !document.getElementById('hist-avisos-body').hidden,
        n: ban.dataset.n, flash: ban.classList.contains('hitem-flash'),
      };
    });
    check('B4 historial:venc despliega los avisos y marca el banner de vencidos', b4.tab === 'panel-historial' && b4.abierto && b4.n === '2' && b4.flash, JSON.stringify(b4));

    // B5 — destinos raros.
    const b5 = await page.evaluate(async () => {
      switchTab('editor');
      await new Promise(r => setTimeout(r, 150));
      const errores = [];
      for (const g of ['agenda:2026-1-1', 'agenda:2026-10-12:"]x', 'hist:1;alert(1)', 'historial:otro', 'javascript:alert(1)', '', null, undefined]) {
        try { irDestino(g); } catch (e) { errores.push(String(g) + ': ' + e.message); }
      }
      await new Promise(r => setTimeout(r, 150));
      return { errores, tab: document.querySelector('.tab-panel.active')?.id };
    });
    check('B5 destinos inválidos no rompen ni mueven la app', !b5.errores.length && b5.tab === 'panel-editor', JSON.stringify(b5));
  } finally { await browser.close(); }
}

(async () => {
  try { await parteWorker(); } catch (e) { allOk = false; console.log('FAIL  parte Worker —', e.stack || e.message); }
  try { await parteApp(); } catch (e) { allOk = false; console.log('FAIL  parte App —', e.stack || e.message); }
  console.log(allOk ? '\nOK — destino de las notificaciones' : '\nFALLÓ');
  process.exit(allOk ? 0 : 1);
})();
