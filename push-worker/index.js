// push-worker/index.js
// ── base64url helpers ──────────────────────────────────────────────────────
function b64uDec(s) {
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function b64uEnc(buf) {
  let s = '';
  for (const b of (buf instanceof Uint8Array ? buf : new Uint8Array(buf))) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function cat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n,a)=>n+a.length,0));
  let i=0; for (const a of arrs) { out.set(a,i); i+=a.length; }
  return out;
}

// ── HKDF (RFC 5869) ───────────────────────────────────────────────────────
async function hkdfExtract(salt, ikm) {
  const k = await crypto.subtle.importKey('raw', salt, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, ikm));
}
async function hkdfExpand(prk, info, len) {
  const k = await crypto.subtle.importKey('raw', prk, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  let t = new Uint8Array(0), out = new Uint8Array(len), off=0;
  for (let i=1; off<len; i++) {
    t = new Uint8Array(await crypto.subtle.sign('HMAC', k, cat(t, info, new Uint8Array([i]))));
    const n = Math.min(t.length, len-off);
    out.set(t.slice(0,n), off); off+=n;
  }
  return out;
}
async function hkdf(ikm, salt, info, len) {
  return hkdfExpand(await hkdfExtract(salt, ikm), info, len);
}

// ── VAPID JWT (RFC 8292) ───────────────────────────────────────────────────
async function vapidAuth(endpoint, subject, pubB64u, privB64u) {
  const aud = new URL(endpoint).origin;
  const te = new TextEncoder();
  const enc = obj => b64uEnc(te.encode(JSON.stringify(obj)));
  const hdr = enc({typ:'JWT',alg:'ES256'});
  const pay = enc({aud, exp:Math.floor(Date.now()/1000)+43200, sub:subject});
  const sigInput = `${hdr}.${pay}`;

  const pub = b64uDec(pubB64u);
  const key = await crypto.subtle.importKey('jwk', {
    kty:'EC', crv:'P-256',
    x: b64uEnc(pub.slice(1,33)),
    y: b64uEnc(pub.slice(33,65)),
    d: privB64u,
    key_ops:['sign'],
  }, {name:'ECDSA',namedCurve:'P-256'}, false, ['sign']);

  const sig = new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, key, te.encode(sigInput)));
  return `vapid t=${sigInput}.${b64uEnc(sig)},k=${pubB64u}`;
}

// ── Web Push Encryption (RFC 8291, aes128gcm) ─────────────────────────────
async function encryptPush(sub, plaintext) {
  const te = new TextEncoder();
  const uaPub      = b64uDec(sub.keys.p256dh);
  const authSecret = b64uDec(sub.keys.auth);

  const kp    = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'}, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, {name:'ECDH',namedCurve:'P-256'}, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:uaKey}, kp.privateKey, 256));

  const ikm  = await hkdf(ecdhSecret, authSecret, cat(te.encode('WebPush: info\x00'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek   = await hkdf(ikm, salt, cat(te.encode('Content-Encoding: aes128gcm\x00'), new Uint8Array([1])), 16);
  const nonce = await hkdf(ikm, salt, cat(te.encode('Content-Encoding: nonce\x00'),     new Uint8Array([1])), 12);

  const padded    = cat(te.encode(plaintext), new Uint8Array([2]));
  const cryptoKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher    = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce}, cryptoKey, padded));

  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096, false);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, cipher);
}

// ── Send one push ──────────────────────────────────────────────────────────
async function sendPush(sub, payload, env) {
  const body = await encryptPush(sub, JSON.stringify(payload));
  const auth = await vapidAuth(
    sub.endpoint,
    env.VAPID_SUBJECT || 'mailto:contacto@ejemplo.com',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      // Urgency alta: en Android, sin esto FCM puede demorar/agrupar el push
      // mientras el teléfono está en reposo (doze). "high" mejora la entrega.
      'Urgency': 'high',
    },
    body,
  });
  return res.ok;
}

