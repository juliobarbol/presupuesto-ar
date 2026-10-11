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
  // El info va SIN un 0x01 al final: el contador de bloque ya lo agrega
  // hkdfExpand. Con el 0x01 de más (receta de otras librerías que expanden a
  // mano) la clave y el nonce salían mal: el servicio de push aceptaba el
  // mensaje (201) pero el teléfono no lo podía descifrar y lo tiraba callado.
  // Por eso NUNCA llegó una notificación del servidor hasta la v237.
  const cek   = await hkdf(ikm, salt, te.encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdf(ikm, salt, te.encode('Content-Encoding: nonce\x00'),     12);

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
  // 404/410: el servicio de push dice que esa suscripción ya no existe (se
  // desinstaló la app, se borraron los datos del sitio, se revocó el permiso).
  // El llamador la borra del KV en vez de reintentarla para siempre.
  if (res.status === 404 || res.status === 410) return 'gone';
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

// Avisos GENÉRICOS con horario: la app arma el texto y la hora local en que
// tiene que sonar cada uno (trabajo de mañana, agenda del día, recordatorio con
// hora…) y el Worker solo los entrega cuando llega la hora. Así cada aviso
// nuevo se agrega del lado de la app, sin volver a publicar el Worker.
const MAX_GEN = 120;
// v240: el aviso se lee entero sin abrir la app (Android lo despliega), así
// que el cuerpo trae el detalle. El tope real es el del push (~4 KB cifrado):
// payloadDe recorta si hiciera falta.
const MAX_BODY = 900;
const MAX_PAYLOAD_BYTES = 3500;
// Recorta a `max` caracteres sin partir un renglón (si hay alguno entero).
export function recortarRenglones(txt, max) {
  txt = String(txt ?? '');
  if (txt.length <= max) return txt;
  const corte = txt.lastIndexOf('\n', max);
  return corte > 0 ? txt.slice(0, corte) : txt.slice(0, max);
}
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const GO_OK = ['historial', 'agenda', 'editor', 'mapa', 'facturacion', 'nuevo'];
// Destino al tocar la notificación. Además de la pestaña, puede decir el LUGAR
// exacto: un día de la Agenda (y la nota de ese día), un presupuesto del
// Historial, o el banner de seguimientos/vencidos. La app lo resuelve en
// irDestino; una app vieja que no lo entienda abre igual, sin moverse.
const GO_RE = /^(?:agenda:\d{4}-\d{2}-\d{2}(?::[\w-]{1,40})?|hist:\d{1,20}|historial:(?:seg|venc))$/;
export function goValido(go) {
  return GO_OK.includes(go) || (typeof go === 'string' && GO_RE.test(go));
}
// Seguimiento/vencimiento: uno solo lleva al presupuesto; varios, al banner.
export function goAvisos(lista, banner) {
  const id = lista.length === 1 ? lista[0].id : null;
  return (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0)
    ? 'hist:' + id : 'historial:' + banner;
}
// Botones de la notificación (v239). Android muestra dos como mucho. Los que
// abren algo llevan su URL, y solo se aceptan las de Maps y WhatsApp: el
// Service Worker la abre tal cual al tocar el botón, así que acá no puede
// pasar cualquier dirección.
const MAX_ACTS = 2;
const ACT_URL_RE = {
  maps: /^https:\/\/(?:www\.google\.com\/maps\/|maps\.google\.com\/|maps\.app\.goo\.gl\/|goo\.gl\/maps\/)[^\s"'<>]{0,560}$/,
  wa: /^https:\/\/wa\.me\/\d{6,15}$/,
};
export function actsValidos(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const x of arr) {
    if (out.length >= MAX_ACTS || !x || typeof x !== 'object') continue;
    if (out.some(o => o.a === x.a)) continue;
    if (x.a === 'posponer') out.push({ a: 'posponer' });
    else if (ACT_URL_RE[x.a] && ACT_URL_RE[x.a].test(String(x.url ?? ''))) out.push({ a: x.a, url: x.url });
  }
  return out;
}

// Puntos para mirar el clima de un día (v239): coordenadas ya redondeadas a
// ~1 km por la app (2 decimales) y el nombre corto del cliente para el texto.
const MAX_PTS = 5;
export function climaValido(c) {
  if (!c || typeof c !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(c.d)) return null;
  const pts = [];
  for (const p of (Array.isArray(c.pts) ? c.pts : [])) {
    if (pts.length >= MAX_PTS || !p) continue;
    const la = Math.round(Number(p.la) * 100) / 100, lo = Math.round(Number(p.lo) * 100) / 100;
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) continue;
    pts.push({ la, lo, n: String(p.n ?? '').slice(0, 40) });
  }
  return pts.length ? { d: c.d, pts } : null;
}

