'use strict';

// ── PUSH NOTIFICATIONS ─────────────────────────────────────────────────────
// Avisos que llegan al teléfono aunque la app esté cerrada. El dispositivo se
// suscribe (Push API + VAPID) y le manda al Worker (push-worker/) su endpoint
// y lo que hay que avisar: seguimientos y vencimientos (el Worker arma el
// texto) y los AVISOS CON HORARIO (`avisos`: la app arma texto y hora local, el
// Worker solo los entrega a su hora — así sumar un aviso nuevo no obliga a
// volver a publicar el Worker). La app sigue offline-first: los datos viven
// local; lo único que sale es la suscripción y esas listas, y solo con señal.
// Inerte si PUSH_WORKER_URL está vacío.
//
// Por qué "nunca aparecían" (v237): solo existían los avisos de seguimiento y
// vencimiento; trabajos, visitas y recordatorios con hora no salían nunca con
// la app cerrada. Y nada decía si el circuito andaba: si la suscripción se
// perdía, el interruptor seguía prendido y no llegaba nada, sin aviso.

// ID estable por dispositivo (clave del registro en el KV del Worker).
function _pushDeviceId() {
  let id = localStorage.getItem(LS.PUSH_DEVICE_ID);
  if (!id) {
    // Sufijo aleatorio de largo garantizado: Math.random().toString(36) puede
    // salir muy corto (o vacío) en casos degenerados, y este id se persiste.
    const rnd = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 10);
    id = 'pq-' + Date.now() + '-' + (rnd || 'x0');
    localStorage.setItem(LS.PUSH_DEVICE_ID, id);
  }
  return id;
}

