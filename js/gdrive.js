'use strict';

// ═══════════════════════════════════════
// GDRIVE.JS — Copia de seguridad automática en Google Drive
// ═══════════════════════════════════════
// Guarda un único archivo de backup en la carpeta privada de la app
// (scope drive.appdata): el usuario solo ve sus propios datos, y nadie
// más accede. Sube automáticamente mientras la app está abierta.
//
// ⚠️ Para activarlo: pegá tu OAuth Client ID de Google en CLIENT_ID.
//    Mientras esté vacío, la función queda inactiva y no afecta nada.
const GDRIVE = {
  CLIENT_ID: '1019348269608-tns51f3pknm6r6ce8effhhrikcukou8k.apps.googleusercontent.com',  // OAuth Client ID de Google (público; el secret NO se usa ni se guarda)
  SCOPE: 'https://www.googleapis.com/auth/drive.appdata',
  FILE: 'presupuesto-backup.json',
  _gisPromise: null, _tokenClient: null,
  _token: null, _tokenExp: 0, _pending: null, _timer: null, _dirty: false,
};

function gdriveConfigured(){ return !!(GDRIVE.CLIENT_ID && GDRIVE.CLIENT_ID.indexOf('.apps.googleusercontent.com') > 0); }
function gdriveConnected(){ try { return localStorage.getItem(LS.GDRIVE_ON) === '1'; } catch(_){ return false; } }

// ─── Cache persistente del access token de Google ───
// El token de acceso solo vivía en memoria (GDRIVE._token / GCAL._token), así
// que CADA recarga de la pestaña (lo que hace el navegador del celular al
// descartar una PWA/pestaña de fondo) lo perdía y había que volver a pedírselo
// a Google — ese ida-y-vuelta es lo que se notaba como "recargar la cuenta" al
// reabrir. Persistimos el token con su vencimiento para que una reapertura
// rápida lo reuse y se saltee por completo el pedido a Google.
// El token es de acceso (no refresh), de vida corta (~1 h), propio y guardado
// en el dispositivo del usuario (sin login). Se borra al desconectar.
function _gTokSave(key, token, exp){
  try { localStorage.setItem(key, JSON.stringify({ t: token, e: exp })); } catch(_){}
}
function _gTokLoad(key){
  try {
    const raw = localStorage.getItem(key); if (!raw) return null;
    const o = JSON.parse(raw);
    // Mismo margen que la comprobación en memoria (60 s): si le queda menos de
    // un minuto de vida, lo ignoramos y se renovará callado.
    if (o && o.t && o.e && Date.now() < o.e - 60000) return o;
  } catch(_){}
  return null;
}
function _gTokClear(key){ try { localStorage.removeItem(key); } catch(_){} }

// ─── Reintento silencioso ante token inválido (401) ───
// Un token reusado desde el cache podría estar revocado en el servidor (raro:
// solo si el usuario quitó el acceso desde su cuenta de Google). En ese caso la
// llamada a la API lanza Error('… 401'). Detectamos ese caso, invalidamos el
// token (memoria + cache) y reintentamos UNA vez: getToken pedirá uno nuevo con
// prompt:'none' (callado), sin que el usuario note nada.
function _gIsAuthErr(e){ return /\b401\b/.test(String((e && e.message) || e || '')); }
function gdriveInvalidateToken(){ GDRIVE._token = null; GDRIVE._tokenExp = 0; _gTokClear(LS.GDRIVE_TOK); }
function gcalInvalidateToken(){ GCAL._token = null; GCAL._tokenExp = 0; _gTokClear(LS.GCAL_TOK); }
async function _gWithAuthRetry(invalidate, op){
  try { return await op(); }
  catch(e){ if (_gIsAuthErr(e)) { invalidate(); return await op(); } throw e; }
}

// Carga la librería de Google Identity Services (una sola vez).
function loadGIS(){
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (GDRIVE._gisPromise) return GDRIVE._gisPromise;
  GDRIVE._gisPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = () => res();
    s.onerror = () => { GDRIVE._gisPromise = null; rej(new Error('No se pudo cargar Google')); };
    document.head.appendChild(s);
  });
  return GDRIVE._gisPromise;
}

