'use strict';

// ═══════════════════════════════════════
// GCAL.JS — Sincronización de la Agenda con Google Calendar
// ═══════════════════════════════════════
// Empuja (una sola vía: app → Google) TODO lo de la pestaña Agenda a un
// calendario propio "Presupuestos AR". Reusa el OAuth de Google (mismo
// CLIENT_ID y la misma loadGIS() que Drive), con su PROPIO token client y el
// scope mínimo `calendar.app.created` (solo toca calendarios que la app creó;
// nunca ve el resto de la agenda del usuario). Corre igual que el auto-backup
// de Drive: al abrir la app y (con retardo) tras cada cambio, solo con señal.
//
// Idempotencia: el calendario es enteramente de la app. Cada evento lleva
// extendedProperties.private.pqKey (clave estable, misma lógica que el UID del
// .ics) y pqHash (hash del contenido). En cada sync listamos lo que hay,
// reconstruimos el estado desde el servidor (auto-reparable entre dispositivos)
// y hacemos el diff: insertar / patch (si cambió el hash) / borrar (lo que ya
// no está en la agenda). NUNCA se pide token al abrir (regla de CLAUDE.md):
// las syncs de fondo usan prompt:'none' (silenciosas).
const GCAL = {
  // `calendar.app.created` para crear/manejar el calendario propio; `openid
  // email` para recordar la cuenta y renovar el token sin mostrar el selector.
  SCOPE: 'https://www.googleapis.com/auth/calendar.app.created openid email',
  CAL_NAME: 'Presupuestos AR',
  _tokenClient: null, _token: null, _tokenExp: 0, _pending: null, _timer: null,
  _dirty: false, _syncing: false,
};

function gcalConfigured(){ return !!(GDRIVE.CLIENT_ID && GDRIVE.CLIENT_ID.indexOf('.apps.googleusercontent.com') > 0); }
function gcalConnected(){ try { return localStorage.getItem(LS.GCAL_ON) === '1'; } catch(_){ return false; } }

// Token client propio (independiente del de Drive). Reusa loadGIS().
async function gcalEnsureClient(){
  await loadGIS();
  if (!GCAL._tokenClient) {
    GCAL._tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GDRIVE.CLIENT_ID,
      scope: GCAL.SCOPE,
      callback: (resp) => {
        const p = GCAL._pending; GCAL._pending = null;
        if (resp && resp.access_token) {
          // Google devuelve token IGUAL si el usuario desmarca la casilla del
          // permiso de Calendar: el token viene sin `calendar.app.created` y
          // recién fallaría después, con un 403 incomprensible. Lo cortamos acá
          // con un error propio para poder decirle qué le faltó tildar.
          const granted = ((resp.scope || '') + '');
          if (granted && granted.indexOf('calendar.app.created') < 0) {
            if (p) p.reject(new Error('scope_no_otorgado'));
            return;
          }
          GCAL._token = resp.access_token;
          GCAL._tokenExp = Date.now() + ((resp.expires_in || 3500) * 1000);
          _gTokSave(LS.GCAL_TOK, GCAL._token, GCAL._tokenExp);
          if (p) p.resolve(resp.access_token);
        } else if (p) {
          // error_description trae el motivo real de Google (p. ej. qué scope
          // rechazó): se conserva para poder mostrarlo, no solo el código.
          const err = new Error((resp && resp.error) || 'sin_token');
          err.detail = (resp && (resp.error_description || resp.error_uri || '')) + '';
          p.reject(err);
        }
      },
      // Errores no-OAuth (popup cerrado, etc.): sin esto el Promise quedaría
      // colgado y el botón "Conectar" no volvería nunca.
      error_callback: (err) => {
        const p = GCAL._pending; GCAL._pending = null;
        const e2 = new Error((err && (err.type || err.message)) || 'popup');
        e2.detail = (err && err.type && err.message && err.message !== err.type) ? (err.message + '') : '';
        if (p) p.reject(e2);
      },
    });
  }
}
// Igual que gdriveGetToken: silencioso por defecto (hint = cuenta recordada),
// interactivo solo desde el botón "Conectar".
function gcalGetToken(opts){
  opts = opts || {};
  const interactive = !!opts.interactive;
  // `noHint`: pedir como si fuera la PRIMERA vez, sin la cuenta recordada.
  // Ver _gcalTokenParaConectar(): el login_hint puede envenenar la ventana.
  const noHint = !!opts.noHint;
  return new Promise((resolve, reject) => {
    // Rehidratar el token desde el cache persistente (sobrevive la recarga de
    // la pestaña): reapertura rápida = sin ida-y-vuelta a Google.
    if (!GCAL._token) { const c = _gTokLoad(LS.GCAL_TOK); if (c) { GCAL._token = c.t; GCAL._tokenExp = c.e; } }
    if (GCAL._token && Date.now() < GCAL._tokenExp - 60000) { resolve(GCAL._token); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { reject(new Error('offline')); return; }
    gcalEnsureClient().then(() => {
      GCAL._pending = { resolve, reject };
      let hint = '';
      if (!noHint) { try { hint = localStorage.getItem(LS.GCAL_EMAIL) || localStorage.getItem(LS.GDRIVE_EMAIL) || ''; } catch(_){} }
      const req = {};
      if (hint) req.login_hint = hint;         // le decimos a Google qué cuenta usar
      // Interactivo (botón "Conectar"): forzar la pantalla de consentimiento.
      // A diferencia de Drive, acá el scope de Calendar suele ser NUEVO aunque
      // ya haya un `hint` (heredado de Drive): con prompt:'' Google lo rechaza
      // sin mostrar UI (access_denied). 'consent' garantiza que aparezca el
      // pedido de permiso la primera vez. Las renovaciones de fondo siguen
      // silenciosas (prompt:'none') porque el scope ya quedó otorgado.
      if (interactive) req.prompt = 'consent';
      else req.prompt = 'none';                // fondo: nunca mostrar UI
      GCAL._tokenClient.requestAccessToken(req);
    }).catch(reject);
  });
}
// Recuerda el email de la cuenta conectada (para renovar callado). Requiere el
// scope `email`. Nunca rompe si falla.
async function gcalRememberEmail(token){
  try {
    const r = await netFetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.email) { try { localStorage.setItem(LS.GCAL_EMAIL, j.email); } catch(_){} }
  } catch(_){}
}

