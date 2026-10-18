'use strict';

// ═══════════════════════════════════════
// EXPORTIMPORT.JS — Exportar e importar JSON y backups
// ═══════════════════════════════════════

// ─── EXPORT ──────────────────────────────────
function dlJSON(data, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)], {type:'application/json'}));
  a.download = name;
  a.click();
}

function expCurrent() {
  syncFromUI();
  const {total} = calcTotals();
  dlJSON({
    _type: 'presupuesto_individual',
    _schemaVersion: APP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    quoteNumber: S.quoteNumber,
    clientName: S.clientName,
    currency: S.currency,
    total,
    snapshot: snapshotSinConfig(JSON.parse(JSON.stringify(S))),
    photos: buildPhotoMap(S)
  }, `presupuesto-${S.quoteNumber}.json`);
  toast('Presupuesto exportado', 'ok');
}

function expHistory() {
  const history = getH();
  dlJSON({
    _type: 'historial_presupuestos',
    _schemaVersion: APP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    history: history,
    photos: buildPhotoMap.apply(null, history.map(e => e && e.snapshot))
  }, 'historial-presupuestos.json');
  toast('Historial exportado', 'ok');
}

// Arma el objeto de backup completo (todas las DBs en localStorage).
// Lo usan tanto la exportación a archivo como la copia a Google Drive.
function buildBackupObject() {
  const phrases = {
    desc: (typeof getPhrasesDB === 'function') ? getPhrasesDB('desc') : [],
    obs:  (typeof getPhrasesDB === 'function') ? getPhrasesDB('obs')  : [],
    pay:  (typeof getPhrasesDB === 'function') ? getPhrasesDB('pay')  : [],
  };
  // Facturación: registro de facturas + tope anual configurado. Viven en sus
  // propias claves de localStorage (pq_facturas / pq_tope_anual). Sin esto, un
  // restore en un teléfono nuevo perdía todo el control de monotributo.
  // El tope se guarda como el valor crudo (o null si nunca se personalizó),
  // para no fijar el default como si fuera elegido por el usuario.
  const facturas = (typeof getFacturas === 'function') ? getFacturas() : [];
  let tope = null;
  try { tope = localStorage.getItem(TOPE_KEY); } catch(_){}

  // Fotos (v4): ahora viven en IndexedDB y los ítems solo guardan su ID. Para
  // que las fotos sobrevivan a un cambio de teléfono, el backup incluye el
  // dataURL de cada foto referenciada por el estado o el historial. Así, al
  // restaurar en otro dispositivo, las fotos vuelven a IndexedDB.
  const history = getH();
  const photos = buildPhotoMap.apply(null, [S].concat(history.map(e => e && e.snapshot)));

  return {
    _type: 'backup_completo',
    _version: 4,
    _schemaVersion: APP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    state: JSON.parse(JSON.stringify(S)),
    history: history,
    clients: getClientDB(),
    species: getSpeciesDB(),
    services: (typeof getServicesDB === 'function') ? getServicesDB() : [],
    servicesPinned: (typeof getPinnedServices === 'function') ? getPinnedServices() : [],
    // Tarifas propias (lo que el usuario cobra cuando trabaja para un colega).
    // Las escribió él y sin ellas el alta rápida de colaboraciones arranca
    // vacía en el teléfono nuevo: va al backup.
    misServicios: (typeof getMisServicios === 'function') ? getMisServicios() : [],
    phrases: phrases,
    facturas: facturas,
    tope: tope,
    reciboSeq: (function(){ try { return localStorage.getItem(RECIBO_SEQ_KEY); } catch(_) { return null; } })(),
    notes: (typeof getNotes === 'function') ? getNotes() : [],
    // Id del calendario "Presupuestos AR" (si se sincroniza con Google Calendar):
    // así un restore en otro teléfono reusa el mismo calendario en vez de crear
    // uno nuevo y duplicar eventos.
    gcalId: (function(){ try { return localStorage.getItem(LS.GCAL_ID); } catch(_) { return null; } })(),
    // Bitácora del centro de notificaciones (avisos recientes + acciones con
    // "Deshacer"): viaja en el backup para no perder el historial al cambiar de
    // dispositivo. Es opcional; un backup viejo sin esto no rompe nada.
    notifLog: (typeof getNotifLog === 'function') ? getNotifLog() : [],
    // "Mis estilos" (v247): los estilos que el usuario guardó con nombre.
    estilos: (typeof getEstilos === 'function') ? getEstilos() : [],
    // Config de seguimiento comercial: días, estados que disparan y las TRES
    // plantillas de WhatsApp que el usuario redactó (envío, seguimiento y
    // recontacto). Sin esto, al cambiar de teléfono los mensajes con los que le
    // habla a sus clientes volvían al texto de fábrica — y se enteraba recién
    // al mandar uno.
    followup: (typeof getFollowupCfg === 'function') ? getFollowupCfg() : null,
    photos: photos
  };
}