// Precarga la librería de Google al iniciar (nunca pide token: solo baja el
// script y arma los token clients).
//
// Por qué: los botones "Conectar" abren un popup, y el navegador solo lo deja
// abrir mientras dura el gesto del usuario. Si al tocar el botón todavía hay
// que bajar accounts.google.com/gsi/client por datos móviles, el popup llega
// tarde y Chrome lo cierra → error `popup_closed`, que parece un problema de
// permisos y no lo es. Los caminos de init cortan antes de cargar GIS (Drive
// si ya hay datos locales, Calendar si no está conectado), así que sin esto la
// primera conexión de Calendar arranca SIEMPRE con la librería fría.
function preloadGIS(){
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  // Con red lenta o caída no se precarga: es un script de ~90 KB de un tercero
  // que nadie pidió todavía. Si el usuario toca "Conectar", gcalConnect ya
  // sabe pedir un segundo toque mientras la librería llega.
  if (typeof netPuedeAuto === 'function' && !netPuedeAuto()) return;
  if (typeof gdriveConfigured === 'function' && !gdriveConfigured()) return;
  loadGIS().then(() => {
    // Armar los clients también es parte del costo del primer tap (initTokenClient
    // no muestra UI ni pide nada a Google).
    try { if (typeof gcalEnsureClient === 'function') gcalEnsureClient(); } catch(_){}
    try { if (typeof gdriveEnsureClient === 'function') gdriveEnsureClient(); } catch(_){}
  }).catch(() => { /* sin señal o Google caído: se reintenta al tocar Conectar */ });
}

async function gdriveEnsureClient(){
  await loadGIS();
  if (!GDRIVE._tokenClient) {
    GDRIVE._tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GDRIVE.CLIENT_ID,
      scope: GDRIVE.SCOPE,
      callback: (resp) => {
        const p = GDRIVE._pending; GDRIVE._pending = null;
        if (resp && resp.access_token) {
          GDRIVE._token = resp.access_token;
          GDRIVE._tokenExp = Date.now() + ((resp.expires_in || 3500) * 1000);
          _gTokSave(LS.GDRIVE_TOK, GDRIVE._token, GDRIVE._tokenExp);
          if (p) p.resolve(resp.access_token);
        } else if (p) { p.reject(new Error((resp && resp.error) || 'sin_token')); }
      },
    });
  }
}

// Obtiene un access token.
//  • Por defecto es SILENCIOSO: usa el email guardado como "hint" para que
//    Google renueve el token sin mostrar el selector de cuenta. Si no se
//    puede renovar callado, falla (rechaza) sin molestar al usuario.
//  • Con { interactive: true } (solo desde botones que el usuario tocó)
//    se permite mostrar el selector/consentimiento la primera vez.
function gdriveGetToken(opts){
  opts = opts || {};
  const interactive = !!opts.interactive;
  const noHint = !!opts.noHint;   // pedir como la primera vez (ver _gdriveTokenParaConectar)
  return new Promise((resolve, reject) => {
    // Rehidratar el token desde el cache persistente: si la pestaña se recargó
    // (memoria perdida) pero el token sigue vigente, lo reusamos sin ir a Google.
    if (!GDRIVE._token) { const c = _gTokLoad(LS.GDRIVE_TOK); if (c) { GDRIVE._token = c.t; GDRIVE._tokenExp = c.e; } }
    if (GDRIVE._token && Date.now() < GDRIVE._tokenExp - 60000) { resolve(GDRIVE._token); return; }
    // Sin señal no tiene sentido intentar (y rompería el modo offline).
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { reject(new Error('offline')); return; }
    gdriveEnsureClient().then(() => {
      GDRIVE._pending = { resolve, reject };
      let hint = ''; if (!noHint) { try { hint = localStorage.getItem(LS.GDRIVE_EMAIL) || ''; } catch(_){} }
      const req = {};
      // ⚠️ El campo de GIS es `login_hint`, NO `hint` (que Google ignora). Con
      // varias cuentas abiertas en el navegador, ESTO es lo que evita el
      // selector: le decimos a Google EXACTAMENTE qué cuenta usar.
      if (hint) req.login_hint = hint;
      if (interactive) {
        // Botón tocado por el usuario: si todavía no sabemos la cuenta (primera
        // conexión) dejamos aparecer el consentimiento/selector (única vez). Si
        // ya la sabemos, prompt vacío = renovación silenciosa sin volver a pedir.
        req.prompt = hint ? '' : 'consent';
      } else {
        // Llamadas en segundo plano (apertura, auto-backup): NUNCA mostrar UI.
        // Si no se puede renovar callado, falla y queda el botón "Conectar".
        req.prompt = 'none';
      }
      GDRIVE._tokenClient.requestAccessToken(req);
    }).catch(reject);
  });
}