// Error de una llamada a la Calendar API con el status y el cuerpo de Google
// adjuntos. Sin esto, _gcalErrMsg() no puede distinguir "falta habilitar la
// API" de "falta el permiso" y cae siempre en el mensaje genérico.
async function _gcalHttpErr(r, what){
  let detail = ''; try { detail = await r.text(); } catch(_){}
  const err = new Error(what + ' ' + r.status);
  err.status = r.status; err.detail = detail;
  return err;
}

// Zona horaria del dispositivo: la del calendario que se crea y la de los
// eventos con horario. Fallback a Córdoba si el navegador no la da.
function _gcalTz(){
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Argentina/Cordoba'; }
  catch(_){ return 'America/Argentina/Cordoba'; }
}
// Asegura el calendario "Presupuestos AR": valida el id guardado, y si no
// existe (o se borró) lo crea. Devuelve el calendarId.
async function gcalEnsureCalendar(token){
  let id = ''; try { id = localStorage.getItem(LS.GCAL_ID) || ''; } catch(_){}
  if (id) {
    const r = await netFetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(id),
      { headers: { Authorization: 'Bearer ' + token } });
    // El calendario ya existía: igual hay que asegurarse UNA VEZ de que esté
    // tildado en la cuenta. Los que se crearon antes de este arreglo pueden
    // llevar meses recibiendo eventos que el usuario nunca vio.
    if (r.ok) { await _gcalEnsureVisible(token, id, true); return id; }
    if (r.status !== 404 && r.status !== 410) throw await _gcalHttpErr(r, 'cal get');
    // 404/410: el calendario ya no existe → recrear abajo.
  }
  const tz = _gcalTz();
  const r = await netFetch('https://www.googleapis.com/calendar/v3/calendars', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: GCAL.CAL_NAME, description: 'Agenda de Presupuestos AR: trabajos, recontactos, vencimientos, seguimientos y notas. Se sincroniza automáticamente desde la app.', timeZone: tz }),
  });
  // El detalle da el mensaje útil (API sin habilitar, permiso faltante, etc.).
  if (!r.ok) throw await _gcalHttpErr(r, 'cal create');
  const j = await r.json();
  id = j.id;
  try { localStorage.setItem(LS.GCAL_ID, id); } catch(_){}
  await _gcalEnsureVisible(token, id);
  return id;
}

// Deja el calendario MARCADO COMO VISIBLE en la cuenta (`selected`). Un
// calendario creado por API entra a la lista de la cuenta, pero puede quedar
// destildado: entonces los eventos existen y el usuario no ve ninguno, que se
// parece mucho a "la app no sincroniza". Best-effort: si la cuenta no deja
// tocar la calendarList, la sync sigue igual (los eventos ya están).
// OJO: en la app de Android hay además un interruptor POR DISPOSITIVO
// (☰ → Configuración → la cuenta → "Presupuestos AR" → Sincronización) que
// ninguna API puede activar; por eso la sección de config lo explica.
// `soloUnaVez`: no repetir el pedido en cada sync (queda anotado en LS.GCAL_VIS
// al primer éxito). El botón "Sincronizar ahora" lo llama SIN esa bandera: es el
// camino de reparación cuando el usuario dice "no veo nada en Google".
async function _gcalEnsureVisible(token, calId, soloUnaVez){
  if (soloUnaVez) { try { if (localStorage.getItem(LS.GCAL_VIS) === '1') return; } catch(_){} }
  try {
    const r = await netFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList/' + encodeURIComponent(calId),
      { method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected: true, hidden: false }) });
    if (r && r.ok) { try { localStorage.setItem(LS.GCAL_VIS, '1'); } catch(_){} }
  } catch(_){ /* no es crítico: los eventos se sincronizan igual */ }
}