// ─── QUÉ SE GUARDA Y QUÉ NO (lista canónica) ─────────────────
// Cada vez que se agrega una clave de localStorage hay que decidir a cuál de
// las dos listas pertenece. Ya pasó dos veces que una clave nueva se sumara al
// backup y otra quedara afuera sin querer (pq_followup estuvo afuera hasta
// v177). Ante la duda: si el usuario la escribió o la configuró, VA.
//
// VA AL BACKUP (datos y configuración del usuario):
//   pq_s (estado) · pq_h (historial) · pq_clients · pq_species · pq_services
//   pq_services_pinned · pq_mis_servicios · pq_frases_* (+ pq_phrases_seeded) · pq_facturas
//   pq_tope_anual · pq_recibo_seq · pq_agenda_notes · pq_notif_log · pq_estilos
//   pq_followup · pq_gcal_id · fotos (IndexedDB, vía buildPhotoMap)
//
// NO VA (preferencias de UI, caches y estado propio del dispositivo):
//   pq_theme · pq_cal_view · pq_hist_avisos · pq_onboarded · pq_last_backup · pq_estilo_oferta
//   pq_day_alert_seen · pq_notif_seen (qué avisos ya viste acá) · pq_clima + pq_clima_warn (cache
//   del pronóstico, se rebaja solo) · pq_push_device_id (identifica ESTE
//   equipo) · pq_gdrive_* y pq_gcal_on/last/email (conexión de este equipo)
//   · pq_gdrive_tok / pq_gcal_tok (tokens: nunca salen del dispositivo)

function expBackup() {
  syncFromUI();
  dlJSON(buildBackupObject(), 'backup-presupuestopro.json');
  // Registramos la fecha del backup para no volver a molestar con el
  // recordatorio durante un tiempo (ver checkBackupReminder()).
  try { localStorage.setItem(LS.LAST_BACKUP, today()); } catch(_) {}
  toast('Backup completo exportado', 'ok');
}

// ─── IMPORT ──────────────────────────────────
function handleImport(e) {
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onerror = () => toast('No se pudo leer el archivo.', 'err', 5000);
  r.onload = ev => {
    let data;
    try { data = JSON.parse(ev.target.result); }
    catch(err) { toast('El archivo no es un JSON válido.', 'err', 5000); return; }
    if (!data || typeof data !== 'object') {
      toast('El archivo no tiene un formato reconocible.', 'err', 5000); return;
    }
    showImpOpts(data);
  };
  r.readAsText(f);
}

// El objeto importado (ya parseado) queda en esta variable de módulo en vez
// de serializarse DENTRO de los atributos onclick de los botones. Inyectar el
// JSON en onclick='...' permitía romper el atributo con una comilla simple en
// cualquier campo del archivo → XSS al abrir un .json ajeno (y los backups se
// intercambian entre colegas). Los handlers de import leen de acá.
let _pendingImport = null;

// Normaliza el archivo importado según su tipo. Se hace UNA vez acá, al
// mostrar las opciones, para que los cuatro handlers de import (impIndividual,
// impToHistory, impHistCombine, impHistReplace) trabajen siempre sobre datos ya
// validados y no haya que acordarse en cada uno.
function sanitizeImport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const type = data._type;
  if (type === 'backup_completo') {
    const b = sanitizeBackup(data);
    if (b) b._type = type;
    return b;
  }
  if (type === 'historial_presupuestos') {
    return { _type: type, history: sanitizeHistory(data.history), photos: data.photos };
  }
  if (type === 'presupuesto_individual') {
    return {
      _type: type,
      quoteNumber: sanStr(data.quoteNumber, 60),
      clientName:  sanStr(data.clientName, 200),
      currency:    sanEnum(data.currency, ['ARS','USD','EUR'], 'ARS'),
      total:       sanNum(data.total),
      snapshot:    data.snapshot ? sanitizeStateObj(data.snapshot) : null,
      photos:      data.photos,
    };
  }
  return { _type: type };   // tipo no reconocido: la UI ya lo informa
}

