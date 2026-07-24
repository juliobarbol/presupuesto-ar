// test/push-worker.test.cjs — Regresión de seguridad del Worker de push.
// Cubre A5 de docs/auditoria-2026-07-24.md:
//   · GET /test no pedía NADA y dispara un push a TODOS los dispositivos. La URL
//     del Worker está en claro en el index.html público, así que cualquiera
//     podía hacer sonar el teléfono de todos, sin límite.
//   · POST /subscribe aceptaba cualquier deviceId (es la CLAVE del KV, que se
//     paga) y cualquier payload, desde cualquier origen (CORS '*').
//
// El Worker es un módulo ESM con Worker globals; se carga como .mjs temporal y
// se lo llama con un KV falso en memoria.
//
// Uso:  node test/push-worker.test.cjs

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SRC = path.resolve(__dirname, '..', 'push-worker', 'index.js');

let allOk = true;
const check = (name, ok, extra) => {
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

// KV falso: guarda en un Map y recuerda el TTL con que se escribió.
function fakeKV(inicial) {
  const m = new Map(Object.entries(inicial || {}));
  const ttls = new Map();
  return {
    _m: m, _ttls: ttls,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, opts) { m.set(k, v); if (opts && opts.expirationTtl) ttls.set(k, opts.expirationTtl); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
  };
}

const ORIGIN = 'https://presupuesto-ar.juliobarribolbo.workers.dev';
const SUB_OK = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'x'.repeat(87), auth: 'y'.repeat(22) } };

(async () => {
  // Cargar el Worker como ESM
  const tmp = path.join(os.tmpdir(), 'pushworker-' + process.pid + '.mjs');
  fs.writeFileSync(tmp, fs.readFileSync(SRC, 'utf8'));
  const mod = (await import('file://' + tmp)).default;
  fs.unlinkSync(tmp);

  const req = (url, opts) => new Request(url, opts);
  const post = (body, origin) => req('https://w.dev/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });

  // ── /test sin secreto ──
  {
    const kv = fakeKV({ 'sub:pq-1721000000000-abcdefghij': JSON.stringify({ subscription: SUB_OK }) });
    const r1 = await mod.fetch(req('https://w.dev/test'), { PUSH_KV: kv });
    check('A5 · GET /test sin secreto devuelve 404', r1.status === 404, 'status=' + r1.status);

    const r2 = await mod.fetch(req('https://w.dev/test?key=equivocada'), { PUSH_KV: kv, TEST_KEY: 'lasecreta' });
    check('A5 · GET /test con secreto incorrecto devuelve 404', r2.status === 404, 'status=' + r2.status);

    // Con el secreto correcto sí funciona (el envío falla porque no hay VAPID,
    // pero el endpoint responde 200 y no explota).
    const r3 = await mod.fetch(req('https://w.dev/test?key=lasecreta'), { PUSH_KV: kv, TEST_KEY: 'lasecreta' });
    check('A5 · GET /test con el secreto correcto sí responde', r3.status === 200, 'status=' + r3.status);
  }

  // ── deviceId ──
  {
    const kv = fakeKV();
    const malos = ['', 'x', '../otro', 'sub:otro', 'pq-abc-def', 'pq-1721000000000-' + 'z'.repeat(40),
                   'pq-1721000000000-MAYUS', 'pq-1721000000000-a b'];
    let rechazados = 0;
    for (const id of malos) {
      const r = await mod.fetch(post({ deviceId: id, subscription: SUB_OK }, ORIGIN), { PUSH_KV: kv });
      if (r.status === 400) rechazados++;
    }
    check('A5 · se rechazan los deviceId con formato inválido',
      rechazados === malos.length, rechazados + '/' + malos.length);
    check('A5 · y no escribieron nada en el KV', kv._m.size === 0, 'entradas=' + kv._m.size);

    const bueno = 'pq-1721000000000-abcdefghij';
    const r = await mod.fetch(post({ deviceId: bueno, subscription: SUB_OK }, ORIGIN), { PUSH_KV: kv });
    check('A5 · el deviceId que genera la app sí se acepta', r.status === 200, 'status=' + r.status);
    check('A5 · se guarda con TTL (un equipo abandonado se limpia solo)',
      kv._ttls.get('sub:' + bueno) === 60*60*24*90, 'ttl=' + kv._ttls.get('sub:' + bueno));
  }

  // ── suscripción inválida ──
  {
    const kv = fakeKV();
    const malas = [null, {}, { endpoint: 'http://insegura.dev/x', keys: { p256dh:'x'.repeat(87), auth:'y'.repeat(22) } },
                   { endpoint: 'https://ok.dev/x' }, { endpoint: 'https://ok.dev/x', keys: { p256dh:'corta', auth:'y'.repeat(22) } }];
    let rechazadas = 0;
    for (const s of malas) {
      const r = await mod.fetch(post({ deviceId: 'pq-1721000000000-abcdefghij', subscription: s }, ORIGIN), { PUSH_KV: kv });
      if (r.status === 400) rechazadas++;
    }
    check('A5 · se rechazan las suscripciones mal formadas',
      rechazadas === malas.length, rechazadas + '/' + malas.length);
  }

  // ── tamaños acotados ──
  {
    const kv = fakeKV();
    const muchos = Array.from({ length: 2000 }, (_, i) => ({
      id: i, clientName: 'C'.repeat(500), date: '2026-07-24', diasDesdeEnvio: 3 }));
    await mod.fetch(post({ deviceId: 'pq-1721000000000-abcdefghij', subscription: SUB_OK,
                           followups: muchos, expiries: muchos }, ORIGIN), { PUSH_KV: kv });
    const guardado = JSON.parse(kv._m.get('sub:pq-1721000000000-abcdefghij'));
    check('A5 · la lista de avisos se acota a 300', guardado.followups.length === 300,
      'guardados=' + guardado.followups.length);
    check('A5 · el nombre del cliente se recorta', guardado.followups[0].clientName.length === 120);
    check('A5 · los avisos sin fecha válida se descartan',
      guardado.followups.every(f => /^\d{4}-\d{2}-\d{2}$/.test(f.date)));
  }

  // ── CORS ──
  {
    const kv = fakeKV();
    const rBueno = await mod.fetch(post({ deviceId: 'pq-1721000000000-abcdefghij', subscription: SUB_OK }, ORIGIN), { PUSH_KV: kv });
    check('A5 · el origen de la app recibe el header CORS',
      rBueno.headers.get('access-control-allow-origin') === ORIGIN,
      String(rBueno.headers.get('access-control-allow-origin')));

    const rMalo = await mod.fetch(post({ deviceId: 'pq-1721000000000-abcdefghij', subscription: SUB_OK }, 'https://sitio-ajeno.com'), { PUSH_KV: kv });
    check('A5 · un sitio ajeno NO recibe el header (el navegador le corta la respuesta)',
      rMalo.headers.get('access-control-allow-origin') === null,
      String(rMalo.headers.get('access-control-allow-origin')));
    check('A5 · y ya no se responde "*" a cualquiera',
      rMalo.headers.get('access-control-allow-origin') !== '*');
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
