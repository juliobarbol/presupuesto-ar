'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// CLIMA.JS — Pronóstico del tiempo para los trabajos agendados.
//
// Fuente: Open-Meteo (https://open-meteo.com) — gratuita, sin API key, con
// CORS abierto. Se pide el pronóstico DIARIO (código de tiempo, probabilidad
// y milímetros de lluvia, temperaturas, viento sostenido + ráfaga, e índice
// UV) para la ubicación de cada trabajo agendado de los próximos días.
//
// Coordenadas: se resuelven con la misma plomería del mapa (entryLatLng:
// pin manual → "lat,lng" → Plus Code). Si el trabajo no tiene ubicación, se
// usa el centroide de la zona del usuario (_mapaComputeGeoRef). Como el
// pronóstico es a escala de ciudad, las ubicaciones se agrupan redondeando
// a ~1 km: en la práctica es UNA sola llamada por refresco.
//
// Cache en LS.CLIMA (pq_clima): { "lat,lng": { at, v, days: { iso: {...} } } }.
// TTL 3 h. Sin conexión no se intenta nada y se sirve lo último cacheado
// (offline-first: el chip muestra el pronóstico viejo antes que nada).
//
// Se usa en: chip de clima (Agenda, banner de hoy, pop-up, Historial), tira
// de 7 días al agendar (elegir un buen día), recomendaciones del día, y aviso
// accionable de lluvia/viento para trabajos de HOY o MAÑANA (toast que lleva
// al presupuesto y ofrece reprogramar por WhatsApp; una vez por día por
// trabajo, gate en LS.CLIMA_WARN). Además, tocar cualquier chip (o el botón
// "Clima" del aviso) abre el PANEL DE DETALLE (climaOpenDetail): día completo
// en tarjetas, hora por hora (próximas 72 h, guardadas en `hours` del cache)
// y tira de próximos días para comparar.

const CLIMA = {
  TTL_MS: 3 * 60 * 60 * 1000,  // refrescar como mucho cada 3 h
  MAX_DAYS: 14,                // horizonte útil del pronóstico diario
  VER: 4,                      // versión del formato cacheado (v2: +UV, v3: +ráfaga,
                               // v4: +hora por hora); subirla invalida el cache
                               // viejo en el próximo refresh
  WIND_WARN: 45,               // km/h de ráfaga: aviso "peligro en altura"
  WIND_CHIP: 35,               // km/h de ráfaga: mostrar el viento en el chip
  UV_CHIP: 6,                  // índice UV: mostrar el UV en el chip (escala OMS: "alto")
  _fetching: false,
};

function _climaCache() {
  try { return JSON.parse(localStorage.getItem(LS.CLIMA) || '{}') || {}; }
  catch (_) { return {}; }
}

// Agrupar ubicaciones a ~1 km (2 decimales): el pronóstico no cambia a esa
// escala y así casi siempre alcanza con una sola llamada a la API.
function _climaKey(ll) { return ll[0].toFixed(2) + ',' + ll[1].toFixed(2); }

// Zona cacheada ({ at, v, days, hours }) de unas coordenadas, o null. Es el
// paso común de climaDe/climaDeNota y de todo lo que necesite las HORAS
// además del día (el resumen para compartir, por ejemplo).
function _climaZona(ll) {
  if (!ll) return null;
  return _climaCache()[_climaKey(ll)] || null;
}

// Coordenadas para el clima de un trabajo: las del trabajo si las tiene,
// si no el centroide de la zona (todos los trabajos de un podador caen en
// la misma zona). null si no hay forma de ubicar nada todavía.
function _climaLatLngDe(e) {
  const propia = (typeof entryLatLng === 'function') ? entryLatLng(e) : null;
  if (propia) return propia;
  if (!_mapaGeoRef && typeof _mapaComputeGeoRef === 'function') _mapaGeoRef = _mapaComputeGeoRef();
  return _mapaGeoRef;
}

// Trabajos agendados (aceptados) con días dentro del horizonte del
// pronóstico: [{ e, fechas: [iso...] }].
function _climaProximosTrabajos() {
  const hoy = today();
  const lim = _calAddDays(hoy, CLIMA.MAX_DAYS);
  const out = [];
  getH().forEach(e => {
    if ((e.estado || '') !== 'aceptado') return;
    const fechas = agFechas(e).filter(f => f >= hoy && f <= lim);
    if (fechas.length) out.push({ e, fechas });
  });
  return out;
}

// Visitas (notas tipo 'visita') pendientes dentro del horizonte del
// pronóstico: sus zonas también se bajan/cachean para el chip de clima
// (evaluar un árbol con lluvia o ráfagas es tan mala idea como podarlo).
function _climaProximasVisitas() {
  const hoy = today();
  const lim = _calAddDays(hoy, CLIMA.MAX_DAYS);
  return (typeof getNotes === 'function' ? getNotes() : [])
    .filter(n => n && n.tipo === 'visita' && !n.hecho && n.fecha >= hoy && n.fecha <= lim);
}

// Coordenadas para el clima de una visita: la ubicación cargada en la nota
// ("lat,lng" o Plus Code; un link http no se puede convertir a coordenadas)
// o, si no, el centroide de la zona — igual que un trabajo sin ubicación.
function _climaLatLngNota(n) {
  const u = ((n && n.ubic) || '').trim();
  if (u && !/^https?:\/\//i.test(u)) {
    const m = u.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return [lat, lng];
    }
    const pc = (typeof plusCodeToLatLng === 'function') ? plusCodeToLatLng(u, _mapaGeoRef) : null;
    if (pc) return pc;
  }
  if (!_mapaGeoRef && typeof _mapaComputeGeoRef === 'function') _mapaGeoRef = _mapaComputeGeoRef();
  return _mapaGeoRef;
}

// Pronóstico cacheado para una visita en una fecha, o null si no hay.
function climaDeNota(n, iso) {
  const z = _climaZona(_climaLatLngNota(n));
  return (z && z.days && z.days[iso]) || null;
}

// Asegura el pronóstico de la zona de UNA visita recién agendada y llama a
// cb() al terminar (espejo de climaEnsureZona para trabajos).
async function climaEnsureNota(n, cb) {
  const ll = _climaLatLngNota(n);
  if (!ll) { if (cb) cb(); return; }
  const zonas = {}; zonas[_climaKey(ll)] = ll;
  try { await _climaFetchZonas(zonas); } catch (_) {}
  if (cb) cb();
}