// timeMin (RFC3339) = medianoche local de hoy → solo lo que viene.
function _gcalTimeMin(){
  const t = today().split('-');
  return new Date(+t[0], +t[1] - 1, +t[2]).toISOString();
}
// Hash corto (djb2) del contenido, para detectar cambios sin comparar campos.
function _gcalHash(s){
  let h = 5381; s = String(s);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
// Lista los eventos actuales del calendario (paginado) → { pqKey: {id, hash} }.
async function gcalListEvents(token, calId){
  const map = {};
  let pageToken = '';
  do {
    const u = new URL('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calId) + '/events');
    u.searchParams.set('maxResults', '2500');
    u.searchParams.set('showDeleted', 'false');
    u.searchParams.set('singleEvents', 'true');
    u.searchParams.set('timeMin', _gcalTimeMin());
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const r = await netFetch(u.toString(), { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw await _gcalHttpErr(r, 'events list');
    const j = await r.json();
    (j.items || []).forEach(it => {
      const pv = (it.extendedProperties && it.extendedProperties.private) || {};
      if (pv.pqKey) map[pv.pqKey] = { id: it.id, hash: pv.pqHash || '' };
    });
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return map;
}

// Arma summary / description / location de un evento de la agenda según el tipo,
// reusando la misma info que el .ics y el botón de Google Calendar per-evento.
function _gcalEvInfo(ev, e){
  let summary = '', loc = '';
  const desc = [];
  if (ev.tipo === 'trabajo')      summary = 'Trabajo: ' + ev.title + (ev.sub ? ' — ' + ev.sub : '');
  else if (ev.tipo === 'visita')  summary = 'Visita: ' + ev.title;
  else if (ev.tipo === 'nota')    summary = 'Nota: ' + ev.title;
  else                            summary = ev.title;   // "Llamar a X" / "Vence X" / "Seguimiento X"
  if (e) {
    const snap = e.snapshot || {};
    if (ev.tipo === 'recontacto' && e.recontactoNota) desc.push('Nota: ' + e.recontactoNota);
    if (e.total > 0) desc.push('Presupuesto ' + (e.quoteNumber || '') + ': ' + fmtM(e.total, e.currency || 'ARS'));
    if (snap.clientContact) desc.push('Contacto: ' + snap.clientContact);
    if (ev.tipo === 'trabajo') { const a = (snap.workAddress || snap.workMapLink || '').trim(); if (a) loc = a; }
  } else if (ev.sub) {
    desc.push(ev.sub);   // nota: nombre del contacto vinculado
  }
  if (ev.tel) desc.push('Tel: ' + ev.tel);
  if (ev.mapUrl) { desc.push('Ubicación: ' + ev.mapUrl); if (!loc) loc = ev.mapUrl; }
  return { summary, desc: desc.join('\n'), loc };
}
// Construye el conjunto DESEADO desde calBuildIndex(): { pqKey: {body, hash} }.
// Incluye todos los tipos, solo de hoy en adelante; notas/visitas hechas no van.
function _gcalBuildDesired(){
  const idx = calBuildIndex();
  const hoy = today();
  const h = (typeof getH === 'function') ? getH() : [];
  const byId = {}; h.forEach(e => { if (e && e.id != null) byId[e.id] = e; });
  const desired = {};
  const seen = {};
  Object.keys(idx).sort().forEach(iso => {
    if (iso < hoy) return;
    idx[iso].forEach(ev => {
      if ((ev.tipo === 'nota' || ev.tipo === 'visita') && ev.done) return;
      const dstart = iso.replace(/-/g, '');
      const dendISO = _calAddDays(iso, 1);
      const info = _gcalEvInfo(ev, ev.entryId != null ? byId[ev.entryId] : null);
      // Con hora → evento con horario (1 h); sin hora → día completo.
      const hora = ev.hora || '';
      const tz = _gcalTz();
      const fin = hora ? _calHoraMas(iso, hora, CAL_EV_MINS) : null;
      const start = hora ? { dateTime: iso + 'T' + hora + ':00', timeZone: tz } : { date: iso };
      const end   = hora ? { dateTime: fin.fecha + 'T' + fin.hora + ':00', timeZone: tz } : { date: dendISO };
      // La hora forma parte de la CLAVE, no solo del hash: un PATCH que cambia
      // un evento de día completo a uno con horario deja start.date y
      // start.dateTime conviviendo y Google lo rechaza. Con la hora en la clave,
      // poner o cambiar la hora se resuelve como borrar + insertar. Los eventos
      // sin hora conservan la clave (y el hash) de siempre: nada se re-escribe.
      let key = (ev.entryId != null ? 'e' + ev.entryId + '-' + ev.tipo : 'n' + (ev.noteId || '')) + '-' + dstart
        + (hora ? '-t' + hora.replace(':', '') : '');
      const rep = (seen[key] = (seen[key] || 0) + 1);
      const pqKey = key + (rep > 1 ? '-' + rep : '');
      const hash = _gcalHash(info.summary + '|' + info.desc + '|' + info.loc + '|' + iso + '|' + dendISO
        + (hora ? '|' + hora : ''));
      const body = { summary: info.summary, start: start, end: end,
        extendedProperties: { private: { pqKey: pqKey, pqHash: hash } } };
      if (info.desc) body.description = info.desc;
      if (info.loc)  body.location = info.loc;
      desired[pqKey] = { body, hash };
    });
  });
  return desired;
}

// Sincroniza: list → diff → insert/patch/delete. Best-effort y secuencial
// (serializa los pedidos, suave con la cuota).
async function gcalSync(){
  if (!gcalConfigured() || !gcalConnected()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (GCAL._syncing) return;
  GCAL._syncing = true;
  try {
    const token = await gcalGetToken();
    const calId = await gcalEnsureCalendar(token);
    const existing = await gcalListEvents(token, calId);
    const desired = _gcalBuildDesired();
    const base = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calId) + '/events';
    const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    let fallo = null;   // primer error de evento; se reporta al terminar la pasada
    // Insertar los nuevos y actualizar los que cambiaron.
    for (const pk of Object.keys(desired)) {
      const d = desired[pk], ex = existing[pk];
      if (!ex) {
        const r = await netFetch(base, { method: 'POST', headers: H, body: JSON.stringify(d.body) });
        if (!r.ok) { fallo = fallo || await _gcalHttpErr(r, 'event insert'); continue; }
      } else if (ex.hash !== d.hash) {
        const r = await netFetch(base + '/' + encodeURIComponent(ex.id), { method: 'PATCH', headers: H, body: JSON.stringify(d.body) });
        if (!r.ok) { fallo = fallo || await _gcalHttpErr(r, 'event patch'); continue; }
      }
    }
    // Borrar lo que ya no está en la agenda (nota borrada, fecha cambiada, etc.).
    for (const pk of Object.keys(existing)) {
      if (!desired[pk]) {
        await netFetch(base + '/' + encodeURIComponent(existing[pk].id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      }
    }
    // Un evento que no se pudo crear NO debe cortar la pasada: antes el primer
    // insert fallido tiraba y se salteaba todo lo que venía después, incluido
    // el borrado, así que la sync quedaba a medias (eventos nuevos sin crear y
    // viejos sin borrar). Ahora se intenta todo y recién al final se avisa.
    if (fallo) throw fallo;
    GCAL._dirty = false;
    try { localStorage.setItem(LS.GCAL_LAST, new Date().toISOString()); } catch(_){}
    // Cuántos eventos quedaron arriba. Es el dato que contesta la pregunta
    // "¿la app no los manda, o Google no me los muestra?": si acá dice 7 y en
    // el teléfono no se ve ninguno, el problema es la visibilidad del
    // calendario, no la sincronización.
    try { localStorage.setItem(LS.GCAL_N, String(Object.keys(desired).length)); } catch(_){}
  } finally { GCAL._syncing = false; }
}

// Espejo de gdriveAutoUpload para el calendario. Reusa _gcalErrMsg(), que ya
// traduce cada error de Google a algo que el usuario pueda accionar (permiso
// no dado, Calendar API sin habilitar, sesión vencida) — hasta ahora eso solo
// se usaba en el botón "Conectar" y el camino automático no lo aprovechaba.
function gcalAutoSync(){
  return _autoSync(GCAL, gcalSync, gcalInvalidateToken, gcalUpdateUI,
    (e) => '⚠️ La agenda no se está sincronizando con Google Calendar. ' + _gcalErrMsg(e));
}

// Sync automática con retardo tras cada cambio de agenda (espejo del auto-backup).
function scheduleGcalSync(){
  if (!gcalConfigured() || !gcalConnected()) return;
  GCAL._dirty = true;
  clearTimeout(GCAL._timer);
  GCAL._timer = setTimeout(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (typeof netPuedeAutoImportante === 'function' && !netPuedeAutoImportante()) return;   // ver scheduleGdriveBackup
    gcalAutoSync();
  }, 45000);
}

// ¿Corre como app instalada (manifest display:standalone) y no como pestaña?
// Cambia qué se le puede pedir al usuario: ahí el popup de Google no es viable.
function _esAppInstalada(){
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) return true;
    return window.navigator.standalone === true;   // iOS
  } catch(_){ return false; }
}

// Código técnico corto de lo que respondió Google (el mismo que muestra la
// ventana de permisos, o el `reason` de la API). Se agrega al final del
// mensaje: sin esto, diagnosticar desde el celular es adivinar — el mensaje
// lindo tapaba el único dato que distingue una causa de otra.
function _gcalErrCode(e){
  const msg = ((e && e.message) || '') + '';
  const detail = ((e && e.detail) || '') + '';
  let reason = '';
  if (detail) {
    try {
      const er = (JSON.parse(detail) || {}).error;
      if (er) {
        reason = (er.errors && er.errors[0] && er.errors[0].reason) || er.status || '';
        if (!reason && typeof er === 'string') reason = er;   // error=invalid_scope
      }
    } catch(_){ reason = detail.slice(0, 40); }
  }
  const code = (msg + (reason ? ' · ' + reason : '')).trim();
  return code.length > 90 ? code.slice(0, 90) + '…' : code;
}

// Botón "Conectar Google Calendar".
// Traduce un error de conexión/sync a un mensaje accionable (para el toast).
// Distingue: sin señal, permiso no otorgado / faltante, y API sin habilitar.
function _gcalErrMsg(e){
  const code = _gcalErrCode(e);
  const base = _gcalErrBase(e);
  return code && code !== 'offline' ? base + ' (Google dijo: ' + code + ')' : base;
}
function _gcalErrBase(e){
  const msg = ((e && e.message) || '') + '';
  const detail = ((e && e.detail) || '') + '';
  const status = e && e.status;
  if (msg === 'offline') return 'Sin conexión. Conectá cuando tengas señal.';
  // Ventana de Google: bloqueada o cerrada. No es un problema de permisos, así
  // que antes mandaba a revisar Google Cloud al pedo.
  if (/popup_failed_to_open|popup_blocked/i.test(msg)) {
    return 'El navegador bloqueó la ventana de Google. Permití las ventanas emergentes para este sitio y reintentá.';
  }
  if (/popup_closed|abort/i.test(msg)) {
    // OJO: `popup_closed` solo dice que la ventana se fue sin responder, no por
    // qué. Puede ser que Google mostrara adentro un error (la Calendar API sin
    // habilitar hace justo eso) o que en la app instalada el popup se abra
    // afuera de la ventana. Por eso el mensaje ofrece los dos caminos en vez de
    // afirmar una causa que no está probada.
    if (_esAppInstalada()) {
      return 'La ventana de Google se cerró sin responder. Si adentro apareció un error, revisá que la Calendar API esté habilitada; si ni llegó a mostrarse, probá conectar desde Chrome (mismo link) y volvé a la app.';
    }
    return 'Se cerró la ventana de Google antes de terminar. Reintentá y aceptá el acceso.';
  }
  // El usuario llegó a la pantalla de permisos pero no tildó Calendar.
  if (/scope_no_otorgado/i.test(msg)) {
    return 'Faltó tildar el permiso de Calendar en la pantalla de Google. Reintentá y marcá la casilla del calendario.';
  }
  // invalid_scope = Google no acepta el permiso PEDIDO. Con el scope ya cargado
  // en la pantalla de consentimiento, lo que queda es la Calendar API sin
  // habilitar en el proyecto: el permiso existe pero no corresponde a ninguna
  // API activa, así que la autorización se rechaza antes de preguntarte nada.
  if (/invalid_scope/i.test(msg)) {
    return 'Google rechazó el permiso de Calendar. Casi siempre es la Google Calendar API sin habilitar en el proyecto (el permiso en la pantalla de consentimiento no alcanza).';
  }
  // Errores del token de Google (GIS): permiso no dado o scope no configurado.
  if (/access_denied|invalid_client|unauthorized_client|consent|scope|sin_token|interaction_required/i.test(msg)) {
    return 'Google no dio el permiso de Calendar. Si tu app está en modo Prueba, agregá tu cuenta como usuario de prueba; si no, revisá el permiso "calendar.app.created" en la pantalla de consentimiento.';
  }
  // Calendar API sin habilitar en el proyecto (403 con accessNotConfigured).
  if (status === 403 && /accessNotConfigured|has not been used|is disabled|SERVICE_DISABLED|Calendar API/i.test(detail)) {
    return 'Falta habilitar la Google Calendar API en tu proyecto de Google Cloud. Habilitala, esperá unos minutos y reintentá.';
  }
  // 403 por token sin el scope: conectó antes de agregar el permiso.
  if (status === 403 && /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient/i.test(detail)) {
    return 'El acceso de Google no incluye el permiso de Calendar. Desconectá, volvé a conectar y aceptá el permiso del calendario.';
  }
  if (status === 403) return 'Google rechazó el acceso (403). Revisá que la Calendar API esté habilitada y el permiso "calendar.app.created" agregado.';
  if (status === 401) return 'La sesión de Google expiró. Reintentá conectar.';
  if (status === 404) return 'No se encontró el calendario en tu cuenta. Desconectá y volvé a conectar para recrearlo.';
  if (status === 429 || status === 503) return 'Google está limitando los pedidos. Se reintenta solo más tarde.';
  return 'No se pudo conectar con Google Calendar. Revisá la Calendar API y el permiso en Google Cloud.';
}

// Escalera de intentos del botón "Conectar":
//   1) SIN ventana: si la cuenta ya tiene el permiso vigente, no se abre nada.
//   2) con ventana y la cuenta recordada (login_hint).
//   3) con ventana SIN cuenta recordada — el camino de "primera vez".
//
// El paso 3 es el que faltaba. Si la cuenta recordada ya no tiene el permiso
// vigente, mandar `login_hint` hace que la ventana de Google se cierre sola sin
// mostrar nada: solo llega `popup_closed`, que parece un problema de permisos y
// no lo es. Desconectar y volver a conectar lo destrababa porque borraba el
// email recordado (LS.*_EMAIL) y el pedido salía limpio; ahora eso se hace solo,
// sin perder la conexión ni obligar a desconectar.
async function _gcalTokenParaConectar(){
  try { return await gcalGetToken({ interactive: false }); } catch(_){}
  let hint = '';
  try { hint = localStorage.getItem(LS.GCAL_EMAIL) || localStorage.getItem(LS.GDRIVE_EMAIL) || ''; } catch(_){}
  try {
    return await gcalGetToken({ interactive: true });
  } catch(e){
    if (!hint || !_gEsFalloDeVentana(e)) throw e;
    gcalInvalidateToken();
    return await gcalGetToken({ interactive: true, noHint: true });
  }
}

async function gcalConnect(){
  if (!gcalConfigured()) { toast('Google Calendar no está configurado todavía.', 'info', 5000); return; }
  // Librería fría (falló la precarga, o se abrió sin señal): pedir el token
  // ahora significa bajar el script primero y que el navegador cierre el popup
  // por llegar tarde. Mejor calentarla y pedir un segundo toque, que sí abre la
  // ventana dentro del gesto.
  if (!(window.google && google.accounts && google.accounts.oauth2)) {
    toast('Preparando Google… volvé a tocar "Conectar" en un segundo.', 'info', 4000);
    try { await gcalEnsureClient(); }
    catch(e){ GCAL._lastErr = e; gcalUpdateUI(); toast(_gcalErrMsg(e), 'err', 9000); }
    return;
  }
  try {
    toast('Conectando con Google Calendar…', 'info', 3000);
    const token = await _gcalTokenParaConectar();
    try { localStorage.setItem(LS.GCAL_ON, '1'); } catch(_){}
    await gcalRememberEmail(token);
    await gcalSync();
    // Espejo de gdriveConnect: reconectar limpia la racha de fallos y el aviso,
    // si no la sección quedaba en rojo hasta la siguiente sync automática.
    _syncOk(GCAL); GCAL._warned = false;
    toast('Conectado. Tu agenda se sincroniza con el calendario "Presupuestos AR".', 'ok', 5000);
  } catch(e){
    console.error('gcalConnect', e);
    try { localStorage.removeItem(LS.GCAL_ON); } catch(_){}
    // Se guarda para que gcalUpdateUI lo deje escrito en la sección: un toast de
    // 9 s no alcanza para leer (ni fotografiar) el motivo.
    GCAL._lastErr = e;
    // Si lo que falló fue la VENTANA (no un permiso), queda el camino por
    // redirección, que no depende de ventanas emergentes.
    if (_gEsFalloDeVentana(e)) { gcalUpdateUI(); gcalOfrecerRedireccion(e); return; }
    toast(_gcalErrMsg(e), 'err', 9000);
  }
  gcalUpdateUI();
}

// ─── Conexión por REDIRECCIÓN (sin ventana emergente) ───────────
// El flujo normal de Google abre un popup, y hay dispositivos donde ese popup
// muere sin responder (`popup_closed`) tanto en la app instalada como en una
// pestaña del navegador. La redirección no usa ventanas: la app navega a
// Google en la misma pestaña y Google devuelve el permiso en el fragmento de
// la URL al volver.
//
// Requiere que la URL de retorno esté registrada como "URI de redireccionamiento
// autorizado" en el Client ID (ver docs/gcal-redirect.md). Si no lo está, Google
// muestra su propio error a pantalla completa — que igual es más útil que un
// popup que desaparece.
function _gEsFalloDeVentana(e){
  const m = ((e && e.message) || '') + '';
  return /popup|abort/i.test(m);
}
function gcalRedirectURI(){ return location.origin + '/'; }

async function gcalOfrecerRedireccion(e){
  const ok = await confirmDlg(
    'Conectar sin ventana emergente',
    'La ventana de Google no llegó a responder (' + _gcalErrCode(e) + '). Puedo llevarte a Google en esta misma pestaña para que des el permiso; al terminar volvés acá solo.',
    'Ir a Google', 'btn-p');
  if (ok) gcalConnectRedirect();
}

function gcalConnectRedirect(){
  if (!gcalConfigured()) return;
  // Que no quede nada sin guardar antes de irnos de la página.
  try { if (typeof syncFromUI === 'function') syncFromUI(); saveLS(); } catch(_){}
  const state = 'gcal_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
  try { sessionStorage.setItem('pq_gcal_state', state); } catch(_){}
  let hint = '';
  try { hint = localStorage.getItem(LS.GCAL_EMAIL) || localStorage.getItem(LS.GDRIVE_EMAIL) || ''; } catch(_){}
  const p = new URLSearchParams({
    client_id: GDRIVE.CLIENT_ID,
    redirect_uri: gcalRedirectURI(),
    response_type: 'token',            // flujo implícito: sin client_secret
    scope: GCAL.SCOPE,
    include_granted_scopes: 'true',
    state: state,
    prompt: 'consent',
  });
  if (hint) p.set('login_hint', hint);
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
}

// Al volver de Google: el token (o el error) viene en el fragmento de la URL.
// Devuelve true si el fragmento era nuestro, para que el init no siga de largo.
function gcalHandleRedirectReturn(){
  const h = (location.hash || '').replace(/^#/, '');
  if (!h || (h.indexOf('access_token') < 0 && h.indexOf('error') < 0)) return false;
  const q = new URLSearchParams(h);
  let saved = '';
  try { saved = sessionStorage.getItem('pq_gcal_state') || ''; } catch(_){}
  if (!saved || q.get('state') !== saved) return false;   // no lo pedimos nosotros
  try { sessionStorage.removeItem('pq_gcal_state'); } catch(_){}
  // Sacar el token de la barra de direcciones cuanto antes (no queda en el
  // historial ni se comparte al copiar el link).
  try { history.replaceState(null, '', location.pathname + location.search); } catch(_){}

  const err = q.get('error');
  if (err) {
    const e = new Error(err);
    e.detail = q.get('error_description') || '';
    GCAL._lastErr = e; gcalUpdateUI();
    toast(_gcalErrMsg(e), 'err', 9000);
    return true;
  }
  const token = q.get('access_token');
  if (!token) return true;
  const scope = q.get('scope') || '';
  if (scope && scope.indexOf('calendar.app.created') < 0) {
    const e = new Error('scope_no_otorgado');
    GCAL._lastErr = e; gcalUpdateUI();
    toast(_gcalErrMsg(e), 'err', 9000);
    return true;
  }
  GCAL._token = token;
  GCAL._tokenExp = Date.now() + ((+q.get('expires_in') || 3500) * 1000);
  _gTokSave(LS.GCAL_TOK, GCAL._token, GCAL._tokenExp);
  try { localStorage.setItem(LS.GCAL_ON, '1'); } catch(_){}
  (async () => {
    try {
      await gcalRememberEmail(token);
      await gcalSync();
      _syncOk(GCAL); GCAL._warned = false;
      toast('Conectado. Tu agenda se sincroniza con el calendario "Presupuestos AR".', 'ok', 5000);
    } catch(e2){
      console.error('gcalRedirectReturn', e2);
      GCAL._lastErr = e2;
      toast(_gcalErrMsg(e2), 'err', 9000);
    }
    gcalUpdateUI();
  })();
  return true;
}
function gcalDisconnect(){
  try { if (GCAL._token && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(GCAL._token, ()=>{}); } catch(_){}
  GCAL._token = null; GCAL._tokenExp = 0;
  _gTokClear(LS.GCAL_TOK);
  try { localStorage.removeItem(LS.GCAL_ON); } catch(_){}
  gcalUpdateUI();
  toast('Google Calendar desconectado. El calendario "Presupuestos AR" queda en tu cuenta.', 'info', 5000);
}
async function gcalSyncNow(){
  if (!gcalConnected()) return;
  try {
    toast('Sincronizando con Google Calendar…', 'info', 2500);
    // El token PRIMERO y con la escalera interactiva: este botón es un gesto del
    // usuario, así que puede abrir la ventana de Google. Sin esto, el botón de
    // reparar no podía reparar el fallo más común —la sesión de Google que dejó
    // de renovarse callada—: gcalSync() pide el token en modo silencioso y lo
    // único que lograba era repetir el mismo error.
    await _gcalTokenParaConectar();
    await gcalSync();
    // El botón manual es también el botón de "arreglalo": re-marca el
    // calendario como visible por si quedó destildado en la cuenta.
    try {
      const calId = localStorage.getItem(LS.GCAL_ID) || '';
      if (calId) await _gcalEnsureVisible(await gcalGetToken(), calId);
    } catch(_){}
    _syncOk(GCAL); GCAL._warned = false;
    gcalUpdateUI();
    let n = 0; try { n = +(localStorage.getItem(LS.GCAL_N) || 0) || 0; } catch(_){}
    toast(n ? `Agenda sincronizada ✓ · ${n} evento${n > 1 ? 's' : ''} en "Presupuestos AR"` : 'Agenda sincronizada ✓',
      'ok', n ? 4000 : 2500);
  } catch(e){ console.error('gcalSyncNow', e); GCAL._lastErr = e; gcalUpdateUI(); toast(_gcalErrMsg(e), 'err', 9000); }
}
// Al arrancar: si está conectado y hay señal, sync silenciosa. Nunca pide token
// con UI (si no renueva callado, queda el botón "Conectar").
function gcalInitOnLoad(){
  if (!gcalConfigured()) { gcalUpdateUI(); return; }
  gcalUpdateUI();
  if (!gcalConnected()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  gcalGetToken({ interactive: false })
    .then(() => gcalAutoSync())
    // Si el token NO renueva callado, la sync no corre nunca y hasta acá eso se
    // tragaba en silencio: la sección seguía diciendo "Conectado ✓" con la fecha
    // de la última vez que anduvo, y la agenda podía estar parada días sin que
    // nada lo dijera (es el mismo escenario que ya nos pasó con Drive). Ahora
    // cuenta como fallo de sincronización: al segundo, la sección se marca en
    // rojo y ofrece "Reconectar", que es lo único que lo arregla.
    .catch((e) => { _syncFail(GCAL, e); gcalUpdateUI(); });
}
// Refresca la sección de Calendar (pestaña Empresa).
function gcalUpdateUI(){
  const sec = document.getElementById('gcal-section'); if (!sec) return;
  if (!gcalConfigured()) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  const on = gcalConnected();
  const cBtn = document.getElementById('gcal-connect');
  const sBtn = document.getElementById('gcal-sync');
  const dBtn = document.getElementById('gcal-disconnect');
  const status = document.getElementById('gcal-status');
  if (sBtn) sBtn.style.display = on ? '' : 'none';
  if (dBtn) dBtn.style.display = on ? '' : 'none';
  const fallando = on && (GCAL._fails || 0) >= SYNC_FAIL_UMBRAL;
  // "Hace más de un día que no sincroniza" vale como caída aunque no haya
  // quedado ningún error registrado (el contador vive en memoria y se reinicia
  // en cada apertura). Es lo que destapa una agenda parada hace una semana.
  let _cLast = ''; try { _cLast = localStorage.getItem(LS.GCAL_LAST) || ''; } catch(_){}
  const viejo = on && !!_cLast && (Date.now() - new Date(_cLast).getTime()) > 24 * 3600 * 1000;
  const roto = fallando || viejo;
  sec.classList.toggle('is-fail', roto);
  if (status) {
    if (!on) {
      // Si el último intento de conectar falló, el motivo queda a la vista (con
      // el código de Google) en vez de irse con el toast.
      status.textContent = GCAL._lastErr
        ? ('⚠️ No se pudo conectar. ' + _gcalErrMsg(GCAL._lastErr))
        : 'Creá los eventos de tu agenda automáticamente en un calendario propio de Google ("Presupuestos AR"). Sincroniza con la app abierta y con señal.';
    } else {
      let last = ''; try { last = localStorage.getItem(LS.GCAL_LAST) || ''; } catch(_){}
      if (fallando) {
        status.textContent = (last ? '⚠️ Sin sincronizar desde el ' + _fmtBackupDate(last) + '. ' : '⚠️ La agenda no se está sincronizando. ')
          + _gcalErrMsg(GCAL._lastErr);
      } else {
        // Cuántos eventos dejó arriba la última pasada: sin ese número, "no veo
        // nada en Google" no se puede diagnosticar (¿no se mandaron, o no se
        // muestran?). Incluye TODO lo de la Agenda: trabajos, visitas, notas,
        // recontactos, vencimientos y seguimientos de hoy en adelante.
        let n = 0; try { n = +(localStorage.getItem(LS.GCAL_N) || 0) || 0; } catch(_){}
        const cuantos = n ? ` · ${n} evento${n > 1 ? 's' : ''} sincronizado${n > 1 ? 's' : ''}` : '';
        // `viejo` (arriba) es la red de seguridad para las caídas que no dejan
        // error: decirlo es mejor que un "Conectado ✓" sobre una agenda parada.
        status.textContent = last
          ? ((viejo ? '⚠️ ' : 'Conectado ✓ · ') + 'Última sincronización: ' + _fmtBackupDate(last) + cuantos
             + (viejo ? '. ' + _gSesionVencidaMsg() : ''))
          : 'Conectado ✓ · Tu agenda se sincroniza con el calendario "Presupuestos AR".';
      }
    }
  }
  // Ayuda del caso más confuso: los eventos SÍ están en Google pero la app de
  // Android no muestra el calendario nuevo hasta que se lo activa a mano (es un
  // interruptor del dispositivo, ninguna API lo puede tocar).
  const vis = document.getElementById('gcal-visibilidad');
  if (vis) vis.style.display = on ? '' : 'none';
  if (cBtn) {
    cBtn.style.display = (!on || roto) ? '' : 'none';
    cBtn.textContent = roto ? 'Reconectar' : 'Conectar Google Calendar';
  }
}