// base64url → Uint8Array (para applicationServerKey).
function _b64uToUint8(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// ¿Este navegador puede recibir push y la app está conectada a un Worker?
function pushDisponible() {
  return !!(PUSH_WORKER_URL && PUSH_VAPID_KEY && typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator && typeof window !== 'undefined' &&
    'PushManager' in window && typeof Notification !== 'undefined');
}

// Arma la lista de seguimientos que el Worker necesita: por cada presupuesto
// que aún espera seguimiento, su FECHA de vencimiento (envío + días de la
// config). El Worker compara contra "hoy" en su cron y dispara el push.
function _buildPushFollowups(cfg) {
  const h = (typeof getH === 'function') ? getH() : [];
  const out = [];
  for (const e of h) {
    const est = e.estado || 'borrador';
    if (!cfg.estados.includes(est)) continue;
    if (!e.enviadoEn) continue;
    if (e.reemplazadoPor) continue;   // el pendiente pasó a la versión nueva
    if (e.seguimientoHechoEn && new Date(e.seguimientoHechoEn) >= new Date(e.enviadoEn)) continue;
    const dueMs = new Date(e.enviadoEn).getTime() + cfg.days * 86400000;
    if (!isFinite(dueMs)) continue;
    out.push({
      id: e.id,
      clientName: e.clientName || '(sin nombre)',
      date: toLocalISODate(new Date(dueMs)),
      diasDesdeEnvio: (typeof daysSince === 'function') ? (daysSince(e.enviadoEn) || 0) : 0,
    });
  }
  return out;
}

// Arma la lista de vencimientos que el Worker necesita: por cada presupuesto
// enviado y aún sin marcar como visto, la FECHA en que vence. El Worker
// compara contra "hoy" en su cron y dispara el push cuando ya pasó. Mismo
// criterio que getExpiredQuotes: sin `enviadoEn` (ver el comentario de allá).
function _buildPushExpiries(cfg) {
  const h = (typeof getH === 'function') ? getH() : [];
  const out = [];
  for (const e of h) {
    const est = e.estado || 'borrador';
    if (!cfg.estados.includes(est)) continue;
    if (e.vencimientoVistoEn) continue;
    if (e.reemplazadoPor) continue;   // ya tiene versión nueva
    const exp = e.snapshot && e.snapshot.dateExpiry;
    if (!exp) continue;
    out.push({
      id: e.id,
      clientName: e.clientName || '(sin nombre)',
      date: exp,
    });
  }
  return out;
}

// ── Avisos con horario (los arma la app, el Worker los entrega a su hora) ──
// v239: la app arma TODO lo que suena con la app cerrada —también los
// seguimientos y vencidos, que antes calculaba el Worker en franjas fijas (9,
// 14 y 19 h)—, así los horarios se eligen en Configuración y cualquier aviso
// nuevo se suma acá sin volver a publicar el Worker. Lo que sale:
//   · Resumen del día (`hoy:`), a la hora elegida: Agenda del día + los
//     seguimientos y vencidos que tocan + los lunes, la semana y el tope.
//   · La noche anterior (`man:`): trabajos y visitas de mañana, con el clima.
//   · Visitas/recordatorios con hora (`hr:`): N minutos antes.
//   · Solo clima (`clima:`): con los avisos de la Agenda apagados.
const PUSH_HORIZONTE_DIAS = 14;     // qué tan adelante se mandan
const PUSH_MAX_AVISOS = 120;
const PUSH_ANTES_OPC = [30, 60, 120];
// Un seguimiento/vencido avisa el día que toca y UNA vez más a la semana.
// Antes repetía todos los días hasta marcarlo: un aviso diario por presupuestos
// muertos, que es lo que enseña a ignorar las notificaciones. Después de eso
// queda en el banner del Historial y en la campanita.
const PUSH_REPITE_DIAS = 7;
const PUSH_SEMANA_DOW = 1;          // lunes: resumen de la semana
const PUSH_TOPE_AVISO_PCT = 80;     // desde acá el tope de facturación entra al resumen
// Mismas URLs que deja pasar el Worker (ACT_URL_RE): el botón la abre tal cual.
const PUSH_MAPS_URL_RE = /^https:\/\/(?:www\.google\.com\/maps\/|maps\.google\.com\/|maps\.app\.goo\.gl\/|goo\.gl\/maps\/)[^\s"'<>]{0,560}$/;

function _pushAt(d) {   // Date local → 'YYYY-MM-DDTHH:MM'
  return toLocalISODate(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function _pushCorto(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function _pushPlural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
function _pushUnir(partes) {   // ['a','b','c'] → "a, b y c"
  return partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] : (partes[0] || '');
}
function _pushDow(iso) { const p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getDay(); }

// Horarios elegidos, con los de fábrica si falta algo.
function _pushHorarios(cfg) {
  const c = cfg || {};
  return {
    resumen: sanHoraHM(c.pushHoraResumen) || FOLLOWUP_DEF.pushHoraResumen,
    noche: sanHoraHM(c.pushHoraNoche) || FOLLOWUP_DEF.pushHoraNoche,
    antes: PUSH_ANTES_OPC.includes(c.pushAntesMin) ? c.pushAntesMin : FOLLOWUP_DEF.pushAntesMin,
    silencio: new Set(Array.isArray(c.pushSilencio) ? c.pushSilencio : []),
  };
}

// ── Detalle para leer sin abrir la app (v240) ──
// "A veces no tengo tiempo para ponerme a ver, pero si veo la notificación y
// la puedo leer directamente, me sirve." Android despliega el texto entero, así
// que cada renglón dice QUÉ, DÓNDE y CUÁNTO, y el primero (el que se ve sin
// desplegar) es el más importante del aviso.
const PUSH_MAX_BODY = 900;     // el Worker recorta por bytes si hiciera falta
const PUSH_MAX_LINEAS = 5;     // eventos por aviso; el resto, "…y N más"

// Un lugar que se pueda LEER: una dirección. Coordenadas, Plus Codes y links
// no le dicen nada a nadie en una notificación (para eso está "Cómo llegar").
function _pushLugar(u) {
  u = String(u || '').trim();
  if (!u || /^https?:\/\//i.test(u) || /^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(u)
      || /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]*/i.test(u)) return '';
  return _pushCorto(u, 45);
}
// Qué se va a hacer: las especies de los árboles ("Eucalipto y Pino"), o la
// primera descripción si el presupuesto no tiene árboles (estimativo, servicios).
function _pushQueTrabajo(snap) {
  const s = snap || {};
  const esp = [];
  (Array.isArray(s.items) ? s.items : []).forEach(it => {
    if (!it || it.type !== 'tree') return;
    String(it.species || '').split(/,|\s+y\s+/).forEach(x => {
      x = x.trim();
      if (x && !/^\[/.test(x) && !esp.some(y => y.toLowerCase() === x.toLowerCase())) esp.push(x);
    });
  });
  if (esp.length) return _pushUnir(esp.slice(0, 3)) + (esp.length > 3 ? ' y más' : '');
  const d = [].concat(s.items || [], s.estItems || []).map(it => String((it && it.desc) || '').trim()).find(Boolean);
  return d ? _pushCorto(d, 45) : '';
}
function _pushMonto(e) {
  return (e && Number(e.total) > 0) ? fmtM(e.total, e.currency) : '';
}
function _pushDiasEntre(a, b) {   // días de calendario de a → b (ISO locales)
  return Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 86400000);
}
// Recorta a `max` caracteres sin partir un renglón (como recortarRenglones del Worker).
function _pushRecortar(txt, max) {
  txt = String(txt || '');
  if (txt.length <= max) return txt;
  const corte = txt.lastIndexOf('\n', max);
  return corte > 0 ? txt.slice(0, corte) : txt.slice(0, max);
}
function _pushHaceDias(n) { return n <= 0 ? 'hoy' : n === 1 ? 'ayer' : 'hace ' + n + ' días'; }

// Un renglón por evento de la Agenda:
//   "🌳 García — Eucalipto y Pino · Av. Mitre 1234 · $ 450.000 · día 1 de 2"
//   "👁️ 10:30 Ver pino — López · Barrio Norte"
function _pushDetalleEv(ev, hById, nById) {
  const hora = ev.hora ? ev.hora + ' ' : '';
  if (ev.tipo === 'trabajo') {
    const e = hById.get(ev.entryId);
    const snap = (e && e.snapshot) || {};
    const que = _pushQueTrabajo(snap);
    const dia = (String(ev.sub || '').match(/día \d+ de \d+/) || [''])[0];
    return _pushCorto('🌳 ' + [ev.title + (que ? ' — ' + que : ''), _pushLugar(snap.workAddress), _pushMonto(e), dia]
      .filter(Boolean).join(' · '), 140);
  }
  if (ev.tipo === 'visita' || ev.tipo === 'nota') {
    const n = nById.get(String(ev.noteId)) || {};
    return _pushCorto((ev.tipo === 'visita' ? '👁️ ' : '📝 ') + hora
      + [ev.title + (ev.sub ? ' — ' + ev.sub : ''), _pushLugar(n.ubic)].filter(Boolean).join(' · '), 140);
  }
  if (ev.tipo === 'recontacto') {
    return _pushCorto('📞 ' + ev.title + (ev.sub && !/^N° /.test(ev.sub) ? ' — ' + ev.sub : ''), 140);
  }
  return _pushCorto(hora + (ev.title || ''), 140);
}
// Renglones de los eventos, con el "…y N más" si no entran. Los trabajos van
// primero (son el día; el primer renglón es lo que se ve sin desplegar) y el
// resto por hora.
const PUSH_ORDEN_TIPO = { trabajo: 0, visita: 1, recontacto: 2, nota: 3 };
function _pushLineasEv(evs, hById, nById) {
  const orden = evs.slice().sort((a, b) => ((PUSH_ORDEN_TIPO[a.tipo] ?? 9) - (PUSH_ORDEN_TIPO[b.tipo] ?? 9))
    || String(a.hora || '99:99').localeCompare(String(b.hora || '99:99')));
  const l = orden.slice(0, PUSH_MAX_LINEAS).map(ev => _pushDetalleEv(ev, hById, nById));
  if (evs.length > PUSH_MAX_LINEAS) l.push('…y ' + (evs.length - PUSH_MAX_LINEAS) + ' más');
  return l;
}
// Seguimientos y vencidos del resumen del día `d`, uno por renglón:
//   "📨 Seguimiento: Gómez · N° 2026-0003 · $ 320.000 · enviado hace 10 días"
//   "⌛ Vencido: Pérez · N° 2026-0002 · $ 500.000 · venció ayer"
function _pushLineasPres(tipo, items, hById, d) {
  const l = items.slice(0, 3).map(x => {
    const e = hById.get(x.id) || {};
    const snap = e.snapshot || {};
    let cuando = '';
    if (tipo === 'seg' && e.enviadoEn) cuando = 'enviado ' + _pushHaceDias(_pushDiasEntre(_calTsToLocalISO(e.enviadoEn), d));
    if (tipo === 'venc' && snap.dateExpiry) cuando = 'venció ' + _pushHaceDias(_pushDiasEntre(snap.dateExpiry, d));
    return _pushCorto((tipo === 'seg' ? '📨 Seguimiento: ' : '⌛ Vencido: ')
      + [x.clientName || '(sin nombre)', e.quoteNumber ? 'N° ' + e.quoteNumber : '', _pushMonto(e), cuando]
        .filter(Boolean).join(' · '), 140);
  });
  if (items.length > 3) l.push('…y ' + (items.length - 3) + ' ' + (tipo === 'seg' ? 'seguimientos' : 'vencidos') + ' más');
  return l;
}

// Partes del resumen: ["1 trabajo", "2 visitas"].
function _pushResumenPartes(evs) {
  const n = (t) => evs.filter(e => e.tipo === t).length;
  const partes = [];
  if (n('trabajo')) partes.push(_pushPlural(n('trabajo'), 'trabajo', 'trabajos'));
  if (n('visita')) partes.push(_pushPlural(n('visita'), 'visita', 'visitas'));
  if (n('recontacto')) partes.push(_pushPlural(n('recontacto'), 'llamada', 'llamadas'));
  if (n('nota')) partes.push(_pushPlural(n('nota'), 'recordatorio', 'recordatorios'));
  return partes;
}
// Resumen "1 trabajo y 2 visitas".
function _pushResumen(evs) { return _pushUnir(_pushResumenPartes(evs)); }

// Botones de la notificación. Android muestra dos: el primero es lo útil de
// ESE aviso (la ruta si hay lugar, si no el chat), el segundo "Posponer".
// Ruta y teléfono de un presupuesto (`e`) o de una nota (`n`): { maps, tel }.
function _pushFuente(e, n) {
  let maps = '', tel = '';
  if (e) {
    const snap = e.snapshot || {};
    maps = mapsDirUrlFor(snap.workMapLink, snap.workAddress);
    tel = normalizeArgPhone(histClientPhone(e));
  } else if (n) {
    maps = n.ubic ? mapsDirUrlFor(n.ubic, '') : '';
    tel = normalizeArgPhone(n.tel || '');
  }
  return { maps: PUSH_MAPS_URL_RE.test(maps || '') ? maps : '', tel: /^\d{6,15}$/.test(tel || '') ? tel : '' };
}
function _pushWa(f) { return f.tel ? { a: 'wa', url: 'https://wa.me/' + f.tel } : null; }
// El botón útil de un aviso: la ruta si hay lugar, si no el chat.
function _pushActUtil(f) { return f.maps ? { a: 'maps', url: f.maps } : _pushWa(f); }
function _pushFuenteEv(ev, hById, nById) {
  return ev.entryId != null ? _pushFuente(hById.get(ev.entryId), null) : _pushFuente(null, nById.get(String(ev.noteId)));
}

// Puntos para que el Worker mire el clima de los trabajos y visitas de un día:
// coordenadas redondeadas a ~1 km (como las que la app ya manda a Open-Meteo)
// y el nombre del cliente para el texto ("Ráfagas de 55 km/h — García").
function _pushClimaPts(evs, hById, nById) {
  const pts = [], vistos = new Set();
  evs.forEach(ev => {
    let ll = null;
    try {
      if (ev.tipo === 'trabajo' && ev.entryId != null && typeof _climaLatLngDe === 'function') ll = _climaLatLngDe(hById.get(ev.entryId));
      else if (ev.tipo === 'visita' && ev.noteId != null && typeof _climaLatLngNota === 'function') ll = _climaLatLngNota(nById.get(String(ev.noteId)));
    } catch (_) { ll = null; }
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return;
    const la = Math.round(ll[0] * 100) / 100, lo = Math.round(ll[1] * 100) / 100;
    const clave = la + ',' + lo + ',' + ev.title;
    if (vistos.has(clave) || pts.length >= 5) return;
    vistos.add(clave);
    // El nombre del cliente (en una visita el título puede ser "Ver pino").
    pts.push({ la, lo, n: _pushCorto(ev.tipo === 'visita' ? (ev.sub || ev.title) : ev.title, 40) });
  });
  return pts;
}

// ¿Este seguimiento/vencido entra en el resumen del día `d`? Entra el día que
// toca (`base`) y a la semana; y si esos días caen en días sin avisos, pasa al
// primer resumen que sí sale (`desde` = primer día de silencio antes de `d`).
function _pushToca(base, desde, d) {
  if (!base) return false;
  const rep = _calAddDays(base, PUSH_REPITE_DIAS);
  return (base >= desde && base <= d) || (rep >= desde && rep <= d);
}

// Facturación de los últimos 12 meses sobre el tope anual, en %.
function _pushPctTope() {
  try {
    const tope = (typeof getTope === 'function') ? getTope() : 0;
    if (!(tope > 0) || typeof factTotalAnual !== 'function') return 0;
    return factTotalAnual(new Date()) / tope * 100;
  } catch (_) { return 0; }
}

// Los lunes: lo que viene en la semana, lo que espera respuesta y el tope.
function _pushSemanaLineas(d, idx, h) {
  const lineas = [];
  const evs = [];
  for (let i = 0; i < 7; i++) (idx[_calAddDays(d, i)] || []).forEach(ev => {
    if (!ev.done && (ev.tipo === 'trabajo' || ev.tipo === 'visita')) evs.push(ev);
  });
  if (evs.length) lineas.push('Semana: ' + _pushResumen(evs));
  const esperan = h.filter(e => (e.estado || '') === 'enviado' && !e.reemplazadoPor
    && !(e.snapshot && e.snapshot.dateExpiry && e.snapshot.dateExpiry < d)).length;
  if (esperan) lineas.push(_pushPlural(esperan, 'presupuesto espera', 'presupuestos esperan') + ' respuesta');
  const pct = _pushPctTope();
  if (pct >= PUSH_TOPE_AVISO_PCT) lineas.push('Facturación: ' + Math.round(pct) + ' % del tope anual');
  return lineas;
}

// Cuerpo del recordatorio con hora: qué hay que hacer y dónde.
function _pushHoraCuerpo(ev, n) {
  n = n || {};
  const texto = String(n.texto || '').trim();
  const lugar = _pushLugar(n.ubic);
  return [
    texto && ev.sub ? '📝 ' + _pushCorto(texto, 200) : '',
    lugar ? '📍 ' + lugar : (n.ubic ? '📍 Ubicación cargada: tocá "Cómo llegar"' : ''),
  ].filter(Boolean).join('\n');
}

function _buildPushAvisos(cfg, ahora) {
  if (typeof calBuildIndex !== 'function') return [];
  cfg = cfg || {};
  const ag = cfg.pushAgenda !== false, hr = cfg.pushHora !== false;
  const clima = cfg.pushClima !== false, semana = cfg.pushSemana !== false;
  const conSeg = !!cfg.enabled, conVenc = !!(cfg.enabled && cfg.expiryEnabled);
  const H = _pushHorarios(cfg);
  const sil = (iso) => H.silencio.has(_pushDow(iso));
  const idx = calBuildIndex();
  const h = (typeof getH === 'function') ? getH() : [];
  const hById = new Map(h.map(e => [e.id, e]));
  const nById = new Map((typeof getNotes === 'function' ? getNotes() : []).map(n => [String(n.id), n]));
  const segs = conSeg ? _buildPushFollowups(cfg) : [];
  const vencs = conVenc ? _buildPushExpiries(cfg).map(v => Object.assign({}, v, { date: _calAddDays(v.date, 1) })) : [];
  const now = ahora || new Date();
  const hoy = toLocalISODate(now);
  const out = [];
  for (let i = 0; i <= PUSH_HORIZONTE_DIAS; i++) {
    const d = _calAddDays(hoy, i);
    const evs = (idx[d] || []).filter(ev => !ev.done);
    const man = evs.filter(ev => ev.tipo === 'trabajo' || ev.tipo === 'visita');

    // La noche anterior: lo que hay que preparar (trabajos y visitas), con el
    // clima. En un día de silencio solo sale si el pronóstico está feo.
    if (i >= 1 && man.length && (ag || clima)) {
      const pts = clima ? _pushClimaPts(man, hById, nById) : [];
      const silencio = sil(_calAddDays(d, -1));
      if (ag || pts.length) {
        const a = {
          k: (ag ? 'man:' : 'clima:') + d, at: _calAddDays(d, -1) + 'T' + H.noche,
          go: 'agenda:' + d, tag: ag ? 'pq-manana' : 'pq-clima',
          title: 'Mañana: ' + _pushResumen(man),
          body: _pushRecortar(_pushLineasEv(man, hById, nById).join('\n'), PUSH_MAX_BODY),
        };
        if (pts.length) a.clima = { d, pts };
        if (!ag || silencio) a.soloSiClima = true;
        // Un solo trabajo: el chat con el cliente, para confirmarle que vas.
        if (man.length === 1) {
          const wa = _pushWa(_pushFuenteEv(man[0], hById, nById));
          if (wa) a.acts = [wa];
        }
        if (!(silencio && !a.clima)) out.push(a);
      }
    }

    // Resumen del día: Agenda + seguimientos/vencidos que tocan + la semana.
    if (!sil(d)) {
      let desde = d;
      for (let n = 0; n < 6 && sil(_calAddDays(desde, -1)); n++) desde = _calAddDays(desde, -1);
      const dia = ag ? evs.filter(ev => ['trabajo', 'visita', 'recontacto', 'nota'].includes(ev.tipo)) : [];
      const sg = segs.filter(x => _pushToca(x.date, desde, d));
      const vc = vencs.filter(x => _pushToca(x.date, desde, d));
      const sem = (semana && _pushDow(d) === PUSH_SEMANA_DOW) ? _pushSemanaLineas(d, idx, h) : [];
      if (dia.length || sg.length || vc.length || sem.length) {
        const partes = _pushResumenPartes(dia);
        if (sg.length) partes.push(_pushPlural(sg.length, 'seguimiento', 'seguimientos'));
        if (vc.length) partes.push(_pushPlural(vc.length, 'vencido', 'vencidos'));
        const cuerpo = _pushLineasEv(dia, hById, nById)
          .concat(_pushLineasPres('seg', sg, hById, d), _pushLineasPres('venc', vc, hById, d), sem);
        const title = partes.length ? 'Hoy: ' + _pushUnir(partes)
          : 'Tu semana · ' + sem[0].replace(/^Semana: /, '');
        const items = sg.concat(vc);
        let go = 'agenda:' + d;
        if (!dia.length && items.length === 1) go = 'hist:' + items[0].id;
        else if (!dia.length && items.length) go = vc.length >= sg.length ? 'historial:venc' : 'historial:seg';
        // Una sola cosa en el día: su botón útil (ruta o chat) + "Posponer".
        // Seguimiento/vencido: lo útil es escribirle al cliente, no la ruta.
        let util = null;
        if (dia.length + items.length === 1) {
          util = dia.length ? _pushActUtil(_pushFuenteEv(dia[0], hById, nById))
            : _pushWa(_pushFuente(hById.get(items[0].id), null));
        }
        const acts = (util ? [util] : []).concat([{ a: 'posponer' }]);
        const aviso = {
          k: 'hoy:' + d, at: d + 'T' + H.resumen, go, tag: 'pq-hoy', acts,
          title: _pushCorto(title, 120),
          body: _pushRecortar(cuerpo.join('\n'), PUSH_MAX_BODY),
        };
        // El pronóstico del día, para leerlo en el mismo aviso (lo agrega el
        // Worker a la hora de mandarlo, con el dato fresco).
        const pts = clima ? _pushClimaPts(dia.filter(ev => ev.tipo === 'trabajo' || ev.tipo === 'visita'), hById, nById) : [];
        if (pts.length) aviso.clima = { d, pts };
        out.push(aviso);
      }
    }

    if (hr) {
      // Visitas y notas con hora: N minutos antes, cada una su propio aviso.
      // Los días de silencio no las frenan: la hora la puso el usuario.
      evs.filter(ev => ev.hora && ev.noteId != null).forEach(ev => {
        const [hh, mm] = ev.hora.split(':').map(Number);
        const [y, mo, da] = d.split('-').map(Number);
        const at = new Date(y, mo - 1, da, hh, mm - H.antes);
        if (at.getTime() < now.getTime() - 3 * 3600000) return;
        out.push({
          k: 'hr:' + ev.noteId + ':' + d + ':' + ev.hora.replace(':', ''),
          at: _pushAt(at), go: 'agenda:' + d + (SAN_ID_RE.test(String(ev.noteId)) ? ':' + ev.noteId : ''),
          tag: 'pq-hora-' + String(ev.noteId).replace(/[^\w-]/g, '').slice(0, 30),
          title: _pushCorto((ev.tipo === 'visita' ? 'Visita' : 'Recordatorio') + ' a las ' + ev.hora
            + (ev.sub || ev.title ? ' · ' + (ev.sub || ev.title) : ''), 120),
          body: _pushHoraCuerpo(ev, nById.get(String(ev.noteId))),
          acts: [_pushActUtil(_pushFuenteEv(ev, hById, nById)), { a: 'posponer' }].filter(Boolean),
        });
      });
    }
  }
  out.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  return out.slice(0, PUSH_MAX_AVISOS);
}

// Estado del circuito en ESTE teléfono (diagnóstico: no va al backup).
function _pushEstadoGet() {
  try { const o = JSON.parse(localStorage.getItem(LS.PUSH_ESTADO) || 'null'); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function _pushEstadoSet(patch) {
  const o = Object.assign(_pushEstadoGet(), patch);
  try { localStorage.setItem(LS.PUSH_ESTADO, JSON.stringify(o)); } catch (_) {}
  pushEstadoRender();
}

// Sube al Worker la suscripción + todo lo que hay que avisar. Devuelve true si
// el Worker la guardó. Silencioso: sin URL, sin señal o sin suscripción no hace
// nada; el resultado queda en el estado que se ve en Configuración.
async function syncPushFollowups(sub) {
  if (!PUSH_WORKER_URL || navigator.onLine === false) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = sub || await reg.pushManager.getSubscription();
    if (!subscription) return false;
    const cfg = (typeof getFollowupCfg === 'function')
      ? getFollowupCfg() : { enabled: false, estados: [], days: 10 };
    // v239: seguimientos y vencidos van DENTRO del resumen del día (avisos).
    // Las listas sueltas viajan vacías: con ellas el Worker repetía el aviso
    // todos los días en franjas fijas (lo sigue haciendo para apps viejas).
    const followups = [], expiries = [];
    const avisos = _buildPushAvisos(cfg);
    const res = await netFetch(PUSH_WORKER_URL + '/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: _pushDeviceId(), subscription: subscription.toJSON(),
        followups, expiries, avisos, tz: new Date().getTimezoneOffset(),
      }),
    });
    if (!res.ok) throw new Error('el servidor de avisos respondió ' + res.status);
    _pushEstadoSet({ ok: new Date().toISOString(), err: '', n: avisos.length + followups.length + expiries.length });
    return true;
  } catch (e) {
    _pushEstadoSet({ err: (e && e.message) || 'sin conexión', errEn: new Date().toISOString() });
    return false;
  }
}

// Re-sincronización con retardo tras cada cambio del historial o la agenda:
// agendar un trabajo para mañana tiene que llegar al Worker sin esperar a que
// se vuelva a abrir la app.
let _pushSyncTimer = null;
function schedulePushSync() {
  if (!S.pushEnabled || !pushDisponible()) return;
  clearTimeout(_pushSyncTimer);
  _pushSyncTimer = setTimeout(() => {
    if (typeof netPuedeAutoImportante === 'function' && !netPuedeAutoImportante()) return;
    syncPushFollowups().catch(() => {});
  }, 8000);
}

// Suscribe el dispositivo (lo llama el toggle tras conceder permiso, y el
// arranque si la suscripción se perdió). `silencioso`: sin toasts.
async function pushSubscribe(silencioso) {
  if (!PUSH_WORKER_URL || !PUSH_VAPID_KEY) return false;
  if (!('PushManager' in window)) { if (!silencioso) toast('Tu navegador no soporta notificaciones push', 'err'); return false; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _b64uToUint8(PUSH_VAPID_KEY),
      });
    }
    S.pushEnabled = true;
    saveLS();
    const el = document.getElementById('push-enabled');
    if (el) el.checked = true;
    const ok = await syncPushFollowups(sub);
    if (!silencioso) {
      if (ok) toastAccion('Avisos activados en este teléfono', [{ label: 'Probar', fn: pushProbar }]);
      else toast('Avisos activados. Se van a registrar cuando haya señal.', 'ok');
    }
    return true;
  } catch (e) {
    _pushEstadoSet({ err: (e && e.message) || 'no se pudo suscribir', errEn: new Date().toISOString() });
    if (!silencioso) toast('No se pudieron activar las notificaciones', 'err');
    const el = document.getElementById('push-enabled');
    if (el) el.checked = !!S.pushEnabled;
    return false;
  }
}

