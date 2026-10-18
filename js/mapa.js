'use strict';

// ═══════════════════════════════════════
// MAPA.JS — Mapa de presupuestos por estado (Leaflet + OpenStreetMap)
// ═══════════════════════════════════════
// Muestra en un mapa cada presupuesto del historial con un pin coloreado por
// su estado comercial. Las coordenadas salen de datos YA existentes
// (workMapLink en formato lat,lng, o Plus Codes completos decodificados
// offline). Los que no tengan coordenadas se ubican A MANO tocando el mapa
// (sin geocoding: cero datos enviados afuera). Leaflet se carga lazy; los
// tiles del fondo sí necesitan conexión.

let _mapa = null;            // instancia Leaflet
let _mapaLayer = null;       // layerGroup de marcadores de presupuestos
let _mapaUserMarker = null;  // marcador "estás acá" (cerca mío)
let _mapaFilterSet = null;   // Set de estados visibles
let _mapaPlacingId = null;   // id del presupuesto que se está ubicando a mano
let _mapaFitDone = false;    // el primer render encuadra a los marcadores
let _mapaCercaList = [];     // pendientes cercanos (para armar la ruta)
let _mapaUserLatLng = null;  // [lat,lng] de la última "cerca mío"
let _mapaHighlight = new Set(); // ids resaltados (cerca mío)
let _mapaGeoRef = null;      // [lat,lng] de referencia para reconstruir Plus Codes cortos
// Las colaboraciones (trabajo propio para un colega) arrancan OCULTAS. El mapa
// es la foto de dónde se presupuestó; los trabajos propios son otra cosa y se
// prenden cuando el usuario los quiere ver. Aun prendidas nunca entran en los
// números de la zona (ver mapaUpdateZonaStats).
let _mapaVerColab = false;
const MAPA_COLAB_COLOR = '#0d9488';

// ─── COLORES DE LOS PINS ─────────────────────────────────────
// Paleta PROPIA del mapa. Antes los pins usaban el color de TEXTO de
// ESTADO_COLORS: tonos oscuros pensados para leerse sobre un chip claro, que
// sobre el verde del mapa y al sol se confundían (realizado #065f46, ir a ver
// #155e63 y borrador #475569 eran tres manchas oscuras iguales). Acá van
// tonos vivos, separados en el círculo de colores, y dos estados llevan
// símbolo para no depender solo del color: ✓ en realizado y ojo en "Ir a ver".
// ESTADO_COLORS no se toca: la usan el Historial y los chips.
const MAPA_PIN_COLORS = {
  por_ver:   '#06b6d4',
  borrador:  '#94a3b8',
  enviado:   '#2563eb',
  aceptado:  '#f59e0b',
  realizado: '#16a34a',
  evolucion: '#9333ea',
  perdido:   '#dc2626',
};
function mapaPinColor(est) { return MAPA_PIN_COLORS[est] || MAPA_PIN_COLORS.borrador; }
const MAPA_PIN_SIMBOLO = {
  realizado: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  por_ver:   '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
};

// Enviado VENCIDO: el presupuesto salió, la vigencia pasó y nadie lo cerró.
// Se dibuja hueco (relleno blanco, borde del color) para no confundirlo con
// un enviado que todavía está en plazo. Es un dato del presupuesto, no un
// aviso: por eso no mira vencimientoVistoEn (descartar el aviso no lo
// vuelve vigente) ni la configuración del seguimiento. Mismo criterio de
// fecha que getExpiredQuotes: desde dateExpiry, y "vence hoy" sigue vigente.
function mapaEsVencido(e) {
  if (!e || (e.estado || 'borrador') !== 'enviado') return false;
  const exp = e.snapshot && e.snapshot.dateExpiry;
  if (!exp) return false;
  const d = daysSinceDate(exp);
  return d !== null && d >= 1;
}

// ─── PINS CERCANOS AGRUPADOS ─────────────────────────────────
// A zoom de provincia los pins de una misma zona se encimaban en una mancha
// (y un grupo "3" quedaba tapado por otros pins). Ahora los pins a menos de
// MAPA_GRUPO_PX píxeles en pantalla se juntan en un círculo con la cantidad;
// tocarlo acerca el mapa. Desde MAPA_GRUPO_HASTA_Z + 1 no se agrupa: a esa
// escala se distinguen las casas. El grupo del MISMO punto ("N trabajos en
// este lugar") sigue como estaba: no se separa con zoom, así que se abre en
// lista. Grilla propia en vez de Leaflet.markercluster: son unas decenas de
// pins, y así no hay otra librería que bajar ni que cachear para offline.
const MAPA_GRUPO_PX = 46;
const MAPA_GRUPO_HASTA_Z = 16;
let _mapaPuntos = [];        // grupos del mismo punto [{ ll, items }] del último mapaRefresh

// ─── ÚLTIMA VISTA ────────────────────────────────────────────
// El mapa abre donde se dejó (centro y zoom en LS.MAPA_VISTA, preferencia del
// dispositivo: fuera del backup, como LS.CAL_VIEW). La primera vez encuadra el
// NÚCLEO de los pins (_mapaNucleo): los trabajos aislados en otras localidades
// alejaban la vista a zoom de provincia y la zona de todos los días quedaba
// chica. Esos pins siguen ahí: se ven alejando el mapa.
function _mapaVistaLeer() {
  try {
    const v = JSON.parse(localStorage.getItem(LS.MAPA_VISTA) || 'null');
    if (!v || typeof v !== 'object') return null;
    const lat = +v.lat, lng = +v.lng, z = +v.z;
    if (!isFinite(lat) || !isFinite(lng) || !Number.isInteger(z)) return null;
    if (lat < -85 || lat > 85 || lng < -180 || lng > 180 || z < 2 || z > 19) return null;
    return { lat, lng, z };
  } catch (_) { return null; }
}
function _mapaVistaGuardar() {
  if (!_mapa) return;
  // Con el mapa oculto (pestaña dejada a medio animar) Leaflet calcula una
  // vista de tamaño cero: no se guarda esa.
  const canvas = document.getElementById('map-canvas');
  if (!canvas || !canvas.offsetWidth || !canvas.offsetHeight) return;
  const c = _mapa.getCenter();
  const v = { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), z: Math.round(_mapa.getZoom()) };
  try { localStorage.setItem(LS.MAPA_VISTA, JSON.stringify(v)); } catch (_) {}
}

// Puntos del núcleo: descarta los aislados para el primer encuadre. Mide la
// distancia de cada punto a la MEDIANA (no al promedio, que los aislados
// arrastran) y corta en 4 veces la distancia mediana, con piso de 5 km para
// no partir una ciudad. Es relativo a la escala: en una ciudad pareja no
// corta nada; con un núcleo de 3 km, un trabajo a 25 km queda afuera. Solo
// descarta si lo que queda afuera es una minoría (hasta 1 de cada 4): si no,
// no son aislados sino otra zona de trabajo, y se encuadra todo. Con menos de
// 5 puntos no hay mayoría que defina una zona: tampoco descarta.
function _mapaNucleo(pts) {
  if (!Array.isArray(pts) || pts.length < 5) return pts || [];
  const med = (arr) => { const a = arr.slice().sort((x, y) => x - y); const k = a.length >> 1; return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2; };
  const cLat = med(pts.map(p => p[0])), cLng = med(pts.map(p => p[1]));
  const ds = pts.map(p => _haversineKm(cLat, cLng, p[0], p[1]));
  const corte = Math.max(5, 4 * med(ds));
  const nucleo = pts.filter((p, i) => ds[i] <= corte);
  return (pts.length - nucleo.length) <= pts.length / 4 ? nucleo : pts;
}