// Lee el email de la cuenta conectada y lo guarda para usarlo como "hint"
// en las próximas renovaciones silenciosas. Funciona con el scope appdata
// (about.get) y nunca rompe si falla.
async function gdriveRememberEmail(token){
  try {
    const r = await netFetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return;
    const j = await r.json();
    const email = j && j.user && j.user.emailAddress;
    if (email) { try { localStorage.setItem(LS.GDRIVE_EMAIL, email); } catch(_){} }
  } catch(_){ /* sin email: seguimos sin hint */ }
}

async function gdriveFindFile(token){
  const q = encodeURIComponent(`name='${GDRIVE.FILE}'`);
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`;
  const r = await netFetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Drive list ' + r.status);
  const j = await r.json();
  return (j.files && j.files[0]) || null;
}

// Tiempo para SUBIR `bytes`. El backup lleva todas las fotos en base64 (15 a
// 60 MB con un historial real) y antes salía con el corte general de netFetch
// (12 s, 25 s en red lenta): el corte cuenta hasta que llega la respuesta, y en
// una subida eso es después de mandar el archivo entero. 15 MB en 12 s piden
// 10 Mbps de subida sostenidos; con datos móviles en el campo el backup se
// cortaba siempre y encima abría el cortacircuitos ("parece que no hay datos").
// Ahora: 30 s de base + 1 s cada 40 KB (≈ 320 kbps, una subida 3G floja), con
// techo de 10 minutos. La bajada no lo necesita: ahí la respuesta llega enseguida
// y el cuerpo se lee sin corte.
function gdriveTimeoutSubida(bytes) {
  return Math.min(10 * 60 * 1000, 30000 + Math.ceil((bytes || 0) / 40000) * 1000);
}

// ─── FOTOS APARTE EN DRIVE (v230) ─────────────────────────────
// Antes el backup era UN archivo con todo, fotos incluidas en base64 (unos
// 200 KB cada una): con 100 fotos, 20 MB que se volvían a subir enteros en
// cada cambio — un precio corregido o un estado cambiado. Diez cambios en un
// día, 200 MB del plan de datos, casi todo las mismas fotos de siempre.
//
// Ahora cada foto es un archivo propio en el appDataFolder
// (`pq-foto-<id>.jpg`, en binario: un 25 % menos que el base64) y se sube UNA
// sola vez: una foto no cambia nunca (una foto nueva es un ID nuevo, ver
// newPhotoId). El backup (GDRIVE.FILE) va sin fotos — `photos: {}` — y con la
// lista de las que usa en `_fotosAparte`. Cada copia sube el JSON (cientos de
// KB) más alguna foto nueva, si la hay.
//
// Reglas que no se pueden romper:
//   · Las fotos suben ANTES que el JSON. Si algo se corta en el medio, el
//     backup que está en Drive nunca nombra una foto que no esté arriba.
//   · La lista de fotos de Drive se pide FRESCA en cada copia (es un pedido
//     chico). Con dos teléfonos en la misma cuenta, si el otro borró una foto,
//     esta copia la vuelve a subir en vez de confiar en un recuerdo viejo.
//   · Borrar de Drive las que ya no se usan, solo DESPUÉS de subir el JSON, una
//     vez por sesión, y nunca si este equipo no tiene ninguna foto (un teléfono
//     recién instalado que todavía no restauró no puede vaciar el Drive).
//   · Restaurar acepta los dos formatos: el viejo (fotos adentro) y el nuevo.
//     Si alguna foto no baja (señal), no se aplica nada: se reintenta entero.
// "Exportar" a un archivo no cambia: sigue siendo un solo archivo con todo.
const GDRIVE_FOTO_PREF = 'pq-foto-';
const GDRIVE_FOTO_RE = /^pq-foto-(p_[A-Za-z0-9_]{1,60})\.(jpg|png|webp|gif)$/;
const GDRIVE_FOTO_ID_RE = /^p_[A-Za-z0-9_]{1,60}$/;

// Fotos que hay en Drive: Map id → fileId. Pagina (pageSize 1000).
async function gdriveListarFotos(token){
  const out = new Map();
  const q = encodeURIComponent(`name contains '${GDRIVE_FOTO_PREF}' and trashed=false`);
  let pageToken = '';
  for (let vuelta = 0; vuelta < 50; vuelta++) {
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&pageSize=1000`
      + `&fields=nextPageToken,files(id,name)` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const r = await netFetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Drive fotos ' + r.status);
    const j = await r.json();
    (j.files || []).forEach(f => {
      const m = GDRIVE_FOTO_RE.exec(f && f.name || '');
      if (m && f.id) out.set(m[1], f.id);
    });
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

// dataURL → { tipo, ext, bytes } (o null si no es una imagen en base64).
function _fotoBinaria(dataUrl){
  const m = /^data:(image\/(jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl || '');
  if (!m) return null;
  const tipo = m[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[tipo];
  const bin = atob(m[3].replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { tipo, ext, bytes };
}

async function gdriveSubirFoto(token, id, dataUrl){
  const f = _fotoBinaria(dataUrl);
  if (!f) return false;                       // no es una imagen válida: no se sube
  const boundary = '----pqf' + Date.now() + Math.random().toString(36).slice(2, 8);
  const meta = JSON.stringify({ name: GDRIVE_FOTO_PREF + id + '.' + f.ext, parents: ['appDataFolder'],
    appProperties: { pqFoto: id } });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: ${f.tipo}\r\n\r\n`, f.bytes, `\r\n--${boundary}--`,
  ]);
  const r = await netFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
    { timeout: gdriveTimeoutSubida(f.bytes.length), sinCorte: true });
  if (!r.ok) throw new Error('Drive foto ' + r.status);
  return true;
}

// Baja una foto de Drive y la devuelve como dataURL (o '' si no es imagen).
async function gdriveBajarFoto(token, fileId){
  const r = await netFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Drive foto get ' + r.status);
  const blob = await r.blob();
  const url = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
  // El tipo lo pone Drive según lo que se subió; si no dice imagen, se descarta.
  return /^data:image\/(jpeg|png|webp|gif);base64,/i.test(url) ? url : '';
}

// Sube el backup actual: primero las fotos que falten en Drive, después el JSON
// (sin fotos), y al final —una vez por sesión— borra las fotos que ya no usa.
async function gdriveUpload(){
  const token = await gdriveGetToken();
  const obj = buildBackupObject();
  const fotos = obj.photos || {};          // las que ESTE equipo tiene (id → dataURL)
  // Todas las que nombra algún presupuesto, las tenga o no este equipo. Es lo
  // que protege la limpieza: una foto que este teléfono no tiene (nunca se
  // restauró, o no bajó) pero que está en Drive y se usa, NO se borra.
  const nombradas = new Set();
  collectPhotoIds(S, nombradas);
  getH().forEach(e => collectPhotoIds(e && e.snapshot, nombradas));
  Object.keys(fotos).forEach(id => nombradas.add(id));

  // 1. Fotos que faltan arriba (lista fresca: ver la cabecera). Lo que no se
  //    puede guardar aparte —un ID con otro formato, una imagen que no es
  //    base64— sigue ADENTRO del JSON, como antes: nunca se pierde una foto.
  const remotas = await gdriveListarFotos(token);
  const aparte = [];
  obj.photos = {};
  let subidas = 0;
  for (const id of nombradas) {
    const ok = GDRIVE_FOTO_ID_RE.test(id);
    if (ok && remotas.has(id)) { aparte.push(id); continue; }
    if (!fotos[id]) continue;                // no está ni acá ni en Drive: nada que hacer
    if (ok && await gdriveSubirFoto(token, id, fotos[id])) { aparte.push(id); subidas++; }
    else obj.photos[id] = fotos[id];
  }
  obj._fotosAparte = aparte;

  // 2. El backup, ya sin fotos.
  const body = JSON.stringify(obj);
  const subida = { timeout: gdriveTimeoutSubida(body.length), sinCorte: true };
  const existing = await gdriveFindFile(token);
  if (existing) {
    const r = await netFetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body }, subida);
    if (!r.ok) throw new Error('Drive update ' + r.status);
  } else {
    const boundary = '----pq' + Date.now();
    const meta = JSON.stringify({ name: GDRIVE.FILE, parents: ['appDataFolder'] });
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const r = await netFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart }, subida);
    if (!r.ok) throw new Error('Drive create ' + r.status);
  }
  GDRIVE._dirty = false;
  GDRIVE._ultimaSubida = { json: body.length, fotos: subidas };
  try { localStorage.setItem(LS.GDRIVE_LAST, new Date().toISOString()); localStorage.setItem(LS.LAST_BACKUP, today()); } catch(_){}

  // 3. Limpieza: fotos de Drive que ya no usa ningún presupuesto. No es parte
  //    de la copia: si falla, la copia igual quedó hecha.
  if (!GDRIVE._limpiado && nombradas.size) {
    GDRIVE._limpiado = true;
    for (const [id, fileId] of remotas) {
      if (nombradas.has(id)) continue;
      try {
        await netFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
          { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      } catch (e) { console.warn('No se pudo borrar una foto vieja de Drive', e); }
    }
  }
}

// Baja a d.photos las fotos de `_fotosAparte` que este equipo no tenga. Si
// alguna no baja (señal), tira: la restauración se reintenta entera. Las que
// no están en Drive se saltean (no hay forma de recuperarlas; quedan como
// "foto no disponible", igual que antes).
async function gdriveBajarFotos(token, d){
  if (!d || !Array.isArray(d._fotosAparte)) return d;
  const ids = d._fotosAparte.filter(id => typeof id === 'string' && GDRIVE_FOTO_ID_RE.test(id)
    && !photoCache.has(id));
  if (!ids.length) return d;
  const remotas = await gdriveListarFotos(token);
  const fotos = (d.photos && typeof d.photos === 'object') ? d.photos : {};
  const cola = ids.filter(id => remotas.has(id) && !fotos[id]);
  // De a 4 a la vez: más rápido que una por una, sin ahogar una señal floja.
  let k = 0;
  const trabajador = async () => {
    while (k < cola.length) {
      const id = cola[k++];
      const url = await gdriveBajarFoto(token, remotas.get(id));
      if (url) fotos[id] = url;
    }
  };
  await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()]);
  d.photos = fotos;
  return d;
}

// Descarga el objeto de backup de Drive (o null si no hay). Con `conFotos`
// en false baja solo el JSON (para mirar si hay algo antes de preguntar).
async function gdriveDownload(opts){
  const token = await gdriveGetToken();
  const f = await gdriveFindFile(token);
  if (!f) return null;
  const r = await netFetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Drive get ' + r.status);
  const d = await r.json();
  if (opts && opts.conFotos === false) return d;
  return await gdriveBajarFotos(token, d);
}

// Botón "Conectar": inicia sesión y, si el equipo está vacío y hay copia
// en Drive, ofrece recuperarla (en vez de pisarla con datos vacíos).
// Misma escalera que en Calendar (ver _gcalTokenParaConectar): si la cuenta
// recordada ya no tiene el permiso vigente, el login_hint hace que la ventana
// de Google se cierre sola y solo llegue `popup_closed`. Reintentar sin la
// cuenta recordada es lo que destraba, y es exactamente lo que pasaba al
// desconectar y volver a conectar (gdriveDisconnect borra LS.GDRIVE_EMAIL).
async function _gdriveTokenParaConectar(){
  let hint = ''; try { hint = localStorage.getItem(LS.GDRIVE_EMAIL) || ''; } catch(_){}
  try {
    return await gdriveGetToken({ interactive: true });
  } catch(e){
    if (!hint || !_gEsFalloDeVentana(e)) throw e;
    gdriveInvalidateToken();
    return await gdriveGetToken({ interactive: true, noHint: true });
  }
}

async function gdriveConnect(){
  if (!gdriveConfigured()) { toast('Google Drive no está configurado todavía.', 'info', 5000); return; }
  try {
    toast('Conectando con Google Drive…', 'info', 3000);
    const token = await _gdriveTokenParaConectar();
    try { localStorage.setItem(LS.GDRIVE_ON, '1'); } catch(_){}
    await gdriveRememberEmail(token);  // recordamos la cuenta para renovar callado
    const localEmpty = !(((typeof getH==='function') ? getH() : []).length);
    let remote = null;
    // Primero solo el JSON: las fotos se bajan si el usuario acepta recuperar.
    try { remote = await gdriveDownload({ conFotos: false }); } catch(_){}
    if (remote && remote.history && remote.history.length && localEmpty) {
      const ok = await confirmDlg('Recuperar datos', 'Hay una copia en tu Google Drive. ¿Querés recuperarla en este dispositivo?', 'Recuperar', 'btn-p');
      if (ok) {
        toast('Bajando la copia y sus fotos…', 'info', 4000);
        await gdriveBajarFotos(token, remote);
        applyBackupObject(remote); toast('Datos recuperados desde Drive.', 'ok', 4000); gdriveUpdateUI(); return;
      }
    }
    await gdriveUpload();
    _syncOk(GDRIVE); GDRIVE._warned = false;   // reconectó: se limpia el aviso de caída
    toast('Conectado. Tus datos se copian automáticamente en tu Drive.', 'ok', 4000);
  } catch(e){
    console.error('gdriveConnect', e);
    try { localStorage.removeItem(LS.GDRIVE_ON); } catch(_){}
    toast('No se pudo conectar con Google Drive.', 'err', 5000);
  }
  gdriveUpdateUI();
}

function gdriveDisconnect(){
  try { if (GDRIVE._token && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(GDRIVE._token, ()=>{}); } catch(_){}
  GDRIVE._token = null; GDRIVE._tokenExp = 0;
  _gTokClear(LS.GDRIVE_TOK);
  try { localStorage.removeItem(LS.GDRIVE_ON); } catch(_){}
  try { localStorage.removeItem(LS.GDRIVE_EMAIL); } catch(_){}
  gdriveUpdateUI();
  toast('Google Drive desconectado.', 'info');
}

async function gdriveRestore(){
  if (!gdriveConfigured()) return;
  const ok = await confirmDlg('Restaurar desde Drive', '¿Traer la copia guardada en Google Drive? Reemplazará los datos actuales de este dispositivo.', 'Restaurar', 'btn-d');
  if (!ok) return;
  try {
    toast('Descargando copia…', 'info', 3000);
    const token = await gdriveGetToken({ interactive: true });
    await gdriveRememberEmail(token);
    const d = await gdriveDownload();
    if (!d) { toast('Todavía no hay ninguna copia en tu Drive.', 'info', 5000); return; }
    if (applyBackupObject(d)) toast('Datos restaurados desde Google Drive.', 'ok', 4000);
    else toast('La copia de Drive no tiene un formato válido.', 'err', 5000);
  } catch(e){ console.error('gdriveRestore', e); toast('No se pudo restaurar desde Drive.', 'err', 5000); }
  gdriveUpdateUI();
}

// ─── ESTADO DE FALLO DE LAS SINCRONIZACIONES AUTOMÁTICAS ───
// El auto-backup fallando en silencio es el peor escenario posible en una app
// sin backend: el usuario se cree respaldado durante meses y se entera recién
// cuando pierde el teléfono y va a recuperar. Antes, TODOS los caminos
// automáticos se tragaban el error (.catch(console.warn) o .catch(() => {})) y
// además no repintaban la UI al fallar, así que el cartel seguía diciendo
// "Conectado ✓ · Última copia: 12/03 09:41" con la fecha del último éxito.
//
// Ahora se cuentan los fallos SEGUIDOS. Un fallo aislado (se cortó la señal a
// mitad de la subida) no molesta a nadie; a partir del segundo se marca la
// sección en rojo y se avisa una vez por sesión. Cualquier éxito reinicia todo.
const SYNC_FAIL_UMBRAL = 2;

// Por qué se "desconecta solo" cada tanto. El navegador NO guarda un refresh
// token: el permiso de Google se renueva callado mientras el CONSENTIMIENTO
// siga vigente. Y si el proyecto de Google Cloud está en modo **Prueba**, ese
// consentimiento caduca a los 7 días — de ahí el patrón "anduvo una semana y
// paró", que se arregla reconectando (y vuelve a pasar 7 días después). La
// solución de fondo es del dueño del proyecto: publicar la app en la pantalla
// de consentimiento. Mientras tanto, al menos hay que DECIRLO en vez de
// mostrar "Conectado ✓" sobre una copia de hace una semana.
function _gSesionVencidaMsg(){
  return 'Parece que venció el permiso de Google (si el proyecto está en modo Prueba, caduca cada 7 días). Tocá "Reconectar".';
}

function _syncOk(mod){ mod._fails = 0; mod._lastErr = null; }
function _syncFail(mod, e){
  mod._fails = (mod._fails || 0) + 1;
  // Se guarda el ERROR entero, no solo su texto: _gcalErrMsg necesita `status`
  // y `detail` para distinguir "falta habilitar la Calendar API" de un 403
  // cualquiera, y esa diferencia es justamente lo accionable.
  mod._lastErr = e || null;
  return mod._fails;
}
// ¿Hay que gritar? Solo a partir del umbral y una sola vez por sesión, para no
// convertirlo en ruido que se aprende a ignorar.
function _syncDebeAvisar(mod){
  if ((mod._fails || 0) < SYNC_FAIL_UMBRAL) return false;
  if (mod._warned) return false;
  mod._warned = true;
  return true;
}

// Envoltorio común de las subidas/sincronizaciones automáticas: corre la
// operación, lleva la cuenta de fallos, repinta la UI SIEMPRE (falle o no) y
// avisa cuando corresponde. `msg(e)` traduce el error a algo accionable.
async function _autoSync(mod, op, invalidate, updateUI, msg){
  try {
    await _gWithAuthRetry(invalidate, op);
    const veniaFallando = (mod._fails || 0) > 0;
    _syncOk(mod);
    mod._warned = false;
    updateUI();
    if (veniaFallando && typeof toast === 'function') toast('✓ Sincronización restablecida', 'ok', 3000);
    return true;
  } catch(e) {
    _syncFail(mod, e);
    console.warn('sincronización automática falló', e);
    updateUI();
    if (_syncDebeAvisar(mod) && typeof toast === 'function') toast(msg(e), 'err', 8000);
    return false;
  }
}

// Una subida a la vez. Con el tiempo de subida según el tamaño
// (gdriveTimeoutSubida) una copia puede tardar minutos con datos móviles, y
// cada cambio programa otra a los 45 s: sin esto se pisaban dos o tres subidas
// de 20 MB por el mismo caño. Lo que cambie mientras tanto sale en una subida
// más, al terminar la que está en curso.
function gdriveAutoUpload(){
  if (GDRIVE._subiendo) { GDRIVE._repetir = true; return GDRIVE._subiendo; }
  GDRIVE._subiendo = _autoSync(GDRIVE, gdriveUpload, gdriveInvalidateToken, gdriveUpdateUI,
    () => '⚠️ No se está pudiendo guardar la copia en Google Drive. Entrá a Configuración → Datos → Copia de seguridad para reconectar.')
    .finally(() => {
      GDRIVE._subiendo = null;
      if (GDRIVE._repetir) { GDRIVE._repetir = false; scheduleGdriveBackup(); }
    });
  return GDRIVE._subiendo;
}

// Copia automática: se dispara (con retardo) tras cada cambio guardado.
function scheduleGdriveBackup(){
  if (!gdriveConfigured() || !gdriveConnected()) return;
  GDRIVE._dirty = true;
  clearTimeout(GDRIVE._timer);
  GDRIVE._timer = setTimeout(() => {
    // Sin señal: dejamos el cambio pendiente; se sube al volver la conexión.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    // Red lenta o caída: tampoco. El backup queda pendiente (_dirty) y sale
    // solo cuando la conexión se recupere — subirlo por un caño tapado deja
    // la app trabada y encima suele fallar igual. Ojo: el gate es el de lo
    // IMPORTANTE (ver netPuedeAutoImportante), no el del clima: el "Ahorro de
    // datos" prendido NO puede dejarte sin copia de seguridad.
    if (typeof netPuedeAutoImportante === 'function' && !netPuedeAutoImportante()) return;
    gdriveAutoUpload();
  }, 45000);
}

// Formatea una fecha ISO como "dd/mm HH:MM".
function _fmtBackupDate(iso){
  try { const d = new Date(iso); const p = n => String(n).padStart(2,'0');
    return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  catch(_){ return ''; }
}

// Refresca el estado visible de la sección de Drive (pestaña Empresa).
function gdriveUpdateUI(){
  const sec = document.getElementById('gdrive-section'); if (!sec) return;
  const status = document.getElementById('gdrive-status');
  const cBtn = document.getElementById('gdrive-connect');
  const rBtn = document.getElementById('gdrive-restore');
  const dBtn = document.getElementById('gdrive-disconnect');
  // Sin configurar: ocultamos toda la sección (no confundir a los colegas).
  if (!gdriveConfigured()) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  const on = gdriveConnected();
  if (rBtn) rBtn.style.display = on ? '' : 'none';
  if (dBtn) dBtn.style.display = on ? '' : 'none';
  const fallando = on && (GDRIVE._fails || 0) >= SYNC_FAIL_UMBRAL;   // el botón conectar/reconectar se resuelve abajo
  // "Hace más de un día que no hay copia" es tan grave como un error explícito,
  // y no depende del contador en memoria (que se reinicia en cada apertura).
  let _dLast = ''; try { _dLast = localStorage.getItem(LS.GDRIVE_LAST) || ''; } catch(_){}
  const viejo = on && !!_dLast && (Date.now() - new Date(_dLast).getTime()) > 24 * 3600 * 1000;
  const roto = fallando || viejo;
  sec.classList.toggle('is-fail', roto);
  if (status) {
    if (!on) {
      status.textContent = 'Guardá una copia automática de todos tus datos en tu Google Drive, para no perderlos si cambiás o perdés el teléfono.';
    } else {
      let last = ''; try { last = localStorage.getItem(LS.GDRIVE_LAST) || ''; } catch(_){}
      if (fallando) {
        // Decir DESDE CUÁNDO no hay copia es lo que permite dimensionar el
        // riesgo: no es lo mismo que falle hace 10 minutos que hace 4 meses.
        status.textContent = last
          ? ('⚠️ No se pudo copiar desde el ' + _fmtBackupDate(last) + '. Tocá "Reconectar" o exportá un backup a mano.')
          : '⚠️ No se está pudiendo copiar a Google Drive. Tocá "Reconectar" o exportá un backup a mano.';
      } else if (viejo) {
        // Red de seguridad: el contador de fallos vive en memoria y se reinicia
        // en cada apertura, así que "2 fallos SEGUIDOS" puede no alcanzarse
        // nunca si se hace un cambio por sesión — y la copia queda parada días
        // diciendo "Conectado ✓". La fecha de la última copia no miente.
        status.textContent = '⚠️ Última copia: ' + _fmtBackupDate(last) + '. ' + _gSesionVencidaMsg();
      } else {
        status.textContent = last
          ? ('Conectado ✓ · Última copia: ' + _fmtBackupDate(last))
          : 'Conectado ✓ · Tus datos se copian automáticamente en tu Google Drive.';
      }
    }
  }
  // Cuando está caído, ofrecer volver a conectar sin tener que desconectar
  // primero (gdriveConnect ya es idempotente y pide token interactivo).
  if (cBtn) {
    cBtn.style.display = (!on || roto) ? '' : 'none';
    cBtn.textContent = roto ? 'Reconectar' : 'Conectar Google Drive';
  }
}

// Al arrancar la app.
// IMPORTANTE: NO pedimos token al abrir. Si el dispositivo ya tiene datos
// (el caso normal: abrís la app para trabajar), no se intenta nada con Google
// → cero pedidos de "iniciar sesión", y el modo offline queda intacto.
//
// Solo cuando el equipo está VACÍO pero figura como conectado (típico de un
// teléfono nuevo o tras reinstalar) intentamos —en silencio y con la cuenta
// recordada como hint— recuperar la copia de Drive. Si no se puede renovar
// callado, no molestamos: queda el botón "Conectar" para hacerlo a mano.
function gdriveInitOnLoad(){
  if (!gdriveConfigured()) { gdriveUpdateUI(); return; }
  gdriveUpdateUI();
  if (!gdriveConnected()) return;
  const local = (typeof getH==='function') ? getH() : [];
  if (local.length) return;                 // ya hay datos locales: no tocar nada
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  gdriveGetToken({ interactive: false }).then(async (token) => {
    gdriveUpdateUI();
    try {
      await gdriveRememberEmail(token);
      const d = await _gWithAuthRetry(gdriveInvalidateToken, gdriveDownload);
      if (d && d.history && d.history.length) {
        const ok = await confirmDlg('Recuperar datos', 'Encontramos una copia en tu Google Drive. ¿Querés recuperar tus presupuestos en este dispositivo?', 'Recuperar', 'btn-p');
        if (ok && applyBackupObject(d)) toast('Datos recuperados desde Drive.', 'ok', 4000);
      }
    } catch(_){}
    // Mismo punto ciego que tenía Calendar: si el token no renueva callado, el
    // backup no corre y hasta acá la sección seguía diciendo "Conectado ✓" con
    // la fecha de la última copia buena. Ahora cuenta como fallo y se ve.
  }).catch((e) => { _syncFail(GDRIVE, e); gdriveUpdateUI(); });
}