function avisosGenValidos(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const a of arr.slice(0, MAX_GEN)) {
    if (!a || typeof a !== 'object') continue;
    const k = String(a.k ?? '').slice(0, 80);
    if (!/^[\w:.-]+$/.test(k) || !AT_RE.test(String(a.at ?? ''))) continue;
    const title = String(a.title ?? '').slice(0, 120);
    if (!title) continue;
    const aviso = {
      k, at: a.at, title,
      body: recortarRenglones(a.body, MAX_BODY),
      go: goValido(a.go) ? a.go : 'agenda',
      tag: /^[\w-]{1,40}$/.test(a.tag || '') ? a.tag : 'pq-agenda',
    };
    const acts = actsValidos(a.acts);
    if (acts.length) aviso.acts = acts;
    const clima = climaValido(a.clima);
    if (clima) {
      aviso.clima = clima;
      // Aviso que existe SOLO para avisar del clima (días de silencio, o con
      // los avisos de la Agenda apagados): sin pronóstico feo no sale.
      if (a.soloSiClima === true) aviso.soloSiClima = true;
    }
    out.push(aviso);
  }
  return out;
}

// ── Clima (v239) ───────────────────────────────────────────────────────────
// La noche anterior a un trabajo el Worker mira el pronóstico del lugar y, si
// llueve o hay viento fuerte, lo dice en el aviso. Hasta ahora eso solo se
// veía al abrir la app. Mismos umbrales que la app (climaEsLluvia /
// climaEsViento): lluvia con ≥ 50 % de probabilidad, ≥ 2 mm o código de
// lluvia/tormenta; ráfaga (o viento sostenido, si no hay ráfaga) ≥ 45 km/h.
const CLIMA_WIND_WARN = 45;
export function climaMotivo(d) {
  if (!d) return null;
  const c = d.code;
  const codLluvia = c != null && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95);
  const lluvia = (d.pp != null && d.pp >= 50) || (d.mm != null && d.mm >= 2) || codLluvia;
  const g = d.gust != null ? d.gust : d.wind;
  const viento = g != null && g >= CLIMA_WIND_WARN;
  if (!lluvia && !viento) return null;
  const rafaga = `ráfagas de ${Math.round(g)} km/h`;
  const llu = d.pp != null ? `lluvia (${Math.round(d.pp)} %)` : 'lluvia';
  return { lluvia, viento, txt: lluvia && viento ? `${llu} y ${rafaga}` : (lluvia ? llu : rafaga) };
}