// Baja y cachea el pronóstico de las zonas indicadas (map key→[lat,lng]) que
// no estén frescas (por TTL o versión de formato vieja). Persiste el cache y
// devuelve true si algo cambió. NO poda zonas (de eso se encarga climaRefresh
// con las zonas de los trabajos). No hace nada sin conexión.
// `opts.force` saltea el TTL: es el camino del botón "Actualizar" del panel,
// donde el usuario PIDE dato fresco (movió el trabajo de día, se largó a
// llover, salió una alerta). Ningún camino automático lo usa.
async function _climaFetchZonas(zonas, opts) {
  if (CLIMA._fetching || navigator.onLine === false) return false;
  const force = !!(opts && opts.force);
  // Sin que el usuario lo pida, no se sale a la red si la conexión está mal:
  // el pronóstico es lo MENOS urgente que hace la app, y en una red moribunda
  // esos kilobytes son los que hacen que todo lo demás no entre.
  if (!force && typeof netPuedeAuto === 'function' && !netPuedeAuto()) return false;
  const cache = _climaCache();
  const ahora = Date.now();
  const pendientes = Object.keys(zonas)
    .filter(k => force || !cache[k] || !cache[k].at || cache[k].v !== CLIMA.VER
              || (ahora - cache[k].at) > CLIMA.TTL_MS);
  if (!pendientes.length) return false;

  CLIMA._fetching = true;
  let cambio = false;
  try {
    for (const k of pendientes) {
      // Las coordenadas que salen a internet son las YA REDONDEADAS de la
      // zona (la clave: 2 decimales ≈ 1 km), no las exactas del trabajo. El
      // pronóstico diario es idéntico a esa escala, así que mandar 4 decimales
      // (≈ 11 m) solo exponía la ubicación puntual de la casa del cliente.
      const [lat, lng] = k.split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      try {
        const url = 'https://api.open-meteo.com/v1/forecast'
          + `?latitude=${lat}&longitude=${lng}`
          + '&daily=weather_code,precipitation_probability_max,precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max'
          + '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_gusts_10m,uv_index'
          + '&timezone=auto&forecast_days=16&forecast_hours=72';
        const res = await netFetch(url);
        if (!res.ok) continue;
        const j = await res.json();
        const d = j && j.daily;
        if (!d || !Array.isArray(d.time)) continue;
        const days = {};
        d.time.forEach((iso, i) => {
          days[iso] = {
            code: d.weather_code?.[i] ?? null,
            pp:   d.precipitation_probability_max?.[i] ?? null, // % probabilidad
            mm:   d.precipitation_sum?.[i] ?? null,             // milímetros
            tmax: d.temperature_2m_max?.[i] ?? null,
            tmin: d.temperature_2m_min?.[i] ?? null,
            wind: d.wind_speed_10m_max?.[i] ?? null,            // km/h sostenido
            gust: d.wind_gusts_10m_max?.[i] ?? null,            // km/h ráfaga (peligro en altura)
            uv:   d.uv_index_max?.[i] ?? null,                  // índice UV máx
          };
        });
        // Hora por hora (próximas 72 h — forecast_hours limita SOLO lo horario,
        // el diario sigue siendo de 16 días): agrupado por fecha local para el
        // panel de detalle ("a qué hora llueve / cuándo pega la ráfaga").
        const hh = j.hourly;
        const hours = {};
        if (hh && Array.isArray(hh.time)) {
          hh.time.forEach((t, i) => {
            const [iso, hm] = t.split('T');
            (hours[iso] || (hours[iso] = [])).push({
              h:    hm ? hm.slice(0, 2) : '',                  // "07", "15"…
              t:    hh.temperature_2m?.[i] ?? null,
              pp:   hh.precipitation_probability?.[i] ?? null, // % probabilidad
              mm:   hh.precipitation?.[i] ?? null,             // milímetros
              code: hh.weather_code?.[i] ?? null,
              gust: hh.wind_gusts_10m?.[i] ?? null,            // km/h ráfaga
              uv:   hh.uv_index?.[i] ?? null,
            });
          });
        }
        cache[k] = { at: ahora, v: CLIMA.VER, days, hours };
        cambio = true;
      } catch (_) { /* sin señal o API caída: se sirve lo cacheado */ }
    }
    // Cache: sin disparar copia a Drive (ver safeSetLS / opts.backup).
    if (cambio) safeSetLS(LS.CLIMA, JSON.stringify(cache), { backup: false });
  } finally {
    CLIMA._fetching = false;
  }
  return cambio;
}

// Refresco (silencioso): baja el pronóstico de las zonas con trabajos
// agendados que no estén frescas, poda las que ya no tienen trabajos, avisa si
// viene lluvia/viento y repinta lo que muestra clima. No hace nada sin
// conexión o sin trabajos próximos.
async function climaRefresh() {
  if (navigator.onLine === false) return;
  const trabajos = _climaProximosTrabajos();
  const visitas = _climaProximasVisitas();
  if (!trabajos.length && !visitas.length) return;

  const zonas = {};
  trabajos.forEach(t => { const ll = _climaLatLngDe(t.e); if (ll) zonas[_climaKey(ll)] = ll; });
  visitas.forEach(n => { const ll = _climaLatLngNota(n); if (ll) zonas[_climaKey(ll)] = ll; });
  const cambio = await _climaFetchZonas(zonas);

  // Podar zonas que ya no corresponden a ningún trabajo ni visita.
  const cache = _climaCache();
  let podado = false;
  Object.keys(cache).forEach(k => { if (!zonas[k]) { delete cache[k]; podado = true; } });
  if (podado) { try { safeSetLS(LS.CLIMA, JSON.stringify(cache), { backup: false }); } catch (_) {} }

  _climaAvisar();
  if (cambio) {
    // Repintar lo que muestra clima con el dato fresco.
    try { if (typeof renderCal === 'function') renderCal(); } catch (_) {}
    try { if (typeof renderMorningBanner === 'function') renderMorningBanner(); } catch (_) {}
    try { if (typeof renderHistory === 'function') renderHistory(); } catch (_) {}
  }
}