function showImpOpts(data) {
  const opts = document.getElementById('imp-opts'); if(!opts) return;
  const type = data._type || 'desconocido';
  _pendingImport = sanitizeImport(data);
  let h = `<div class="msec"><h4>Tipo: <code>${esc(type)}</code></h4>`;

  if(type==='presupuesto_individual'){
    h += `<p style="font-size:12px;color:var(--muted);margin-bottom:10px">#${esc(data.quoteNumber||'?')} — ${esc(data.clientName||'?')}</p>`;
    h += `<button class="btn btn-p btn-bl" onclick="impIndividual()">${icon('clipboard')} Cargar en el editor</button>`;
    h += `<button class="btn btn-s btn-bl" onclick="impToHistory()">${icon('book')} Agregar al historial</button>`;
  } else if(type==='historial_presupuestos'){
    h += `<p style="font-size:12px;color:var(--muted);margin-bottom:10px">${(data.history||[]).length} presupuestos.</p>`;
    h += `<button class="btn btn-p btn-bl" onclick="impHistCombine()">${icon('plus')} Combinar con historial actual</button>`;
    h += `<button class="btn btn-s btn-bl" onclick="impHistReplace()">${icon('refresh')} Reemplazar historial actual</button>`;
  } else if(type==='backup_completo'){
    h += `<p style="font-size:12px;color:var(--muted);margin-bottom:10px">Backup del ${esc((data.exportedAt||'').slice(0,10))}.</p>`;
    h += `<button class="btn btn-p btn-bl" onclick="impBackup()">${icon('refresh')} Restaurar backup completo</button>`;
  } else {
    h += `<p style="font-size:12px;color:var(--red)">Tipo no reconocido.</p>`;
  }

  opts.innerHTML = h + '</div>';
}

function impIndividual() {
  const d = _pendingImport;
  if(!d) return;
  if (d.photos) restorePhotosFromBackup(d.photos);
  if(d.snapshot){
    // Igual que loadFromHistory: no descartar el borrador en curso sin
    // guardarlo antes de pisar el editor con el presupuesto importado.
    if (S.quoteNumber && S.quoteNumber !== (d.snapshot.quoteNumber || '')) autoSaveToHistory();
    // Igual que loadFromHistory: el archivo trae el presupuesto, no la
    // configuración de la empresa de quien lo exportó (ver CFG_GLOBAL_FIELDS).
    assignSnapshot(S, migrateState(d.snapshot));
    if(!S.estItems)       S.estItems = [];
    if(!S.estObservations) S.estObservations = '';
    if(S.surcharge===undefined) S.surcharge = 0;
    if (!Array.isArray(S.itemsB)) S.itemsB = [];
    normalizeRiskData();
    migrateInlinePhotosToIDB(S);
    activeScenario = 'A';
    noSync=true; restoreUI(); noSync=false;
    calcExpiry(); renderItems(); renderEstItems(); renderRiskDefects();
    applyMode(currentMode());
    updateTotalsBar(); updateSurchargeUI(); switchTab('editor');
  }
  closeModal();
  toast('Presupuesto cargado en el editor', 'ok');
}

function impToHistory() {
  const d = _pendingImport;
  if(!d) return;
  if (d.photos) restorePhotosFromBackup(d.photos);
  const h = getH();
  h.unshift({
    id: Date.now(),
    savedAt: new Date().toISOString(),
    quoteNumber: d.quoteNumber,
    clientName: d.clientName,
    currency: d.currency,
    total: d.total,
    itemCount: (d.snapshot?.items||[]).length,
    snapshot: snapshotSinConfig(d.snapshot),
    _type: 'presupuesto_individual'
  });
  setH(h);
  renderHistory();
  toast('Presupuesto agregado al historial', 'ok');
  closeModal();
}