// Agrupa puntos cercanos EN PANTALLA. `xy(p)` da la posición en píxeles del
// punto al zoom actual. Codicioso y estable: los puntos con más trabajos
// siembran primero (un grupo de 3 en el mismo lugar se lleva a sus vecinos, y
// no al revés), y cada semilla se queda con los libres a menos de `radio` px.
// Devuelve [{ ll, puntos }] con ll = centro de sus puntos.
function _mapaAgruparCercanos(puntos, xy, radio) {
  const lista = puntos.map((p, i) => ({ p, i, n: p.items.length, q: xy(p) }));
  const orden = lista.slice().sort((a, b) => (b.n - a.n) || (a.i - b.i));
  const usado = new Set();
  const r2 = radio * radio;
  const out = [];
  orden.forEach(s => {
    if (usado.has(s.i)) return;
    usado.add(s.i);
    const miembros = [s];
    orden.forEach(o => {
      if (usado.has(o.i)) return;
      const dx = o.q.x - s.q.x, dy = o.q.y - s.q.y;
      if (dx * dx + dy * dy <= r2) { usado.add(o.i); miembros.push(o); }
    });
    const pts = miembros.map(m => m.p);
    const ll = pts.length === 1 ? pts[0].ll
      : [pts.reduce((a, p) => a + p.ll[0], 0) / pts.length, pts.reduce((a, p) => a + p.ll[1], 0) / pts.length];
    out.push({ ll, puntos: pts });
  });
  return out;
}