// Refresco MANUAL (botón "Actualizar" del panel de clima). Todos los caminos
// automáticos respetan el TTL de 3 h, así que dentro de esa ventana no vuelven
// a pedir NADA: el panel puede decir "hace 2 h" y no hay forma de destrabarlo.
// Esto es lo que faltaba — mover un trabajo de día, una alerta meteorológica o
// simplemente ver el cielo distinto al pronóstico son razones válidas para
// querer el dato de ahora.
//
// Refresca TODAS las zonas con trabajos/visitas próximos (no solo la del panel
// abierto): en la práctica es una sola llamada, y así quedan al día los chips
// de la Agenda, el banner y el Historial de una sola vez.
// Devuelve: 'ok' | 'offline' | 'ocupado' | 'nada' | 'error'.
async function climaForceRefresh(extraLL) {
  if (navigator.onLine === false) return 'offline';
  if (CLIMA._fetching) return 'ocupado';
  const zonas = {};
  _climaProximosTrabajos().forEach(t => { const ll = _climaLatLngDe(t.e); if (ll) zonas[_climaKey(ll)] = ll; });
  _climaProximasVisitas().forEach(n => { const ll = _climaLatLngNota(n); if (ll) zonas[_climaKey(ll)] = ll; });
  // La zona del panel abierto aunque el trabajo ya no cuente como "próximo"
  // (p. ej. mirando un día pasado o un presupuesto que todavía no se aceptó).
  if (extraLL) zonas[_climaKey(extraLL)] = extraLL;
  if (!Object.keys(zonas).length) return 'nada';

  let cambio = false;
  try { cambio = await _climaFetchZonas(zonas, { force: true }); }
  catch (_) { return 'error'; }
  if (!cambio) return 'error';   // ninguna zona respondió: API caída o sin señal real

  try { _climaAvisar(); } catch (_) {}
  try { if (typeof renderCal === 'function') renderCal(); } catch (_) {}
  try { if (typeof renderMorningBanner === 'function') renderMorningBanner(); } catch (_) {}
  try { if (typeof renderHistory === 'function') renderHistory(); } catch (_) {}
  return 'ok';
}

// Asegura el pronóstico de la zona de UN trabajo puntual (aunque todavía no
// esté aceptado): lo usa el diálogo de agendar para mostrar el clima al elegir
// el día. Baja si hace falta y llama a cb() al terminar (haya cambiado o no).
async function climaEnsureZona(e, cb) {
  const ll = _climaLatLngDe(e);
  if (!ll) { if (cb) cb(); return; }
  const zonas = {}; zonas[_climaKey(ll)] = ll;
  try { await _climaFetchZonas(zonas); } catch (_) {}
  if (cb) cb();
}

// Pronóstico cacheado para un trabajo en una fecha, o null si no hay.
function climaDe(e, iso) {
  const z = _climaZona(_climaLatLngDe(e));
  return (z && z.days && z.days[iso]) || null;
}

// ¿El pronóstico amerita aviso de lluvia? Probabilidad alta, milímetros
// apreciables o código WMO de lluvia/chaparrón/tormenta.
function climaEsLluvia(d) {
  if (!d) return false;
  const c = d.code;
  const codLluvia = c != null && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95);
  return (d.pp != null && d.pp >= 50) || (d.mm != null && d.mm >= 2) || codLluvia;
}

// Ráfaga máxima estimada (km/h): la ráfaga si está, si no el viento sostenido.
// Es lo que importa para trabajar en altura (lo que te sacude en el árbol).
function _climaRafaga(d) {
  if (!d) return null;
  return (d.gust != null) ? d.gust : (d.wind != null ? d.wind : null);
}

// ¿Viento fuerte? Ráfaga por encima del umbral de "peligro en altura".
function climaEsViento(d) {
  const g = _climaRafaga(d);
  return g != null && g >= CLIMA.WIND_WARN;
}

// Motivo de riesgo climático de un día para los avisos: { lluvia, viento, txt }.
// txt combina ambos ("lluvia y viento fuerte") o queda '' si el día está bien.
function _climaMotivo(d) {
  const l = climaEsLluvia(d), v = climaEsViento(d);
  let txt = '';
  if (l && v) txt = 'lluvia y viento fuerte';
  else if (l) txt = 'lluvia';
  else if (v) txt = 'viento fuerte';
  return { lluvia: l, viento: v, txt };
}

// Código WMO → emoji + descripción corta (es-AR).
function _climaEmojiDesc(c) {
  if (c == null)          return ['🌡️', 'Pronóstico'];
  if (c === 0)            return ['☀️', 'Despejado'];
  if (c <= 2)             return ['🌤️', 'Algo nublado'];
  if (c === 3)            return ['☁️', 'Nublado'];
  if (c === 45 || c === 48) return ['🌫️', 'Niebla'];
  if (c <= 57)            return ['🌦️', 'Llovizna'];
  if (c <= 67)            return ['🌧️', 'Lluvia'];
  if (c <= 77)            return ['🌨️', 'Nieve'];
  if (c <= 82)            return ['🌧️', 'Chaparrones'];
  if (c <= 86)            return ['🌨️', 'Nieve'];
  return ['⛈️', 'Tormenta'];
}

// Etiqueta corta del índice UV (escala OMS). '' si no hay dato.
function _climaUvLabel(uv) {
  if (uv == null) return '';
  if (uv >= 11) return 'extremo';
  if (uv >= 8)  return 'muy alto';
  if (uv >= 6)  return 'alto';
  if (uv >= 3)  return 'moderado';
  return 'bajo';
}

// Chip HTML con el pronóstico de un día (para la Agenda / banners / Historial),
// '' si no hay dato cacheado. Color según prioridad: lluvia (ámbar) > viento
// fuerte (rosa, peligro en altura) > UV alto (naranja). El viento se muestra en
// el texto a partir de ráfaga ≥ WIND_CHIP y el UV a partir de ≥ UV_CHIP; en el
// detalle (title) va todo siempre. `tap` (opcional) es el JS a ejecutar al
// tocarlo (armado con _climaTap): vuelve el chip clickeable (abre el panel de
// detalle) con stopPropagation para no disparar la tarjeta que lo contiene.
function climaChipHTML(d, tap) {
  if (!d) return '';
  const [emoji, desc] = _climaEmojiDesc(d.code);
  const lluvia = climaEsLluvia(d);
  const g = _climaRafaga(d);
  const vientoWarn = g != null && g >= CLIMA.WIND_WARN;
  const vientoChip = g != null && g >= CLIMA.WIND_CHIP;
  const uvAlto = d.uv != null && d.uv >= CLIMA.UV_CHIP;
  const temp = (d.tmax != null) ? ` ${Math.round(d.tmax)}°` : '';
  const lluviaTxt = lluvia
    ? ` · lluvia${d.pp != null ? ` ${Math.round(d.pp)}%` : ''}${d.mm ? ` (${Math.round(d.mm)} mm)` : ''}`
    : '';
  const vientoTxt = vientoChip ? ` · 💨 ${Math.round(g)} km/h` : '';
  const uvTxt = uvAlto ? ` · UV ${Math.round(d.uv)} ${_climaUvLabel(d.uv)}` : '';
  const cls = lluvia ? ' clima-rain' : (vientoWarn ? ' clima-wind' : (uvAlto ? ' clima-uv' : ''));
  const title = `${desc}${temp ? `, máx${temp}` : ''}`
    + `${d.tmin != null ? ` / mín ${Math.round(d.tmin)}°` : ''}`
    + `${d.pp != null ? ` · prob. de lluvia ${Math.round(d.pp)}%` : ''}`
    + `${g != null ? ` · viento ${Math.round(g)} km/h` : ''}`
    + `${d.uv != null ? ` · UV ${Math.round(d.uv)} (${_climaUvLabel(d.uv)})` : ''}`;
  const tapAttrs = tap
    ? ` role="button" tabindex="0" onclick="event.stopPropagation();${esc(tap)}"`
    : '';
  return `<span class="clima-chip${cls}${tap ? ' clima-tap' : ''}"${tapAttrs} title="${esc(title)}">`
       + `<span class="clima-emoji">${emoji}</span>${esc(desc)}${temp}${esc(lluviaTxt)}${esc(vientoTxt)}${esc(uvTxt)}`
       + (tap ? `<span class="clima-more">›</span>` : '') + `</span>`;
}