// Cancela la suscripción local y la borra del Worker.
async function pushUnsubscribe() {
  try {
    const deviceId = _pushDeviceId();
    if (PUSH_WORKER_URL) {
      netFetch(PUSH_WORKER_URL + '/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      }).catch(() => {});
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) {}
  S.pushEnabled = false;
  saveLS();
  const el = document.getElementById('push-enabled');
  if (el) el.checked = false;
  try { localStorage.removeItem(LS.PUSH_ESTADO); } catch (_) {}
  pushEstadoRender();
  toast('Notificaciones desactivadas', '');
}

// Qué hacer cuando el permiso está bloqueado: el navegador no vuelve a
// preguntar, hay que habilitarlo a mano.
const PUSH_MSG_BLOQUEADO = 'Las notificaciones están bloqueadas para esta app. En Android: mantené apretado el ícono de la app → Información de la app → Notificaciones → Permitir. (Si la usás desde Chrome: el candado de la barra de dirección → Permisos → Notificaciones.)';

// Handler del toggle: pide permiso al prender, desuscribe al apagar.
async function onPushToggle(on) {
  if (on) {
    if (typeof Notification === 'undefined') { toast('Este navegador no permite notificaciones', 'err'); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast(perm === 'denied' ? PUSH_MSG_BLOQUEADO : 'No diste el permiso de notificaciones.', 'err');
      const el = document.getElementById('push-enabled');
      if (el) el.checked = false;
      pushEstadoRender();
      return;
    }
    await pushSubscribe();
  } else {
    await pushUnsubscribe();
  }
  pushEstadoRender();
  if (document.getElementById('notif-overlay')?.classList.contains('open') && typeof notifRender === 'function') notifRender();
}

// Botón "Probar": separa los dos tramos para saber DÓNDE se corta.
//   1. Una notificación local (sin internet): prueba el teléfono — permiso,
//      canal de notificaciones, No molestar.
//   2. Un push de verdad desde el Worker a este equipo: prueba el servidor y
//      la entrega con la app cerrada.
async function pushProbar() {
  const out = (msg, tipo) => { _pushEstadoSet({ prueba: msg }); if (tipo) toast(msg, tipo); };
  if (!pushDisponible()) { out('Este navegador no recibe notificaciones push.', 'err'); return; }
  if (Notification.permission !== 'granted') { out(Notification.permission === 'denied' ? PUSH_MSG_BLOQUEADO : 'Primero activá los avisos.', 'err'); return; }
  let reg;
  try {
    reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Prueba en este teléfono', {
      body: 'Si ves esto, el teléfono muestra los avisos. En unos segundos llega otra desde el servidor.',
      icon: './icon-192.png', badge: './icon-192.png', tag: 'pq-prueba-local', lang: 'es-AR',
    });
  } catch (e) {
    out('El teléfono no dejó mostrar la notificación: ' + ((e && e.message) || e), 'err');
    return;
  }
  if (!(await pushSubscribe(true)) || !(await syncPushFollowups())) {
    out('El teléfono muestra avisos, pero no se pudo registrar en el servidor (¿hay señal?).', 'err');
    return;
  }
  try {
    const res = await netFetch(PUSH_WORKER_URL + '/ping', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: _pushDeviceId() }),
    });
    if (res.ok) out('Prueba enviada: tienen que llegar dos notificaciones. Si llega solo la primera, el teléfono está frenando las de la app cerrada (ahorro de batería).', 'ok');
    else if (res.status === 429) out('Esperá unos segundos antes de volver a probar.', 'err');
    else if (res.status === 404) out('El servidor de avisos está desactualizado: hay que volver a publicarlo (docs/push-setup.md).', 'err');
    else out('El servidor no pudo mandar la prueba (' + res.status + ').', 'err');
  } catch (e) {
    out('No se pudo pedir la prueba al servidor: ' + ((e && e.message) || e), 'err');
  }
}