// Distancia en km entre dos coordenadas (haversine).
function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Decodifica un Plus Code COMPLETO (separador en la posición 8, ej.
// "8FW4V75V+8Q") a [lat,lng] del centro del área, sin servicios externos.
// Los códigos cortos (con localidad) devuelven null → se ubican a mano.
function decodePlusCode(code) {
  const A = '23456789CFGHJMPQRVWX';
  if (!code) return null;
  code = String(code).trim().toUpperCase();
  if (code.indexOf('+') !== 8) return null;
  code = code.replace('+', '').replace(/0+$/, '');
  if (code.length < 2) return null;
  for (let k = 0; k < code.length; k++) if (A.indexOf(code[k]) < 0) return null;
  let lat = -90, lng = -180, latRes = 400, lngRes = 400, i = 0;
  for (; i < Math.min(code.length, 10); i += 2) {
    latRes /= 20; lngRes /= 20;
    lat += A.indexOf(code[i]) * latRes;
    lng += A.indexOf(code[i + 1]) * lngRes;
  }
  if (code.length > 10) {
    let rowRes = latRes, colRes = lngRes;
    for (; i < code.length; i++) {
      const v = A.indexOf(code[i]);
      rowRes /= 5; colRes /= 4;
      lat += Math.floor(v / 4) * rowRes;
      lng += (v % 4) * colRes;
    }
    lat += rowRes / 2; lng += colRes / 2;
  } else {
    lat += latRes / 2; lng += lngRes / 2;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

// Codifica lat,lng a los primeros `digits` caracteres de un Plus Code (sección
// de pares). Se usa para armar el prefijo al reconstruir un código corto.
function _olcEncodePairs(lat, lng, digits) {
  const A = '23456789CFGHJMPQRVWX';
  let latV = lat + 90, lngV = lng + 180;
  if (latV < 0) latV = 0; else if (latV >= 180) latV = 179.999999;
  lngV = ((lngV % 360) + 360) % 360;
  let code = '', unit = 20, latR = latV, lngR = lngV;
  for (let d = 0; d < digits; d += 2) {
    const li = Math.min(19, Math.floor(latR / unit));
    const gi = Math.min(19, Math.floor(lngR / unit));
    code += A[li] + A[gi];
    latR -= li * unit; lngR -= gi * unit;
    unit /= 20;
  }
  return code;
}

// Reconstruye un Plus Code CORTO (el que copiás de Google Maps, ej.
// "V75V+8Q") usando un punto de referencia cercano — así se ubica sin geocoding.
// Devuelve [lat,lng] del centro, o null si no aplica.
function recoverPlusCode(code, refLat, refLng) {
  const sep = code.indexOf('+');
  if (sep < 0 || sep >= 8 || sep % 2 !== 0) return null;
  if (!isFinite(refLat) || !isFinite(refLng)) return null;
  const padding = 8 - sep;
  const prefix = _olcEncodePairs(refLat, refLng, padding);
  if (prefix.length < padding) return null;
  const center = decodePlusCode(prefix + code);
  if (!center) return null;
  const resolution = Math.pow(20, 2 - padding / 2);
  const half = resolution / 2;
  let lat = center[0], lng = center[1];
  if (refLat + half < lat && lat - resolution >= -90) lat -= resolution;
  else if (refLat - half > lat && lat + resolution <= 90) lat += resolution;
  if (refLng + half < lng && lng - resolution >= -180) lng -= resolution;
  else if (refLng - half > lng && lng + resolution <= 180) lng += resolution;
  return [lat, lng];
}

// Extrae un Plus Code de un texto (puede venir con la localidad al lado) y lo
// resuelve a [lat,lng]. Los completos se decodifican solos; los cortos usan
// `ref` (referencia cercana). Devuelve null si no hay código o falta referencia.
function plusCodeToLatLng(str, ref) {
  if (!str) return null;
  const m = String(str).toUpperCase().match(/([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3})/);
  if (!m) return null;
  const code = m[1];
  if (code.indexOf('+') === 8) return decodePlusCode(code);
  if (ref) return recoverPlusCode(code, ref[0], ref[1]);
  return null;
}

// Punto de referencia para reconstruir Plus Codes cortos: la ubicación del
// usuario (si tocó "Cerca mío"), si no el centroide de los presupuestos ya
// ubicados con coordenadas "duras" (lat,lng o Plus Code completo), y si no el
// centro actual del mapa. Todos los trabajos de un podador caen en la misma
// zona, así que este centroide reconstruye los códigos cortos con precisión.
function _mapaComputeGeoRef() {
  if (_mapaUserLatLng) return _mapaUserLatLng;
  let sLat = 0, sLng = 0, n = 0;
  getH().forEach(e => {
    if (e && e.geo && isFinite(e.geo.lat) && isFinite(e.geo.lng)) { sLat += e.geo.lat; sLng += e.geo.lng; n++; return; }
    const link = ((e && e.snapshot && e.snapshot.workMapLink) || '').trim();
    if (!link || /^https?:\/\//i.test(link)) return;
    const m = link.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (m) { sLat += parseFloat(m[1]); sLng += parseFloat(m[2]); n++; return; }
    const full = plusCodeToLatLng(link, null); // solo resuelve los completos
    if (full) { sLat += full[0]; sLng += full[1]; n++; }
  });
  if (n) return [sLat / n, sLng / n];
  if (_mapa && _mapa.getCenter) { const c = _mapa.getCenter(); return [c.lat, c.lng]; }
  return null;
}

// Resuelve las coordenadas de un entry del historial, o null si no se puede
// ubicar (queda para "sin ubicar"). Orden: (1) pin manual guardado, (2)
// workMapLink como "lat,lng", (3) Plus Code completo o corto (con referencia).
function entryLatLng(e) {
  if (e && e.geo && isFinite(e.geo.lat) && isFinite(e.geo.lng)) return [e.geo.lat, e.geo.lng];
  const link = ((e && e.snapshot && e.snapshot.workMapLink) || '').trim();
  if (link && !/^https?:\/\//i.test(link)) {
    const m = link.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return [lat, lng];
    }
    const pc = plusCodeToLatLng(link, _mapaGeoRef);
    if (pc) return pc;
  }
  return null;
}

function _mapaDateOf(e) { return (((e.snapshot && e.snapshot.dateIssue) || e.savedAt || '') + '').slice(0, 10); }

// ─── FONDO DEL MAPA (tiles) ──────────────────────────────────
// Los tiles de OpenStreetMap son DECENAS de pedidos por pantalla: es lo más
// caro que hace la app y lo primero que hay que sacrificar cuando la red no da.
// Con conexión mala el mapa se abre igual —los pins, las zonas y los filtros
// no necesitan internet— y aparece un aviso con "Cargar el fondo igual" por si
// el usuario prefiere esperar.
let _mapaTiles = null;

function _mapaAddTiles(L) {
  const aviso = document.getElementById('mapa-neti');
  if (!_mapa) return;
  // Con el fondo ya puesto el aviso no tiene nada que decir. Se apaga acá por
  // si quedó colgado de una entrada anterior con la red mala: el cartel decía
  // "fondo sin cargar" con el mapa cargado atrás.
  if (_mapaTiles) { if (aviso) aviso.hidden = true; return; }
  if (typeof netPuedeAuto === 'function' && !netPuedeAuto()) {
    if (aviso) {
      const est = (typeof netEtiqueta === 'function') ? netEtiqueta().toLowerCase() : 'conexión lenta';
      aviso.innerHTML = `<span>Fondo del mapa sin cargar (${esc(est)}): los pins y las zonas se ven igual.</span>`
        + `<button type="button" class="btn btn-g btn-sm" onclick="mapaCargarFondo()">Cargar el fondo igual</button>`;
      aviso.hidden = false;
    }
    return;
  }
  _mapaTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(_mapa);
  if (aviso) aviso.hidden = true;
}

// Botón del aviso: el usuario PIDE el fondo, así que se carga aunque la red
// esté mal (y de paso se levanta el corte, por si ya se recuperó).
function mapaCargarFondo() {
  if (typeof netReintentar === 'function') netReintentar();
  ensureLeaflet().then((L) => {
    const aviso = document.getElementById('mapa-neti');
    if (aviso) aviso.hidden = true;
    if (_mapa && !_mapaTiles) {
      _mapaTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(_mapa);
    }
  }).catch(() => {});
}

// Init lazy: primera entrada a la pestaña carga Leaflet, crea el mapa y dibuja.
function mapaInit() {
  const canvas = document.getElementById('map-canvas');
  if (!canvas) return;
  ensureLeaflet().then((L) => {
    if (!_mapa) {
      mapaBuildFilters();
      const vista = _mapaVistaLeer();
      _mapa = L.map(canvas, { zoomControl: true, maxZoom: 19 })
        .setView(vista ? [vista.lat, vista.lng] : [-34.0, -64.0], vista ? vista.z : 4);
      // Con una vista guardada no se encuadra: el usuario la eligió.
      if (vista) _mapaFitDone = true;
      _mapaLayer = L.layerGroup().addTo(_mapa);
      _mapa.on('zoomend', _mapaDibujar);
      _mapa.on('moveend', () => { mapaUpdateZonaStats(); _mapaVistaGuardar(); });
      _mapa.on('click', mapaOnMapClick);
      // El alto del mapa cambia al abrir los filtros o "Cerca mío", y al
      // girar el teléfono: Leaflet tiene que enterarse o deja franjas grises.
      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => { if (_mapa && canvas.offsetWidth) _mapa.invalidateSize(); }).observe(canvas);
      }
    }
    // Fuera del if: si el mapa se creó sin fondo por mala señal, al volver a
    // entrar con red sana el fondo aparece solo (la función es idempotente).
    _mapaAddTiles(L);
    mapaRefresh();
    // El contenedor estaba oculto al crearse; Leaflet necesita recalcular.
    setTimeout(() => { if (_mapa) _mapa.invalidateSize(); }, 60);
  }).catch(() => {
    canvas.innerHTML = '<div class="mapa-error">No se pudo cargar el mapa. Necesitás conexión la primera vez que lo abrís.</div>';
  });
}

// Checkboxes de filtro por estado (con la leyenda de colores).
function mapaBuildFilters() {
  if (!_mapaFilterSet) _mapaFilterSet = new Set(ESTADOS);
  const box = document.getElementById('mapa-filters');
  if (!box) return;
  box.innerHTML = ESTADOS.map(s => {
    const on = _mapaFilterSet.has(s);
    return `<label class="mapa-filter${on ? ' is-on' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="mapaToggleFilter('${s}', this.checked)">
      <span class="mapa-filter-dot" style="background:${mapaPinColor(s)}"></span>${estadoLabel(s)}</label>`;
  }).join('')
  // Interruptor de colaboraciones: separado de los estados porque no es un
  // estado sino OTRO tipo de trabajo, y apagado por defecto.
  + `<label class="mapa-filter mapa-filter-colab${_mapaVerColab ? ' is-on' : ''}" title="Trabajos propios para colegas. Nunca suman a los números de la zona.">
      <input type="checkbox" ${_mapaVerColab ? 'checked' : ''} onchange="mapaToggleColab(this.checked)">
      <span class="mapa-filter-dot" style="background:${MAPA_COLAB_COLOR}"></span>Colaboraciones</label>`;
  const per = document.getElementById('mapa-periodos');
  if (per) per.innerHTML = MAPA_PERIODOS.map(([k, txt]) =>
    `<button type="button" class="mapa-periodo" data-per="${k}" onclick="mapaPeriodo('${k}')">${txt}</button>`).join('');
  mapaFiltrosSync();
}

// Atajos de fecha: llenan Desde/Hasta (que siguen ahí para un rango a mano).
// Cuentan desde el primer día del período hasta hoy, sin tope ("Hasta" vacío).
const MAPA_PERIODOS = [['todo', 'Todo'], ['mes', 'Este mes'], ['3m', 'Últimos 3 meses'], ['anio', 'Este año']];
function _mapaPeriodoDesde(k) {
  const d = new Date();
  if (k === 'mes')  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  if (k === '3m')   return toLocalISODate(new Date(d.getFullYear(), d.getMonth() - 3, d.getDate()));
  if (k === 'anio') return toLocalISODate(new Date(d.getFullYear(), 0, 1));
  return '';
}
// Qué atajo describe el rango actual, o null si es un rango a mano.
function _mapaPeriodoActual() {
  const desde = (document.getElementById('mapa-desde')?.value || '').trim();
  const hasta = (document.getElementById('mapa-hasta')?.value || '').trim();
  if (hasta) return null;
  const hit = MAPA_PERIODOS.find(([k]) => _mapaPeriodoDesde(k) === desde);
  return hit ? hit[0] : null;
}
function mapaPeriodo(k) {
  const d = document.getElementById('mapa-desde'), h = document.getElementById('mapa-hasta');
  if (d) d.value = _mapaPeriodoDesde(k);
  if (h) h.value = '';
  // El selector de fecha propio dibuja su etiqueta aparte: hay que avisarle.
  if (typeof syncCdate === 'function') { if (d) syncCdate(d); if (h) syncCdate(h); }
  mapaRefresh();
}

// Botón "Filtros": el panel arranca cerrado. El contador dice cuántos
// filtros cambian lo que se ve (estados ocultos, período, colaboraciones).
function mapaFiltrosToggle(abrir) {
  const box = document.getElementById('mapa-filtros');
  const btn = document.getElementById('mapa-filtros-btn');
  if (!box) return;
  const open = (typeof abrir === 'boolean') ? abrir : box.hidden;
  box.hidden = !open;
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function mapaFiltrosSync() {
  const filt = _mapaFilterSet || new Set(ESTADOS);
  const desde = (document.getElementById('mapa-desde')?.value || '').trim();
  const hasta = (document.getElementById('mapa-hasta')?.value || '').trim();
  const ocultos = ESTADOS.filter(s => !filt.has(s)).length;
  const n = (ocultos ? 1 : 0) + ((desde || hasta) ? 1 : 0) + (_mapaVerColab ? 1 : 0);
  const cnt = document.getElementById('mapa-filtros-n');
  if (cnt) { cnt.textContent = n; cnt.hidden = !n; }
  const per = _mapaPeriodoActual();
  document.querySelectorAll('#mapa-periodos .mapa-periodo').forEach(b =>
    b.classList.toggle('is-on', b.dataset.per === per));
  // Resumen al lado del botón: lo que está filtrado sin abrir el panel.
  const partes = [];
  if (per && per !== 'todo') partes.push((MAPA_PERIODOS.find(p => p[0] === per) || [])[1]);
  else if (desde || hasta) partes.push((desde ? 'desde ' + fmtD(desde) : '') + (desde && hasta ? ' ' : '') + (hasta ? 'hasta ' + fmtD(hasta) : ''));
  if (ocultos) partes.push(ocultos === 1 ? '1 estado oculto' : ocultos + ' estados ocultos');
  if (_mapaVerColab) partes.push('con colaboraciones');
  const res = document.getElementById('mapa-filtros-res');
  if (res) res.textContent = partes.join(' · ');
}

// Atajo de la barra a la lista "Sin ubicar", que quedó debajo del mapa.
function mapaIrSinUbicar() {
  const det = document.getElementById('mapa-sinubicar');
  if (!det) return;
  det.open = true;
  det.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function mapaToggleFilter(s, on) {
  if (!_mapaFilterSet) _mapaFilterSet = new Set(ESTADOS);
  if (on) _mapaFilterSet.add(s); else _mapaFilterSet.delete(s);
  mapaBuildFilters();
  mapaRefresh();
}
function mapaToggleColab(on) {
  _mapaVerColab = !!on;
  mapaBuildFilters();
  mapaRefresh();
}

// Re-dibuja los marcadores según filtros de estado y de fecha.
function mapaRefresh() {
  if (!_mapa || !_mapaLayer) return;
  _mapaGeoRef = _mapaComputeGeoRef(); // referencia para Plus Codes cortos
  _mapaLayer.clearLayers();
  const desde = (document.getElementById('mapa-desde')?.value || '').trim();
  const hasta = (document.getElementById('mapa-hasta')?.value || '').trim();
  const filt = _mapaFilterSet || new Set(ESTADOS);
  const sinUbicar = [];
  const bounds = [];
  // Agrupar por ubicación: varios presupuestos en el MISMO punto (mismo lugar,
  // cliente que volvió a llamar para otro trabajo) comparten una sola marca
  // que se abre en abanico. Clave redondeada a ~5 decimales (≈1 m).
  const groups = new Map();
  getH().forEach(e => {
    const est = e.estado || 'borrador';
    // Colaboraciones: solo si el usuario prendió su interruptor, y NUNCA
    // filtradas por estado (su estado es del trabajo propio, no comercial).
    // Los trabajos DIRECTOS son trabajo en la casa de un cliente: se ven
    // siempre, como cualquier otro, y se filtran por estado igual.
    if (esColaboracion(e)) { if (!_mapaVerColab) return; }
    else if (!filt.has(est)) return;
    // El reemplazado no va al mapa: su versión nueva está en el mismo punto y
    // dos marcas para el mismo trabajo hacen dudar de cuál abrir.
    if (esReemplazado(e)) return;
    const d = _mapaDateOf(e);
    if (desde && d && d < desde) return;
    if (hasta && d && d > hasta) return;
    const ll = entryLatLng(e);
    if (!ll) { sinUbicar.push(e); return; }
    const key = ll[0].toFixed(5) + ',' + ll[1].toFixed(5);
    let g = groups.get(key);
    if (!g) { g = { ll, items: [] }; groups.set(key, g); }
    g.items.push({ e, est });
  });
  _mapaPuntos = Array.from(groups.values());
  _mapaPuntos.forEach(g => bounds.push(g.ll));
  mapaRenderSinUbicar(sinUbicar);
  mapaFiltrosSync();
  if (!_mapaFitDone && bounds.length) {
    // Primer encuadre: el núcleo, sin los trabajos aislados (ver _mapaNucleo).
    _mapa.fitBounds(_mapaNucleo(bounds), { padding: [30, 30], maxZoom: 15, animate: false });
    _mapaFitDone = true;
  }
  _mapaDibujar();
}

// Dibuja los puntos de _mapaPuntos al zoom actual: los cercanos en pantalla
// van juntos en un círculo (mapaZonaMarker), los demás como siempre (pin
// suelto o grupo del mismo punto). Corre en cada cambio de zoom; panear no
// cambia la distancia en píxeles, así que no hace falta redibujar.
function _mapaDibujar() {
  if (!_mapa || !_mapaLayer) return;
  const L = window.L;
  _mapaLayer.clearLayers();
  const z = _mapa.getZoom();
  const grupos = (z <= MAPA_GRUPO_HASTA_Z)
    ? _mapaAgruparCercanos(_mapaPuntos, p => _mapa.project(p.ll, z), MAPA_GRUPO_PX)
    : _mapaPuntos.map(p => ({ ll: p.ll, puntos: [p] }));
  grupos.forEach(c => {
    if (c.puntos.length > 1) { _mapaLayer.addLayer(mapaZonaMarker(L, c)); return; }
    const g = c.puntos[0];
    if (g.items.length === 1) _mapaLayer.addLayer(mapaMarker(L, g.items[0].e, g.items[0].est, g.ll));
    else _mapaLayer.addLayer(mapaClusterMarker(L, g));
  });
  mapaUpdateZonaStats();
}

function mapaMarker(L, e, est, ll) {
  // La colaboración lleva color propio (teal): no comparte la paleta de los
  // estados comerciales porque no es una etapa de venta. El trabajo directo
  // sí usa el color de su estado: es trabajo para un cliente, como el resto.
  const colab = esColaboracion(e);
  const color = colab ? MAPA_COLAB_COLOR : mapaPinColor(est);
  const hl = _mapaHighlight.has(e.id);
  const venc = !colab && mapaEsVencido(e);
  const sim = !colab && MAPA_PIN_SIMBOLO[est];
  const icon = L.divIcon({
    className: 'mapa-pin' + (hl ? ' is-hl' : '') + (colab ? ' is-colab' : '') + (venc ? ' is-venc' : ''),
    html: venc
      ? `<span style="border-color:${color}"></span>`
      : `<span style="background:${color}">${sim ? `<svg viewBox="0 0 24 24" aria-hidden="true">${sim}</svg>` : ''}</span>`,
    iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12],
  });
  const m = L.marker(ll, { icon });
  m._estado = est;
  m._total = e.total || 0;
  m._cur = e.currency || 'ARS';
  m._entries = [e];
  m.bindPopup(mapaPopupHtml(e, est));
  return m;
}

// Marca de un GRUPO de presupuestos en el mismo punto: un anillo con la
// cantidad. El anillo se colorea con TODOS los estados presentes (segmentos
// proporcionales), así se ve de un vistazo la mezcla sin abrirlo. Al tocarla
// abre un popup con la LISTA de trabajos del lugar (cada uno con sus acciones).
function mapaClusterMarker(L, g) {
  const items = g.items;
  const hl = items.some(x => _mapaHighlight.has(x.e.id));
  // Segmentos del anillo por estado, en el orden canónico de ESTADOS.
  // Las colaboraciones son su propio segmento (teal): en el mismo punto puede
  // haber un presupuesto del cliente y una jornada trabajada para un colega.
  const n = items.length;
  const ring = _mapaAnillo(_mapaPorEstado(items), n);
  const icon = L.divIcon({
    className: 'mapa-cluster' + (hl ? ' is-hl' : ''),
    html: `<span class="mapa-cluster-ring" style="background:${ring}"><span class="mapa-cluster-count">${n}</span></span>`,
    iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -15],
  });
  const m = L.marker(g.ll, { icon });
  m._entries = items.map(x => x.e);
  m.bindPopup(mapaGroupPopupHtml(g), { minWidth: 210 });
  return m;
}

// Cuenta por estado para el anillo. La colaboración es su propio segmento.
function _mapaPorEstado(items) {
  const byEst = {};
  items.forEach(x => {
    const k = esColaboracion(x.e) ? 'colab' : x.est;
    byEst[k] = (byEst[k] || 0) + 1;
  });
  return byEst;
}
// Fondo del anillo: segmentos proporcionales en el orden canónico de ESTADOS.
function _mapaAnillo(byEst, n) {
  let acc = 0;
  const segs = ESTADOS.concat(['colab']).filter(s => byEst[s]).map(s => {
    const txt = (s === 'colab') ? MAPA_COLAB_COLOR : mapaPinColor(s);
    const from = acc / n * 360, to = (acc + byEst[s]) / n * 360;
    acc += byEst[s];
    return `${txt} ${from}deg ${to}deg`;
  });
  return segs.length > 1 ? `conic-gradient(${segs.join(',')})` : segs[0].split(' ')[0];
}

// Marca de pins CERCANOS (en lugares distintos) juntados por el zoom: círculo
// con la cantidad de trabajos y el anillo de estados. No abre lista: tocarlo
// acerca el mapa hasta separarlos (o hasta el zoom donde ya no se agrupa).
function mapaZonaMarker(L, c) {
  const items = [];
  c.puntos.forEach(p => p.items.forEach(x => items.push(x)));
  const n = items.length;
  const hl = items.some(x => _mapaHighlight.has(x.e.id));
  const lado = n < 10 ? 38 : (n < 50 ? 44 : 50);
  const icon = L.divIcon({
    className: 'mapa-zgrupo' + (hl ? ' is-hl' : ''),
    html: `<span class="mapa-cluster-ring" style="background:${_mapaAnillo(_mapaPorEstado(items), n)}"><span class="mapa-cluster-count">${n}</span></span>`,
    iconSize: [lado, lado], iconAnchor: [lado / 2, lado / 2],
  });
  const m = L.marker(c.ll, { icon, title: n + ' trabajos en esta zona. Tocá para acercar.' });
  m._entries = items.map(x => x.e);
  m._puntos = c.puntos; // las stats de zona cuentan cada punto por su ubicación real
  m.on('click', () => mapaAcercarGrupo(c.puntos.map(p => p.ll)));
  return m;
}

// Acerca el mapa a un grupo: encuadra sus puntos, y siempre avanza al menos
// dos niveles (si no, un grupo muy apretado quedaría igual tras el toque).
// Nunca pasa del zoom donde se deja de agrupar + 1: ahí ya se separan.
function mapaAcercarGrupo(lls) {
  if (!_mapa || !lls || !lls.length) return;
  const L = window.L;
  const b = L.latLngBounds(lls);
  const cur = _mapa.getZoom();
  let z = _mapa.getBoundsZoom(b, false, L.point(60, 60));
  if (z <= cur) z = cur + 2;
  z = Math.min(z, MAPA_GRUPO_HASTA_Z + 1);
  _mapa.setView(b.getCenter(), Math.max(z, cur + 1));
}

// Popup de un grupo apilado: lista todos los trabajos del mismo lugar, del más
// reciente al más viejo. Cada fila reusa los mismos handlers que el popup
// individual (cambiar estado, ver, llegar, editar).
function mapaGroupPopupHtml(g) {
  const rows = g.items.slice()
    .sort((a, b) => _mapaDateOf(b.e).localeCompare(_mapaDateOf(a.e)))
    .map(x => mapaGroupRowHtml(x.e, x.est)).join('');
  return `<div class="mapa-popup mapa-popup-group">
    <div class="mapa-popup-group-title">${g.items.length} trabajos en este lugar</div>
    <div class="mapa-popup-list">${rows}</div>
  </div>`;
}

function mapaGroupRowHtml(e, est) {
  const cli = esc(e.clientName || '(sin nombre)');
  const num = esc(e.quoteNumber || '—');
  const cur = e.currency || 'ARS';
  const [txt, bg] = ESTADO_COLORS[est] || ESTADO_COLORS.borrador;
  const opts = ESTADOS.map(s => `<option value="${s}"${s === est ? ' selected' : ''}>${estadoLabel(s)}</option>`).join('');
  // Tocar la fila (incluido el nombre del cliente) lleva al presupuesto en la
  // pestaña Historial, lo centra y lo resalta (goToHistoryEntry) — distinto del
  // botón "Ver", que abre la imagen del presupuesto. Solo el chip de estado y
  // "Llegar" frenan la propagación para conservar su acción.
  return `<div class="mapa-grow" onclick="goToHistoryEntry(${e.id})" role="button" tabindex="0" title="Ver este presupuesto en el historial">
    <div class="mapa-grow-top">
      <select class="mapa-grow-estado" style="color:${txt};background:${bg}" onclick="event.stopPropagation()" onchange="mapaSetEstado(${e.id}, this.value)" aria-label="Estado">${opts}</select>
      <span class="mapa-grow-cli">${cli}</span>
    </div>
    <div class="mapa-grow-meta">${num} · ${fmtM(e.total || 0, cur)} · ${fmtD(_mapaDateOf(e))}</div>
    <div class="mapa-popup-acts">
      <button class="btn btn-p btn-sm" onclick="event.stopPropagation();mapaVer(${e.id})">${icon('eye')} Ver</button>
      <button class="btn btn-g btn-sm" onclick="event.stopPropagation();comoLlegar(${e.id})">${icon('pin')} Llegar</button>
    </div>
  </div>`;
}

function mapaPopupHtml(e, est) {
  const cli = esc(e.clientName || '(sin nombre)');
  const num = esc(e.quoteNumber || '—');
  const cur = e.currency || 'ARS';
  const opts = ESTADOS.map(s => `<option value="${s}"${s === est ? ' selected' : ''}>${estadoLabel(s)}</option>`).join('');
  // Trabajo sin presupuesto: no hay documento que ver ni presupuesto que
  // cargar en el editor. Se edita en su propio diálogo.
  if (esTrabajoPropio(e)) {
    const c = e.colab || {};
    const cfgT = trabajoCfg(tipoTrabajo(e));
    const [txtC, bgC] = ESTADO_COLORS[est] || ESTADO_COLORS.realizado;
    return `<div class="mapa-popup">
      <div class="mapa-popup-cli">${cli}<span class="hbadge-colab${esTrabajoDirecto(e) ? ' is-directo' : ''}">${esc(cfgT.badge)}</span></div>
      <div class="mapa-popup-meta">${num} · ${fmtM(e.total || 0, cur)} · ${fmtD(_mapaDateOf(e))}</div>
      ${c.nombre ? `<div class="mapa-popup-meta">${esc(c.nombre)} · ${esc(misSvcCantTxt(c.cantidad, c.unidad))}</div>` : ''}
      <select class="mapa-popup-estado" style="color:${txtC};background:${bgC}" onchange="mapaSetEstado(${e.id}, this.value)" aria-label="Estado">${opts}</select>
      <div class="mapa-popup-acts">
        <button class="btn btn-p btn-sm" onclick="comoLlegar(${e.id})">${icon('pin')} Llegar</button>
      </div>
      <button class="mapa-popup-edit" onclick="abrirColaboracion(${e.id})" title="Editar este trabajo">${icon('pencil')} Editar…</button>
    </div>`;
  }
  const [txt, bg] = ESTADO_COLORS[est] || ESTADO_COLORS.borrador;
  return `<div class="mapa-popup">
    <div class="mapa-popup-cli">${cli}</div>
    <div class="mapa-popup-meta">${num} · ${fmtM(e.total || 0, cur)} · ${fmtD(_mapaDateOf(e))}</div>
    <select class="mapa-popup-estado" style="color:${txt};background:${bg}" onchange="mapaSetEstado(${e.id}, this.value)" aria-label="Estado">${opts}</select>
    <div class="mapa-popup-acts">
      <button class="btn btn-p btn-sm" onclick="mapaVer(${e.id})">${icon('eye')} Ver</button>
      <button class="btn btn-g btn-sm" onclick="comoLlegar(${e.id})">${icon('pin')} Llegar</button>
    </div>
    <button class="mapa-popup-edit" onclick="mapaAbrir(${e.id})" title="Cargar este presupuesto en el editor para modificarlo">${icon('pencil')} Editar…</button>
  </div>`;
}

function mapaSetEstado(id, val) {
  if (typeof setEstadoHistory === 'function') setEstadoHistory(id, val);
  mapaRefresh();
}

function mapaAbrir(id) {
  if (_mapa) _mapa.closePopup();
  if (typeof loadFromHistory === 'function') loadFromHistory(id);
}

// "Ver" desde el mapa: abre la vista previa de SOLO LECTURA (mismo modal que
// usa la lista del historial). No toca el editor — así no se edita sin querer
// un presupuesto ya enviado/aceptado/realizado.
function mapaVer(id) {
  if (_mapa) _mapa.closePopup();
  if (typeof previewFromHistory === 'function') previewFromHistory(id);
}

function mapaRenderSinUbicar(list) {
  const cnt = document.getElementById('mapa-sinubicar-count');
  const box = document.getElementById('mapa-sinubicar-list');
  if (cnt) cnt.textContent = list.length;
  // Atajo en la barra: la lista quedó debajo del mapa, fuera de la pantalla.
  const suBtn = document.getElementById('mapa-su-btn'), suN = document.getElementById('mapa-su-n');
  if (suN) suN.textContent = list.length;
  if (suBtn) suBtn.hidden = !list.length;
  if (!box) return;
  if (!list.length) { box.innerHTML = '<div class="mapa-hint">Todos los presupuestos del filtro actual están ubicados. 🎉</div>'; return; }
  // Los estimativos suelen no llevar ubicación exacta: se dejan al final y se
  // marcan con su badge para distinguirlos de un presupuesto normal sin ubicar.
  const ordered = list.slice().sort((a, b) => (a.isEstimative ? 1 : 0) - (b.isEstimative ? 1 : 0));
  box.innerHTML = ordered.map(e => {
    const cli = esc(e.clientName || '(sin nombre)');
    const num = esc(e.quoteNumber || '—');
    const addr = esc(((e.snapshot && e.snapshot.workAddress) || '').trim() || 'sin dirección');
    const estBadge = e.isEstimative ? '<span class="hbadge-est">Estimativo</span>' : '';
    // Tocar la info (fuera de los botones) lleva al presupuesto resaltado en el
    // Historial. "Editar" lo carga en el editor (para pegar coordenadas a mano);
    // "Ubicar" activa el modo de tocar el punto en el mapa.
    return `<div class="mapa-su-item">
      <div class="mapa-su-info" onclick="goToHistoryEntry(${e.id})" role="button" tabindex="0" title="Ver este presupuesto en el historial"><b>${cli}</b> · ${num}${estBadge}<div class="mapa-su-addr">${addr}</div></div>
      <div class="mapa-su-acts">
        <button class="btn btn-g btn-sm" onclick="mapaAbrir(${e.id})" title="Cargar en el editor para agregar la ubicación">${icon('pencil')} Editar</button>
        <button class="btn btn-p btn-sm" onclick="mapaUbicar(${e.id})">${icon('pin')} Ubicar</button>
      </div>
    </div>`;
  }).join('');
}

// Activa el modo colocación: el próximo toque en el mapa fija la ubicación.
function mapaUbicar(id) {
  _mapaPlacingId = id;
  const canvas = document.getElementById('map-canvas');
  if (canvas) canvas.classList.add('mapa-placing');
  const det = document.getElementById('mapa-sinubicar');
  if (det) det.open = false;
  if (_mapa) _mapa.closePopup();
  // La lista está debajo del mapa: subir para que el mapa quede a la vista.
  const vista = document.getElementById('mapa-vista');
  if (vista) vista.scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('Tocá en el mapa el punto exacto de este trabajo', 'info', 4000);
}

function mapaOnMapClick(ev) {
  if (_mapaPlacingId == null) return;
  const id = _mapaPlacingId;
  _mapaPlacingId = null;
  const canvas = document.getElementById('map-canvas');
  if (canvas) canvas.classList.remove('mapa-placing');
  const lat = +ev.latlng.lat.toFixed(6), lng = +ev.latlng.lng.toFixed(6);
  const h = getH();
  const e = h.find(x => x.id === id);
  if (!e) return;
  e.geo = { lat, lng, manual: true };
  if (!e.snapshot) e.snapshot = {};
  e.snapshot.workMapLink = lat + ',' + lng; // reusa "Llegar" y las rutas existentes
  setH(h);
  toast('Ubicación guardada', 'ok', 2000);
  mapaRefresh();
}

// Stats de la zona VISIBLE del mapa (se recalculan al panear/zoomear).
function mapaUpdateZonaStats() {
  const box = document.getElementById('mapa-zonastats');
  if (!box || !_mapa || !_mapaLayer) return;
  const b = _mapa.getBounds();
  const counts = {};
  let total = 0, cur = '', totalMarks = 0;
  // Los trabajos sin presupuesto se cuentan APARTE, los dos tipos. Nunca
  // entran en counts ni en total: nacen aceptados o realizados y jamás
  // perdidos, así que sumarlos subiría sola la conversión y diría que se
  // aceptaron más trabajos de los que de verdad se aceptaron. Que el trabajo
  // directo sí sume a las VENTAS del mes no lo mete acá: esto es el embudo,
  // y por el embudo no pasó. Ver test/trabajo-propio.test.cjs.
  let colabN = 0, colabTotal = 0, dirN = 0, dirTotal = 0, vencidos = 0;
  const visibles = [];
  _mapaLayer.eachLayer(m => {
    // Grupo de pins cercanos: cada punto cuenta por su ubicación REAL, no por
    // el centro del círculo (que puede caer adentro con pins afuera).
    if (m._puntos) {
      m._puntos.forEach(p => { if (b.contains(p.ll)) p.items.forEach(x => visibles.push(x.e)); });
      return;
    }
    if (!m.getLatLng || !b.contains(m.getLatLng())) return;
    // Cada marca puede representar varios presupuestos (grupo apilado): se
    // cuentan todos sus entries (m._entries), no la marca.
    (m._entries || []).forEach(e => visibles.push(e));
  });
  visibles.forEach(e => {
      if (!cur && e.currency) cur = e.currency;
      if (esColaboracion(e))   { colabN++; colabTotal += e.total || 0; return; }
      if (esTrabajoDirecto(e)) { dirN++;   dirTotal   += e.total || 0; return; }
      const est = e.estado || 'borrador';
      counts[est] = (counts[est] || 0) + 1;
      if (mapaEsVencido(e)) vencidos++;
      total += e.total || 0;
      totalMarks++;
  });
  // Panel propio de lo que se ve en la zona pero no pasó por un presupuesto.
  const colabBox =
    (dirN ? `
    <div class="mapa-zona-colab is-directo">${icon('wrench')} ${colabCantTxt(dirN, 'directo')} en esta zona
      <b>${fmtM(dirTotal, cur || 'ARS')}</b>
      <span class="mapa-hint-inline">sin presupuesto: no cuentan en la conversión</span></div>` : '') +
    (colabN ? `
    <div class="mapa-zona-colab">${icon('users')} ${colabCantTxt(colabN, 'colab')} en esta zona
      <b>${fmtM(colabTotal, cur || 'ARS')}</b>
      <span class="mapa-hint-inline">aparte de los números de arriba</span></div>` : '');
  if (!totalMarks) {
    box.innerHTML = colabBox
      || '<div class="mapa-hint">Acercá o paneá el mapa a una zona con presupuestos para ver sus números.</div>';
    return;
  }
  const c = k => counts[k] || 0;
  // Conversión: ganados sobre DECIDIDOS. Decidido = aceptado, realizado,
  // perdido… y el enviado VENCIDO: la vigencia pasó sin respuesta, y en el uso
  // real casi nadie lo marca "perdido" (zona con 20 vencidos y 0 perdidos).
  // Sacarlo de la cuenta daba 100% (v232, el reporte con captura); contarlo
  // como abierto también. El enviado VIGENTE sí queda afuera: el cliente
  // todavía puede aceptarlo, y contarlo bajaba la conversión (v231).
  const ganados = c('aceptado') + c('realizado');
  const decididos = ganados + c('perdido') + vencidos;
  const conv = decididos ? Math.round(ganados / decididos * 100) : null;
  // Cada chip lleva el punto con el color del PIN: con los filtros plegados,
  // la franja es la leyenda del mapa.
  const chips = ESTADOS.filter(s => counts[s]).map(s => {
    const [txt, bg] = ESTADO_COLORS[s];
    const venc = (s === 'enviado' && vencidos)
      ? ` · <span class="mapa-zona-dot is-venc" style="border-color:${mapaPinColor(s)}"></span>${vencidos} vencido${vencidos === 1 ? '' : 's'}` : '';
    return `<span class="mapa-zona-chip" style="color:${txt};background:${bg}"><span class="mapa-zona-dot" style="background:${mapaPinColor(s)}"></span>${estadoLabel(s)} ${counts[s]}${venc}</span>`;
  }).join('');
  // Franja ENCIMA del mapa: una línea de números y los chips (que hacen de
  // leyenda de colores, ahora que los filtros quedan plegados).
  const sep = '<span class="mapa-zona-sep"> · </span>';
  box.innerHTML = `
    <div class="mapa-zona-title" title="Conversión: aceptado + realizado sobre decididos (aceptado + realizado + perdido + enviados vencidos). Los enviados vigentes no cuentan: siguen abiertos.">En esta zona: ${totalMarks} presupuesto(s)${sep}${conv != null ? `Conversión: <b>${conv}%</b> <span class="mapa-zona-frac">(${ganados}/${decididos})</span>` : 'Conversión: —'}${total ? `${sep}Presupuestado: <b>${fmtM(total, cur || 'ARS')}</b>` : ''}</div>
    <div class="mapa-zona-chips">${chips}</div>
    ${colabBox}`;
}

// "Cerca mío": ubica al usuario y resalta pendientes de campo en 15 km.
function mapaCercaMio(btn) {
  if (!('geolocation' in navigator)) { toast('Este dispositivo no permite detectar la ubicación', 'err', 4000); return; }
  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg class="ic"><use href="#i-pin"></use></svg> Buscando…'; }
  const restore = () => { if (btn) { btn.disabled = false; btn.innerHTML = orig; } };
  navigator.geolocation.getCurrentPosition((pos) => {
    restore();
    const ulat = pos.coords.latitude, ulng = pos.coords.longitude;
    _mapaUserLatLng = [ulat, ulng];
    _mapaGeoRef = _mapaUserLatLng; // mejor referencia para Plus Codes cortos
    ensureLeaflet().then((L) => {
      if (!_mapa) return;
      if (_mapaUserMarker) _mapa.removeLayer(_mapaUserMarker);
      _mapaUserMarker = L.circleMarker([ulat, ulng], { radius: 8, color: '#fff', weight: 2, fillColor: '#0ea5e9', fillOpacity: .95 })
        .addTo(_mapa).bindPopup('Estás acá');
      const RADIO = 15; // km
      const near = [];
      getH().forEach(e => {
        // Una colaboración agendada también es trabajo por hacer, pero solo
        // entra si el usuario prendió su interruptor: si no, quedaría
        // resaltada en la lista sin pin que la respalde en el mapa. El
        // trabajo directo se dibuja siempre, así que entra como cualquiera.
        if (esColaboracion(e)) { if (!_mapaVerColab || (e.estado || '') !== 'aceptado') return; }
        else if (!PENDIENTES_CAMPO.includes(e.estado || 'borrador')) return;
        const ll = entryLatLng(e);
        if (!ll) return;
        const dist = _haversineKm(ulat, ulng, ll[0], ll[1]);
        if (dist <= RADIO) near.push({ e, ll, dist });
      });
      near.sort((a, b) => a.dist - b.dist);
      _mapaCercaList = near;
      _mapaHighlight = new Set(near.map(n => n.e.id));
      mapaRefresh();
      mapaRenderCerca(near);
      if (near.length) _mapa.fitBounds([[ulat, ulng], ...near.map(n => n.ll)], { padding: [40, 40], maxZoom: 14 });
      else _mapa.setView([ulat, ulng], 13);
    });
  }, () => { restore(); toast('No se pudo obtener tu ubicación', 'err', 4000); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function mapaRenderCerca(near) {
  const box = document.getElementById('mapa-cerca-panel');
  if (!box) return;
  box.hidden = false;
  if (!near.length) {
    box.innerHTML = `<div class="mapa-cerca-head"><b>Cerca tuyo</b><button class="mapa-cerca-close" onclick="mapaCerrarCerca()" aria-label="Cerrar">✕</button></div><div class="mapa-hint">No hay pendientes con ubicación en 15 km.</div>`;
    return;
  }
  box.innerHTML = `
    <div class="mapa-cerca-head"><b>Pendientes cerca tuyo (${near.length})</b><button class="mapa-cerca-close" onclick="mapaCerrarCerca()" aria-label="Cerrar">✕</button></div>
    <div class="mapa-cerca-list">${near.map(n => {
      const est = n.e.estado || 'borrador';
      const [txt, bg] = ESTADO_COLORS[est] || ESTADO_COLORS.borrador;
      return `<div class="mapa-cerca-item">
        <span class="mapa-zona-chip" style="color:${txt};background:${bg}">${estadoLabel(est)}</span>
        <b class="mapa-cerca-cli">${esc(n.e.clientName || '(sin nombre)')}</b>
        <span class="mapa-cerca-dist">${n.dist.toFixed(1)} km</span>
        <button class="btn btn-g btn-sm" onclick="comoLlegar(${n.e.id})">${icon('pin')} Llegar</button>
      </div>`;
    }).join('')}</div>
    ${near.length >= 2 ? `<button class="btn btn-p mapa-ruta-btn" onclick="mapaArmarRuta()">${icon('pin')} Armar recorrido en Google Maps</button>
    <div class="mapa-tramos" id="mapa-tramos" hidden></div>` : ''}`;
}

function mapaCerrarCerca() {
  const box = document.getElementById('mapa-cerca-panel');
  if (box) box.hidden = true;
  _mapaHighlight = new Set();
  _mapaCercaList = [];
  if (_mapaUserMarker && _mapa) { _mapa.removeLayer(_mapaUserMarker); _mapaUserMarker = null; }
  mapaRefresh();
}

// Ordena las paradas cercanas por vecino más cercano desde la ubicación
// actual (recorrido "más práctico") y abre Google Maps en modo direcciones.
//
// Límite de paradas: Google Maps URLs acepta hasta 3 paradas intermedias si
// el link abre en el navegador del celular, y 9 en el resto. Con más, la ruta
// sale cortada sin aviso. Como no se puede saber dónde va a abrir, se usa el
// límite seguro: tramos de hasta 4 paradas (3 intermedias + destino). Cada
// tramo arranca en la última parada del anterior. Con un solo tramo se abre
// directo, como antes; con más, el panel de "Cerca mío" lista los tramos.
const MAPA_RUTA_INTERMEDIAS = 3;
let _mapaTramos = [];

// Parte las paradas en tramos: [{ origen, paradas }]. Pura (testeable).
function _mapaRutaTramos(origen, paradas, maxIntermedias) {
  const porTramo = maxIntermedias + 1;
  const out = [];
  let o = origen;
  for (let i = 0; i < paradas.length; i += porTramo) {
    const tramo = paradas.slice(i, i + porTramo);
    out.push({ origen: o, paradas: tramo });
    o = tramo[tramo.length - 1].q;
  }
  return out;
}
function _mapaRutaUrl(t) {
  const qs = t.paradas.map(p => p.q);
  const dest = qs[qs.length - 1];
  const wps = qs.slice(0, -1);
  // Sin origen, Google Maps arranca desde la ubicación del teléfono.
  let url = 'https://www.google.com/maps/dir/?api=1'
    + (t.origen ? '&origin=' + encodeURIComponent(t.origen) : '')
    + '&destination=' + encodeURIComponent(dest);
  if (wps.length) url += '&waypoints=' + wps.map(encodeURIComponent).join('%7C');
  return url;
}

function mapaArmarRuta() {
  if (!_mapaUserLatLng || _mapaCercaList.length < 1) { toast('Primero tocá “Cerca mío”', 'info', 3000); return; }
  const [ulat, ulng] = _mapaUserLatLng;
  const rem = _mapaCercaList.slice();
  const ordered = [];
  let clat = ulat, clng = ulng;
  while (rem.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < rem.length; i++) {
      const d = _haversineKm(clat, clng, rem[i].ll[0], rem[i].ll[1]);
      if (d < bd) { bd = d; bi = i; }
    }
    const nx = rem.splice(bi, 1)[0];
    ordered.push(nx); clat = nx.ll[0]; clng = nx.ll[1];
  }
  const paradas = ordered.map(n => ({
    q: _stopQueryForSnap(n.e.snapshot) || `${n.ll[0]},${n.ll[1]}`,
    nombre: n.e.clientName || '(sin nombre)',
  }));
  _mapaTramos = _mapaRutaTramos(`${ulat},${ulng}`, paradas, MAPA_RUTA_INTERMEDIAS);
  if (_mapaTramos.length === 1) { window.open(_mapaRutaUrl(_mapaTramos[0]), '_blank', 'noopener'); return; }
  mapaRenderTramos();
}

function mapaRenderTramos() {
  const box = document.getElementById('mapa-tramos');
  if (!box) return;
  let n = 0;
  box.innerHTML = `<div class="mapa-hint">Google Maps acepta hasta 4 paradas por recorrido en el celular. Abrí los tramos en orden: cada uno arranca donde terminó el anterior.</div>`
    + _mapaTramos.map((t, i) => {
      const desde = n + 1; n += t.paradas.length;
      const nombres = t.paradas.map(p => esc(p.nombre)).join(' → ');
      return `<button type="button" class="btn btn-p btn-sm mapa-tramo-btn" onclick="mapaAbrirTramo(${i})">${icon('pin')} Tramo ${i + 1} · paradas ${desde} a ${n}<span class="mapa-tramo-nombres">${nombres}</span></button>`;
    }).join('');
  box.hidden = false;
}
function mapaAbrirTramo(i) {
  const t = _mapaTramos[i];
  if (t) window.open(_mapaRutaUrl(t), '_blank', 'noopener');
}