// Arma el onclick que abre el panel de detalle del clima para un trabajo
// (t='e', id numérico del historial) o una visita (t='n', id string de la
// nota) en una fecha dada. Se pasa como segundo argumento a climaChipHTML.
function _climaTap(t, id, iso) {
  const idJs = (typeof id === 'number') ? id : `'${String(id).replace(/['"\\<>]/g, '')}'`;
  return `climaOpenDetail('${t === 'n' ? 'n' : 'e'}',${idJs},'${String(iso).replace(/['"\\<>]/g, '')}')`;
}

// Recomendaciones prácticas del día (para el banner de "podas de hoy"): lista
// corta de avisos según lluvia, viento, UV y temperatura. Vacía si el día
// está tranquilo.
function climaRecomendaciones(d) {
  if (!d) return [];
  const out = [];
  if (climaEsLluvia(d)) out.push('🌧️ Puede llover — fijate si conviene reprogramar');
  const g = _climaRafaga(d);
  if (g != null && g >= CLIMA.WIND_WARN) out.push(`💨 Viento fuerte (${Math.round(g)} km/h) — cuidado con el trabajo en altura`);
  if (d.uv != null && d.uv >= 8)      out.push('🧴 UV muy alto — protector, gorra y sombra al mediodía');
  else if (d.uv != null && d.uv >= 6) out.push('🧴 UV alto — protector solar y gorra');
  if (d.tmax != null && d.tmax >= 32)     out.push('🥵 Va a hacer calor — llevá agua e hidratate seguido');
  else if (d.tmax != null && d.tmax <= 7) out.push('🥶 Va a hacer frío — abrigate bien');
  return out;
}

// ─── COMPARTIR EL PRONÓSTICO ─────────────────────────────────
// El pronóstico del día agendado no le sirve solo al que lo mira: el que sube
// al árbol, el que maneja abajo y el colega al que se le pidió una mano tienen
// que saber con qué se van a encontrar. Estas funciones arman el MISMO
// pronóstico que muestra el panel, pero en texto plano para pegarlo en un chat.
//
// Todo sale del cache: compartir anda sin señal, que es justo cuando hace falta
// coordinar. Sin dato cacheado devuelven '' y el botón no se dibuja — mandar
// "no sé cómo va a estar" no es compartir el clima.

// Rangos de horas laborables (6–21) feas del día — lluvia probable o ráfaga con
// peligro en altura, el mismo criterio que tiñe de ámbar la tira "hora por
// hora" del panel — resumidos en texto ("de 11 a 16 h", "a las 9 y de 14 a 17 h").
// El pronóstico horario solo llega a ~72 h; más allá devuelve ''.
function _climaFranjasTxt(zona, iso) {
  const horas = ((zona && zona.hours && zona.hours[iso]) || [])
    .filter(x => (x.pp != null && x.pp >= 40) || (x.mm != null && x.mm >= 0.5)
              || (x.gust != null && x.gust >= CLIMA.WIND_WARN))
    .map(x => parseInt(x.h, 10))
    .filter(h => Number.isFinite(h) && h >= 6 && h <= 21);
  if (!horas.length) return '';
  // Agrupar las horas consecutivas en rangos: "11, 12, 13" se lee mal.
  const rangos = [];
  let ini = horas[0], prev = horas[0];
  for (let i = 1; i < horas.length; i++) {
    if (horas[i] === prev + 1) { prev = horas[i]; continue; }
    rangos.push([ini, prev]); ini = prev = horas[i];
  }
  rangos.push([ini, prev]);
  return rangos.map(([a, b]) => (a === b ? `a las ${a}` : `de ${a} a ${b}`)).join(' y ') + ' h';
}

// Líneas de texto plano con el pronóstico de un día: descripción + térmica,
// lluvia, viento y UV. Devuelve [] si no hay dato.
// `zona`+`iso` son opcionales: con ellos se agrega la franja horaria fea (solo
// la tiene el panel, que es de donde sale el mensaje largo).
// El viento y el UV se muestran con el mismo umbral que el chip (WIND_CHIP /
// UV_CHIP): una brisa de 12 km/h y un UV 2 no son noticia para nadie, y una
// línea por dato convierte el mensaje en ruido que el compañero deja de leer.
function climaResumenLineas(d, zona, iso) {
  if (!d) return [];
  const out = [];
  const [em, desc] = _climaEmojiDesc(d.code);
  const t = [
    d.tmax != null ? `máx ${Math.round(d.tmax)}°` : '',
    d.tmin != null ? `mín ${Math.round(d.tmin)}°` : '',
  ].filter(Boolean).join(' / ');
  out.push(`${em} ${desc}${t ? ` · ${t}` : ''}`);

  const lluvia = climaEsLluvia(d);
  if (lluvia || (d.pp != null && d.pp >= 20)) {
    const mm = d.mm ? ` (${Math.round(d.mm * 10) / 10} mm)` : '';
    out.push(`🌧️ Lluvia ${d.pp != null ? Math.round(d.pp) + '%' : 'probable'}${mm}`);
  }
  const g = _climaRafaga(d);
  if (g != null && g >= CLIMA.WIND_CHIP) {
    out.push(`💨 Ráfagas ${Math.round(g)} km/h${climaEsViento(d) ? ' — peligro en altura' : ''}`);
  }
  if (d.uv != null && d.uv >= CLIMA.UV_CHIP) {
    out.push(`☀️ UV ${Math.round(d.uv)} (${_climaUvLabel(d.uv)})`);
  }
  if (!lluvia && !climaEsViento(d) && out.length === 1) out.push('✅ Día tranquilo para trabajar');

  const franjas = iso ? _climaFranjasTxt(zona, iso) : '';
  if (franjas) out.push(`⏰ Se complica ${franjas}`);
  return out;
}