// Pronóstico del día `d` en (la, lo). null si no se pudo (sin señal, error):
// el llamador reintenta en la corrida siguiente. `memo` evita pedir dos veces
// el mismo punto en una corrida (varios equipos, varios trabajos).
async function climaDia(la, lo, d, memo) {
  const key = `${la},${lo},${d}`;
  if (memo.has(key)) return memo.get(key);
  let out = null;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${la}&longitude=${lo}`
      + '&daily=weather_code,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,temperature_2m_max,temperature_2m_min'
      + `&timezone=auto&start_date=${d}&end_date=${d}`;
    const r = await fetch(url, typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(8000) } : {});
    if (r.ok) {
      const j = await r.json();
      const x = j && j.daily;
      const i = x && Array.isArray(x.time) ? x.time.indexOf(d) : -1;
      if (i >= 0) {
        out = {
          code: x.weather_code?.[i] ?? null, pp: x.precipitation_probability_max?.[i] ?? null,
          mm: x.precipitation_sum?.[i] ?? null, wind: x.wind_speed_10m_max?.[i] ?? null,
          gust: x.wind_gusts_10m_max?.[i] ?? null,
          tmax: x.temperature_2m_max?.[i] ?? null, tmin: x.temperature_2m_min?.[i] ?? null,
        };
      }
    }
  } catch (_) {}
  memo.set(key, out);
  return out;
}

// Emoji del código WMO (el mismo criterio que _climaEmojiDesc de la app).
function climaEmoji(c) {
  if (c == null) return '🌡️';
  if (c === 0) return '☀️';
  if (c <= 2) return '🌤️';
  if (c === 3) return '☁️';
  if (c === 45 || c === 48) return '🌫️';
  if (c <= 67 || (c >= 80 && c <= 82)) return '🌧️';
  if (c <= 86) return '🌨️';
  return '⛈️';
}
const CLIMA_WIND_MOSTRAR = 35;   // como WIND_CHIP de la app: menos es ruido

// Una línea de pronóstico para leer sin abrir la app:
//   "☀️ 14–24 °C · sin lluvia — García"
//   "⚠️ Ráfagas de 55 km/h · 14–24 °C — García y López"
export function climaLinea(d, quien) {
  const temp = (d.tmin != null && d.tmax != null) ? `${Math.round(d.tmin)}–${Math.round(d.tmax)} °C` : '';
  const m = climaMotivo(d);
  const g = d.gust != null ? d.gust : d.wind;
  let txt;
  if (m) {
    txt = '⚠️ ' + m.txt.charAt(0).toUpperCase() + m.txt.slice(1) + (temp ? ' · ' + temp : '');
  } else {
    const partes = [temp, (d.pp != null && d.pp >= 30) ? `lluvia ${Math.round(d.pp)} %` : 'sin lluvia'];
    if (g != null && g >= CLIMA_WIND_MOSTRAR) partes.push(`ráfagas de ${Math.round(g)} km/h`);
    txt = climaEmoji(d.code) + ' ' + partes.filter(Boolean).join(' · ');
  }
  return { mala: !!m, viento: !!(m && m.viento && !m.lluvia), txt: txt + (quien ? ' — ' + quien : '') };
}

// Mira el clima de todos los puntos del aviso (los de la misma zona, juntos).
// { ok, malas, buenas, viento } — ok=false si no se pudo consultar NINGUNO.
async function climaDeAviso(clima, memo) {
  let ok = false, viento = false;
  const malas = [], buenas = [];
  const zonas = new Map();
  for (const p of clima.pts) {
    const z = `${p.la},${p.lo}`;
    if (!zonas.has(z)) zonas.set(z, { la: p.la, lo: p.lo, n: [] });
    if (p.n && !zonas.get(z).n.includes(p.n)) zonas.get(z).n.push(p.n);
  }
  for (const z of zonas.values()) {
    const d = await climaDia(z.la, z.lo, clima.d, memo);
    if (!d) continue;
    ok = true;
    const quien = z.n.length > 2 ? z.n.slice(0, 2).join(', ') + ' y otros' : z.n.join(' y ');
    const l = climaLinea(d, quien);
    if (l.viento) viento = true;
    (l.mala ? malas : buenas).push(l.txt);
  }
  return { ok, malas, buenas, viento };
}

// Aviso listo para mandar: el texto de la app + el pronóstico. Si está feo va
// PRIMERO (es lo que se ve sin desplegar) y el título lo marca; si está lindo,
// al final, como dato.
function conClima(a, cl) {
  if (!cl || (!cl.malas.length && !cl.buenas.length)) return a;
  if (!cl.malas.length) {
    return Object.assign({}, a, { body: [a.body, ...cl.buenas.slice(0, 3)].filter(Boolean).join('\n') });
  }
  const emoji = cl.viento ? '💨' : '🌧️';
  return Object.assign({}, a, {
    title: `${emoji} ${a.title}`.slice(0, 120),
    body: [...cl.malas.slice(0, 3), '¿Reprogramás?', a.body, ...cl.buenas.slice(0, 2)].filter(Boolean).join('\n'),
  });
}

// Lo que viaja al teléfono. `k` y `dev` son para el botón "Posponer" (el
// Service Worker le pide al Worker que lo vuelva a mandar en una hora).
export function payloadDe(a, deviceId) {
  const p = { title: a.title, body: recortarRenglones(a.body, MAX_BODY), go: a.go, tag: a.tag };
  if (a.acts && a.acts.length) {
    p.acts = a.acts;
    if (a.acts.some(x => x.a === 'posponer')) { p.k = a.k; p.dev = deviceId; }
  }
  // El servicio de push rechaza más de ~4 KB: se recorta el cuerpo por renglones
  // enteros (y, si un renglón solo no entra, a lo bruto) hasta que entre.
  const bytes = () => new TextEncoder().encode(JSON.stringify(p)).length;
  while (bytes() > MAX_PAYLOAD_BYTES && p.body) {
    const corte = p.body.lastIndexOf('\n');
    p.body = corte > 0 ? p.body.slice(0, corte) : p.body.slice(0, Math.max(0, p.body.length - 50));
  }
  return p;
}

const POSPONER_MIN = 60;
const MAX_POSPUESTOS = 10;

// Minutos de diferencia con UTC del teléfono (getTimezoneOffset: 180 en
// Argentina). Con eso el Worker sabe qué hora es "allá" sin suponer el país.
function tzValido(n) {
  n = Number(n);
  return Number.isFinite(n) && n >= -840 && n <= 840 ? Math.round(n) : 180;
}
// 'YYYY-MM-DDTHH:MM' de la hora local del dispositivo.
function localAhora(tzOff, ms = Date.now()) {
  return new Date(ms - tzOff * 60000).toISOString().slice(0, 16);
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
          if (sent === true) ok++;
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
          avisos:    avisosGenValidos(body.avisos),
          tz:        tzValido(body.tz),
          notified:  prev.notified || {},
          enviados:  prev.enviados || {},
          pospuestos: Array.isArray(prev.pospuestos) ? prev.pospuestos : [],
          lastPing:  prev.lastPing || 0,
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

    // POST /ping {deviceId} — push de prueba SOLO al dispositivo que lo pide (el
    // botón "Probar" de la app). No puede hacer sonar a otro equipo: usa la
    // suscripción que ese mismo deviceId guardó. Uno cada 30 s como máximo.
    if (url.pathname === '/ping' && request.method === 'POST') {
      try {
        const { deviceId } = await request.json();
        if (!DEVICE_ID_RE.test(String(deviceId || ''))) return new Response('Bad deviceId', {status:400, headers:CORS});
        const key = `sub:${deviceId}`;
        const data = JSON.parse(await env.PUSH_KV.get(key) || 'null');
        if (!data?.subscription) return new Response('No subscription', {status:404, headers:CORS});
        if (Date.now() - (data.lastPing || 0) < 30000) return new Response('Too many', {status:429, headers:CORS});
        data.lastPing = Date.now();
        await env.PUSH_KV.put(key, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 90 });
        const r = await sendPush(data.subscription, {
          title: 'Presupuesto AR — prueba ✓',
          body: 'Las notificaciones llegan a este teléfono.',
          go: 'agenda', tag: 'pq-prueba',
        }, env);
        if (r === 'gone') { await env.PUSH_KV.delete(key); return new Response('Gone', {status:410, headers:CORS}); }
        return new Response(r ? 'OK' : 'Push failed', {status: r ? 200 : 502, headers:CORS});
      } catch(e) { return new Response('Error', {status:500, headers:CORS}); }
    }

    // POST /posponer {deviceId, k} — botón "Posponer 1 h" de la notificación.
    // Vuelve a mandar ESE aviso (el que ya tiene guardado este equipo, con su
    // texto) dentro de una hora. No acepta texto nuevo: quien conozca un
    // deviceId solo puede repetir un aviso que ese equipo ya iba a recibir.
    if (url.pathname === '/posponer' && request.method === 'POST') {
      try {
        const { deviceId, k } = await request.json();
        if (!DEVICE_ID_RE.test(String(deviceId || '')) || !/^[\w:.-]{1,80}$/.test(String(k || ''))) {
          return new Response('Bad request', {status:400, headers:CORS});
        }
        const key = `sub:${deviceId}`;
        const data = JSON.parse(await env.PUSH_KV.get(key) || 'null');
        if (!data?.subscription) return new Response('No subscription', {status:404, headers:CORS});
        const pos = Array.isArray(data.pospuestos) ? data.pospuestos : [];
        const orig = (data.avisos || []).concat(pos).find(a => a.k === k);
        if (!orig) return new Response('Not found', {status:404, headers:CORS});
        if (pos.length >= MAX_POSPUESTOS) pos.shift();
        const tz = tzValido(data.tz);
        pos.push({
          k: `${String(orig.k).replace(/:p[0-9a-z]+$/, '').slice(0, 66)}:p${Date.now().toString(36)}`,
          at: localAhora(tz, Date.now() + POSPONER_MIN * 60000),
          title: orig.title, body: orig.body, go: orig.go, tag: orig.tag,
          ...(orig.acts ? { acts: orig.acts } : {}),
        });
        data.pospuestos = pos;
        await env.PUSH_KV.put(key, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 90 });
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
export async function runDue(env, ms = Date.now()) {
  const { keys } = await env.PUSH_KV.list({ prefix: 'sub:' });
  let total = 0;
  const memo = new Map();   // pronósticos ya pedidos en esta corrida

  await Promise.all(keys.map(async ({name}) => {
    try {
      const data = JSON.parse(await env.PUSH_KV.get(name));
      if (!data?.subscription) return;
      const tz = tzValido(data.tz);
      const ahora = localAhora(tz, ms);          // 'YYYY-MM-DDTHH:MM' del teléfono
      const today = ahora.slice(0, 10);
      const hora = Number(ahora.slice(11, 13));
      const notified = data.notified || {};
      const enviados = data.enviados || {};
      let changed = false, gone = false;

      const enviar = async (payload) => {
        const r = await sendPush(data.subscription, payload, env);
        if (r === 'gone') gone = true;
        return r === true;
      };

      // Seguimientos y vencimientos: el cron corre cada 15 minutos, pero estos
      // salen solo en las tres franjas de siempre (9, 14 y 19 h del teléfono),
      // una vez por día cada presupuesto.
      const franja = [9, 14, 19].includes(hora);

      const due = franja ? (data.followups || [])
        .filter(f => f.date <= today && notified['fu:' + f.id] !== today) : [];
      if (due.length && !gone) {
        const n = due.length;
        const title = n === 1
          ? `Seguimiento: ${due[0].clientName}`
          : `${n} clientes para seguimiento`;
        const body = n === 1
          ? `Llevan ${due[0].diasDesdeEnvio} días sin respuesta.`
          : due.slice(0,3).map(f=>f.clientName).join(', ') + (n>3?' y más.':'.');
        if (await enviar({title, body, go:goAvisos(due, 'seg'), tag:'pq-seguimiento'})) {
          due.forEach(f => { notified['fu:' + f.id] = today; });
          changed = true; total++;
        }
      }

      const exp = franja ? (data.expiries || [])
        .filter(f => f.date < today && notified['vc:' + f.id] !== today) : [];
      if (exp.length && !gone) {
        const n = exp.length;
        const title = n === 1
          ? `Presupuesto vencido: ${exp[0].clientName}`
          : `${n} presupuestos vencidos`;
        const body = n === 1
          ? 'Pasó su fecha de vigencia. Buen momento para contactar al cliente.'
          : exp.slice(0,3).map(f=>f.clientName).join(', ') + (n>3?' y más.':'.');
        if (await enviar({title, body, go:goAvisos(exp, 'venc'), tag:'pq-vencimiento'})) {
          exp.forEach(f => { notified['vc:' + f.id] = today; });
          changed = true; total++;
        }
      }

      // Avisos con horario armados por la app. Sale el que ya llegó a su hora
      // y no tiene más de 3 h de atraso (un "mañana tenés trabajo" que llega al
      // otro día confunde más de lo que ayuda). Cada uno, una sola vez.
      const desde = localAhora(tz, ms - 3 * 3600000);
      const devId = name.slice(4);
      const pospuestos = Array.isArray(data.pospuestos) ? data.pospuestos : [];
      for (const a of (data.avisos || []).concat(pospuestos)) {
        if (gone) break;
        if (a.at > ahora || a.at < desde || enviados[a.k]) continue;
        let listo = a;
        if (a.clima) {
          const cl = await climaDeAviso(a.clima, memo);
          if (a.soloSiClima) {
            if (!cl.ok) continue;                       // sin pronóstico: reintentar
            if (!cl.malas.length) { enviados[a.k] = a.at; changed = true; continue; }   // día lindo: nada que avisar
          }
          listo = conClima(a, cl);
        }
        if (await enviar(payloadDe(listo, devId))) {
          enviados[a.k] = a.at; changed = true; total++;
        }
      }
      // Pospuestos: se quedan un día (para poder posponerlos otra vez) y se van.
      const ayer = localAhora(tz, ms - 86400000);
      const vivos = pospuestos.filter(a => a.at >= ayer);
      if (vivos.length !== pospuestos.length) { data.pospuestos = vivos; changed = true; }

      if (gone) { await env.PUSH_KV.delete(name); return; }

      // Limpiar marcas viejas para que no crezcan sin fin.
      for (const k of Object.keys(notified)) {
        if (notified[k] < today) { delete notified[k]; changed = true; }
      }
      const viejo = localAhora(tz, ms - 3 * 86400000);
      for (const k of Object.keys(enviados)) {
        if (enviados[k] < viejo) { delete enviados[k]; changed = true; }
      }

      if (changed) {
        data.notified = notified;
        data.enviados = enviados;
        await env.PUSH_KV.put(name, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 90 });
      }
    } catch(e) { console.error('Push error', name, e.message); }
  }));

  return total;
}