function _pushHace(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!isFinite(min)) return '';
  if (min < 2) return 'recién';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'hace ' + h + ' h';
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : 'hace ' + d + ' días';
}

// Línea de estado en Configuración: qué pasa con los avisos en ESTE teléfono.
function pushEstadoRender() {
  const el = document.getElementById('push-estado');
  if (!el) return;
  const st = _pushEstadoGet();
  const perm = (typeof Notification !== 'undefined') ? Notification.permission : 'denied';
  let cls = '', txt;
  if (!pushDisponible()) { txt = 'Este navegador no recibe notificaciones push.'; cls = 'is-err'; }
  else if (perm === 'denied') { txt = PUSH_MSG_BLOQUEADO; cls = 'is-err'; }
  else if (!S.pushEnabled) { txt = 'Apagados en este teléfono.'; }
  else if (st.err && (!st.ok || (st.errEn || '') > st.ok)) {
    txt = 'No se pudo actualizar el servidor de avisos: ' + st.err + '. Se reintenta solo con señal.'; cls = 'is-err';
  } else if (st.ok) {
    txt = 'Activos · servidor actualizado ' + _pushHace(st.ok) +
      ' · ' + _pushPlural(st.n || 0, 'aviso programado', 'avisos programados') + '.';
    cls = 'is-ok';
  } else txt = 'Activos · todavía no se registraron en el servidor (falta señal).';
  el.className = 'push-estado ' + cls;
  el.textContent = txt + (st.prueba ? '\n' + st.prueba : '');
  const pr = document.getElementById('push-probar');
  if (pr) pr.hidden = !S.pushEnabled || !pushDisponible();
  const tipos = document.getElementById('push-tipos');
  if (tipos) tipos.hidden = !S.pushEnabled;
}