// Texto completo del panel abierto, para el botón "Compartir": quién y qué día
// arriba (el compañero recibe el mensaje suelto, sin el contexto de la app),
// el pronóstico, y las recomendaciones — que son la parte accionable, la que
// dice si hay que llevar agua o dejar el trabajo en altura para otro día.
function climaShareTexto() {
  const tgt = _climaDlgTarget();
  if (!tgt || !_climaDlg) return '';
  const iso = _climaDlg.iso;
  const zona = _climaZona(tgt.ll);
  const d = (zona && zona.days && zona.days[iso]) || null;
  if (!d) return '';

  const anio = String(iso).split('-')[0] || '';
  const fecha = (typeof _calLongDate === 'function' ? _calLongDate(iso) : iso) + (anio ? ` de ${anio}` : '');
  const qué = tgt.e ? 'Poda' : 'Visita';
  const lines = [`${tgt.e ? '🌳' : '📋'} ${qué}: ${tgt.titulo} · ${fecha}`];
  lines.push(...climaResumenLineas(d, zona, iso));

  const recs = climaRecomendaciones(d);
  if (recs.length) lines.push('', ...recs.map(r => `• ${r}`));
  lines.push('', 'Pronóstico de Open-Meteo');
  return lines.join('\n');
}

// Botón "Compartir" del pie del panel: manda el pronóstico por la bandeja
// nativa (WhatsApp al compañero, al colega que da una mano, al grupo).
function climaCompartir() {
  const txt = climaShareTexto();
  if (!txt) { toast('Todavía no hay pronóstico de este día para compartir', 'info', 3000); return; }
  shareText(txt, 'Pronóstico del día');
}

// Chip de clima para una tarjeta del Historial (idea 5): solo para trabajos
// aceptados con un día próximo (hoy o futuro) dentro del horizonte. '' si no
// aplica o no hay pronóstico cacheado.
function climaChipForEntry(e) {
  if (!e || (e.estado || '') !== 'aceptado') return '';
  const hoy = today();
  const ref = (typeof agFechas === 'function' ? agFechas(e) : []).find(f => f >= hoy);
  if (!ref) return '';
  return climaChipHTML(climaDe(e, ref), _climaTap('e', e.id, ref));
}

// ─── PANEL DE DETALLE DEL CLIMA (tocar un chip / el aviso) ───
// Modal con el pronóstico completo de un día para un trabajo ('e') o una
// visita ('n'): tarjetas de lluvia/viento/UV/térmica, hora por hora (si está
// cacheado: próximas 72 h), recomendaciones y tira de días para comparar.
// Objetivo: que el usuario pueda prepararse ante un imprevisto del clima sin
// salir de la app (y reprogramar por WhatsApp desde acá si pinta feo).
let _climaDlg = null;   // { t:'e'|'n', id, iso } del panel abierto

function climaOpenDetail(t, id, iso) {
  _climaDlg = { t: t === 'n' ? 'n' : 'e', id, iso: iso || today() };
  _climaDetailRender();
  const ov = document.getElementById('clima-overlay');
  if (ov) ov.classList.add('open');
  // Refrescar la zona en segundo plano (solo si hace falta y hay señal) y
  // repintar el panel si sigue abierto cuando llega el dato fresco.
  const cb = () => { if (_climaDlg && document.querySelector('#clima-overlay.open')) _climaDetailRender(); };
  if (_climaDlg.t === 'e') {
    const e = getH().find(x => x.id === id);
    if (e) climaEnsureZona(e, cb);
  } else {
    const n = (typeof getNotes === 'function' ? getNotes() : []).find(x => x.id === id);
    if (n) climaEnsureNota(n, cb);
  }
}

function closeClimaDetail() {
  const ov = document.getElementById('clima-overlay');
  if (ov) ov.classList.remove('open');
  _climaDlg = null;
}

// Tocar un día de la tira del panel: cambia el día mostrado.
function climaDetailPick(iso) {
  if (_climaDlg) { _climaDlg.iso = iso; _climaDetailRender(); }
}

// Botón "Actualizar" del pie del panel. Deja el botón girando mientras baja
// (una llamada a la API tarda lo que tarda, y sin feedback el usuario toca de
// nuevo) y repinta el panel con el dato nuevo — incluido el "hace X", que es
// como se confirma que sirvió.
async function climaRefrescarAhora(btn) {
  if (btn && btn.disabled) return;
  if (btn) {
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.innerHTML = `<span class="cw-refresh-sp"></span> Actualizando…`;
  }
  const tgt = _climaDlgTarget();
  const r = await climaForceRefresh(tgt && tgt.ll);
  if (_climaDlg && document.querySelector('#clima-overlay.open')) _climaDetailRender();
  else if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = `${icon('refresh')} Actualizar`; }
  if (r === 'ok')            toast('Pronóstico actualizado', 'ok', 2200);
  else if (r === 'offline')  toast('Sin conexión: se sigue mostrando el último pronóstico guardado', 'info', 3800);
  else if (r === 'ocupado')  toast('Ya se está actualizando…', 'info', 2000);
  else if (r === 'nada')     toast('No hay trabajos ni visitas próximos para pronosticar', 'info', 3000);
  else                       toast('No se pudo actualizar el pronóstico. Probá de nuevo en un rato', 'info', 3800);
}

// Sujeto del panel abierto (trabajo o visita) + su zona / título / fechas
// agendadas (para marcarlas en la tira). null si el registro ya no existe.
function _climaDlgTarget() {
  if (!_climaDlg) return null;
  if (_climaDlg.t === 'e') {
    const e = getH().find(x => x.id === _climaDlg.id);
    if (!e) return null;
    return {
      e, ll: _climaLatLngDe(e),
      kicker: 'Pronóstico para la poda',
      titulo: (e.clientName || '').trim() || '(sin nombre)',
      fechas: (typeof agFechas === 'function') ? agFechas(e) : [],
    };
  }
  const n = (typeof getNotes === 'function' ? getNotes() : []).find(x => x.id === _climaDlg.id);
  if (!n) return null;
  return {
    n, ll: _climaLatLngNota(n),
    kicker: 'Pronóstico para la visita',
    titulo: (n.texto || '').trim() || (n.cliente || '').trim() || 'Visita',
    fechas: n.fecha ? [n.fecha] : [],
  };
}