function impHistCombine() {
  const d = _pendingImport;
  if(!d) return;
  if (d.photos) restorePhotosFromBackup(d.photos);
  const importedList = d.history || [];
  const localList    = getH();

  // ─── CÓMO SE COMBINA ───
  // El número de presupuesto es la identidad DENTRO de un dispositivo, pero la
  // numeración es local (mkQN sobre S.numNext): dos equipos generan "2026-0042"
  // para clientes distintos sin saberlo. Y el `id` tampoco identifica: cada
  // re-guardado le asigna un Date.now() nuevo.
  //
  // Antes se deduplicaba solo por número y se descartaba el más viejo, así que
  // combinar el historial de la tablet con el del celular BORRABA presupuestos
  // distintos que compartían número — en silencio, y el toast decía
  // alegremente "1 actualizados desde el import". Además, las entradas sin
  // número se perdían enteras (no entraban al Map del que salía el resultado).
  //
  // Ahora: mismo número + mismo cliente = el mismo presupuesto → gana el más
  // reciente. Mismo número + cliente distinto = presupuestos DISTINTOS → se
  // conservan los dos y se avisa cuáles quedaron con número repetido, para que
  // el usuario decida. Nada se descarta en silencio.
  const clave = e => (e.quoteNumber || '') + '\u0000' + ((e.clientName || '').trim().toLowerCase());
  const porClave = new Map();
  const sinNumero = [];
  let conflicts = 0, newImported = 0;

  const meter = (e, esImportado) => {
    if (!e || typeof e !== 'object') return;
    // Sin número no se puede emparejar con nada: se conserva tal cual.
    if (!e.quoteNumber) { sinNumero.push(e); return; }
    const k = clave(e);
    const prev = porClave.get(k);
    if (!prev) {
      porClave.set(k, e);
      if (esImportado) newImported++;
      return;
    }
    // Mismo presupuesto en los dos lados: gana el guardado más recientemente.
    // Empate o sin fecha → gana el local (refleja los cambios del usuario acá).
    const tPrev = prev.savedAt || '';
    const tNew  = e.savedAt   || '';
    if (esImportado && tNew > tPrev) { porClave.set(k, e); conflicts++; }
  };

  localList.forEach(e => meter(e, false));
  importedList.forEach(e => meter(e, true));

  const merged = sinNumero.concat(Array.from(porClave.values()))
    .sort((a,b) => (b.savedAt||'').localeCompare(a.savedAt||''));

  // Los ids se usan para buscar y para los handlers de la UI: si dos entradas
  // quedaran con el mismo id, tocar una abriría la otra. Se reasignan los
  // repetidos (el id no es identidad estable acá, ver arriba).
  const vistos = new Set();
  let seq = 0;
  merged.forEach(e => {
    if (e.id == null || vistos.has(e.id)) e.id = Date.now() + (++seq);
    vistos.add(e.id);
  });

  // Números que quedaron repetidos entre presupuestos distintos.
  const cuentaNum = {};
  merged.forEach(e => { if (e.quoteNumber) cuentaNum[e.quoteNumber] = (cuentaNum[e.quoteNumber] || 0) + 1; });
  const repetidos = Object.keys(cuentaNum).filter(n => cuentaNum[n] > 1).sort();

  setH(merged);
  renderHistory();
  let msg = `Historial combinado: ${merged.length} presupuestos`
    + (newImported ? ` (${newImported} nuevos)` : '')
    + (conflicts   ? ` · ${conflicts} actualizados desde el import` : '');
  toast(msg, 'ok', 5000);
  // Aviso aparte y más largo: es lo único que requiere una decisión del usuario.
  if (repetidos.length) {
    const lista = repetidos.slice(0, 4).join(', ') + (repetidos.length > 4 ? ` y ${repetidos.length - 4} más` : '');
    toast(`Ojo: quedaron ${repetidos.length} número(s) repetidos con clientes distintos (${lista}). No se borró nada — renumerá el que corresponda desde el historial.`, 'info', 11000);
  }
  closeModal();
}

async function impHistReplace() {
  const d = _pendingImport;
  if(!d) return;
  const ok = await confirmDlg('Reemplazar historial', '¿Reemplazar el historial actual con el importado?', 'Reemplazar', 'btn-d');
  if(!ok) return;
  if (d.photos) restorePhotosFromBackup(d.photos);
  setH(d.history||[]);
  renderHistory();
  toast('Historial reemplazado', 'info');
  closeModal();
}