// Tipos de aviso (Configuración): viven en la config de seguimiento.
function pushTiposSave(extra) {
  const chk = (id) => { const el = document.getElementById(id); return el ? !!el.checked : true; };
  const hora = (id, def) => { const el = document.getElementById(id); return (el && sanHoraHM(el.value)) || def; };
  const cfg = getFollowupCfg();
  setFollowupCfg(Object.assign({}, cfg, {
    pushAgenda: chk('push-agenda'),
    pushHora: chk('push-hora'),
    pushClima: chk('push-clima'),
    pushSemana: chk('push-semana'),
    pushHoraResumen: hora('push-h-resumen', cfg.pushHoraResumen),
    pushHoraNoche: hora('push-h-noche', cfg.pushHoraNoche),
  }, extra || {}));
  pushHorariosRender();
  if (S.pushEnabled) syncPushFollowups().catch(() => {});
}
function pushAntesSet(min) {
  if (PUSH_ANTES_OPC.includes(min)) pushTiposSave({ pushAntesMin: min });
}
function pushSilToggle(dow) {
  const cur = new Set(getFollowupCfg().pushSilencio || []);
  if (cur.has(dow)) cur.delete(dow); else cur.add(dow);
  // Los siete días en silencio es apagar los resúmenes: para eso está el
  // interruptor de arriba. No se deja marcar el séptimo.
  if (cur.size > 6) { toast('Para no recibir ninguno, apagá los avisos con el interruptor de arriba', 'info', 3200); return; }
  pushTiposSave({ pushSilencio: [...cur].sort() });
}
// Pinta horarios, anticipación y días de silencio desde la config guardada.
function pushHorariosRender() {
  const cfg = getFollowupCfg();
  const H = _pushHorarios(cfg);
  const set = (id, v) => { const el = document.getElementById(id); if (el && el.value !== v) el.value = v; };
  set('push-h-resumen', H.resumen);
  set('push-h-noche', H.noche);
  document.querySelectorAll('#push-antes button').forEach(b =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.min) === H.antes)));
  document.querySelectorAll('#push-silencio button').forEach(b =>
    b.setAttribute('aria-pressed', String(H.silencio.has(Number(b.dataset.dow)))));
  const cl = document.getElementById('push-clima');
  if (cl) cl.checked = cfg.pushClima !== false;
  const se = document.getElementById('push-semana');
  if (se) se.checked = cfg.pushSemana !== false;
}