// "recién" / "hace 40 min" / "hace 2 h" — edad del pronóstico cacheado, para
// saber cuán confiable es lo que se está viendo (clave estando offline).
function _climaHaceTxt(at) {
  const min = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (min < 1) return 'recién actualizado';
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.round(min / 60)} h`;
}

function _climaDetailRender() {
  const body = document.getElementById('clima-dlg-body');
  if (!body || !_climaDlg) return;
  const tgt = _climaDlgTarget();
  if (!tgt) { body.innerHTML = '<div class="cw-empty">No se encontró el trabajo o la visita.</div>'; return; }
  const zona = tgt.ll ? _climaCache()[_climaKey(tgt.ll)] : null;
  const iso = _climaDlg.iso;
  const d = (zona && zona.days && zona.days[iso]) || null;
  const hoy = today();

  const fechaTxt = (typeof _calLongDate === 'function') ? _calLongDate(iso) : iso;
  let cuando = iso === hoy ? ' · hoy' : (iso === _calAddDays(hoy, 1) ? ' · mañana' : '');
  // Marcar si el día mirado es el agendado (ayuda a no confundirse navegando
  // la tira: solo en estos días aparece "Reprogramar").
  if (tgt.fechas.includes(iso)) cuando += tgt.e ? ' · día del trabajo' : ' · día de la visita';

  // Tira de días (hoy → +6) para comparar/elegir: los días con lluvia o
  // ráfagas van en ámbar y los agendados del trabajo quedan marcados.
  let strip = '';
  if (zona && zona.days) {
    const dias = [];
    for (let i = 0; i < 7; i++) { const di = _calAddDays(hoy, i); dias.push({ iso: di, d: zona.days[di] }); }
    if (dias.some(x => x.d)) {
      strip = `<div class="agenda-clima-strip">` + dias.map(({ iso: di, d: dd }, i) => {
        const [em] = dd ? _climaEmojiDesc(dd.code) : ['·', ''];
        const mal = dd && (climaEsLluvia(dd) || climaEsViento(dd));
        const p = di.split('-');
        const dt = new Date(+p[0], +p[1] - 1, +p[2]);
        const wd = i === 0 ? 'Hoy' : AGENDA_WD[dt.getDay()];
        const temp = dd && dd.tmax != null ? `${Math.round(dd.tmax)}°` : '';
        return `<button type="button" class="agenda-clima-day${mal ? ' mal' : ''}${di === iso ? ' sel' : ''}${tgt.fechas.includes(di) ? ' elegido' : ''}" onclick="climaDetailPick('${di}')" title="${esc(dt.getDate() + '/' + (dt.getMonth() + 1))}">
          <span class="acd-wd">${esc(wd)}</span><span class="acd-em">${em}</span><span class="acd-t">${esc(temp)}</span></button>`;
      }).join('') + `</div>`;
    }
  }

  let main = '';
  if (d) {
    const [em, desc] = _climaEmojiDesc(d.code);
    const g = _climaRafaga(d);
    const lluvia = climaEsLluvia(d);
    const viento = climaEsViento(d);
    const uvAlto = d.uv != null && d.uv >= CLIMA.UV_CHIP;
    const tTxt = [
      d.tmax != null ? `Máx ${Math.round(d.tmax)}°` : '',
      d.tmin != null ? `Mín ${Math.round(d.tmin)}°` : '',
    ].filter(Boolean).join(' · ');

    const cards =
      `<div class="cw-card${lluvia ? ' warn' : ''}">
        <span class="cw-card-l">🌧️ Lluvia</span>
        <span class="cw-card-v">${d.pp != null ? `${Math.round(d.pp)}%` : '—'}</span>
        <span class="cw-card-s">${d.mm ? `${Math.round(d.mm * 10) / 10} mm previstos` : (lluvia ? 'posible lluvia' : 'sin acumulado previsto')}</span>
      </div>
      <div class="cw-card${viento ? ' peligro' : ''}">
        <span class="cw-card-l">💨 Viento</span>
        <span class="cw-card-v">${g != null ? `${Math.round(g)} km/h` : '—'}</span>
        <span class="cw-card-s">${d.wind != null && d.gust != null ? `sostenido ${Math.round(d.wind)} · ráfagas ${Math.round(d.gust)}` : 'ráfaga máxima'}${viento ? ' — peligro en altura' : ''}</span>
      </div>
      <div class="cw-card${uvAlto ? ' warn' : ''}">
        <span class="cw-card-l">☀️ UV</span>
        <span class="cw-card-v">${d.uv != null ? Math.round(d.uv) : '—'}</span>
        <span class="cw-card-s">${d.uv != null ? `índice ${_climaUvLabel(d.uv)}` : 'sin dato'}</span>
      </div>
      <div class="cw-card">
        <span class="cw-card-l">🌡️ Temperatura</span>
        <span class="cw-card-v">${d.tmax != null ? `${Math.round(d.tmax)}°` : '—'}</span>
        <span class="cw-card-s">${d.tmin != null ? `mínima ${Math.round(d.tmin)}°` : ''}</span>
      </div>`;

    // Hora por hora del día (solo está para las próximas ~72 h). Se muestran
    // las horas laborables (6–21); las feas (lluvia probable o ráfaga con
    // peligro en altura) van teñidas de ámbar.
    let hoursHtml = '';
    const hs = ((zona.hours && zona.hours[iso]) || [])
      .filter(x => { const h = parseInt(x.h, 10); return h >= 6 && h <= 21; });
    if (hs.length) {
      hoursHtml = `<div class="cw-sec">Hora por hora</div><div class="cw-hours">` + hs.map(x => {
        const [hem] = _climaEmojiDesc(x.code);
        const malH = (x.pp != null && x.pp >= 40) || (x.mm != null && x.mm >= 0.5)
                  || (x.gust != null && x.gust >= CLIMA.WIND_WARN);
        return `<div class="cw-hour${malH ? ' mal' : ''}">
          <span class="cw-hour-h">${esc(x.h)} h</span>
          <span class="cw-hour-em">${hem}</span>
          <span class="cw-hour-t">${x.t != null ? Math.round(x.t) + '°' : ''}</span>
          ${x.pp != null && x.pp >= 20 ? `<span class="cw-hour-pp">💧${Math.round(x.pp)}%</span>` : ''}
          ${x.gust != null && x.gust >= CLIMA.WIND_CHIP ? `<span class="cw-hour-g">💨${Math.round(x.gust)}</span>` : ''}
        </div>`;
      }).join('') + `</div>`;
    }

    const recs = climaRecomendaciones(d);
    const recosHtml = `<div class="cw-sec">Para tener en cuenta</div><div class="cw-recos">`
      + (recs.length
          ? recs.map(r => `<div class="cw-reco">${esc(r)}</div>`).join('')
          : `<div class="cw-reco cw-reco-ok">✅ Día tranquilo para trabajar: sin lluvia ni viento fuerte a la vista.</div>`)
      + `</div>`;

    main = `
      <div class="cw-hero"><span class="cw-hero-em">${em}</span>
        <div><div class="cw-hero-desc">${esc(desc)}</div>${tTxt ? `<div class="cw-hero-t">${esc(tTxt)}</div>` : ''}</div></div>
      <div class="cw-grid">${cards}</div>
      ${hoursHtml}
      ${recosHtml}`;
  } else {
    main = `<div class="cw-empty">${zona
      ? 'No hay pronóstico para este día: queda más allá del horizonte útil (~2 semanas).'
      : 'Todavía no se descargó el pronóstico de esta zona. Se baja solo cuando hay conexión.'}</div>`;
  }

  // Pie: reprogramar por WhatsApp — SOLO si el día que se está mirando es un
  // día agendado del trabajo (con teléfono y clima feo). Navegando otros días
  // de la tira (p. ej. comparando) no tiene sentido ofrecer reprogramar: el
  // mensaje diría "para el día pactado pronostican lluvia" y sería falso.
  const motivo = d ? _climaMotivo(d) : { txt: '' };
  const tieneTel = tgt.e && typeof histClientPhone === 'function' && !!histClientPhone(tgt.e);
  const repro = (tgt.e && motivo.txt && tieneTel && tgt.fechas.includes(iso))
    ? `<button type="button" class="btn btn-g btn-sm" onclick="climaReprogramarWhatsApp(${tgt.e.id}, '${esc(motivo.txt)}')">${icon('message')} Reprogramar</button>`
    : '';
  // "Compartir": pasarle el día a los compañeros de trabajo. A diferencia de
  // "Reprogramar" (que es para el cliente y solo si el día pintó feo), este
  // sale en CUALQUIER día con pronóstico —incluidos los buenos: "el jueves
  // está lindo, dale que vamos" es tan útil como el aviso de lluvia— y también
  // navegando la tira, porque comparar días con el equipo es media coordinación.
  const compartir = d
    ? `<button type="button" class="btn btn-g btn-sm" onclick="climaCompartir()" title="Mandarle el pronóstico de este día a un compañero">${icon('share')} Compartir</button>`
    : '';
  // "Actualizar": el único camino que ignora el TTL de 3 h. Va pegado a la
  // edad del dato porque es justo ahí donde uno se pregunta "¿y si cambió?".
  const foot = `<div class="cw-foot">
    <span class="cw-src">Open-Meteo${zona && zona.at ? ` · ${esc(_climaHaceTxt(zona.at))}` : ''}</span>
    <button type="button" class="cw-refresh" id="cw-refresh" onclick="climaRefrescarAhora(this)" title="Volver a pedir el pronóstico ahora mismo">${icon('refresh')} Actualizar</button>
    <div class="cw-btns">${compartir}${repro}<button type="button" class="btn btn-p btn-sm" onclick="closeClimaDetail()">Listo</button></div>
  </div>`;

  body.innerHTML = `
    <div class="cw-kicker">${esc(tgt.kicker)}</div>
    <h4 class="cw-title" id="clima-dlg-title">${esc(tgt.titulo)}</h4>
    <div class="cw-fecha">${esc(fechaTxt + cuando)}</div>
    ${strip}
    ${main}
    ${foot}`;
}

// Abre WhatsApp con un mensaje ya redactado para reprogramar el trabajo por
// mal clima (idea 3). `motivo` = texto del _climaMotivo ("lluvia" / "viento
// fuerte" / "lluvia y viento fuerte"); si viene vacío, mensaje genérico.
function climaReprogramarWhatsApp(id, motivo) {
  const e = getH().find(x => x.id === id);
  if (!e) return;
  const phone = (typeof normalizeArgPhone === 'function' && typeof histClientPhone === 'function')
    ? normalizeArgPhone(histClientPhone(e)) : '';
  const cliente = (e.clientName || '').trim();
  const empresa = (S.coName || '').trim();
  const saludo = cliente ? `Hola ${cliente}` : 'Hola';
  const firma = empresa ? ` Te escribo de ${empresa}.` : '';
  const porque = motivo ? `pronostican ${motivo}` : 'el pronóstico no viene bueno';
  const msg = `${saludo}, ¿cómo estás?${firma} Para el día que teníamos pactado el trabajo de poda ${porque}. ¿Te parece si lo reprogramamos para otro día con mejor clima?`;
  const base = phone ? `https://wa.me/${phone}` : 'https://wa.me/';
  window.open(`${base}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
}

// Toast accionable (multi-línea, tocable) para el aviso de clima. El toast()
// plano tiene white-space:nowrap y trunca los mensajes largos; este usa
// .toast-action (envuelve el texto). Toda la tarjeta dispara onCardTap (ir al
// presupuesto / la Agenda); `botones` son acciones extra ({label, on}) — p. ej.
// "Reprogramar" por WhatsApp — que se muestran como botones propios.
function _climaToast(msgHtml, onCardTap, botones) {
  // Lo dispara la llegada del pronóstico, no un toque: va por la cola de avisos.
  colaAviso(() => _climaToastYa(msgHtml, onCardTap, botones));
}
function _climaToastYa(msgHtml, onCardTap, botones) {
  const c = document.getElementById('toast-container');
  if (!c) return null;
  const el = document.createElement('div');
  el.className = 'toast toast-err toast-action clima-toast';
  el.innerHTML = `<span>${msgHtml}</span>`
    + (botones || []).map((b, i) => `<button type="button" class="toast-btn" data-i="${i}">${esc(b.label)}</button>`).join('');
  c.appendChild(el);
  requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  el.querySelectorAll('.toast-btn').forEach(btn => {
    btn.onclick = (ev) => { ev.stopPropagation(); const b = (botones || [])[+btn.dataset.i]; try { b && b.on(); } finally { close(); } };
  });
  if (onCardTap) el.onclick = () => { try { onCardTap(); } finally { close(); } };
  setTimeout(close, 13000);
  return el;
}

// Detalle corto (probabilidad · mm · ráfaga) de un pronóstico, para el aviso.
// '' si no hay ningún dato.
function _climaDet(d) {
  const partes = [];
  if (d.pp != null) partes.push(`${Math.round(d.pp)}% prob.`);
  if (d.mm) partes.push(`${Math.round(d.mm)} mm`);
  const g = _climaRafaga(d);
  if (climaEsViento(d) && g != null) partes.push(`ráfagas ${Math.round(g)} km/h`);
  return partes.join(' · ');
}

// Aviso de lluvia O viento fuerte para trabajos de HOY o MAÑANA. Junta todos
// los avisos nuevos (no mostrados hoy) y notifica UNA vez: si es uno solo, un
// toast que lleva al presupuesto y ofrece reprogramar por WhatsApp; si son
// varios, un único toast consolidado que lleva a la Agenda (evita apilar varios
// carteles largos que se pisaban). Gate diario por trabajo en LS.CLIMA_WARN =
// { "entryId|fecha": "avisadoEl" }.
function _climaAvisar() {
  const hoy = today();
  const man = _calAddDays(hoy, 1);
  let gate = {};
  try { gate = JSON.parse(localStorage.getItem(LS.CLIMA_WARN) || '{}') || {}; } catch (_) {}
  let cambio = false;
  // Podar avisos de fechas ya pasadas.
  Object.keys(gate).forEach(k => { if ((k.split('|')[1] || '') < hoy) { delete gate[k]; cambio = true; } });

  const avisos = [];
  _climaProximosTrabajos().forEach(t => {
    t.fechas.filter(f => f === hoy || f === man).forEach(f => {
      const d = climaDe(t.e, f);
      const motivo = _climaMotivo(d);
      if (!motivo.txt) return;             // día sin lluvia ni viento fuerte
      const k = `${t.e.id}|${f}`;
      if (gate[k] === hoy) return;         // ya avisado hoy
      gate[k] = hoy; cambio = true;
      avisos.push({ e: t.e, f, cuando: f === hoy ? 'hoy' : 'mañana', d, motivo });
    });
  });
  if (cambio) { try { localStorage.setItem(LS.CLIMA_WARN, JSON.stringify(gate)); } catch (_) {} }
  if (!avisos.length) return;

  // Bitácora: dejar cada aviso nuevo en el centro de notificaciones (el toast
  // es efímero; así se puede volver a consultar desde la campanita).
  if (typeof logNotif === 'function') {
    avisos.forEach(a => {
      const quien = (a.e.clientName || '').trim() || '(sin nombre)';
      const emoji = a.motivo.viento && !a.motivo.lluvia ? '💨' : '⛈️';
      const cap = (typeof _cap === 'function') ? _cap(a.motivo.txt) : a.motivo.txt;
      logNotif({ icon: emoji, kind: 'clima',
        text: `${cap} ${a.cuando}: ${quien}`,
        dedupeKey: `clima|${a.e.id}|${a.f}`,
        action: { type: 'clima', id: a.e.id, f: a.f } });
    });
  }

  if (avisos.length === 1) {
    const a = avisos[0];
    const quien = (a.e.clientName || '').trim() || 'sin nombre';
    const det = _climaDet(a.d);
    // Emoji e intro según el motivo (lluvia / viento / ambos).
    const emoji = a.motivo.viento && !a.motivo.lluvia ? '💨' : '⛈️';
    const enAltura = a.motivo.viento ? ' Ojo con el trabajo en altura.' : '';
    const tieneTel = typeof histClientPhone === 'function' && !!histClientPhone(a.e);
    const botones = [];
    if (tieneTel) botones.push({ label: 'Reprogramar', on: () => climaReprogramarWhatsApp(a.e.id, a.motivo.txt) });
    // "Clima": abre el panel de detalle (hora por hora, recomendaciones y
    // próximos días) para dimensionar el imprevisto antes de decidir.
    botones.push({ label: 'Clima', on: () => climaOpenDetail('e', a.e.id, a.f) });
    botones.push({ label: 'Ver', on: () => goToHistoryEntry(a.e.id) });
    _climaToast(
      `${emoji} <b>${_cap(a.motivo.txt)} ${a.cuando}</b> y tenés la poda de ${esc(quien)}${det ? ` (${esc(det)})` : ''}.${enAltura} Tocá para ver el presupuesto.`,
      () => goToHistoryEntry(a.e.id),
      botones
    );
  } else {
    const nHoy = avisos.filter(a => a.cuando === 'hoy').length;
    const nMan = avisos.length - nHoy;
    const cuandoTxt = nHoy && nMan ? 'hoy y mañana' : (nHoy ? 'hoy' : 'mañana');
    _climaToast(
      `⛈️ <b>Mal clima pronosticado</b> para ${avisos.length} podas (${cuandoTxt}). Tocá para ver la Agenda y reprogramar.`,
      () => switchTab('agenda'),
      [{ label: 'Ver Agenda', on: () => switchTab('agenda') }]
    );
  }
}

// Primera letra en mayúscula (para el motivo al arrancar el aviso).
function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ─── PRONÓSTICO EN EL DIÁLOGO DE AGENDAR (idea 1) ────────────
// Tira de 7 días (hoy → +6) con emoji + temperatura para ayudar a elegir un
// buen día antes de fijar la fecha. Solo en modo trabajo y si hay pronóstico
// cacheado de la zona del trabajo. Debajo, el detalle + recomendación del día
// que esté seleccionado en el input. La llama openAgendaDlg (tras asegurar la
// zona), setAgendaMode y agendaOnDateChange.
function agendaClimaRender() {
  const wrap = document.getElementById('agenda-clima-wrap');
  const strip = document.getElementById('agenda-clima-strip');
  const selEl = document.getElementById('agenda-clima-sel');
  if (!wrap || !strip) return;
  const e = (typeof getH === 'function') ? getH().find(x => x.id === _agendaId) : null;
  if (!e || _agendaMode === 'recontacto') { wrap.hidden = true; return; }

  const hoy = today();
  const dias = [];
  for (let i = 0; i < 7; i++) { const iso = _calAddDays(hoy, i); dias.push({ iso, d: climaDe(e, iso) }); }
  if (!dias.some(x => x.d)) { wrap.hidden = true; return; }  // sin pronóstico → no mostrar nada

  wrap.hidden = false;
  const sel = (document.getElementById('agenda-fecha') || {}).value || '';
  strip.innerHTML = dias.map(({ iso, d }, i) => {
    const [emoji] = d ? _climaEmojiDesc(d.code) : ['·', ''];
    const mal = d && (climaEsLluvia(d) || climaEsViento(d));
    const yaElegido = _agendaFechas.includes(iso);
    const esSel = iso === sel;
    const p = iso.split('-');
    const dt = new Date(+p[0], +p[1] - 1, +p[2]);
    const wd = i === 0 ? 'Hoy' : AGENDA_WD[dt.getDay()];
    const temp = d && d.tmax != null ? `${Math.round(d.tmax)}°` : '';
    return `<button type="button" class="agenda-clima-day${mal ? ' mal' : ''}${esSel ? ' sel' : ''}${yaElegido ? ' elegido' : ''}" onclick="agendaClimaPick('${iso}')" title="${esc(dt.getDate() + '/' + (dt.getMonth() + 1))}">
      <span class="acd-wd">${esc(wd)}</span>
      <span class="acd-em">${emoji}</span>
      <span class="acd-t">${esc(temp)}</span>
    </button>`;
  }).join('');

  // Detalle + primera recomendación del día seleccionado (si hay uno elegido).
  const dSel = sel ? climaDe(e, sel) : null;
  if (dSel && selEl) {
    const recs = climaRecomendaciones(dSel);
    selEl.innerHTML = climaChipHTML(dSel, _climaTap('e', _agendaId, sel))
      + (recs.length ? `<span class="acd-warn">${esc(recs.join(' · '))}</span>` : '');
    selEl.hidden = false;
  } else if (selEl) {
    selEl.hidden = true; selEl.innerHTML = '';
  }
}

// Tocar un día de la tira: lo pone en el campo de fecha (staging para "Agregar
// día" o Guardar) y refresca warning + pronóstico.
function agendaClimaPick(iso) {
  const inp = document.getElementById('agenda-fecha');
  if (!inp) return;
  inp.value = iso;
  if (typeof syncCdate === 'function') syncCdate(inp);
  agendaOnDateChange();
}