// Aplica un objeto de backup ya parseado al estado y a las DBs. Reutilizada
// por la restauración desde archivo y desde Google Drive. Devuelve true si OK.
// Claves de localStorage que toca una restauración. Se usan para la copia de
// seguridad previa (rollback) — ver applyBackupObject.
function _restoreTouchedKeys() {
  const keys = [LS.STATE, LS.HISTORY, LS.NOTES, LS.NOTIF_LOG, LS.GCAL_ID, LS.FOLLOWUP];
  [typeof CLIENT_KEY !== 'undefined' && CLIENT_KEY,
   typeof SPECIES_KEY !== 'undefined' && SPECIES_KEY,
   typeof SERVICES_KEY !== 'undefined' && SERVICES_KEY,
   typeof SERVICES_PINNED_KEY !== 'undefined' && SERVICES_PINNED_KEY,
   typeof MISSVC_KEY !== 'undefined' && MISSVC_KEY,
   typeof PHRASE_SEEDED_KEY !== 'undefined' && PHRASE_SEEDED_KEY,
   typeof FACT_KEY !== 'undefined' && FACT_KEY,
   typeof TOPE_KEY !== 'undefined' && TOPE_KEY,
   typeof RECIBO_SEQ_KEY !== 'undefined' && RECIBO_SEQ_KEY].forEach(k => { if (k) keys.push(k); });
  if (typeof PHRASE_KEYS !== 'undefined') ['desc','obs','pay'].forEach(c => { if (PHRASE_KEYS[c]) keys.push(PHRASE_KEYS[c]); });
  return keys;
}
function _snapshotKeys(keys) {
  const snap = {};
  keys.forEach(k => { try { snap[k] = localStorage.getItem(k); } catch(_) { snap[k] = null; } });
  return snap;
}
function _restoreKeys(snap) {
  Object.keys(snap).forEach(k => {
    try { if (snap[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, snap[k]); } catch(_){}
  });
}

// Aplica un backup en DOS FASES:
//   1. Validar y normalizar TODO en memoria (sanitizeBackup). Si el archivo no
//      es reconocible, se sale sin haber tocado nada.
//   2. Escribir. Antes se guarda una copia de las claves afectadas y, si algo
//      falla a mitad de camino, se revierte.
// Antes esto era un solo try con ~18 escrituras seguidas: si fallaba en la
// número 10, el historial y los clientes ya se habían pisado pero facturación y
// notas no, y el usuario veía "el backup no tiene un formato válido" — o sea,
// creía que no había pasado nada cuando ya había perdido sus datos.
function applyBackupObject(raw) {
  const d = (typeof sanitizeBackup === 'function') ? sanitizeBackup(raw) : raw;
  if (!d || typeof d !== 'object') return false;
  const _snap = _snapshotKeys(_restoreTouchedKeys());
  const _prevS = JSON.parse(JSON.stringify(S));
  try {
    // Fotos (v4+): repoblar IndexedDB/caché ANTES de renderizar, para que el
    // estado e historial restaurados encuentren sus fotos por ID.
    if (d.photos && typeof restorePhotosFromBackup === 'function') restorePhotosFromBackup(d.photos);
    if(d.state)   Object.assign(S, migrateState(d.state));
    if(d.history) setH(d.history);
    if(d.clients) safeSetLS(CLIENT_KEY, JSON.stringify(d.clients));
    if(d.species) safeSetLS(SPECIES_KEY, JSON.stringify(d.species));
    // v2: servicios + pineados + frases (compatibilidad: si vienen ausentes
    // mantenemos lo que haya en localStorage actualmente — no se rompe nada).
    if(d.services && typeof SERVICES_KEY !== 'undefined') {
      safeSetLS(SERVICES_KEY, JSON.stringify(d.services));
    }
    if(d.servicesPinned && typeof SERVICES_PINNED_KEY !== 'undefined') {
      safeSetLS(SERVICES_PINNED_KEY, JSON.stringify(d.servicesPinned));
    }
    // Tarifas propias (backups viejos no las traen → se deja lo que haya acá).
    if(Array.isArray(d.misServicios) && typeof MISSVC_KEY !== 'undefined') {
      safeSetLS(MISSVC_KEY, JSON.stringify(d.misServicios));
    }
    if(d.phrases && typeof PHRASE_KEYS !== 'undefined') {
      // Marcar como "sembrado" para que no se vuelvan a sembrar los defaults
      // encima de las frases del backup. Si el backup trae lista vacía,
      // respetar igual: el usuario decidió tener 0 frases en esa categoría.
      if (Array.isArray(d.phrases.desc)) safeSetLS(PHRASE_KEYS.desc, JSON.stringify(d.phrases.desc));
      if (Array.isArray(d.phrases.obs))  safeSetLS(PHRASE_KEYS.obs,  JSON.stringify(d.phrases.obs));
      if (Array.isArray(d.phrases.pay))  safeSetLS(PHRASE_KEYS.pay,  JSON.stringify(d.phrases.pay));
      safeSetLS(PHRASE_SEEDED_KEY, '1');
    }
    // v3: facturación (facturas + tope anual). Compatibilidad: backups viejos
    // no traen estas claves → se deja intacto lo que haya en localStorage.
    if (Array.isArray(d.facturas) && typeof FACT_KEY !== 'undefined') {
      safeSetLS(FACT_KEY, JSON.stringify(d.facturas));
    }
    if (d.tope != null && typeof TOPE_KEY !== 'undefined') {
      safeSetLS(TOPE_KEY, String(d.tope));
    }
    // Contador de recibos: restaurarlo evita repetir números en otro equipo.
    // Nunca lo bajamos (el máximo manda si acá ya se emitieron recibos).
    if (d.reciboSeq != null && typeof RECIBO_SEQ_KEY !== 'undefined') {
      const cur = parseInt(localStorage.getItem(RECIBO_SEQ_KEY)||'0',10) || 0;
      const inc = parseInt(d.reciboSeq,10) || 0;
      if (inc > cur) safeSetLS(RECIBO_SEQ_KEY, String(inc));
    }
    // Notas/recordatorios manuales de la Agenda (calendario). Backups viejos no
    // los traen → se deja intacto lo que haya en localStorage.
    if (Array.isArray(d.notes)) safeSetLS(LS.NOTES, JSON.stringify(d.notes));
    // Id del calendario "Presupuestos AR": reusar el mismo tras un restore para
    // no duplicar el calendario ni sus eventos.
    if (d.gcalId) { try { localStorage.setItem(LS.GCAL_ID, d.gcalId); } catch(_){} }
    // Bitácora del centro de notificaciones (opcional en backups viejos).
    if (Array.isArray(d.notifLog)) { try { localStorage.setItem(LS.NOTIF_LOG, JSON.stringify(d.notifLog.slice(0, NOTIF_CAP))); } catch(_){} }
    // Mis estilos (opcional en backups viejos: sin la clave, quedan los de acá).
    if (Array.isArray(d.estilos)) { try { localStorage.setItem(LS.ESTILOS, JSON.stringify(sanitizeEstilos(d.estilos))); } catch(_){} }
    // Config de seguimiento + plantillas de WhatsApp (opcional en backups
    // viejos → se deja intacto lo que haya en el dispositivo).
    if (d.followup && typeof setFollowupCfg === 'function') setFollowupCfg(d.followup);
    if (!Array.isArray(S.itemsB)) S.itemsB = [];
    normalizeRiskData();
    // Backups viejos (v3-) traían las fotos embebidas en el estado: migrarlas.
    migrateInlinePhotosToIDB(S);
    activeScenario = 'A';
    noSync=true; restoreUI(); noSync=false;
    calcExpiry(); renderItems(); renderEstItems(); renderRiskDefects();
    applyMode(currentMode());
    renderHistory(); updateTotalsBar(); updateSurchargeUI();
    if (typeof updateCollapsibleCounts === 'function') updateCollapsibleCounts();
    if (typeof renderQuickServices === 'function') renderQuickServices();
    // Refrescar la pestaña de facturación (totales, lista y campo de tope) por
    // si se restauraron facturas/tope. factInit lee elementos del panel oculto
    // sin problema (sus guardas salen temprano si no están en el DOM).
    if (typeof factInit === 'function') factInit();
    return true;
  } catch(e) {
    // Rollback: dejar el dispositivo como estaba antes de intentar restaurar.
    console.error('Error al aplicar backup — revirtiendo', e);
    try {
      _restoreKeys(_snap);
      S = _prevS;
      noSync=true; restoreUI(); noSync=false;
      calcExpiry(); renderItems(); renderEstItems(); renderRiskDefects();
      applyMode(currentMode());
      renderHistory(); updateTotalsBar(); updateSurchargeUI();
      if (typeof factInit === 'function') factInit();
    } catch(e2) { console.error('Falló también el rollback', e2); }
    return false;
  }
}

async function impBackup() {
  const d = _pendingImport;
  if(!d) { toast('El backup está dañado o incompleto.', 'err', 5000); return; }
  const ok = await confirmDlg('Restaurar backup', '¿Restaurar el backup completo? Esto reemplazará el estado actual, historial, clientes, especies, servicios y frases.', 'Restaurar', 'btn-d');
  if(!ok) return;
  if (applyBackupObject(d)) { toast('Backup restaurado correctamente', 'ok'); closeModal(); }
  else { toast('⚠️ El backup no tiene un formato válido.', 'err', 5000); }
}