// ── CORS ───────────────────────────────────────────────────────────────────
// Antes era 'Access-Control-Allow-Origin: *', o sea que CUALQUIER sitio web
// podía llamar a estos endpoints desde el navegador de un visitante. Ahora solo
// el origen de la app (configurable con la variable ALLOWED_ORIGIN, por si el
// día de mañana hay dominio propio) y localhost para desarrollo.
//
// OJO: CORS lo aplica el NAVEGADOR, no es autenticación — un script fuera del
// navegador puede llamar igual. Por eso además se valida la forma de todo lo que
// entra (ver abajo): el deviceId es la clave del KV y no puede ser cualquier
// cosa, y los tamaños están acotados para que nadie llene el namespace.
const DEFAULT_ORIGIN = 'https://presupuesto-ar.juliobarribolbo.workers.dev';

function corsFor(request, env) {
  const permitidos = [env.ALLOWED_ORIGIN || DEFAULT_ORIGIN, 'http://localhost:8787', 'http://127.0.0.1:8787'];
  const origin = request.headers.get('Origin') || '';
  const h = {
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  if (permitidos.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

// El deviceId es la CLAVE del registro en el KV: si se acepta cualquier string,
// cualquiera puede escribir entradas arbitrarias (llenar el namespace, que se
// paga) o pisar el registro de otro equipo. La app lo genera como
// 'pq-<timestamp>-<random base36>'.
// Permisivo a propósito en la parte aleatoria: Math.random().toString(36) puede
// devolver pocos caracteres en casos degenerados, y el id queda PERSISTIDO en el
// dispositivo — un equipo rechazado acá no volvería a suscribirse nunca.
const DEVICE_ID_RE = /^pq-\d{10,16}-[a-z0-9]{1,30}$/;

// Una suscripción de Push API válida: endpoint https de un servicio de push y
// las dos claves que exige RFC 8291.
function subscriptionValida(s) {
  if (!s || typeof s !== 'object') return false;
  if (typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000) return false;
  if (!s.keys || typeof s.keys !== 'object') return false;
  const { p256dh, auth } = s.keys;
  if (typeof p256dh !== 'string' || p256dh.length < 20 || p256dh.length > 200) return false;
  if (typeof auth !== 'string'   || auth.length   < 10 || auth.length   > 100) return false;
  return true;
}

// Recorta la lista de avisos a lo que el cron necesita, con tamaños acotados.
const MAX_AVISOS = 300;
function avisosValidos(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, MAX_AVISOS).map((f) => ({
    id: typeof f?.id === 'number' ? f.id : String(f?.id ?? '').slice(0, 40),
    clientName: String(f?.clientName ?? '').slice(0, 120),
    date: /^\d{4}-\d{2}-\d{2}$/.test(f?.date) ? f.date : '',
    diasDesdeEnvio: Number.isFinite(f?.diasDesdeEnvio) ? f.diasDesdeEnvio : 0,
  })).filter((f) => f.date);
}

// ── Worker entry points ────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const CORS = corsFor(request, env);

    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:CORS});

    // GET /test?key=… — dispara un push de prueba a TODOS los dispositivos
    // suscritos. Antes no pedía nada: como la URL del Worker está en claro en el
    // index.html público, cualquiera podía hacer sonar el teléfono de todos, sin
    // límite. Ahora exige el secreto TEST_KEY; si no está configurado, el
    // endpoint no existe. (Para probar el envío real, lo documentado es disparar
    // el cron a mano — ver docs/push-setup.md.)
    if (url.pathname === '/test' && request.method === 'GET') {
      if (!env.TEST_KEY || url.searchParams.get('key') !== env.TEST_KEY) {
        return new Response('Not found', {status:404, headers:CORS});
      }
      const { keys } = await env.PUSH_KV.list({ prefix: 'sub:' });
      let ok = 0;
      for (const {name} of keys) {
        try {
          const data = JSON.parse(await env.PUSH_KV.get(name));
          if (!data?.subscription) continue;
          const sent = await sendPush(data.subscription, {
            title: 'Presupuesto AR — prueba ✓',
            body: 'Las notificaciones funcionan. Ya vas a recibir los avisos de seguimiento.',
            go: 'historial',
          }, env);
          if (sent) ok++;
        } catch(e) {}
      }
      const msg = ok > 0
        ? `✓ Push enviado a ${ok} dispositivo(s). Revisá las notificaciones del teléfono.`
        : 'No hay dispositivos suscritos todavía. Activá el toggle en la app primero.';
      return new Response(msg, { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { deviceId, subscription } = body || {};
        if (!DEVICE_ID_RE.test(String(deviceId || ''))) {
          return new Response('Bad deviceId', {status:400, headers:CORS});
        }
        if (!subscriptionValida(subscription)) {
          return new Response('Bad subscription', {status:400, headers:CORS});
        }
        // Preservar el estado de deduplicación (notified) entre re-sincronizaciones:
        // si la app vuelve a suscribir, no debe perder qué ya se avisó hoy.
        let prev = {};
        try { prev = JSON.parse(await env.PUSH_KV.get(`sub:${deviceId}`)) || {}; } catch(_) {}
        await env.PUSH_KV.put(`sub:${deviceId}`, JSON.stringify({
          subscription: { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } },
          followups: avisosValidos(body.followups),
          expiries:  avisosValidos(body.expiries),
          notified:  prev.notified || {},
        }), {
          // Un equipo que deja de usarse se limpia solo: la app re-suscribe en
          // cada apertura con señal, así que 90 días sin aparecer = abandonado.
          // Antes las entradas quedaban para siempre, con los nombres de los
          // clientes adentro.
          expirationTtl: 60 * 60 * 24 * 90,
        });
        return new Response('OK', {headers:CORS});
      } catch(e) { return new Response('Error', {status:500, headers:CORS}); }
    }

    if (url.pathname === '/subscribe' && request.method === 'DELETE') {
      try {
        const { deviceId } = await request.json();
        if (DEVICE_ID_RE.test(String(deviceId || ''))) await env.PUSH_KV.delete(`sub:${deviceId}`);
        return new Response('OK', {headers:CORS});
      } catch(e) { return new Response('Error', {status:500, headers:CORS}); }
    }

    return new Response('Not found', {status:404, headers:CORS});
  },

  async scheduled(event, env) {
    await runDue(env);
  },
};