// Lleva a la sección de avisos en Configuración (desde la campanita).
function irAPush() {
  if (typeof notifClose === 'function') notifClose();
  switchTab('empresa');
  if (typeof switchSubtab === 'function') switchSubtab('textos');
  const sec = document.getElementById('push-section');
  if (!sec) return;
  requestAnimationFrame(() => {
    sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    sec.classList.add('is-destacada');
    setTimeout(() => sec.classList.remove('is-destacada'), 2200);
  });
}

// Invitación en la campanita: los avisos ya están ahí, falta que suenen con la
// app cerrada. Se esconde para siempre con "Ahora no".
function pushCtaHTML() {
  if (!pushDisponible() || S.pushEnabled) return '';
  try { if (localStorage.getItem(LS.PUSH_CTA_NO)) return ''; } catch (_) {}
  const bloq = Notification.permission === 'denied';
  return `<div class="nt-push-cta"><div><strong>📲 Que te lleguen al teléfono</strong>` +
    `<span>${bloq ? 'Las notificaciones están bloqueadas para la app.' : 'Un resumen del día, los trabajos de mañana con el clima y las visitas con hora, aunque la app esté cerrada.'}</span></div>` +
    `<div class="nt-push-btns"><button type="button" class="btn btn-s btn-sm" onclick="pushCtaNo()">Ahora no</button>` +
    `<button type="button" class="btn btn-p btn-sm" onclick="${bloq ? 'irAPush()' : 'onPushToggle(true)'}">${bloq ? 'Cómo habilitar' : 'Activar'}</button></div></div>`;
}
function pushCtaNo() {
  try { localStorage.setItem(LS.PUSH_CTA_NO, '1'); } catch (_) {}
  if (typeof notifRender === 'function') notifRender();
}

// Al iniciar: mostrar la sección solo si el push está configurado; si ya
// estaba activado, re-sincronizar (los avisos cambian con el tiempo) y, si la
// suscripción se perdió (el navegador la renovó, se borraron datos), rehacerla
// en silencio: antes el interruptor seguía prendido y no llegaba nada.
async function initPush() {
  if (!pushDisponible()) return;
  const ps = document.getElementById('push-section');
  if (ps) ps.style.display = '';
  pushEstadoRender();
  if (!S.pushEnabled) return;
  if (Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) syncPushFollowups(sub).catch(() => {});
      else pushSubscribe(true).catch(() => {});
    } catch (_) {}
  } else {
    // El usuario revocó el permiso desde el sistema: reflejarlo.
    S.pushEnabled = false;
    saveLS();
    pushEstadoRender();
  }
}