// ── Lógica de avisos (la usan el cron y, si hace falta, un disparo manual) ──
// Recorre cada dispositivo y manda los avisos que correspondan HOY, con
// deduplicación: cada presupuesto avisa una sola vez por día (clave en
// `notified`), sin importar cuántas veces corra el cron en el día.
export async function runDue(env) {
  const today = new Date().toISOString().slice(0,10);
  const { keys } = await env.PUSH_KV.list({ prefix: 'sub:' });
  let total = 0;

  await Promise.all(keys.map(async ({name}) => {
    try {
      const data = JSON.parse(await env.PUSH_KV.get(name));
      if (!data?.subscription) return;
      const notified = data.notified || {};
      let changed = false;

      // Seguimientos al día de aviso que NO se avisaron todavía hoy.
      const due = (data.followups || [])
        .filter(f => f.date <= today && notified['fu:' + f.id] !== today);
      if (due.length) {
        const n = due.length;
        const title = n === 1
          ? `Seguimiento: ${due[0].clientName}`
          : `${n} clientes para seguimiento`;
        const body = n === 1
          ? `Llevan ${due[0].diasDesdeEnvio} días sin respuesta.`
          : due.slice(0,3).map(f=>f.clientName).join(', ') + (n>3?' y más.':'.');
        if (await sendPush(data.subscription, {title, body, go:'historial'}, env)) {
          due.forEach(f => { notified['fu:' + f.id] = today; });
          changed = true; total++;
        }
      }

      // Vencidos (fecha de vigencia pasada) que NO se avisaron todavía hoy.
      const exp = (data.expiries || [])
        .filter(f => f.date < today && notified['vc:' + f.id] !== today);
      if (exp.length) {
        const n = exp.length;
        const title = n === 1
          ? `Presupuesto vencido: ${exp[0].clientName}`
          : `${n} presupuestos vencidos`;
        const body = n === 1
          ? 'Pasó su fecha de vigencia. Buen momento para contactar al cliente.'
          : exp.slice(0,3).map(f=>f.clientName).join(', ') + (n>3?' y más.':'.');
        if (await sendPush(data.subscription, {title, body, go:'historial'}, env)) {
          exp.forEach(f => { notified['vc:' + f.id] = today; });
          changed = true; total++;
        }
      }

      // Limpiar marcas de días anteriores para que `notified` no crezca sin fin.
      for (const k of Object.keys(notified)) {
        if (notified[k] < today) { delete notified[k]; changed = true; }
      }

      if (changed) {
        data.notified = notified;
        await env.PUSH_KV.put(name, JSON.stringify(data));
      }
    } catch(e) { console.error('Push error', name, e.message); }
  }));

  return total;
}
