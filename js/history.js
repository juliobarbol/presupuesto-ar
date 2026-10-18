'use strict';

// ═══════════════════════════════════════
// HISTORY.JS — Historial de presupuestos, nuevo presupuesto
// ═══════════════════════════════════════

// ─── STORAGE ─────────────────────────────────
// Lectura defensiva: si lo guardado no es un array de entradas válidas (backup
// de otra herramienta, archivo editado a mano, versión futura), se normaliza
// acá en vez de propagar el problema. Antes, un `history` que no fuera array
// quedaba guardado y rompía la app en CADA arranque ("h is not iterable"):
// Historial y Agenda muertos, sin forma de recuperarse desde la app.
//
// CACHE: el historial se re-parseaba en CADA llamada, y un solo render del
// listado llama a getH() 9 veces (~5 ms cada una con 250 presupuestos, porque
// los snapshots son el 94% de los bytes). El calendario es peor: calBuildIndex()
// hace su propio getH() y se la invoca varias veces por render.
//
// El cache se valida contra el STRING guardado, no contra un flag: si el valor
// en disco es idéntico al que parseamos, devolvemos el mismo array. Así ninguna
// escritura directa a localStorage (las migraciones del arranque, por ejemplo)
// puede dejar el cache viejo, y no hay que acordarse de invalidarlo a mano.
// getItem de 1 MB es ~0 ms; parsearlo no.
//
// Se devuelve el MISMO array, no una copia: clonarlo cuesta 4× más que
// parsearlo (11,7 ms vs 3 ms medidos). Es seguro porque en toda la app el
// patrón es getH() → mutar → setH(); no hay ningún lugar que mute una entrada y
// descarte el cambio. Si algún día se agrega uno, tiene que llamar a setH() o
// trabajar sobre su propia copia.
let _hRawCache = null;
let _hArrCache = null;

function getH() {
  try {
    const raw = localStorage.getItem(LS.HISTORY) || localStorage.getItem(LS.HISTORY_LEGACY);
    if (_hArrCache && raw === _hRawCache) return _hArrCache;
    const parsed = JSON.parse(raw||'[]');
    if (Array.isArray(parsed)) { _hRawCache = raw; _hArrCache = parsed; return parsed; }
    // Forma inesperada: lo dejamos utilizable y reparamos el valor persistido
    // (una sola vez) para que la próxima lectura ya salga limpia.
    const fixed = sanitizeHistory(parsed);
    try { safeSetLS(LS.HISTORY, JSON.stringify(fixed)); } catch(_){}
    _hRawCache = null; _hArrCache = null;   // que la próxima lea del disco reparado
    return fixed;
  } catch(e){ return []; }
}

function setH(h) {
  const payload = JSON.stringify(h);
  // El que escribe queda cacheado. Si safeSetLS falla (cuota llena), el string
  // en disco no coincidirá y la próxima lectura se re-parsea sola.
  _hRawCache = payload; _hArrCache = h;
  safeSetLS(LS.HISTORY, payload);
  if (typeof scheduleGcalSync === 'function') scheduleGcalSync();
  if (typeof schedulePushSync === 'function') schedulePushSync();
}

// Devuelve true si el presupuesto ACTUAL (estado en memoria `S`) está en
// blanco: sin cliente, sin items, sin total, sin observaciones ni condiciones
// de pago, ni datos del informe de riesgo. Es "no hay nada en edición": el
// usuario abrió la app, se asignó un N° automático, y nunca cargó nada.
// Se usa para no ensuciar el historial con borradores vacíos y para saber si
// es seguro auto-actualizar la fecha de emisión al día de hoy.
function isBlankQuote() {
  const itemCount = S.isEstimative
    ? (S.estItems||[]).filter(i=>i.type==='work'||i.type==='service').length
    : (S.items||[]).length;

  const total = S.isEstimative ? calcEstTotals(S.estItems).total : calcTotals().total;

  return !S.clientName?.trim()
      && itemCount === 0
      && total === 0
      && !S.observations?.trim()
      && !S.paymentConditions?.trim()
      && !(S.isRisk && S.riskData?.species);
}

// ─── MIGRACIÓN: totales de estimativos mal guardados ─────────
// Los presupuestos ESTIMATIVOS guardados antes del fix de C2 tienen el total
// de menos si algún servicio llevaba cantidad > 1 (se ignoraba la cantidad).
// Ese número es el que se ve en el historial y en el mapa, el que pre-carga el
// monto al facturar y el que suma en los totales del mes: hay que corregirlo,
// no solo dejar de generarlo mal.
//
// Recalcula desde el snapshot, que es la fuente de verdad de lo que se
// presupuestó. Es idempotente: una vez corregido, el recálculo coincide y no
// vuelve a escribir (ni dispara copia a Drive).
function migrateFixEstTotals() {
  let h;
  try { h = getH(); } catch (_) { return 0; }
  if (!Array.isArray(h) || !h.length) return 0;
  let cambios = 0;
  h.forEach(e => {
    if (!e || !e.isEstimative) return;
    const est = e.snapshot && e.snapshot.estItems;
    if (!Array.isArray(est) || !est.length) return;
    const real = calcEstTotals(est).total;
    // Comparar en centavos para no pelear con el punto flotante.
    if (moneyToCents(real) === moneyToCents(e.total)) return;
    e.total = real;
    cambios++;
  });
  if (cambios) {
    try { localStorage.setItem(LS.HISTORY, JSON.stringify(h)); } catch (_) {}
    console.warn('Se corrigió el total de ' + cambios + ' presupuesto(s) estimativo(s)');
  }
  return cambios;
}

// ─── MIGRACIÓN: vínculos de versión perdidos ─────────────────
// Hasta la v252 el autoguardado rehacía la entrada con un id nuevo y sin
// versionDe/versionN/reemplazadoPor: retocar una v2 la desligaba del original,
// y abrir y tocar el original lo devolvía al mapa y a los acumulados (contado
// dos veces). Los vínculos se pueden rearmar porque el snapshot de cada
// versión guarda lo que se imprimió: su número (versionN) y el del presupuesto
// que actualiza (versionDeNum).
//
// Solo completa lo que falta o apunta a una entrada que ya no existe: un
// vínculo válido no se toca. Es idempotente.
function migrateRepararVersiones() {
  let h;
  try { h = getH(); } catch (_) { return 0; }
  if (!Array.isArray(h) || !h.length) return 0;
  const ids = new Set(h.map(e => e && e.id));
  const porNum = new Map();
  h.forEach(e => { if (e && e.quoteNumber && !porNum.has(e.quoteNumber)) porNum.set(e.quoteNumber, e); });
  const ultima = new Map();   // original → su versión más alta
  let cambios = 0;
  h.forEach(v => {
    const snap = v && v.snapshot;
    const n = parseInt(snap && snap.versionN, 10) || 0;
    if (n < 2 || !snap.versionDeNum) return;
    const orig = porNum.get(snap.versionDeNum);
    if (!orig || orig === v) return;
    if (v.versionDe == null || !ids.has(v.versionDe)) { v.versionDe = orig.id; cambios++; }
    if (v.versionN !== n) { v.versionN = n; cambios++; }
    const u = ultima.get(orig);
    if (!u || n > u.n) ultima.set(orig, { v, n });
  });
  ultima.forEach(({ v }, orig) => {
    if (orig.reemplazadoPor == null || !ids.has(orig.reemplazadoPor)) {
      orig.reemplazadoPor = v.id;
      cambios++;
    }
  });
  if (cambios) {
    safeSetLS(LS.HISTORY, JSON.stringify(h));
    console.warn('Se repararon ' + cambios + ' vínculo(s) de versión del historial');
  }
  return cambios;
}

// ─── AUTO-SAVE (silencioso) ───────────────────
// Devuelve true si asentó el presupuesto en el historial, false si no
// había nada que guardar (sin N° o borrador vacío).
function autoSaveToHistory() {
  if (!S.quoteNumber) return false;
  syncFromUI();
  if (S.clientName) saveClientToDB(S.clientName, S.clientContact, S.workAddress, S.workMapLink);
  S.items.forEach(it=>{ if(it.type==='tree'&&it.species) saveSpeciesToDB(it.species); });

  const itemCount = S.isEstimative
    ? (S.estItems||[]).filter(i=>i.type==='work'||i.type==='service').length
    : S.items.length;

  // El total del estimativo sale de calcEstTotals (la misma que el PDF): antes
  // se calculaba acá aparte y se guardaba de menos al haber servicios con
  // cantidad > 1. Ver docs/auditoria-2026-07-24.md (C2).
  const total = S.isEstimative ? calcEstTotals(S.estItems).total : calcTotals().total;

  // No guardar borradores completamente vacíos: sin cliente, sin items,
  // sin total, sin observaciones. Eso es ruido — el usuario abrió la
  // app, se asignó un N° automático, y nunca cargó nada. Antes esos
  // borradores ensuciaban el historial con líneas "Sin cliente · $0".
  if (isBlankQuote()) return false;

  // Snapshot del presupuesto, sin la configuración del negocio (logo, textos
  // del PDF, diseño…): vive una sola vez en S y en la raíz del backup. Solo el
  // logo eran ~67 KB por entrada. Ver snapshotSinConfig.
  const snapshot = snapshotSinConfig(JSON.parse(JSON.stringify(S)));

  const entry = {
    _type: 'presupuesto_individual',
    id: Date.now(),
    savedAt: new Date().toISOString(),
    quoteNumber: S.quoteNumber,
    clientName: S.clientName,
    currency: S.currency,
    total,
    itemCount,
    isEstimative: !!S.isEstimative,
    snapshot
  };

  const h = getH();
  const idx = h.findIndex(e=>e.quoteNumber===S.quoteNumber);

  // Re-guardar reemplaza el CONTENIDO (lo de arriba) y conserva todo lo demás
  // que la entrada ya tenía: id, estado, ciclo comercial, vínculos de versión,
  // tipo de trabajo… Antes era al revés —se copiaba una lista fija de campos y
  // el id se rehacía con Date.now()—, así que cada edición perdía lo que no
  // estaba en la lista (versionDe/versionN/reemplazadoPor) y cambiaba el id al
  // que apuntan la Agenda de Google, los push, la campanita y el "Deshacer".
  // savedAt sí se actualiza: es la fecha de última modificación (el merge del
  // import se queda con la más reciente). Solo los nuevos arrancan en 'borrador'.
  if (idx >= 0) {
    const prev = h[idx];
    Object.keys(prev).forEach(k => { if (!(k in entry)) entry[k] = prev[k]; });
    if (prev.id != null) entry.id = prev.id;
    entry.estado = prev.estado || 'borrador';
  } else {
    entry.estado = 'borrador';
  }

  if(idx>=0) h.splice(idx,1,entry); else h.unshift(entry);
  setH(h);
  renderHistory();
  return true;
}

// ─── SAVE (con toast) ────────────────────────
// ─── SAVE (guardar como borrador + nuevo) ────
// El estado se autoguarda en el historial a medida que se redacta, así
// que un "Guardar" a secas era redundante. Este botón cierra el ciclo:
// deja el presupuesto actual asentado en el historial (como borrador si
// todavía no avanzó de estado) y arranca uno nuevo, listo para el
// siguiente cliente. Equivale a "Nuevo presupuesto" pero sin pedir
// confirmación, porque guardar es la acción explícita que pidió el usuario.
function saveToHistory() {
  const num = S.quoteNumber;
  autoSaveToHistory();
  resetToNewQuote();
  toast(`✓ Presupuesto ${num} guardado como borrador`, 'ok');
}

// ─── HELPER: siguiente N° disponible mirando el historial ───
// Evita duplicar números cuando se cargan presupuestos viejos.
// Filtra por el prefijo actual (ej: si numPrefix="2026-", solo considera
// los presupuestos 2026-XXXX y no mezcla con los del año pasado).
function calcNextNumFromHistory() {
  const prefix = S.numPrefix || '';
  const h = getH();
  let maxNum = 0;
  h.forEach(e => {
    const qn = e.quoteNumber || '';
    // Las colaboraciones tienen numeración propia ('T-2026-0001') y no
    // consumen correlativo. Sin prefijo configurado, el 0001 de una
    // colaboración pasaría por número de presupuesto.
    if (typeof esTrabajoPropio === 'function' && esTrabajoPropio(e)) return;
    // Solo presupuestos con el mismo prefijo
    if (prefix && !qn.startsWith(prefix)) return;
    // Extrae el número final (ej: "2026-0035" → 35). El sufijo de versión se
    // saca ANTES: en "2026-0035-v2" el número correlativo es el 35, no el 2
    // (una segunda versión no consume número nuevo, ver nuevaVersionQuote).
    const m = numBaseSinVersion(qn).match(/(\d+)\s*$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  // Si no encontró nada (historial vacío o cambio de prefijo recién),
  // mantiene el numNext actual.
  if (maxNum === 0) return S.numNext || 1;
  return maxNum + 1;
}

// ─── LOAD ────────────────────────────────────
function loadFromHistory(id) {
  const e = getH().find(e=>e.id===id); if(!e) return;
  // Antes de pisar el editor, dejar guardado lo que se estaba editando
  // (mismo autoguardado silencioso que usa "Nuevo presupuesto"): cargar
  // otro presupuesto NO debe descartar el borrador en curso. Si se está
  // recargando el MISMO presupuesto (mismo N°) no se autoguarda, porque
  // ahí la intención es volver a la versión asentada en el historial.
  let prevNum = '';
  if (S.quoteNumber && S.quoteNumber !== e.quoteNumber && autoSaveToHistory()) {
    prevNum = S.quoteNumber;
  }
  // Cargar un presupuesto viejo trae SUS datos, no la configuración de la
  // empresa de aquel momento (nombre, subtítulo, CUIT, textos del PDF, diseño,
  // numeración). Ver CFG_GLOBAL_FIELDS.
  _snapshotAlEditor(e.snapshot);
  toast(prevNum
    ? `Presupuesto abierto · el ${prevNum} quedó guardado en el historial`
    : 'Presupuesto abierto', 'ok');
}

// Pone en el editor los datos de un snapshot del historial (nunca la config de
// la empresa: assignSnapshot respeta CFG_GLOBAL_FIELDS). `antesDePintar`
// permite retocar S antes de que se dibuje (lo usa duplicarQuote).
//
// El snapshot se COPIA: getH() devuelve el mismo array que tiene en cache (ver
// getH), así que sin copia los ítems del editor eran los mismos objetos que
// los de la entrada del historial. Editar el presupuesto abierto —o sacarle
// las fotos a una copia en duplicarQuote— modificaba la entrada original en
// memoria, y el próximo setH() la dejaba así en el disco.
function _snapshotAlEditor(snap, antesDePintar) {
  assignSnapshot(S, migrateState(JSON.parse(JSON.stringify(snap || {}))));
  if (!S.estItems)       S.estItems = [];
  if (!S.estObservations) S.estObservations = '';
  if (S.surcharge === undefined) S.surcharge = 0;
  if (!Array.isArray(S.itemsB)) S.itemsB = [];
  normalizeRiskData();
  // Migrar a IndexedDB cualquier foto embebida del snapshot viejo, para no
  // re-inflar el estado activo (que se autoguarda en localStorage).
  migrateInlinePhotosToIDB(S);
  if (typeof antesDePintar === 'function') antesDePintar();
  // Estado runtime de escenarios: siempre arrancar en A al cargar
  activeScenario = 'A';
  noSync=true; restoreUI(); noSync=false;
  calcExpiry(); renderItems(); renderEstItems(); renderRiskDefects();
  applyMode(currentMode());
  updateTotalsBar(); updateSurchargeUI(); switchTab('editor');
}

// "Duplicar" (tarjeta del historial): un presupuesto NUEVO con los datos y los
// trabajos de otro — el cliente que repite la poda cada año, o un trabajo
// parecido para otro cliente. Antes había que cargar todo de nuevo: "Nueva
// versión" existe solo para los vencidos y queda LIGADA al original.
// Lleva número nuevo, fecha de hoy y vigencia nueva; no hereda vínculos de
// versión (el estado y el envío viven en la entrada, así que arranca borrador).
// Las fotos NO se copian: son de aquel árbol y aquel día, y en un presupuesto
// nuevo mostrarían algo que ya no es así.
function duplicarQuote(id) {
  const e = getH().find(x => x && x.id === id);
  if (!e || !e.snapshot || (typeof esTrabajoPropio === 'function' && esTrabajoPropio(e))) return;
  let prevNum = '';
  if (S.quoteNumber && autoSaveToHistory()) prevNum = S.quoteNumber;
  const origen = e.quoteNumber || '';
  _snapshotAlEditor(e.snapshot, () => {
    S.numNext = calcNextNumFromHistory();
    S.dateIssue = today();
    S.quoteNumber = mkQN();
    S.versionN = 0; S.versionDeNum = ''; S.versionDeFecha = ''; S.versionEnDoc = true;
    const sinFoto = arr => (Array.isArray(arr) ? arr : []).forEach(it => {
      if (!it) return;
      if ('photo' in it) delete it.photo;
      if (Array.isArray(it.photos)) it.photos = [];
    });
    sinFoto(S.items); sinFoto(S.itemsB); sinFoto(S.estItems);
    S.dispoPhotos = [];
    sinFoto(riskDefectList(S));
  });
  const m = document.getElementById('main');
  if (m) m.scrollTop = 0;
  sched();
  const msg = `Copia de ${origen} lista como ${S.quoteNumber}. Las fotos no se copian.`;
  if (prevNum) toastAccion(msg, [{ label: 'Deshacer', fn: () => deshacerNuevo(prevNum) }], 8000);
  else toast(msg, 'ok', 5000);
}

// ═══════════════════════════════════════════════════════════
// SEGUNDA VERSIÓN DE UN PRESUPUESTO (el vencido que vuelve)
// ═══════════════════════════════════════════════════════════
// El caso: se pasó un presupuesto, venció, y semanas después el cliente
// escribe — porque quiere hacer el trabajo, o para tantear cuánto sale ahora.
// Volver a cargar el viejo y editarle los precios a mano pierde el original
// (que es la referencia de lo que se le había dicho) y encima obliga a
// recalcular árbol por árbol.
//
// El modelo es el de las revisiones de obra (Rev. A / Rev. B) y el de las
// versiones de cotización de cualquier CRM: la versión nueva es OTRO
// presupuesto, ligado al anterior, y el anterior queda marcado como
// reemplazado. Concretamente:
//   · número     → el mismo con sufijo ("2026-0035-v2"). El cliente escribe
//                  POR ese número; darle uno nuevo rompe el hilo. Y no
//                  consume correlativo (ver calcNextNumFromHistory).
//   · precios    → se actualizan de una con un %, redondeado a cifras de
//                  oficio. Es lo único que cambia en la mayoría de los casos.
//   · el viejo   → reemplazadoPor + vencimientoVistoEn: deja de aparecer en
//                  el banner de vencidos y no suma dos veces al acumulado.
//   · el mensaje → al enviarla por WhatsApp sale la plantilla de
//                  actualización, no la de envío (ver _sendCurrentWhatsappGo).
// Los vínculos (versionDe / reemplazadoPor / versionN) son metadata del ENTRY,
// como el estado: se leen en el listado sin cargar el presupuesto. La
// referencia que se imprime en el PDF (versionDeNum / versionDeFecha) sí va en
// el snapshot, porque es parte del documento.

// Número sin el sufijo de versión: "2026-0035-v3" → "2026-0035".
function numBaseSinVersion(num) { return String(num || '').replace(/-v\d+$/i, ''); }

// ¿Este entry ya fue reemplazado por una versión posterior?
function esReemplazado(e) { return !!(e && e.reemplazadoPor); }

// Redondea un importe (en centavos) a una cifra que un podador diría en voz
// alta. Un +18% sobre $470.000 da $554.600; lo que se pasa es $555.000. Sin
// esto, la actualización deja precios de supermercado en un presupuesto donde
// todos los números son redondos.
function redondeoPrecioCents(cents) {
  if (!(cents > 0)) return 0;
  // $10.000 o más → al millar; por debajo, a la centena (un flete de $8.000
  // no se redondea a $8.000 ± $1.000).
  const paso = cents >= 1000000 ? 100000 : 10000;
  return Math.max(paso, Math.round(cents / paso) * paso);
}

// Aplica un % a TODOS los precios de un snapshot (escenarios A/B y estimativo
// incluidos). Muta el objeto que recibe — se lo llama sobre una copia o sobre
// S ya cargado. Devuelve cuántos precios tocó.
//
// `_basePrice` (el precio previo al recargo por viáticos, ver applySurcharge)
// se ajusta con el mismo factor: si no, quitar el recargo después de
// actualizar devolvería los precios del año pasado.
function ajustarPreciosEn(snap, pct) {
  const f = 1 + (Number(pct) || 0) / 100;
  if (!snap || f === 1) return 0;
  let n = 0;
  const bump = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach(it => {
      if (!it || (it.type !== 'tree' && it.type !== 'service' && it.type !== 'work')) return;
      const c = moneyToCents(it.price);
      if (!(c > 0)) return;
      it.price = centsToMoney(redondeoPrecioCents(Math.round(c * f)));
      const b = moneyToCents(it._basePrice);
      if (b > 0) it._basePrice = centsToMoney(redondeoPrecioCents(Math.round(b * f)));
      n++;
    });
  };
  bump(snap.items); bump(snap.itemsB); bump(snap.estItems);
  return n;
}

// Total de un snapshot cualquiera, sin tocar el estado abierto (calcTotals y
// calcEstTotals trabajan sobre S / el escenario activo). Se usa para la cuenta
// del diálogo: "$470.000 → $555.000".
function totalDeSnapshot(snap) {
  if (!snap) return 0;
  if (snap.isEstimative) return calcEstTotals(snap.estItems || []).total;
  let sub = 0;
  (snap.items || []).forEach(i => {
    if (i && (i.type === 'tree' || i.type === 'service')) sub += itemTotalCents(i);
  });
  const d = Math.min(100, Math.max(0, parseFloat(snap.discount) || 0));
  return centsToMoney(sub - Math.round(sub * d / 100));
}

// Primer número de versión libre para una base dada. Normalmente es
// "<base>-v<n>", pero si ese número ya existe (una versión borrada y rehecha,
// un import) sigue subiendo hasta encontrar uno libre.
function numeroDeVersionLibre(baseNum, n) {
  const usados = new Set(getH().map(e => e.quoteNumber || ''));
  let k = Math.max(2, Math.round(n) || 2);
  while (usados.has(`${baseNum}-v${k}`)) k++;
  return { num: `${baseNum}-v${k}`, n: k };
}

// ─── Diálogo ─────────────────────────────────
let _nvEntry = null;   // entry del historial que se está versionando

const NV_CHIPS = [0, 10, 15, 20, 30, 50];

function _nvPctGuardado() {
  const v = parseFloat(localStorage.getItem(LS.VER_PCT));
  return Number.isFinite(v) ? v : 0;
}

function nuevaVersionQuote(id) {
  const e = getH().find(x => x.id === id);
  if (!e) return;
  _nvEntry = e;
  const ov = document.getElementById('nv-overlay');
  if (!ov) return;
  const base = numBaseSinVersion(e.quoteNumber || '');
  const emit = (e.snapshot && e.snapshot.dateIssue) || (e.savedAt || '').slice(0, 10);
  const exp  = e.snapshot && e.snapshot.dateExpiry;
  const dv   = exp ? daysSinceDate(exp) : null;
  const sub  = document.getElementById('nv-sub');
  if (sub) {
    sub.textContent = `${e.quoteNumber || '—'} · ${(e.clientName || '').trim() || '(sin nombre)'}`
      + (emit ? ` · emitido el ${fmtD(emit)}` : '')
      + ((dv !== null && dv >= 1) ? ` · venció hace ${dv} día${dv > 1 ? 's' : ''}` : '');
  }
  const tit = document.getElementById('nv-title');
  if (tit) tit.textContent = `Nueva versión de ${base}`;
  const pctEl = document.getElementById('nv-pct');
  if (pctEl) pctEl.value = _nvPctGuardado();
  const endoc = document.getElementById('nv-endoc');
  if (endoc) endoc.checked = true;
  nvSync();
  ov.classList.add('open');
}

function nvClose() {
  const ov = document.getElementById('nv-overlay');
  if (ov) ov.classList.remove('open');
  _nvEntry = null;
}

// Escape cierra el diálogo (escritorio). En el celular se cierra tocando fuera
// o con Cancelar.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const ov = document.getElementById('nv-overlay');
  if (ov && ov.classList.contains('open')) nvClose();
  const cv = document.getElementById('colab-overlay');
  if (cv && cv.classList.contains('open')) colabClose();
});

// Fija el % desde un atajo y refresca la cuenta.
function nvSetPct(p) {
  const el = document.getElementById('nv-pct');
  if (el) el.value = p;
  nvSync();
}

// Repinta los atajos y la cuenta (total viejo → total nuevo) con el % actual.
function nvSync() {
  if (!_nvEntry) return;
  const pct = parseFloat(gv('nv-pct')) || 0;
  const snap = _nvEntry.snapshot || {};
  const cur  = _nvEntry.currency || snap.currency || 'ARS';
  const viejo = totalDeSnapshot(snap);
  // La copia es para no tocar el snapshot guardado mientras se mira la cuenta.
  const clone = JSON.parse(JSON.stringify(snap));
  const n = ajustarPreciosEn(clone, pct);
  const nuevo = totalDeSnapshot(clone);

  const chips = document.getElementById('nv-chips');
  if (chips) {
    chips.innerHTML = NV_CHIPS.map(p =>
      `<button type="button" class="nv-chip${p === pct ? ' is-active' : ''}" onclick="nvSetPct(${p})">${p === 0 ? 'Sin cambios' : '+' + p + '%'}</button>`
    ).join('');
  }
  const oldEl = document.getElementById('nv-prev-old');
  const newEl = document.getElementById('nv-prev-new');
  const noteEl = document.getElementById('nv-prev-note');
  if (oldEl) oldEl.textContent = fmtM(viejo, cur);
  if (newEl) newEl.textContent = fmtM(nuevo, cur);
  if (noteEl) {
    noteEl.textContent = pct === 0
      ? 'Mismos precios, vigencia nueva desde hoy.'
      : `${n} precio${n === 1 ? '' : 's'} actualizado${n === 1 ? '' : 's'} y redondeado${n === 1 ? '' : 's'}. Podés retocarlos uno por uno en el editor.`;
  }
}

function nvConfirm() {
  if (!_nvEntry) { nvClose(); return; }
  const pct = parseFloat(gv('nv-pct')) || 0;
  const enDoc = gc('nv-endoc');
  const entry = _nvEntry;
  nvClose();
  try { localStorage.setItem(LS.VER_PCT, String(pct)); } catch (_) {}
  crearNuevaVersion(entry, pct, enDoc);
}

// ─── Creación ────────────────────────────────
// Deja la versión nueva abierta en el editor y asentada en el historial, con
// los dos entries ligados. No envía nada: el usuario revisa, retoca lo que
// haga falta y recién ahí imprime o manda el WhatsApp.
function crearNuevaVersion(entry, pct, enDoc) {
  if (!entry || !entry.snapshot) return;
  // Lo que estaba abierto en el editor no se pierde (mismo criterio que
  // loadFromHistory): se autoguarda salvo que sea el presupuesto de origen.
  let prevNum = '';
  if (S.quoteNumber && S.quoteNumber !== entry.quoteNumber && autoSaveToHistory()) {
    prevNum = S.quoteNumber;
  }

  const snap = migrateState(JSON.parse(JSON.stringify(entry.snapshot)));
  assignSnapshot(S, snap);
  if (!S.estItems)        S.estItems = [];
  if (!S.estObservations) S.estObservations = '';
  if (S.surcharge === undefined) S.surcharge = 0;
  if (!Array.isArray(S.itemsB)) S.itemsB = [];
  normalizeRiskData();
  // Las fotos son las mismas (mismo trabajo, mismos árboles): la versión
  // referencia los mismos ids de IndexedDB, no se duplican los binarios.
  migrateInlinePhotosToIDB(S);
  activeScenario = 'A';

  const tocados = ajustarPreciosEn(S, pct);

  // Referencia al presupuesto que actualiza (esto SÍ es parte del documento).
  const nEsperado = (parseInt(entry.versionN, 10) || 1) + 1;
  const { num, n } = numeroDeVersionLibre(numBaseSinVersion(entry.quoteNumber || mkQN()), nEsperado);
  S.versionN       = n;
  S.versionDeNum   = entry.quoteNumber || '';
  S.versionDeFecha = (entry.snapshot.dateIssue || (entry.savedAt || '').slice(0, 10)) || '';
  S.versionEnDoc   = enDoc !== false;
  S.quoteNumber    = num;
  // Emitida hoy, con la vigencia contada desde hoy: si algo justifica una
  // versión nueva es justamente que la anterior se venció.
  S.dateIssue = today();
  calcExpiry();

  noSync = true; restoreUI(); noSync = false;
  renderItems(); renderEstItems(); renderRiskDefects();
  applyMode(currentMode());
  updateTotalsBar(); updateSurchargeUI();

  // Asentar la versión en el historial y ligar las dos entradas.
  autoSaveToHistory();
  const h = getH();
  const nuevo = h.find(x => x.quoteNumber === num);
  const orig  = h.find(x => x.id === entry.id);
  if (nuevo) { nuevo.versionDe = entry.id; nuevo.versionN = n; }
  if (orig && nuevo) {
    orig.reemplazadoPor = nuevo.id;
    // Ya tiene reemplazo: no hace falta que el banner de vencidos siga
    // reclamando por él.
    if (!orig.vencimientoVistoEn) orig.vencimientoVistoEn = new Date().toISOString();
  }
  setH(h);
  renderHistory();
  if (typeof renderFollowupBanner === 'function') renderFollowupBanner();
  switchTab('editor');

  const detalle = pct === 0
    ? 'con los mismos precios'
    : `con ${tocados} precio${tocados === 1 ? '' : 's'} al ${pct > 0 ? '+' : ''}${pct}%`;
  toast(`✓ ${num} creado ${detalle}` + (prevNum ? ` · el ${prevNum} quedó guardado` : ''), 'ok', 5000);
}

// ─── DELETE ──────────────────────────────────
async function delFromHistory(id) {
  const ok = await confirmDlg('Eliminar presupuesto', '¿Eliminar este presupuesto del historial? Esta acción no se puede deshacer.', 'Eliminar', 'btn-d');
  if (!ok) return;
  setH(getH().filter(e=>e.id!==id));
  renderHistory();
  toast('Presupuesto eliminado', 'err');
}

async function clearHistory() {
  const ok = await confirmDlg('Limpiar historial', '¿Eliminar todos los presupuestos guardados? Esta acción no se puede deshacer.', 'Limpiar todo', 'btn-d');
  if (!ok) return;
  setH([]);
  renderHistory();
  toast('Historial eliminado', 'err');
}

// ═══════════════════════════════════════════════════════════════════════════
// TRABAJOS SIN PRESUPUESTO — colaboraciones y trabajos directos
// ═══════════════════════════════════════════════════════════════════════════
// Dos cosas distintas que se registran igual, de un toque, porque ninguna pasó
// por un presupuesto:
//
//   · COLABORACIÓN (`colab`) — "un día de trabajo como trepador, que es el
//     servicio que presto cuando un colega me llama a trabajar con él". Paga
//     un COLEGA. Su plata no es venta del negocio.
//   · TRABAJO DIRECTO (`directo`) — "pequeños trabajos a clientes que ya
//     existen": el cliente llama, se arregla en el momento y se hace. Paga un
//     CLIENTE. Su plata SÍ es venta del negocio.
//
// Ninguno es un presupuesto: nadie los aceptó ni los rechazó, no se envían, no
// vencen y no se siguen. Pero comparten todo el ciclo que ya existe —se
// agendan, se ven en la Agenda con su clima, se marcan realizados y desembocan
// en la factura—, así que viven como entradas del historial con la bandera
// `esTrabajoPropio` y el tipo en `tipoTrabajo`.
//
// LA BANDERA DECIDE DOS COSAS DISTINTAS, y por eso hay dos preguntas y no una:
//
//   1. `cuentaEnConversion(e)` — ¿entra en la conversión y en los chips de
//      estado de la zona? NINGUNO de los dos. Nacen 'aceptado' o 'realizado' y
//      nunca 'perdido': contarlos haría subir sola la conversión y diría que
//      "fueron aceptados más trabajos de los que de verdad fueron".
//   2. `sumaComoVenta(e)` — ¿su plata es venta del negocio (total del mes,
//      acumulado del cliente)? El trabajo directo SÍ: se lo cobró a un cliente
//      suyo. La colaboración NO: esa plata se la paga un colega.
//
// Ver test/trabajo-propio.test.cjs, que falla si alguna cuenta los mezcla.
function esTrabajoPropio(e) { return !!(e && e.esTrabajoPropio); }
// Compatibilidad: las colaboraciones registradas antes de que existiera el
// trabajo directo no tienen `tipoTrabajo` y son colaboraciones.
function tipoTrabajo(e) { return (e && e.tipoTrabajo === 'directo') ? 'directo' : 'colab'; }
function esColaboracion(e)   { return esTrabajoPropio(e) && tipoTrabajo(e) === 'colab'; }
function esTrabajoDirecto(e) { return esTrabajoPropio(e) && tipoTrabajo(e) === 'directo'; }
// Las dos preguntas de arriba, como funciones que usan todas las cuentas.
function cuentaEnConversion(e) { return !esTrabajoPropio(e); }
function sumaComoVenta(e)      { return !esColaboracion(e); }

// (`TRABAJO_TIPOS`, la lista blanca, vive en js/sanitize.js con las demás.)
// Todo lo que cambia entre los dos tipos, en un solo lugar: el resto del
// código pregunta por acá en vez de repartir `if (directo)` por la app.
const TRABAJO_CFG = {
  colab: {
    nombre: 'Colaboración', plural: 'colaboraciones', fem: true,
    prefijo: 'T-', badge: 'Colaboración',
    quienLabel: 'Colega', quienPlaceholder: '¿Quién te llamó?',
    subtitulo: 'Un trabajo tuyo para un colega. La plata la paga él: no suma a las ventas ni a las estadísticas.',
    // El colega no te pide un presupuesto: te paga jornadas ya trabajadas. El
    // papel que le pasás es el DETALLE de lo que hiciste y cuánto es, sin el
    // argumentario de venta (plan de trabajo, cómo trabajamos) ni condiciones
    // de pago de un presupuesto, que a un colega no le dicen nada.
    doc: {
      corto: 'Detalle', badge: 'Detalle N°', quien: 'Colega',
      titulo: 'Detalle de jornadas trabajadas',
      secciones: ['details', 'total', 'observations', 'pago'],
    },
  },
  directo: {
    nombre: 'Trabajo', plural: 'trabajos directos', fem: false,
    prefijo: 'D-', badge: 'Trabajo directo',
    quienLabel: 'Cliente', quienPlaceholder: 'Nombre del cliente',
    subtitulo: 'Un trabajo para un cliente tuyo, sin presupuesto de por medio. Suma a tus ventas, no a la conversión.',
    // Para el cliente el papel ES un presupuesto: mismo título, mismo
    // encabezado y las secciones que él eligió en Empresa → Textos del PDF
    // (`secciones: null` = el orden guardado, sin recortar).
    doc: {
      corto: 'Presupuesto', badge: 'Presupuesto N°', quien: 'Cliente',
      titulo: '', secciones: null,
    },
  },
};
function trabajoCfg(t) { return TRABAJO_CFG[t] || TRABAJO_CFG.colab; }
// "Colaboración registrada" / "Trabajo registrado": el participio concuerda con
// el nombre del tipo, que es femenino en uno y masculino en el otro.
function trabajoFrase(tipo, participio) {
  const c = trabajoCfg(tipo);
  return `${c.nombre} ${participio}${c.fem ? 'a' : 'o'}`;
}

// "1 colaboración" / "3 colaboraciones" / "1 trabajo directo" / "2 trabajos
// directos". El singular sale del badge (el nombre completo del concepto), no
// de `nombre`, que es la etiqueta corta del segmentado; y el plural de
// colaboración pierde la tilde.
function colabCantTxt(n, tipo) {
  const c = trabajoCfg(tipo || 'colab');
  return n === 1 ? ('1 ' + c.badge.toLowerCase()) : (n + ' ' + c.plural);
}

// Numeración propia por tipo: 'T-2026-0001' las colaboraciones, 'D-2026-0001'
// los trabajos directos. No consumen correlativo de presupuestos (el prefijo
// no coincide con `numPrefix` y además calcNextNumFromHistory los saltea). El
// año es el de hoy —el de la emisión—, aunque el trabajo se agende para más
// adelante.
function _nextColabNum(tipo) {
  const pre = trabajoCfg(tipo).prefijo + today().slice(0, 4) + '-';
  let max = 0;
  getH().forEach(e => {
    const qn = e.quoteNumber || '';
    if (qn.indexOf(pre) !== 0) return;
    const m = qn.slice(pre.length).match(/^(\d+)/);
    if (!m) return;
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return pre + String(max + 1).padStart(4, '0');
}

// Lo que parece una ubicación de mapa (coordenadas, Plus Code o link) va a
// workMapLink, que es de donde salen el pin, "Llegar" y el clima. Una
// dirección escrita va a workAddress. Es la misma distinción que hace el
// editor, resuelta acá para que el diálogo tenga un solo campo "Lugar".
function _colabEsUbicacion(v) {
  const s = (v || '').trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^\s*-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/.test(s)) return true;
  return /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}/i.test(s);
}

// ─── Diálogo ─────────────────────────────────
let _colabEditId = null;    // id del trabajo en edición (null = alta)
let _colabTarifaId = '';    // tarifa elegida (solo para pintar el chip activo)
let _colabTipo = 'colab';   // tipo elegido en el segmentado

// `tipo` solo se pasa en el alta ('colab' | 'directo'); al editar manda el
// que tenga la entrada.
function abrirColaboracion(id, tipo) {
  const ov = document.getElementById('colab-overlay');
  if (!ov) return;
  const e = (id != null) ? getH().find(x => x.id === id) : null;
  _colabEditId  = e ? e.id : null;
  _colabTarifaId = '';
  _colabTipo = e ? tipoTrabajo(e)
                 : (TRABAJO_TIPOS.indexOf(tipo) >= 0 ? tipo : 'directo');

  const okb = document.getElementById('colab-ok');
  if (okb) okb.textContent = e ? 'Guardar cambios' : 'Registrar';

  const sv = (k, v) => { const el = document.getElementById(k); if (el) el.value = v; };
  if (e) {
    const c = e.colab || {};
    const snap = e.snapshot || {};
    sv('colab-nombre', c.nombre || '');
    sv('colab-precio', c.precio || '');
    sv('colab-cant',   c.cantidad || 1);
    sv('colab-unidad', c.unidad || 'jornada');
    sv('colab-colega', e.clientName || '');
    sv('colab-tel',    snap.clientContact || '');
    sv('colab-lugar',  (snap.workMapLink || '').trim() || (snap.workAddress || ''));
    sv('colab-nota',   snap.observations || '');
    sv('colab-fecha',  agFechas(e)[0] || today());
  } else {
    // Alta: arranca con la primera tarifa cargada, hoy y una unidad.
    const tarifas = (typeof getMisServicios === 'function') ? getMisServicios() : [];
    const t = tarifas[0];
    sv('colab-nombre', t ? t.nombre : '');
    sv('colab-precio', t && t.precio ? t.precio : '');
    sv('colab-cant',   1);
    sv('colab-unidad', t ? t.unidad : 'jornada');
    sv('colab-colega', '');
    sv('colab-tel',    '');
    sv('colab-lugar',  '');
    sv('colab-nota',   '');
    sv('colab-fecha',  today());
    if (t) _colabTarifaId = t.id;
  }
  _colabRenderTipo();
  _colabRenderTarifas();
  _colabClientesDatalist();
  colabSync();
  ov.classList.add('open');
  // El campo fecha usa el datepicker propio de la app, que se engancha acá
  // porque el diálogo recién ahora está visible.
  if (typeof refreshCustomDates === 'function') refreshCustomDates();
  if (typeof enhanceSelects === 'function') enhanceSelects(ov);
  if (typeof refreshCustomSelects === 'function') refreshCustomSelects();
}

// Pinta el segmentado y todo lo que cambia con el tipo: título, subtítulo y la
// etiqueta de quién paga (Cliente o Colega). Al EDITAR el segmentado se
// bloquea: cambiarle el tipo a una entrada ya registrada movería su plata de
// las ventas y le dejaría un número de otra serie.
function _colabRenderTipo() {
  const cfg = trabajoCfg(_colabTipo);
  const editando = _colabEditId != null;
  const seg = document.getElementById('colab-tipo-seg');
  if (seg) {
    seg.hidden = editando;
    seg.innerHTML = TRABAJO_TIPOS.map(t =>
      `<button type="button" class="colab-tseg${t === _colabTipo ? ' is-active' : ''}" data-tipo="${t}">${esc(trabajoCfg(t).nombre)}</button>`
    ).join('');
    if (!seg._colabTipoListener) {
      seg.addEventListener('click', (ev) => {
        const b = ev.target.closest('.colab-tseg');
        if (b && b.dataset.tipo) colabSetTipo(b.dataset.tipo);
      });
      seg._colabTipoListener = true;
    }
  }
  const tit = document.getElementById('colab-title');
  if (tit) tit.textContent = (editando ? 'Editar ' : 'Registrar ') + cfg.nombre.toLowerCase();
  const sub = document.getElementById('colab-sub');
  if (sub) sub.textContent = cfg.subtitulo;
  const lbl = document.getElementById('colab-colega-lbl');
  if (lbl) lbl.textContent = cfg.quienLabel;
  const inp = document.getElementById('colab-colega');
  if (inp) inp.placeholder = cfg.quienPlaceholder;
}

function colabSetTipo(t) {
  if (TRABAJO_TIPOS.indexOf(t) < 0 || t === _colabTipo) return;
  _colabTipo = t;
  _colabRenderTipo();
  colabSync();
}

// Cliente ya conocido: al terminar de escribir el nombre se completan solos su
// teléfono y su lugar desde la base de clientes. Es la mitad de la carga de un
// trabajo a alguien que ya está en la libreta. Nunca pisa lo que el usuario ya
// escribió a mano.
function colabAutoCliente() {
  const nom = (gv('colab-colega') || '').trim().toLowerCase();
  if (!nom || typeof getClientDB !== 'function') return;
  const c = getClientDB().find(x => ((x.name || '') + '').trim().toLowerCase() === nom);
  if (!c) return;
  const tel = document.getElementById('colab-tel');
  const lug = document.getElementById('colab-lugar');
  let completo = false;
  if (tel && !tel.value.trim() && (c.contact || '').trim()) { tel.value = c.contact; completo = true; }
  if (lug && !lug.value.trim()) {
    // La clave en la DB es `maplink` en minúscula (ver saveClientToDB).
    const l = ((c.maplink || '').trim() || (c.address || '').trim());
    if (l) { lug.value = l; completo = true; }
  }
  if (completo) toast('Datos del cliente completados', 'ok', 1800);
}

function colabClose() {
  const ov = document.getElementById('colab-overlay');
  if (ov) ov.classList.remove('open');
  _colabEditId = null;
}

// Chips de tarifas guardadas. Sin ninguna cargada, el diálogo sigue sirviendo
// (nombre y precio a mano) y se ofrece el camino para guardarla.
function _colabRenderTarifas() {
  const box = document.getElementById('colab-tarifas');
  if (!box) return;
  const tarifas = (typeof getMisServicios === 'function') ? getMisServicios() : [];
  if (!tarifas.length) {
    box.innerHTML = '<span class="colab-tarifas-empty">Sin tarifas guardadas. Cargalas en ⚙ Configuración → Datos → Mis servicios para que aparezcan acá.</span>';
    return;
  }
  // El id va en data-id y lo lee un listener delegado: nunca interpolado en
  // un onclick (ver la regla de ids en js/sanitize.js).
  box.innerHTML = tarifas.map(t => `
    <button type="button" class="colab-chip${t.id === _colabTarifaId ? ' is-active' : ''}" data-id="${esc(t.id)}">
      ${esc(t.nombre)}${t.precio ? `<span class="colab-chip-precio">${fmtM(t.precio, S.currency || 'ARS')}</span>` : ''}
    </button>`).join('');
  if (!box._colabListener) {
    box.addEventListener('click', (ev) => {
      const chip = ev.target.closest('.colab-chip');
      if (chip && chip.dataset.id) colabPickTarifa(chip.dataset.id);
    });
    box._colabListener = true;
  }
}

// Autocompletar del colega con la misma base de clientes: el que te llama a
// trabajar suele ser el mismo de siempre.
function _colabClientesDatalist() {
  const dl = document.getElementById('colab-colegas-dl');
  if (!dl) return;
  const db = (typeof getClientDB === 'function') ? getClientDB() : [];
  dl.innerHTML = db.map(c => `<option value="${esc(c.name || '')}">`).join('');
}

function colabPickTarifa(id) {
  const t = (typeof getMisServicios === 'function') ? getMisServicios().find(x => x.id === id) : null;
  if (!t) return;
  _colabTarifaId = t.id;
  const sv = (k, v) => { const el = document.getElementById(k); if (el) el.value = v; };
  sv('colab-nombre', t.nombre);
  if (t.precio) sv('colab-precio', t.precio);
  sv('colab-unidad', t.unidad);
  _colabRenderTarifas();
  if (typeof refreshCustomSelects === 'function') refreshCustomSelects();
  colabSync();
}

// Total en centavos del diálogo. La cantidad admite medias jornadas, así que
// el producto se redondea a centavos enteros acá y ese número es el que se
// guarda: el ítem del snapshot va con el total ya hecho (ver colabGuardar).
function _colabTotalCents() {
  const precio = Math.max(0, moneyToCents(gv('colab-precio')));
  const cant   = Math.max(0, parseFloat(gv('colab-cant')) || 0) || 1;
  return Math.round(precio * cant);
}

// Repinta la cuenta y, sobre todo, qué va a pasar al guardar. El estado sale
// de la fecha, y eso hay que decirlo ANTES de tocar el botón.
function colabSync() {
  const cur   = S.currency || 'ARS';
  const fecha = (gv('colab-fecha') || '').trim() || today();
  const futura = fecha > today();
  const cant   = Math.max(0, parseFloat(gv('colab-cant')) || 0) || 1;
  const unidad = gv('colab-unidad') || 'jornada';

  const totEl = document.getElementById('colab-total');
  if (totEl) totEl.textContent = fmtM(centsToMoney(_colabTotalCents()), cur);
  const cuentaEl = document.getElementById('colab-cuenta');
  if (cuentaEl) {
    const precio = roundMoney(gv('colab-precio'));
    cuentaEl.textContent = precio > 0
      ? `${misSvcCantTxt(cant, unidad)} × ${fmtM(precio, cur)}`
      : 'Cargá el precio de la tarifa';
  }
  const qEl = document.getElementById('colab-quepasa');
  if (qEl) {
    const qué = _colabTipo === 'directo' ? 'El trabajo' : 'La colaboración';
    qEl.textContent = futura
      ? `${qué} se agenda para el ${fmtDiaCorto(fecha)}. Va a aparecer en la Agenda y en el aviso de ese día.`
      : `${qué} queda registrado como realizado el ${fmtDiaCorto(fecha)}. Después vas a poder registrar la factura.`;
  }
}

// ─── Guardado ────────────────────────────────
// Deja el trabajo asentado en el historial. No abre el editor: ni la
// colaboración ni el trabajo directo se editan como presupuesto (no tienen
// ítems que retocar ni documento que mandar), se corrigen desde su diálogo.
function colabGuardar() {
  const nombre = (gv('colab-nombre') || '').trim();
  if (nombre.length < 2) { toast('Escribí qué trabajo hiciste', 'err'); return; }
  // El tipo de una entrada ya registrada no se cambia (el segmentado está
  // oculto al editar): mudarla de serie le cambiaría el número y movería su
  // plata dentro o fuera de las ventas.
  const totalCents = _colabTotalCents();
  const fecha  = sanISODate(gv('colab-fecha')) || today();
  const cant   = Math.max(0, parseFloat(gv('colab-cant')) || 0) || 1;
  const unidad = MISSVC_UNIDADES.indexOf(gv('colab-unidad')) >= 0 ? gv('colab-unidad') : 'jornada';
  const colega = (gv('colab-colega') || '').trim();
  const tel    = (gv('colab-tel') || '').trim();
  const lugar  = (gv('colab-lugar') || '').trim();
  const nota   = (gv('colab-nota') || '').trim();
  const futura = fecha > today();

  const h = getH();
  const prev = (_colabEditId != null) ? h.find(x => x.id === _colabEditId) : null;

  // El snapshot arranca de DEF para que no le falte ningún campo que el resto
  // de la app da por sentado, y se le sacan las dos fechas del ciclo comercial:
  // ninguno de los dos vence, y su "emisión" es el día en que se trabaja (es
  // lo que lo pone en el mes correcto del historial y del mapa).
  const snap = snapshotSinConfig(JSON.parse(JSON.stringify(DEF)));
  snap.quoteNumber = prev ? prev.quoteNumber : _nextColabNum(_colabTipo);
  snap.dateIssue   = fecha;
  snap.dateExpiry  = '';
  snap.clientName    = colega;
  snap.clientContact = tel;
  snap.workAddress = _colabEsUbicacion(lugar) ? '' : lugar;
  snap.workMapLink = _colabEsUbicacion(lugar) ? lugar : '';
  snap.observations = nota;
  snap.currency = S.currency || 'ARS';
  // Un solo ítem, con el total YA hecho y cantidad 1: media jornada no entra
  // en el qty del editor (itemTotalCents lo fuerza a entero ≥ 1) y el total
  // guardado tiene que coincidir exacto con el del ítem.
  snap.items = [{
    id: Date.now(), type: 'service', species: '',
    desc: `${nombre} — ${misSvcCantTxt(cant, unidad)}`,
    price: centsToMoney(totalCents), qty: 1, showQty: false,
  }];
  snap.itemsB = []; snap.estItems = [];

  const entry = {
    _type: 'presupuesto_individual',
    id: prev ? prev.id : Date.now(),
    savedAt: prev ? (prev.savedAt || new Date().toISOString()) : new Date().toISOString(),
    quoteNumber: snap.quoteNumber,
    clientName: colega,
    currency: snap.currency,
    total: centsToMoney(totalCents),
    itemCount: 1,
    isEstimative: false,
    esTrabajoPropio: true,
    tipoTrabajo: _colabTipo,
    colab: { nombre, precio: roundMoney(gv('colab-precio')), cantidad: cant, unidad },
    snapshot: snap,
  };
  // El estado es del ciclo de vida, no del contenido: al editar no se pisa
  // (mismo criterio que autoSaveToHistory con los presupuestos). Solo el alta
  // lo deriva de la fecha.
  entry.estado = prev ? (prev.estado || 'aceptado') : (futura ? 'aceptado' : 'realizado');
  if (prev && prev.facturado) entry.facturado = true;

  // Días del trabajo: si ya estaba agendada a varios días con el diálogo de
  // agenda y el primero no cambió, se respetan todos. Cambiar la fecha en este
  // diálogo sí reemplaza la programación.
  const prevFechas = prev ? agFechas(prev) : [];
  const conservar = prevFechas.length > 1 && prevFechas[0] === fecha;
  entry.fechasTrabajo = conservar ? prevFechas : [fecha];
  entry.fechaTrabajo  = entry.fechasTrabajo[0];
  if (prev && prev.diasEstimados) entry.diasEstimados = prev.diasEstimados;

  if (prev) h.splice(h.indexOf(prev), 1, entry); else h.unshift(entry);
  setH(h);
  if (colega && typeof saveClientToDB === 'function') saveClientToDB(colega, tel, snap.workAddress, snap.workMapLink);
  colabClose();
  renderHistory();
  if (typeof renderMorningBanner === 'function') renderMorningBanner();
  if (typeof mapaRefresh === 'function') mapaRefresh();

  if (prev) { toast(trabajoFrase(_colabTipo, 'actualizad'), 'ok'); return; }
  toast(futura
    ? `${trabajoFrase(_colabTipo, 'agendad')} para el ${fmtDiaCorto(fecha)}`
    : `${trabajoFrase(_colabTipo, 'registrad')} · ${fmtM(entry.total, entry.currency)}`, 'ok', 3500);
  // Recién hecha: el cierre del trabajo es el mismo de siempre (datos de pago
  // + registrar factura), que es a lo que apunta todo esto.
  if (!futura) _ofrecerCierreTrabajo(entry);
}

// ─── ESTADO COMERCIAL ────────────────────────
// Cambia el estado de un presupuesto del historial por su id.
// Persiste y re-renderiza. No toca el snapshot ni el state activo.
function setEstadoHistory(id, nuevoEstado) {
  if (!ESTADOS.includes(nuevoEstado)) return;
  const h = getH();
  const e = h.find(x => x.id === id);
  if (!e) return;
  const prevEstado = e.estado || 'borrador';
  e.estado = nuevoEstado;
  // Al pasar a "enviado", registrar la fecha. Este dato es lo que habilita
  // el seguimiento: solo los presupuestos enviados DESPUÉS de esta
  // actualización lo tienen, así que los viejos nunca disparan recordatorio.
  // También limpiamos cualquier "seguimiento hecho" previo para que el
  // conteo de días arranque de cero en este nuevo envío.
  if (nuevoEstado === 'enviado') {
    e.enviadoEn = new Date().toISOString();
    delete e.seguimientoHechoEn;
  }
  setH(h);
  renderHistory();
  toast(`Estado: ${estadoLabel(nuevoEstado)}`, 'info', 1800);
  // Al marcar "aceptado", ofrecer agendar la fecha del trabajo o un
  // recontacto (salteable con "Todavía no sé"): es el momento natural,
  // recién se cerró con el cliente. Si ya tiene algo agendado, no molestar.
  if (nuevoEstado === 'aceptado' && !e.fechaTrabajo && !e.recontactoEn) openAgendaDlg(id, { fromAccept: true });
  // Al marcar "realizado", ofrecer las dos cosas que se hacen recién terminado
  // el trabajo: mandarle al cliente los datos para pagar (está ahí, en el
  // lugar) y registrar la factura, que conecta el pipeline comercial con la
  // pestaña Facturación (control de tope) sin volver a tipear cliente + monto.
  if (nuevoEstado === 'realizado') _ofrecerCierreTrabajo(e);
  // Marcar "realizado" es la acción que más se toca sin querer (banner del día,
  // dropdown del historial). Dejamos el aviso en el centro de notificaciones con
  // botón "Deshacer" para volver al estado previo con un toque.
  if (nuevoEstado === 'realizado' && prevEstado !== 'realizado' && typeof logNotif === 'function') {
    logNotif({
      icon: '✅', kind: 'estado',
      text: `Marcaste como realizado: ${(e.clientName || '').trim() || '(sin nombre)'}${e.quoteNumber ? ` (N° ${e.quoteNumber})` : ''}`,
      action: { type: 'entry', id: e.id },
      undo: { type: 'estado', id: e.id, prev: prevEstado },
    });
  }
  if (typeof updateNotifBadge === 'function') updateNotifBadge();
}

// ─── AGENDA: BOTÓN DEL ENCABEZADO ────────────────────────────
// Alterna el filtro de estado "aceptado". El listado filtrado por aceptado
// ES la agenda: renderHistory lo ordena por fecha de trabajo ascendente y
// deja al final los aceptados sin fecha (con su chip "Programar").
function toggleAgendaView() {
  const sel = document.getElementById('hist-estado-filter');
  if (!sel) return;
  sel.value = (sel.value === 'aceptado') ? '' : 'aceptado';
  renderHistory();
  // Sincronizar el dropdown visual también cuando el listado filtrado queda
  // vacío (ese camino de renderHistory retorna antes de refrescar selects).
  if (typeof refreshCustomSelects === 'function') refreshCustomSelects();
}

// ─── AGENDA: FECHA(S) DEL TRABAJO (MULTI-DÍA) ────────────────
// Un trabajo aceptado puede durar varios días, y esos días NO siempre son
// consecutivos ni se conocen de una: se agenda el primero y el resto se
// ubican después, a medida que se organiza la continuación. Por eso el
// modelo tiene dos partes, a nivel del entry del historial:
//   · e.fechasTrabajo → array de fechas YA UBICADAS (YYYY-MM-DD LOCAL, nunca
//     UTC), ordenado. Cada una es un día concreto en que se trabaja.
//   · e.diasEstimados → cuántos días dura el trabajo EN TOTAL. Los días que
//     faltan ubicar (diasEstimados − fechasTrabajo.length) quedan "por ubicar".
// e.fechaTrabajo se mantiene como ESPEJO del primer día ubicado
// (fechasTrabajo[0]) para no romper el código que lo lee. Entries viejos que
// solo tienen e.fechaTrabajo se leen como un trabajo de 1 día (ver agFechas).
// Una fecha pasada con estado "aceptado" se muestra como "En curso" (neutro),
// sin alarmas ni insistencia para cerrarlo.

// Fechas ubicadas de un entry (ordenadas, retrocompatible con entries viejos
// que solo tenían e.fechaTrabajo). No muta el entry.
function agFechas(e) {
  if (!e) return [];
  if (Array.isArray(e.fechasTrabajo) && e.fechasTrabajo.length)
    return e.fechasTrabajo.slice().sort();
  return e.fechaTrabajo ? [e.fechaTrabajo] : [];
}
// Días totales del trabajo: al menos los ya ubicados; si hay un estimado
// explícito mayor, ese manda (los de más son "por ubicar").
function agDiasEstimados(e) {
  const ub = agFechas(e).length;
  const n = parseInt(e && e.diasEstimados, 10);
  return Math.max(ub, n > 0 ? n : 0);
}
// Días que faltan ubicar en una fecha concreta.
function agDiasPendientes(e) {
  return Math.max(0, agDiasEstimados(e) - agFechas(e).length);
}

const AGENDA_WD = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// "Sáb 12/07" — etiqueta corta con día de semana. Construye el Date con
// año/mes/día locales (nunca new Date('YYYY-MM-DD'), que sería UTC).
function fmtDiaCorto(iso) {
  const p = String(iso || '').split('-');
  if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return fmtD(iso);
  const dt = new Date(+p[0], +p[1] - 1, +p[2]);
  return `${AGENDA_WD[dt.getDay()]} ${p[2]}/${p[1]}`;
}

// Chips de agenda para una tarjeta del historial. Aceptado sin nada →
// "Programar"; con día(s) de trabajo → el día más relevante (próximo/hoy, o
// "En curso" si ya empezó) coloreado por proximidad, con un sufijo multi-día
// que avisa cuántos días faltan ubicar; con recontacto pendiente → chip
// celeste 📱 (ámbar cuando llegó el día). En otros estados es solo registro.
function agendaChipFor(e) {
  const est = e.estado || 'borrador';
  const fechas = agFechas(e);
  const total = agDiasEstimados(e);
  const pend = agDiasPendientes(e);
  let out = '';
  if (fechas.length) {
    // Día de referencia: el próximo que sea hoy o futuro; si ya pasaron
    // todos, el último (el trabajo está en curso o es registro histórico).
    const hoy = today();
    const ref = fechas.find(f => f >= hoy) || fechas[fechas.length - 1];
    const d = daysSinceDate(ref); // >0 pasado · 0 hoy · <0 futuro
    // El color del chip es SIEMPRE el del concepto "trabajo" (violeta, la clase
    // base). La urgencia no cambia el tono: hoy/mañana llevan .is-due (realce).
    // Lo ya cumplido (pasado y no aceptado) se atenúa a gris con .is-done.
    let cls = '', lbl = fmtDiaCorto(ref);
    if (d === 0)       { cls = ' is-due'; lbl = 'Hoy'; }
    else if (d === -1) { cls = ' is-due'; lbl = 'Mañana'; }
    else if (d > 0 && est === 'aceptado') { lbl = `En curso · ${lbl}`; }
    else if (d > 0)    { cls = ' is-done'; }
    // Sufijo multi-día: prioriza avisar los días que faltan ubicar.
    let extra = '';
    if (est === 'aceptado' && pend > 0)      extra = ` · +${pend}d por ubicar`;
    else if (total > 1 || fechas.length > 1) extra = ` · ${total} días`;
    const tit = `Días del trabajo: ${fechas.map(fmtD).join(', ')}`
      + (pend > 0 ? ` (+${pend} por ubicar)` : '') + ' — tocá para editar';
    out += `<button type="button" class="hagenda-chip${cls}" onclick="openAgendaDlg(${e.id})" title="${esc(tit)}">${icon('calendar')} ${lbl}${extra}</button>`;
  } else if (est === 'aceptado' && pend > 0) {
    // Duración cargada pero ningún día ubicado todavía: todo por ubicar.
    out += `<button type="button" class="hagenda-chip is-due" onclick="openAgendaDlg(${e.id})" title="El trabajo dura ${total} días y todavía no ubicaste ninguno — tocá para agendar">${icon('calendar')} ${total} días · por ubicar</button>`;
  } else if (est === 'aceptado' && !e.recontactoEn) {
    out += `<button type="button" class="hagenda-chip is-none" onclick="openAgendaDlg(${e.id})" title="Agendar la fecha del trabajo o un recontacto con el cliente">${icon('calendar')} Programar</button>`;
  }
  // Recontacto: solo tiene sentido mientras el presupuesto siga aceptado.
  if (e.recontactoEn && est === 'aceptado') {
    const d = daysSinceDate(e.recontactoEn);
    // Recontacto = celeste siempre (concepto). Atrasado/hoy → realce is-due.
    let cls = ' is-call', lbl = fmtDiaCorto(e.recontactoEn);
    if (d === 0)    { cls = ' is-call is-due'; lbl = 'Llamar hoy'; }
    else if (d > 0) { cls = ' is-call is-due'; lbl = `Llamar · hace ${d}d`; }
    const tit = 'Recontactar al cliente para coordinar la fecha'
      + (e.recontactoNota ? ` — ${e.recontactoNota}` : '');
    out += `<button type="button" class="hagenda-chip${cls}" onclick="openAgendaDlg(${e.id},{mode:'recontacto'})" title="${esc(tit)}">${icon('phone')} ${lbl}</button>`;
  }
  return out;
}

// Estado del diálogo de agenda mientras está abierto (staging: no toca el
// entry hasta Guardar). _agendaFechas = días de trabajo ya ubicados (copia
// editable, ordenada); _agendaDiasEst = duración total en días; _agendaRecon
// = fecha del modo recontacto. Se conservan al alternar de pestaña.
let _agendaId = null;
let _agendaMode = 'trabajo';
let _agendaFromAccept = false;
let _agendaFechas = [];
let _agendaDiasEst = 1;
let _agendaRecon = '';

function openAgendaDlg(id, opts) {
  const e = getH().find(x => x.id === id);
  const ov = document.getElementById('agenda-overlay');
  if (!e || !ov) return;
  _agendaId = id;
  _agendaFromAccept = !!(opts && opts.fromAccept);
  _agendaFechas = agFechas(e);
  _agendaDiasEst = agDiasEstimados(e) || 1;
  _agendaRecon = e.recontactoEn || '';
  const sub = document.getElementById('agenda-sub');
  if (sub) sub.textContent = `${e.quoteNumber || ''} · ${e.clientName || 'Sin cliente'}`;
  const nota = document.getElementById('agenda-nota');
  if (nota) nota.value = e.recontactoNota || '';
  const ca = document.getElementById('agenda-cancel');
  if (ca) ca.textContent = _agendaFromAccept ? 'Todavía no sé' : 'Cancelar';
  setAgendaMode((opts && opts.mode) || 'trabajo');
  ov.classList.add('open');
  // Pronóstico de la zona para elegir un buen día (idea 1): baja el clima de
  // este trabajo aunque no esté aceptado y repinta la tira al terminar.
  if (typeof climaEnsureZona === 'function') climaEnsureZona(e, () => { try { agendaClimaRender(); } catch (_) {} });
}

// Alterna entre "Fecha del trabajo" (multi-día) y "Recontactar": actualiza
// título, etiquetas, y muestra/oculta el bloque de duración + días ubicados
// (solo trabajo) o la nota (solo recontacto). El campo de fecha es, en modo
// trabajo, el "staging" para agregar un día más (arranca vacío).
function setAgendaMode(m) {
  _agendaMode = (m === 'recontacto') ? 'recontacto' : 'trabajo';
  const rec = _agendaMode === 'recontacto';
  const e = getH().find(x => x.id === _agendaId) || {};
  const bt = document.getElementById('agenda-mode-trabajo');
  const br = document.getElementById('agenda-mode-recontacto');
  if (bt) bt.classList.toggle('active', !rec);
  if (br) br.classList.toggle('active', rec);
  const ti = document.getElementById('agenda-title');
  if (ti) ti.textContent = rec ? 'Recontactar al cliente'
    : (_agendaFromAccept ? '¡Aceptado! ¿Cuándo se hace el trabajo?' : 'Fecha del trabajo');
  const lbl = document.getElementById('agenda-fecha-label');
  if (lbl) lbl.textContent = rec ? '¿Qué día lo volvés a contactar?'
    : (_agendaFechas.length ? 'Agregar otro día' : 'Día de comienzo del trabajo');
  const help = document.getElementById('agenda-help');
  if (help) help.hidden = !rec;
  const notaWrap = document.getElementById('agenda-nota-wrap');
  if (notaWrap) notaWrap.hidden = !rec;
  const addBtn = document.getElementById('agenda-add-dia');
  if (addBtn) addBtn.hidden = rec;
  const inp = document.getElementById('agenda-fecha');
  // En trabajo el campo es de "agregar día" → arranca vacío; en recontacto
  // muestra la fecha guardada del recontacto.
  if (inp) { inp.value = rec ? (_agendaRecon || '') : ''; if (typeof syncCdate === 'function') syncCdate(inp); }
  const cl = document.getElementById('agenda-clear');
  if (cl) cl.hidden = rec ? !e.recontactoEn : true; // en trabajo se quita por día (chip)
  renderAgendaDiasList();
  agendaOnDateChange();
}

// Repinta el stepper de duración, la lista de días ubicados y el aviso de
// "faltan ubicar N días". Solo aplica en modo trabajo; en recontacto oculta
// todo ese bloque.
function renderAgendaDiasList() {
  const rec = _agendaMode === 'recontacto';
  const durWrap = document.getElementById('agenda-dur-wrap');
  const box = document.getElementById('agenda-dias-list');
  const pendEl = document.getElementById('agenda-pend');
  if (durWrap) durWrap.hidden = rec;
  if (rec) {
    if (box) { box.hidden = true; box.innerHTML = ''; }
    if (pendEl) pendEl.hidden = true;
    return;
  }
  // La duración nunca puede ser menor a los días ya ubicados, ni menor a 1.
  if (_agendaDiasEst < _agendaFechas.length) _agendaDiasEst = _agendaFechas.length;
  if (_agendaDiasEst < 1) _agendaDiasEst = 1;
  const valEl = document.getElementById('agenda-dur-val');
  if (valEl) valEl.textContent = _agendaDiasEst;
  const lblEl = document.getElementById('agenda-dur-lbl');
  if (lblEl) lblEl.textContent = _agendaDiasEst === 1 ? 'día' : 'días';
  const minus = document.getElementById('agenda-dur-minus');
  if (minus) minus.disabled = _agendaDiasEst <= Math.max(1, _agendaFechas.length);
  // Lista de días ubicados (chips removibles), ordenados.
  const hoy = today();
  if (box) {
    if (_agendaFechas.length) {
      box.hidden = false;
      box.innerHTML = _agendaFechas.map((f, i) => {
        const esHoy = f === hoy;
        return `<div class="agenda-dia-chip${esHoy ? ' is-today' : ''}">
          ${icon('calendar')}
          <span class="agenda-dia-txt">Día ${i + 1}: ${esc(fmtDiaCorto(f))}${esHoy ? ' · hoy' : ''}</span>
          <button type="button" class="agenda-dia-x" onclick="agendaRemoveDia('${f}')" aria-label="Quitar este día" title="Quitar este día">×</button>
        </div>`;
      }).join('');
    } else { box.hidden = true; box.innerHTML = ''; }
  }
  // Aviso de días pendientes de ubicar.
  const pend = Math.max(0, _agendaDiasEst - _agendaFechas.length);
  if (pendEl) {
    if (pend > 0) {
      pendEl.hidden = false;
      pendEl.textContent = _agendaFechas.length
        ? `Faltan ubicar ${pend} día${pend > 1 ? 's' : ''} de ${_agendaDiasEst}. Agregalos cuando coordines cómo seguir.`
        : `El trabajo dura ${_agendaDiasEst} días. Agregá el primero abajo; los demás los ubicás después.`;
    } else pendEl.hidden = true;
  }
}

// +/− de la duración total. No baja de los días ya ubicados (ni de 1).
function agendaDurStep(delta) {
  _agendaDiasEst = Math.max(Math.max(1, _agendaFechas.length), _agendaDiasEst + delta);
  renderAgendaDiasList();
}

// "Agregar día": toma la fecha del campo y la suma a los días ubicados (sin
// duplicar). Si supera la duración estimada, la sube para acompañar.
function agendaAddDia() {
  const inp = document.getElementById('agenda-fecha');
  const f = (inp && inp.value) || '';
  if (!f) { toast('Elegí primero un día', 'info', 2000); return; }
  if (!_agendaFechas.includes(f)) {
    _agendaFechas.push(f);
    _agendaFechas.sort();
    if (_agendaDiasEst < _agendaFechas.length) _agendaDiasEst = _agendaFechas.length;
  }
  if (inp) { inp.value = ''; if (typeof syncCdate === 'function') syncCdate(inp); }
  const lbl = document.getElementById('agenda-fecha-label');
  if (lbl) lbl.textContent = 'Agregar otro día';
  renderAgendaDiasList();
  agendaOnDateChange();
}

// Quita un día ubicado (la duración estimada se mantiene, así ese día pasa a
// contar como "por ubicar").
function agendaRemoveDia(f) {
  _agendaFechas = _agendaFechas.filter(x => x !== f);
  const lbl = document.getElementById('agenda-fecha-label');
  if (lbl && !_agendaFechas.length) lbl.textContent = 'Día de comienzo del trabajo';
  renderAgendaDiasList();
}

function closeAgendaDlg() {
  const ov = document.getElementById('agenda-overlay');
  if (ov) ov.classList.remove('open');
  _agendaId = null;
}

// Reacción al cambio del campo de fecha: en recontacto guarda el staging; en
// trabajo muestra el aviso de superposición si ese día ya está agendado en
// otro trabajo aceptado (avisa, no bloquea: hacer dos en un día es válido).
function agendaOnDateChange() {
  const warn = document.getElementById('agenda-warn');
  const f = (document.getElementById('agenda-fecha') || {}).value || '';
  if (_agendaMode === 'recontacto') _agendaRecon = f;
  if (!warn) return;
  const otros = (f && _agendaMode === 'trabajo')
    ? getH().filter(x => x.id !== _agendaId && (x.estado || '') === 'aceptado' && agFechas(x).includes(f))
    : [];
  if (otros.length) {
    const nombres = otros.map(x => x.clientName || x.quoteNumber || 'otro presupuesto');
    warn.textContent = `⚠ Ese día ya tenés agendado: ${nombres.join(', ')}. Podés mantenerlo igual si vas a hacer los dos.`;
    warn.hidden = false;
  } else {
    warn.hidden = true;
  }
  // Repintar la tira de clima (resalta el día elegido + su detalle).
  if (typeof agendaClimaRender === 'function') agendaClimaRender();
}

// Persiste el modo activo en el entry. En trabajo escribe e.fechasTrabajo
// (días ubicados), e.diasEstimados (duración) y espeja e.fechaTrabajo en el
// primer día. Ubicar al menos un día borra el recontacto pendiente (ya se
// coordinó). Devuelve el entry, o null si ya no existe.
function _agendaPersist() {
  const h = getH();
  const e = h.find(x => x.id === _agendaId);
  if (!e) return null;
  if (_agendaMode === 'recontacto') {
    const nota = ((document.getElementById('agenda-nota') || {}).value || '').trim();
    const f = _agendaRecon || '';
    if (f) e.recontactoEn = f; else delete e.recontactoEn;
    if (f && nota) e.recontactoNota = nota; else delete e.recontactoNota;
  } else {
    // Auto-agrega el día tipeado que no se llegó a "Agregar día".
    const inp = document.getElementById('agenda-fecha');
    const typed = (inp && inp.value) || '';
    if (typed && !_agendaFechas.includes(typed)) { _agendaFechas.push(typed); _agendaFechas.sort(); }
    const fechas = _agendaFechas.slice().sort();
    const diasEst = Math.max(fechas.length, _agendaDiasEst || 0);
    if (fechas.length) {
      e.fechasTrabajo = fechas;
      e.fechaTrabajo = fechas[0];             // espejo del primer día (compat)
      if (diasEst > 1) e.diasEstimados = diasEst; else delete e.diasEstimados;
      delete e.recontactoEn;
      delete e.recontactoNota;
    } else if (diasEst > 1) {
      // Duración cargada pero ningún día ubicado todavía.
      delete e.fechasTrabajo;
      delete e.fechaTrabajo;
      e.diasEstimados = diasEst;
    } else {
      delete e.fechasTrabajo;
      delete e.fechaTrabajo;
      delete e.diasEstimados;
    }
  }
  setH(h);
  return e;
}

// Texto de confirmación al guardar un trabajo (contempla multi-día y pendientes).
function _agendaTrabajoToast(e) {
  const fechas = agFechas(e);
  const pend = agDiasPendientes(e);
  if (fechas.length) {
    let msg = fechas.length === 1
      ? `Trabajo agendado: ${fmtDiaCorto(fechas[0])}`
      : `Trabajo agendado: ${fechas.length} días`;
    if (pend > 0) msg += ` (+${pend} por ubicar)`;
    return msg;
  }
  if (agDiasEstimados(e) > 1) return `Trabajo de ${agDiasEstimados(e)} días — faltan ubicar los días`;
  return 'Fecha del trabajo quitada';
}

function agendaSave() {
  const rec = _agendaMode === 'recontacto';
  const e = _agendaPersist();
  closeAgendaDlg();
  renderHistory();
  if (!e) return;
  if (rec) toast(e.recontactoEn ? `Recontacto agendado: ${fmtDiaCorto(e.recontactoEn)}` : 'Recontacto quitado', 'ok');
  else     toast(_agendaTrabajoToast(e), 'ok');
  // Trabajo recién agendado: bajar el pronóstico ya (y avisar si viene lluvia)
  // sin esperar la próxima apertura de la app.
  if (!rec && typeof climaRefresh === 'function') climaRefresh();
}

// "Quitar fecha" (visible solo en recontacto): vacía el recontacto y guarda.
function agendaClear() {
  if (_agendaMode === 'recontacto') {
    _agendaRecon = '';
    const inp = document.getElementById('agenda-fecha');
    if (inp) { inp.value = ''; if (typeof syncCdate === 'function') syncCdate(inp); }
  } else {
    _agendaFechas = [];
    _agendaDiasEst = 1;
  }
  agendaSave();
}

// URL del template público "crear evento" de Google Calendar (evento de día
// completo, sin API ni backend). En el celular la abre la app de Calendar,
// que es donde el usuario tiene sus recordatorios reales con alarma.
// `modo`: 'trabajo' (evento del trabajo, con ubicación) o 'recontacto'
// (recordatorio de llamar al cliente, con la nota). `dayInfo` opcional
// ({ idx, total }) numera el día dentro de un trabajo de varios días.
function agendaGcalUrl(e, iso, modo, dayInfo) {
  const p = iso.split('-');
  const d0 = p.join('');
  const sig = new Date(+p[0], +p[1] - 1, +p[2] + 1); // día siguiente, LOCAL
  const d1 = toLocalISODate(sig).replace(/-/g, '');
  const snap = e.snapshot || {};
  const rec = modo === 'recontacto';
  const quien = e.clientName || 'cliente';
  const num = e.quoteNumber ? ` (${e.quoteNumber})` : '';
  const dnum = (dayInfo && dayInfo.total > 1) ? ` — día ${dayInfo.idx} de ${dayInfo.total}` : '';
  const title = rec ? `Llamar a ${quien} — coordinar trabajo${num}` : `Trabajo: ${quien}${num}${dnum}`;
  const det = [];
  if (rec && e.recontactoNota) det.push(`Nota: ${e.recontactoNota}`);
  if (e.total > 0) det.push(`Presupuesto ${e.quoteNumber || ''}: ${fmtM(e.total, e.currency || 'ARS')}`);
  if (snap.clientContact) det.push(`Contacto: ${snap.clientContact}`);
  if (!rec && snap.workMapLink) det.push(`Ubicación: ${snap.workMapLink}`);
  const loc = rec ? '' : (snap.workAddress || snap.workMapLink || '').trim();
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + '&text=' + encodeURIComponent(title)
    + '&dates=' + d0 + '/' + d1
    + (det.length ? '&details=' + encodeURIComponent(det.join('\n')) : '')
    + (loc ? '&location=' + encodeURIComponent(loc) : '');
}

// Botón "Google Calendar" del diálogo: guarda primero (para no perder los
// datos al saltar de app) y abre el/los evento(s) precargado(s). En un
// trabajo de varios días abre un evento por cada día ubicado.
function agendaGcal() {
  if (_agendaMode === 'recontacto') {
    const f = _agendaRecon || '';
    if (!f) { toast('Elegí primero el día del recontacto', 'info', 2500); return; }
    const e = _agendaPersist();
    if (!e) { closeAgendaDlg(); return; }
    window.open(agendaGcalUrl(e, f, 'recontacto'), '_blank', 'noopener');
    closeAgendaDlg();
    renderHistory();
    toast(`Recontacto agendado: ${fmtDiaCorto(f)}`, 'ok');
    return;
  }
  // Trabajo: auto-agrega el día tipeado y abre un evento por cada día ubicado.
  const inp = document.getElementById('agenda-fecha');
  const typed = (inp && inp.value) || '';
  if (typed && !_agendaFechas.includes(typed)) { _agendaFechas.push(typed); _agendaFechas.sort(); }
  if (!_agendaFechas.length) { toast('Elegí primero al menos un día del trabajo', 'info', 2500); return; }
  const e = _agendaPersist();
  if (!e) { closeAgendaDlg(); return; }
  const fechas = agFechas(e);
  fechas.forEach((f, i) => {
    window.open(agendaGcalUrl(e, f, 'trabajo', { idx: i + 1, total: fechas.length }), '_blank', 'noopener');
  });
  closeAgendaDlg();
  renderHistory();
  const pend = agDiasPendientes(e);
  let msg = fechas.length === 1
    ? `Trabajo agendado: ${fmtDiaCorto(fechas[0])}`
    : `${fechas.length} eventos abiertos en Calendar`;
  if (pend > 0) msg += ` · +${pend} por ubicar`;
  toast(msg, 'ok');
}

// ─── PUENTE PRESUPUESTO → FACTURACIÓN ────────────────────────
// Presupuesto del que se está por registrar factura (lo setea el puente al
// llevar a la pestaña Facturación). Permite enlazar la factura con su
// presupuesto y marcarlo como facturado al confirmar el registro.
let _pendingFacturaQuote = null; // { id, quoteNumber } o null

// Ofrece, con un toast accionable, las dos cosas que se hacen apenas termina
// un trabajo: mandarle al cliente los datos para pagar (está ahí, en el lugar)
// y registrar la factura. Cada botón aparece solo si tiene sentido — sin alias
// cargado no hay datos que mandar, y sin monto (o ya facturado) no hay factura
// que registrar. Si no queda ninguno, no se muestra nada.
function _ofrecerCierreTrabajo(entry) {
  if (!entry) return;
  const puedeFacturar = !entry.facturado && entry.total > 0;
  const puedeCobrar   = !!((S.coAliasPago || '').trim() || (S.coCbu || '').trim());
  if (!puedeFacturar && !puedeCobrar) return;
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast toast-info toast-action';
  el.innerHTML = `<span>Trabajo terminado. ¿Qué querés hacer?</span>
    ${puedeCobrar   ? `<button type="button" class="toast-btn" data-act="cobro">Datos de pago</button>` : ''}
    ${puedeFacturar ? `<button type="button" class="toast-btn" data-act="factura">Registrar factura</button>` : ''}`;
  c.appendChild(el);
  requestAnimationFrame(()=>{ requestAnimationFrame(()=>el.classList.add('show')); });
  const close = () => { el.classList.remove('show'); setTimeout(()=>el.remove(), 300); };
  el.querySelectorAll('.toast-btn').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.act === 'cobro') enviarDatosDePago(entry.id);
      else                             irARegistrarFactura(entry.id);
      close();
    };
  });
  // Dos decisiones en vez de una: un poco más de aire para leerlas.
  setTimeout(close, 12000);
}

// Abre WhatsApp con el mensaje de cobro (plantilla editable en Empresa) para
// el cliente del presupuesto. Reusa buildWhatsappLink, que ya resuelve el
// teléfono desde el snapshot y cae al selector de contactos si no hay.
//
// Además deja el alias SOLO en el portapapeles: en WhatsApp, "Copiar" toma el
// mensaje entero, así que la única forma de que el cliente copie el alias de
// un toque es que llegue como mensaje suelto. Con esto, mandarlo es pegar.
function enviarDatosDePago(id) {
  const e = getH().find(x => x.id === id);
  if (!e) return;
  // Se copia el alias; si no hay, el CBU. Es la clave que el cliente pega en
  // el homebanking — el resto de los datos son para que verifique, no para
  // copiar.
  const clave = (S.coAliasPago || '').trim() || (S.coCbu || '').trim();
  if (!clave) { toast('Cargá tu alias o CBU en ⚙ Configuración → Negocio → Datos para cobrar', 'info', 5000); return; }
  const cfg = (typeof getFollowupCfg === 'function') ? getFollowupCfg() : FOLLOWUP_DEF;
  const tpl = (cfg.waCobroTemplate && cfg.waCobroTemplate.trim()) ? cfg.waCobroTemplate : FOLLOWUP_DEF.waCobroTemplate;
  // El portapapeles ANTES de abrir WhatsApp: después la pestaña pierde el foco
  // y el navegador rechaza la escritura.
  let copiado = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clave); copiado = true;
    }
  } catch(_){}
  window.open(buildWhatsappLink(e, tpl), '_blank', 'noopener');
  const qué = (S.coAliasPago || '').trim() ? 'Alias' : 'CBU';
  toast(copiado
    ? `${qué} copiado: mandalo como segundo mensaje suelto y lo copia de un toque`
    : 'Se abrió WhatsApp con los datos de pago', 'info', 6000);
}

// Lleva a la pestaña Facturación con el formulario precargado desde un
// presupuesto. El usuario revisa el monto (puede diferir del presupuestado por
// descuentos, anticipos, etc.) y confirma con "Registrar factura".
function irARegistrarFactura(id) {
  const e = getH().find(x => x.id === id);
  if (!e) return;
  switchTab('facturacion'); // dispara factInit() → setea la fecha de hoy
  const setVal = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v; };
  setVal('fact-monto',   e.total || '');
  setVal('fact-cliente', e.clientName || '');
  // El concepto de una colaboración es el trabajo que se prestó ("Día de
  // trabajo como trepador — 2 jornadas"), no un número de presupuesto: es lo
  // que después se lee en la lista de facturas y en el recibo.
  setVal('fact-desc',    esTrabajoPropio(e) && e.colab
    ? `${e.colab.nombre} — ${misSvcCantTxt(e.colab.cantidad, e.colab.unidad)}`
    : 'Presupuesto ' + (e.quoteNumber || ''));
  _pendingFacturaQuote = { id: e.id, quoteNumber: e.quoteNumber || '' };
  const form = document.querySelector('#panel-facturacion .fact-form');
  if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const mi = document.getElementById('fact-monto');
  if (mi) { try { mi.focus(); mi.select(); } catch(_){} }
  toast('Revisá el monto y tocá "Registrar factura"', 'info', 5000);
}

// Marca como "enviado" el presupuesto que corresponde al N° activo,
// SOLO si está en borrador. Se llama desde el toast que aparece al
// generar el PDF (opción B: el usuario decide con un toque).
function marcarComoEnviado(quoteNumber) {
  const h = getH();
  const e = h.find(x => x.quoteNumber === quoteNumber);
  if (!e) return;
  if (e.estado && e.estado !== 'borrador') return; // ya avanzó, no retroceder
  e.estado = 'enviado';
  e.enviadoEn = new Date().toISOString(); // habilita el seguimiento
  delete e.seguimientoHechoEn;
  setH(h);
  renderHistory();
  toast('✓ Marcado como enviado', 'ok');
}

// ─── VISTA PREVIA (sin cargar el presupuesto) ────────────────
// Muestra el documento de un presupuesto guardado en un modal, usando
// la MISMA maquinaria que el PDF (buildDoc/buildEstDoc/buildRiskDoc),
// pero SIN tocar lo que el usuario está editando. Estrategia:
//   1. Guardar el estado actual (S) y el contenido de #doc-a4.
//   2. Cargar temporalmente el snapshot del presupuesto en S.
//   3. Llamar a buildDoc() — escribe en #doc-a4.
//   4. Mover ese HTML al modal de preview.
//   5. Restaurar S y #doc-a4 a como estaban. El usuario no nota nada.
let _previewBackup = null;

// ─── DOCUMENTO DE UN TRABAJO SIN PRESUPUESTO ─────────────────
// Un trabajo directo o una colaboración también tienen su papel: el snapshot
// que guardan ya es un presupuesto completo (cliente, lugar, renglón, total).
// Para dibujarlo NO se duplica buildDoc —el recibo ya probó que la maquinaria
// se reusa—, sino que se le pasa un override que vive SOLO lo que dura la
// construcción: cambia la etiqueta del número, el título, cómo se llama el
// destinatario y qué secciones entran. Fuera de esa ventana vale null y el
// presupuesto de siempre sale idéntico, byte por byte.
//
// Lo que ningún tipo lleva es la VIGENCIA: el snapshot va sin `dateExpiry`
// porque el trabajo no vence, así que la franja saldría "Vence el —".
let _docTrabajo = null;

function _docTrabajoDe(e) {
  return esTrabajoPropio(e) ? trabajoCfg(tipoTrabajo(e)).doc : null;
}

// Nombre del papel en los textos de compartir: "Presupuesto D-2026-0001" o
// "Detalle T-2026-0001".
function _entryDocCorto(e) {
  const d = _docTrabajoDe(e);
  return (d && d.corto) || 'Presupuesto';
}

function previewFromHistory(id) {
  const e = getH().find(x => x.id === id);
  if (!e || !e.snapshot) { toast('No se pudo abrir la vista previa', 'err'); return; }

  const docEl     = document.getElementById('doc-a4');
  const contentEl = document.getElementById('doc-preview-content');
  const overlay   = document.getElementById('doc-preview-overlay');
  const titleEl   = document.getElementById('doc-preview-title');
  if (!docEl || !contentEl || !overlay) return;

  // 1. Backup del estado real (se restaura al cerrar la vista previa).
  _previewBackup = {
    S: JSON.parse(JSON.stringify(S)),
    activeScenario: activeScenario,
    docHTML: docEl.innerHTML,
  };

  // 2. Cargar el snapshot en S (temporal), conservando la configuración de la
  //    empresa y el diseño ACTUALES: la previa de un presupuesto viejo tiene
  //    que verse como sale hoy, con tu nombre, tu logo y tu diseño de ahora
  //    (ver CFG_GLOBAL_FIELDS).
  const snap = migrateState(JSON.parse(JSON.stringify(e.snapshot)));
  assignSnapshot(S, snap);
  if (!Array.isArray(S.itemsB)) S.itemsB = [];
  if (!S.estItems) S.estItems = [];
  normalizeRiskData();
  activeScenario = 'A';
  _docTrabajo = _docTrabajoDe(e);

  // 3. Construir el documento (escribe en #doc-a4)
  try {
    buildDoc();
  } catch (err) {
    console.error('Error al construir la vista previa', err);
    _restorePreviewState();
    toast('Error al generar la vista previa', 'err');
    return;
  }

  // 4. Mover el HTML al modal
  contentEl.innerHTML = docEl.innerHTML;
  if (titleEl) {
    titleEl.textContent = (e.quoteNumber || 'Vista previa')
      + (e.clientName ? ' · ' + e.clientName : '');
  }

  // 5. Restaurar el estado real (el HTML ya está copiado al modal)
  _restorePreviewState();

  // Mostrar y escalar para que entre en pantalla
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(_scalePreview);
}

function _restorePreviewState() {
  _docTrabajo = null;
  if (!_previewBackup) return;
  Object.assign(S, _previewBackup.S);
  activeScenario = _previewBackup.activeScenario;
  const docEl = document.getElementById('doc-a4');
  if (docEl) docEl.innerHTML = _previewBackup.docHTML;
  _previewBackup = null;
}

// Escala el "papel" A4 (210mm) para que entre en el ancho disponible.
function _scalePreview() {
  const scroll = document.querySelector('.doc-preview-scroll');
  const paper  = document.getElementById('doc-preview-paper');
  const content= document.getElementById('doc-preview-content');
  if (!scroll || !paper || !content) return;
  // Ancho A4 en px (210mm ≈ 793.7px a 96dpi)
  const A4_PX = 793.7;
  const avail = scroll.clientWidth - 32; // menos el padding
  const scale = Math.min(1, avail / A4_PX);
  content.style.transform = `scale(${scale})`;
  content.style.transformOrigin = 'top left';
  // Ajustar el alto del paper al contenido escalado para que el scroll
  // no quede con espacio vacío de más.
  const h = content.getBoundingClientRect().height;
  paper.style.width  = (A4_PX * scale) + 'px';
  paper.style.height = h + 'px';
}

function closePreview() {
  const overlay = document.getElementById('doc-preview-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  const content = document.getElementById('doc-preview-content');
  if (content) { content.innerHTML = ''; content.style.transform = ''; }
}

// ─── COMPARTIR IMAGEN (PNG) POR WHATSAPP (Web Share API con archivo) ─────
// Genera una imagen PNG del presupuesto completo y la entrega a la bandeja
// nativa del sistema (navigator.share), que ofrece WhatsApp con la imagen YA
// adjunta. Es una opción ALTERNATIVA: NO toca el flujo de impresión (printDoc
// / window.print), que sigue siendo el PDF vectorial de máxima calidad.
//
// La librería html2pdf (trae html2canvas, que es lo que usamos para rasterizar
// el documento a canvas) se carga lazy la primera vez — a propósito NO está en
// el APP_SHELL para no inflar la carga inicial de la app en el campo. El
// Service Worker la cachea tras el primer uso, así que los usos offline
// siguientes funcionan; SOLO la primera vez necesita conexión.
let _h2pLoading = null;
function ensureHtml2Pdf() {
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  if (_h2pLoading) return _h2pLoading;
  _h2pLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './vendor/html2pdf.bundle.min.js';
    s.async = true;
    s.onload = () => window.html2pdf ? resolve(window.html2pdf) : reject(new Error('html2pdf no disponible'));
    s.onerror = () => { _h2pLoading = null; reject(new Error('no se pudo cargar html2pdf')); };
    document.head.appendChild(s);
  });
  return _h2pLoading;
}

// Leaflet (mapa) se vendoriza en /vendor y se carga lazy la primera vez que se
// abre la pestaña Mapa — mismo criterio que html2pdf. Está en APP_SHELL, así
// que offline funciona; los TILES del mapa sí necesitan conexión (son imágenes
// remotas de OpenStreetMap), pero la lógica de marcadores/pines es local.
let _leafletLoading = null;
function ensureLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (_leafletLoading) return _leafletLoading;
  _leafletLoading = new Promise((resolve, reject) => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = './vendor/leaflet.css';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = './vendor/leaflet.js';
    s.async = true;
    s.onload = () => (window.L && window.L.map) ? resolve(window.L) : reject(new Error('Leaflet no disponible'));
    s.onerror = () => { _leafletLoading = null; reject(new Error('no se pudo cargar Leaflet')); };
    document.head.appendChild(s);
  });
  return _leafletLoading;
}

// Construye el documento de un entry del historial y devuelve su HTML, SIN
// alterar lo que el usuario está editando (mismo swap de estado que usa
// previewFromHistory: backup de S → cargar snapshot → buildDoc → restaurar).
function _buildDocHTMLForEntry(e) {
  const docEl = document.getElementById('doc-a4');
  if (!docEl || !e || !e.snapshot) return null;
  const backup = {
    S: JSON.parse(JSON.stringify(S)),
    activeScenario: activeScenario,
    docHTML: docEl.innerHTML,
  };
  try {
    // La imagen que se comparte lleva los datos de empresa y el diseño de HOY
    // (ver CFG_GLOBAL_FIELDS): si reenviás un presupuesto viejo, tiene que salir
    // con tu nombre y tu contacto actuales, no con los de entonces.
    const snap = migrateState(JSON.parse(JSON.stringify(e.snapshot)));
    assignSnapshot(S, snap);
    if (!Array.isArray(S.itemsB)) S.itemsB = [];
    if (!S.estItems) S.estItems = [];
    normalizeRiskData();
    activeScenario = 'A';
    _docTrabajo = _docTrabajoDe(e);
    buildDoc();
    return docEl.innerHTML;
  } catch (err) {
    console.error('Error al construir el documento para compartir', err);
    return null;
  } finally {
    _docTrabajo = null;
    Object.assign(S, backup.S);
    activeScenario = backup.activeScenario;
    docEl.innerHTML = backup.docHTML;
  }
}

// Renderiza el documento del entry en un contenedor fuera de pantalla con los
// MISMOS estilos del documento en pantalla (clases .doc-preview-host >
// .doc-a4-screen, ver CSS ~1159). Devuelve {host, inner} o null. El llamador
// DEBE hacer host.remove() al terminar.
function _offscreenDoc(e) {
  const html = _buildDocHTMLForEntry(e);
  if (!html) return null;
  const host = document.createElement('div');
  host.className = 'doc-preview-host';
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;background:#fff;z-index:-1';
  const inner = document.createElement('div');
  inner.className = 'doc-a4-screen';
  inner.innerHTML = html;
  host.appendChild(inner);
  document.body.appendChild(host);
  return { host, inner };
}

// Nombre de archivo legible "N°-Cliente" (sin extensión).
function _entryFileBase(e) {
  const cliente = (e.clientName || '').trim().replace(/[^\w\sáéíóúñüÁÉÍÓÚÑÜ-]/g, '').trim();
  const num = (e.quoteNumber || 'presupuesto').replace(/[^\w-]/g, '');
  return (cliente ? `${num}-${cliente}` : num).replace(/\s+/g, '_');
}

// Espera a que TODAS las <img> dentro de root terminen de cargar (o fallen),
// con un tope de tiempo para no colgarse si una foto no resuelve. Es
// IMPRESCINDIBLE antes de rasterizar con html2canvas: si la captura ocurre
// mientras las fotos del Registro Fotográfico están a medio cargar, html2canvas
// mide el documento "compacto" (las fotos colapsadas a 0) pero las dibuja a su
// tamaño real, dejando bandas en blanco donde estarían (el "espacio grande
// entre hojas"). Esperarlas hace que la imagen salga idéntica a la vista previa.
function _awaitDocImages(root, timeoutMs = 8000) {
  const imgs = [...root.querySelectorAll('img')];
  const pending = imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    if (img.decode) return img.decode().catch(() => {});   // lo más fiable
    return new Promise(res => { img.onload = img.onerror = res; });
  });
  // Tras cargar, un par de fotogramas para que el layout (alturas de las fotos
  // clampeadas a max-height) se asiente antes de medir/rasterizar.
  const settle = Promise.all(pending).then(() => new Promise(res =>
    requestAnimationFrame(() => requestAnimationFrame(res))));
  const guard = new Promise(res => setTimeout(res, timeoutMs));
  return Promise.race([settle, guard]);
}

// Fallback manual (escritorio o cuando navigator.share falla): descarga la
// imagen y abre WhatsApp con un texto, para que el usuario la adjunte a mano.
function _downloadAndWhatsApp(file, e) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  const phone = (typeof normalizeArgPhone === 'function')
    ? normalizeArgPhone((e.snapshot && e.snapshot.clientContact) || '') : '';
  const base = phone ? `https://wa.me/${phone}` : 'https://wa.me/';
  const quePaso = _entryDocCorto(e).toLowerCase() + ' ' + (e.quoteNumber || '');
  window.open(`${base}?text=${encodeURIComponent('Te paso el ' + quePaso.trim())}`, '_blank', 'noopener');
  toast('Imagen descargada. Adjuntala en WhatsApp.', 'info', 6000);
}

// Comparte un File por la bandeja nativa del sistema (navigator.share). Debe
// llamarse DENTRO del gesto del usuario (ver sharePngFromHistory: el envío va
// en un segundo toque fresco) para no perder la activación transitoria. Si el
// dispositivo no soporta compartir archivos, o si navigator.share falla de
// verdad (p. ej. la activación ya venció → NotAllowedError), cae al flujo
// manual (descargar + WhatsApp) para no dejar al usuario sin nada.
async function _shareFileOrFallback(file, e) {
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    const empresa = ((e.snapshot && e.snapshot.coName) || S.coName || '').trim();
    const txt = `${_entryDocCorto(e)} ${e.quoteNumber || ''}${empresa ? ' — ' + empresa : ''}`.trim();
    try {
      await navigator.share({ files: [file], title: file.name, text: txt });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // el usuario canceló la bandeja
      // Falló de verdad → en vez de un error sin salida, caemos al camino manual.
      console.error('navigator.share falló; uso descarga + WhatsApp como fallback', err);
    }
  }
  // Fallback escritorio / sin soporte de compartir-archivos / share falló.
  _downloadAndWhatsApp(file, e);
}

// Calcula el factor de escala (≈ DPI) más alto posible para rasterizar el
// documento, pero acotado para no reventar los límites de canvas de los
// celulares (gama baja Android limita el ÁREA total y cada DIMENSIÓN). Un
// presupuesto de 1–2 páginas sale a 3×; uno muy largo baja solo para no fallar.
function _bestRasterScale(cssW, cssH) {
  const MAX_SCALE = 3;     // tope: más que esto casi no se nota y pesa de más
  const MAX_DIM   = 12000; // px por lado, conservador para Android gama baja
  const MAX_AREA  = 30e6;  // ~30 MP de área total del canvas
  if (!cssW || !cssH) return 2;
  let s = MAX_SCALE;
  s = Math.min(s, MAX_DIM / cssW, MAX_DIM / cssH);
  s = Math.min(s, Math.sqrt(MAX_AREA / (cssW * cssH)));
  return Math.max(1.5, Math.round(s * 100) / 100); // piso 1.5×
}

// Imagen ya generada y lista para enviar (flujo de DOS TOQUES, ver abajo).
// Guardamos solo UNA a la vez para no retener memoria. Se limpia al re-render
// del historial (renderHistory) y tras enviarla.
let _pngShareReady = null; // { id, file, btn }

// Deja un botón "Compartir" en su estado base (por si quedó en "Enviar imagen").
function _resetShareBtn(btn) {
  if (!btn || !btn.isConnected) return;
  btn.disabled = false;
  btn.classList.remove('btn-ready');
  btn.innerHTML = `${icon('image')} Compartir`;
}

// Descarta cualquier imagen lista pendiente y restaura su botón.
function _clearPngShareReady() {
  if (_pngShareReady) { _resetShareBtn(_pngShareReady.btn); _pngShareReady = null; }
}

// Compartir como imagen PNG del presupuesto COMPLETO (una sola imagen larga).
// Usa html2canvas (vía html2pdf) para rasterizar el documento y lo exporta como
// PNG SIN PÉRDIDA. Calidad máxima: esperamos a que las fuentes estén cargadas
// (texto nítido, sin fallback) y rasterizamos al mayor DPI que el dispositivo
// banque. Es la opción para quien prefiera mandar una imagen; el PDF vectorial
// de máxima calidad sigue estando en el botón Imprimir/PDF de siempre.
//
// FLUJO DE DOS TOQUES (importante): navigator.share exige "activación
// transitoria" (estar todavía dentro del gesto del usuario, ventana de ~5 s en
// Android). Como rasterizar puede tardar más que eso (documentos largos, fotos,
// celu lento), si compartiéramos en el mismo toque la activación ya habría
// vencido → NotAllowedError → "no se pudo compartir". Por eso separamos:
//   1er toque → genera la imagen (trabajo pesado) y deja el botón en "Enviar".
//   2do toque → comparte YA, dentro de un gesto fresco (share nunca falla por
//               activación vencida).
async function sharePngFromHistory(id, btn) {
  const e = getH().find(x => x.id === id);
  if (!e || !e.snapshot) { toast('No se pudo abrir el presupuesto', 'err'); return; }

  // SEGUNDO TOQUE: ya hay una imagen lista para ESTE presupuesto → compartir
  // ahora mismo, sin ningún await previo, para conservar la activación del gesto.
  if (_pngShareReady && _pngShareReady.id === id && _pngShareReady.file) {
    const file = _pngShareReady.file;
    _resetShareBtn(_pngShareReady.btn);
    if (btn && btn !== _pngShareReady.btn) _resetShareBtn(btn);
    _pngShareReady = null;
    await _shareFileOrFallback(file, e);
    return;
  }

  // Si había una imagen lista de OTRO presupuesto, descartarla y resetear su botón.
  _clearPngShareReady();

  // PRIMER TOQUE: generar la imagen (trabajo pesado). NO compartimos acá.
  if (btn) { btn.disabled = true; btn.innerHTML = `${icon('image')} Generando…`; }
  toast('Generando imagen para compartir…', 'info', 4000);
  let h2p;
  try { h2p = await ensureHtml2Pdf(); }
  catch (err) { _resetShareBtn(btn); toast('⚠️ No se pudo cargar el generador de imagen. La primera vez necesita conexión.', 'err', 6000); return; }
  // Fuentes listas antes de rasterizar: si html2canvas captura mientras la
  // tipografía de marca aún no cargó, el texto sale con la fuente de respaldo.
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (_) {}
  const od = _offscreenDoc(e);
  if (!od) { _resetShareBtn(btn); toast('No se pudo generar el documento', 'err'); return; }
  try {
    // Esperar a que las fotos carguen ANTES de medir/rasterizar (ver
    // _awaitDocImages): evita el espacio en blanco entre secciones.
    await _awaitDocImages(od.inner);
    const cssW = od.inner.offsetWidth;
    const cssH = od.inner.offsetHeight;
    const scale = _bestRasterScale(cssW, cssH);
    const canvas = await h2p().set({
      html2canvas: {
        scale,
        useCORS: true,
        backgroundColor: '#ffffff',
        imageTimeout: 0,      // sin timeout: esperar a que carguen logo/fotos
        logging: false,
        windowWidth: cssW,    // viewport estable = layout idéntico al de pantalla
      },
    }).from(od.inner).toCanvas().get('canvas');
    // toBlob('image/png') es sin pérdida; el 2º arg (calidad) no aplica a PNG.
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) { _resetShareBtn(btn); toast('No se pudo generar la imagen', 'err'); return; }
    const file = new File([blob], _entryFileBase(e) + '.png', { type: 'image/png' });
    // Imagen lista: el botón queda en modo "Enviar" y esperamos el 2º toque.
    _pngShareReady = { id, file, btn };
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.classList.add('btn-ready');
      btn.innerHTML = `${icon('share')} Enviar imagen`;
    }
    toast('✅ Imagen lista — tocá "Enviar imagen" para compartir', 'ok', 5000);
  } catch (err) {
    console.error('Error generando la imagen para compartir', err);
    _resetShareBtn(btn);
    toast('⚠️ No se pudo generar la imagen', 'err', 5000);
  } finally {
    od.host.remove();
  }
}

// Vista previa del presupuesto que se está editando AHORA (sin pasar por el
// historial). Construye el documento desde el estado actual y lo muestra en
// el mismo overlay que usa previewFromHistory.
function previewCurrent() {
  syncFromUI();
  const docEl     = document.getElementById('doc-a4');
  const contentEl = document.getElementById('doc-preview-content');
  const overlay   = document.getElementById('doc-preview-overlay');
  const titleEl   = document.getElementById('doc-preview-title');
  if (!docEl || !contentEl || !overlay) return;
  try {
    buildDoc();
  } catch (err) {
    console.error('Error al construir la vista previa', err);
    toast('Error al generar la vista previa', 'err');
    return;
  }
  contentEl.innerHTML = docEl.innerHTML;
  if (titleEl) {
    titleEl.textContent = (S.quoteNumber || 'Vista previa')
      + (S.clientName ? ' · ' + S.clientName : '');
  }
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(_scalePreview);
}

// Si la vista previa está abierta, la regenera con el estado actual. Se usa al
// reordenar las secciones del PDF para ver el cambio al instante.
function refreshPreviewIfOpen() {
  const overlay = document.getElementById('doc-preview-overlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  const docEl     = document.getElementById('doc-a4');
  const contentEl = document.getElementById('doc-preview-content');
  try { buildDoc(); } catch (e) { return; }
  if (docEl && contentEl) {
    contentEl.innerHTML = docEl.innerHTML;
    requestAnimationFrame(_scalePreview);
  }
}

// ─── ORDEN DE LAS SECCIONES DEL PDF ──────────────────────────
// Lista reordenable (flechas ↑/↓, robusto en celular) que controla
// S.docSectionOrder. Cada cambio guarda y refresca la vista previa si está
// abierta. Ver DOC_SECTIONS / sanitizeSectionOrder / buildDoc.
function renderSectionOrder() {
  const host = document.getElementById('doc-section-order');
  if (!host) return;
  const order = sanitizeSectionOrder(S.docSectionOrder);
  S.docSectionOrder = order; // deja el estado normalizado
  host.innerHTML = order.map((id, i) => {
    const sec = DOC_SECTIONS.find(s => s.id === id);
    return `<div class="sord-row">
      <span class="sord-num">${i + 1}</span>
      <span class="sord-label">${esc(sec ? sec.label : id)}</span>
      <span class="sord-btns">
        <button type="button" class="sord-btn" onclick="moveSection('${id}',-1)" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
        <button type="button" class="sord-btn" onclick="moveSection('${id}',1)" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Bajar">▼</button>
      </span>
    </div>`;
  }).join('');
}

function moveSection(id, dir) {
  const order = sanitizeSectionOrder(S.docSectionOrder);
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  S.docSectionOrder = order;
  saveLS();
  renderSectionOrder();
  refreshPreviewIfOpen();
}

// Toggle del plan de trabajo a medida (Editor). Muestra/oculta la caja de
// edición y, al activarlo por primera vez, precarga el plan global como punto
// de partida para que el usuario lo ajuste en vez de escribir de cero.
function toggleWorkPlanOverride() {
  const on  = gc('wp-override');
  const box = document.getElementById('wp-override-box');
  if (box) box.style.display = on ? 'block' : 'none';
  if (on) {
    // Precargar el plan global como punto de partida si todavía no hay nada.
    if (!(S.workPlanCustom || '').trim())      S.workPlanCustom = S.workPlan || '';
    if (!(S.workPlanCustomTitle || '').trim()) S.workPlanCustomTitle = S.workPlanTitle || '';
    sv('wp-custom-title', S.workPlanCustomTitle);
    renderLineList('wp-custom-list');
  }
  syncFromUI();
  refreshPreviewIfOpen();
}

// ─── EDITOR DE LISTAS "UNO POR ÍTEM" ─────────────────────────
// Reemplaza los textarea "uno por línea" por una lista donde cada ítem es su
// propio casillero (numerado, con botón de borrar). Así se ve claramente la
// división de cada punto, en vez de un bloque de texto donde las líneas largas
// se mezclan. Se serializa al MISMO string con '\n' que antes, así no cambia
// ni el almacenamiento ni la construcción del PDF.
const LINELISTS = {
  'wp-custom-list':     { get:()=>S.workPlanCustom, set:v=>{S.workPlanCustom=v;}, ph:'Ej. Tala dirigida sobre la medianera del vecino.' },
  'doc-work-plan-list': { get:()=>S.workPlan,        set:v=>{S.workPlan=v;},        ph:'Ej. Trabajo realizado por personal capacitado…' },
  'doc-criteria-list':  { get:()=>S.docCriteria,     set:v=>{S.docCriteria=v;},     ph:'Ej. Altura y Acceso | Evaluamos el ingreso…' },
};

function renderLineList(hostId, rows) {
  const host = document.getElementById(hostId);
  const cfg  = LINELISTS[hostId];
  if (!host || !cfg) return;
  if (!rows) { const v = cfg.get() || ''; rows = (v === '') ? [''] : v.split('\n'); }
  if (!rows.length) rows = [''];
  host.innerHTML = rows.map((l, i) => `
    <div class="llrow">
      <span class="llnum">${i + 1}</span>
      <textarea class="llinput" rows="1" placeholder="${esc(cfg.ph || '')}"
             oninput="onLineListInput('${hostId}')" onkeydown="onLineListKey(event,'${hostId}',${i})">${esc(l)}</textarea>
      <button type="button" class="lldel" onclick="removeLineListRow('${hostId}',${i})" aria-label="Quitar ítem">×</button>
    </div>`).join('') +
    `<button type="button" class="lladd" onclick="addLineListRow('${hostId}')">+ Agregar ítem</button>`;
}

// Lee las filas tal como están en el DOM (incluye vacías, para no perder el
// cursor mientras se edita). El valor que se guarda filtra las vacías.
function _lineListRows(hostId) {
  const host = document.getElementById(hostId);
  return host ? [...host.querySelectorAll('.llinput')].map(i => i.value.replace(/\s*\n\s*/g, ' ')) : [];
}
function _commitLineList(hostId) {
  const cfg = LINELISTS[hostId]; if (!cfg) return;
  cfg.set(_lineListRows(hostId).filter(v => v.trim() !== '').join('\n'));
  saveLS();
  refreshPreviewIfOpen();
}
function onLineListInput(hostId) { _commitLineList(hostId); }
function addLineListRow(hostId) {
  const rows = _lineListRows(hostId); rows.push('');
  renderLineList(hostId, rows); _commitLineList(hostId);
  const ins = document.getElementById(hostId).querySelectorAll('.llinput');
  if (ins.length) ins[ins.length - 1].focus();
}
function removeLineListRow(hostId, i) {
  const rows = _lineListRows(hostId); rows.splice(i, 1);
  if (!rows.length) rows.push('');
  renderLineList(hostId, rows); _commitLineList(hostId);
}
// Enter inserta un ítem nuevo debajo (flujo natural al escribir una lista).
function onLineListKey(e, hostId, i) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const rows = _lineListRows(hostId); rows.splice(i + 1, 0, '');
  renderLineList(hostId, rows); _commitLineList(hostId);
  const ins = document.getElementById(hostId).querySelectorAll('.llinput');
  if (ins[i + 1]) ins[i + 1].focus();
}

// Abre WhatsApp con un mensaje de ENVÍO (no de seguimiento) dirigido al
// cliente del presupuesto actual. wa.me solo permite texto: el PDF se
// adjunta a mano, por eso el recordatorio en el toast.
function sendCurrentWhatsapp() {
  syncFromUI();
  // Mismo control que al imprimir. El window.open va DESPUÉS del "Enviar
  // igual", que es otro toque del usuario: la ventana sigue permitida.
  const pend = huecosPendientes();
  if (pend.length) { confirmarHuecos('Enviar igual').then(ok => { if (ok) _sendCurrentWhatsappGo(); }); return; }
  _sendCurrentWhatsappGo();
}

function _sendCurrentWhatsappGo() {
  const phone = normalizeArgPhone(S.clientContact || '');
  // El texto sale de la plantilla editable (Empresa → Mi negocio), con las
  // variables reemplazadas por los datos del presupuesto actual.
  const cfg = (typeof getFollowupCfg === 'function') ? getFollowupCfg() : FOLLOWUP_DEF;
  // Si lo que sale es una VERSIÓN de un presupuesto anterior, el mensaje es
  // otro: el cliente ya conoce el trabajo y lo que cambió es el precio. Cada
  // plantilla se edita por separado en Empresa (ver saveActualizacionTemplate).
  const esVersion = (parseInt(S.versionN, 10) || 0) > 1;
  const tplKey = esVersion ? 'waActualizacionTemplate' : 'waSendTemplate';
  const tpl = (cfg[tplKey] && cfg[tplKey].trim()) ? cfg[tplKey] : FOLLOWUP_DEF[tplKey];
  const t = S.isEstimative ? calcEstTotals(S.estItems).total : calcTotals().total;
  const msg = fillWaTemplate(tpl, {
    cliente: (S.clientName || '').trim(),
    numero:  S.quoteNumber || '',
    empresa: (S.coName || '').trim(),
    importe: t > 0 ? fmtM(t, S.currency) : '',
  });
  // Dejamos registro en el historial (igual que al imprimir).
  if (typeof autoSaveToHistory === 'function') autoSaveToHistory();
  const base = phone ? `https://wa.me/${phone}` : 'https://wa.me/';
  window.open(`${base}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  toast('Se abrió WhatsApp. Acordate de adjuntar el PDF que descargaste.', 'info', 6000);
}

// Reescalar si rota el celular o cambia el tamaño
window.addEventListener('resize', () => {
  const ov = document.getElementById('doc-preview-overlay');
  if (ov && ov.classList.contains('open')) _scalePreview();
});

// ─── AVISOS DEL HISTORIAL: una línea plegable ─────────────────
// Los tres banners (recontactos · seguimientos · vencidos) viven dentro de
// #hist-avisos-body. Desplegados ocupaban dos pantallas ANTES del buscador
// (medido con 36 presupuestos en un celular de 360 px): buscar un presupuesto
// obligaba a pasar por encima de todos los pendientes. Ahora se resumen en una
// línea con las cantidades, que se toca para desplegarlos. La preferencia
// (abierto/cerrado) es del dispositivo: LS.HIST_AVISOS, fuera del backup.
// Cada banner deja su cantidad en data-n al pintarse y llama acá.
const HIST_AVISOS_DEF = [
  ['recontacto-banner', 'is-rec', 'phone',     n => `${n} para recontactar`],
  ['followup-banner',   'is-seg', 'bell',      n => `${n} para seguimiento`],
  ['expiry-banner',     'is-ven', 'hourglass', n => `${n} vencido${n > 1 ? 's' : ''}`],
];
function histAvisosAbierto() {
  try { return localStorage.getItem(LS.HIST_AVISOS) === '1'; } catch (_) { return false; }
}
function histAvisosSync() {
  const wrap = document.getElementById('hist-avisos');
  if (!wrap) return;
  let total = 0;
  const chips = HIST_AVISOS_DEF.map(([id, cls, ic, txt]) => {
    const el = document.getElementById(id);
    const n = el ? (parseInt(el.dataset.n, 10) || 0) : 0;
    total += n;
    return n ? `<span class="hav-chip ${cls}">${icon(ic)}${esc(txt(n))}</span>` : '';
  }).join('');
  wrap.hidden = !total;
  const abierto = histAvisosAbierto();
  const ch = document.getElementById('hist-avisos-chips');
  if (ch) ch.innerHTML = chips;
  const res = document.getElementById('hist-avisos-res');
  if (res) res.setAttribute('aria-expanded', abierto ? 'true' : 'false');
  const acc = document.getElementById('hist-avisos-acc');
  if (acc) acc.textContent = abierto ? 'Ocultar' : 'Ver';
  const body = document.getElementById('hist-avisos-body');
  if (body) body.hidden = !abierto;
}
// Sin argumento alterna; con true/false fuerza.
function histAvisosToggle(forzar) {
  const abrir = (typeof forzar === 'boolean') ? forzar : !histAvisosAbierto();
  try { localStorage.setItem(LS.HIST_AVISOS, abrir ? '1' : '0'); } catch (_) {}
  histAvisosSync();
}

// ─── SEGUIMIENTO: banner ─────────────────────
// Renderiza el banner de seguimientos pendientes arriba del historial.
// Se llama al arrancar la app y al entrar a la pestaña Historial.
function renderFollowupBanner() {
  // Los tres banners (seguimiento, vencidos y recontactos) se refrescan juntos.
  if (typeof renderExpiryBanner === 'function') renderExpiryBanner();
  if (typeof renderRecontactoBanner === 'function') renderRecontactoBanner();
  // Y de paso el globito de la pestaña Agenda (¿hay algo agendado hoy?).
  if (typeof calUpdateDot === 'function') calUpdateDot();
  const el = document.getElementById('followup-banner');
  if (!el) return;
  const pend = (typeof getPendingFollowups === 'function') ? getPendingFollowups() : [];
  el.dataset.n = pend.length;
  histAvisosSync();
  if (!pend.length) { el.style.display = 'none'; el.innerHTML = ''; return; }

  const n = pend.length;
  el.style.display = 'block';
  el.innerHTML = `
    <div class="fub-head">
      <span class="fub-icon"><svg class="ic ic-c-amber"><use href="#i-bell"></use></svg></span>
      <span class="fub-title">${n} presupuesto${n>1?'s':''} para seguimiento</span>
    </div>
    <div class="fub-sub">Enviado${n>1?'s':''} hace más de ${getFollowupCfg().days} días sin respuesta. Buen momento para contactar al cliente.</div>
    <div class="fub-list">
      ${pend.slice(0,5).map(p => {
        const e = p.entry;
        const wa = buildWhatsappLink(e);
        return `<div class="fub-item">
          <div class="fub-item-info" onclick="goToHistoryEntry(${e.id})" role="button" tabindex="0" title="Ver este presupuesto en el historial">
            <span class="fub-item-num">${esc(e.quoteNumber||'—')}</span>
            <span class="fub-item-client">${esc(e.clientName||'(sin nombre)')}</span>
            <span class="fub-item-days">hace ${p.dias} días</span>
          </div>
          <div class="fub-item-acts">
            <a class="fub-wa" href="${wa}" target="_blank" rel="noopener" onclick="_afterWhatsapp(${e.id})">${icon('message')} WhatsApp</a>
            <button class="fub-done" onclick="marcarSeguimientoHecho(${e.id})" title="Ya hice el seguimiento">✓</button>
          </div>
        </div>`;
      }).join('')}
      ${n>5 ? `<div class="fub-more">y ${n-5} más…</div>` : ''}
    </div>`;
}

// Banner de presupuestos vencidos (arriba del historial, en rojo). Mismo
// patrón que el de seguimiento, pero para los que ya pasaron su vencimiento.
function renderExpiryBanner() {
  const el = document.getElementById('expiry-banner');
  if (!el) return;
  const venc = (typeof getExpiredQuotes === 'function') ? getExpiredQuotes() : [];
  el.dataset.n = venc.length;
  histAvisosSync();
  if (!venc.length) { el.style.display = 'none'; el.innerHTML = ''; return; }

  const n = venc.length;
  el.style.display = 'block';
  el.innerHTML = `
    <div class="fub-head">
      <span class="fub-icon">${icon('hourglass','ic-c-red')}</span>
      <span class="fub-title">${n} presupuesto${n>1?'s':''} vencido${n>1?'s':''}</span>
    </div>
    <div class="fub-sub">Pasó su fecha de vigencia sin cerrarse. Conviene avisarle al cliente o pasarle un presupuesto actualizado.</div>
    <div class="fub-list">
      ${venc.slice(0,5).map(p => {
        const e = p.entry;
        const wa = buildWhatsappLink(e);
        // Esta tarjeta tiene TRES acciones y por eso se arma distinto de las
        // de los otros banners: el texto va arriba con el ✓ ("no avisarme
        // más") al lado, y abajo la fila de las dos acciones reales. En un
        // celular de 360px los tres botones necesitan ~293px y la tarjeta da
        // 280: no hay forma de ponerlos en fila sin apretar el texto —era el
        // número partido en "2026-" / "0058" del reporte—. El ✓ es el que se
        // sube porque es el descarte del aviso, no una acción del trabajo.
        return `<div class="fub-item">
          <div class="fub-item-top">
            <div class="fub-item-info" onclick="goToHistoryEntry(${e.id})" role="button" tabindex="0" title="Ver este presupuesto en el historial">
              <span class="fub-item-num">${esc(e.quoteNumber||'—')}</span>
              <span class="fub-item-client">${esc(e.clientName||'(sin nombre)')}</span>
              <span class="fub-item-days">venció hace ${p.dias} día${p.dias>1?'s':''}</span>
            </div>
            <button class="fub-done" onclick="marcarVencimientoVisto(${e.id})" title="No avisarme más de este">✓</button>
          </div>
          <div class="fub-item-acts">
            <button class="fub-nv" onclick="nuevaVersionQuote(${e.id})" title="Armar la segunda versión con los precios al día">${icon('refresh')} Nueva versión</button>
            <a class="fub-wa" href="${wa}" target="_blank" rel="noopener">${icon('message')} WhatsApp</a>
          </div>
        </div>`;
      }).join('')}
      ${n>5 ? `<div class="fub-more">y ${n-5} más…</div>` : ''}
    </div>`;
}

// ─── RECONTACTOS: banner + aviso global ──────────────────────
// Presupuestos aceptados cuyo día de recontacto ya llegó (hoy o antes),
// el más atrasado primero. Los de fecha futura no molestan.
function getRecontactosPendientes() {
  const out = [];
  getH().forEach(e => {
    if ((e.estado || '') !== 'aceptado' || !e.recontactoEn) return;
    const d = daysSinceDate(e.recontactoEn);
    if (d === null || d < 0) return;
    out.push({ entry: e, dias: d });
  });
  out.sort((a, b) => b.dias - a.dias);
  return out;
}

// Link de WhatsApp con la plantilla de RECONTACTO (coordinar la fecha).
function buildRecontactoWhatsappLink(e) {
  return buildWhatsappLink(e, getFollowupCfg().waRecontactoTemplate || FOLLOWUP_DEF.waRecontactoTemplate);
}

// Banner celeste arriba del historial + globito en la pestaña Historial
// (el globito es el aviso global: las pestañas se ven desde toda la app).
function renderRecontactoBanner() {
  // Refrescar el badge de la campanita: este banner se re-renderiza en cada
  // cambio del historial, así que es un buen punto para mantenerlo al día.
  if (typeof updateNotifBadge === 'function') updateNotifBadge();
  const pend = getRecontactosPendientes();
  const dot = document.getElementById('tab-hist-dot');
  if (dot) { dot.textContent = pend.length; dot.hidden = !pend.length; }
  const el = document.getElementById('recontacto-banner');
  if (!el) return;
  el.dataset.n = pend.length;
  histAvisosSync();
  if (!pend.length) { el.style.display = 'none'; el.innerHTML = ''; return; }

  const n = pend.length;
  el.style.display = 'block';
  el.innerHTML = `
    <div class="fub-head">
      <span class="fub-icon">${icon('phone')}</span>
      <span class="fub-title">${n} cliente${n>1?'s':''} para recontactar</span>
    </div>
    <div class="fub-sub">Aceptaron el presupuesto y quedaron en coordinar la fecha del trabajo. Hoy es el día de retomar la charla.</div>
    <div class="fub-list">
      ${pend.slice(0,5).map(p => {
        const e = p.entry;
        const wa = buildRecontactoWhatsappLink(e);
        const cuando = p.dias === 0 ? 'hoy' : `hace ${p.dias} día${p.dias>1?'s':''}`;
        return `<div class="fub-item">
          <div class="fub-item-info" onclick="goToHistoryEntry(${e.id})" role="button" tabindex="0" title="Ver este presupuesto en el historial">
            <span class="fub-item-num">${esc(e.quoteNumber||'—')}</span>
            <span class="fub-item-client">${esc(e.clientName||'(sin nombre)')}</span>
            <span class="fub-item-days">${cuando}</span>
            ${e.recontactoNota ? `<span class="fub-item-nota">${esc(e.recontactoNota)}</span>` : ''}
          </div>
          <div class="fub-item-acts">
            <a class="fub-wa" href="${wa}" target="_blank" rel="noopener" onclick="_afterRecontactoWhatsapp(${e.id})">${icon('message')} WhatsApp</a>
            <button class="fub-done" onclick="marcarRecontactoHecho(${e.id})" title="Ya lo contacté">✓</button>
          </div>
        </div>`;
      }).join('')}
      ${n>5 ? `<div class="fub-more">y ${n-5} más…</div>` : ''}
    </div>`;
}

// "Ya lo contacté" (✓ del banner): borra el recontacto pendiente. Si de la
// charla salió una fecha, se agenda desde el chip o el toast post-WhatsApp.
function marcarRecontactoHecho(id) {
  const h = getH();
  const e = h.find(x => x.id === id);
  if (!e) return;
  const prevEn = e.recontactoEn, prevNota = e.recontactoNota;
  delete e.recontactoEn;
  delete e.recontactoNota;
  setH(h);
  renderHistory();
  toast('✓ Recontacto hecho', 'ok');
  // Bitácora + Deshacer: si lo tocaste sin querer, restaura el pendiente.
  if (typeof logNotif === 'function') {
    logNotif({
      icon: '📞', kind: 'recontacto',
      text: `Recontacto marcado hecho: ${(e.clientName || '').trim() || '(sin nombre)'}`,
      action: { type: 'entry', id: e.id },
      undo: { type: 'recontacto', id: e.id, recontactoEn: prevEn, recontactoNota: prevNota },
    });
  }
}

// Tras abrir WhatsApp para un recontacto, ofrecer cerrar el ciclo: si
// coordinaron, agendar la fecha del trabajo ahí mismo (lo que además
// borra el recontacto pendiente al guardar).
function _afterRecontactoWhatsapp(id) {
  setTimeout(() => {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast toast-info toast-action';
    el.innerHTML = `<span>¿Coordinaron? Agendá la fecha del trabajo</span>
      <button type="button" class="toast-btn">Agendar</button>`;
    c.appendChild(el);
    requestAnimationFrame(()=>{ requestAnimationFrame(()=>el.classList.add('show')); });
    const close = () => { el.classList.remove('show'); setTimeout(()=>el.remove(),300); };
    el.querySelector('.toast-btn').onclick = () => { openAgendaDlg(id); close(); };
    setTimeout(close, 12000);
  }, 600);
}

// Aviso global al abrir la app: un recontacto vencido no puede depender de
// que el usuario entre al Historial. Toast accionable → lleva al lugar.
function toastRecontactosPendientes() {
  const pend = getRecontactosPendientes();
  if (!pend.length) return;
  const c = document.getElementById('toast-container');
  if (!c) return;
  const first = pend[0].entry;
  const txt = pend.length === 1
    ? `Recontactar a ${first.clientName || 'un cliente'} para coordinar la fecha del trabajo`
    : `Tenés ${pend.length} clientes para recontactar y coordinar fechas`;
  // Bitácora: una vez por día (dedupeKey) para poder volver a verlo desde la
  // campanita aunque el toast se haya cerrado.
  if (typeof logNotif === 'function') {
    logNotif({ icon: '📞', kind: 'recontacto', text: txt, dedupeKey: 'recontactos',
      action: pend.length === 1 ? { type: 'entry', id: first.id } : { type: 'tab', tab: 'historial' } });
  }
  colaAviso(() => {
    const el = document.createElement('div');
    el.className = 'toast toast-info toast-action';
    el.innerHTML = `<span>📞 ${esc(txt)}</span><button type="button" class="toast-btn">Ver</button>`;
    c.appendChild(el);
    requestAnimationFrame(()=>{ requestAnimationFrame(()=>el.classList.add('show')); });
    const close = () => { el.classList.remove('show'); setTimeout(()=>el.remove(),300); };
    el.querySelector('.toast-btn').onclick = () => {
      close();
      if (pend.length === 1) goToHistoryEntry(first.id);
      else switchTab('historial');
    };
    setTimeout(close, 12000);
    return el;
  });
}

// ─── BANNER "PODAS DE HOY" (resumen del día al abrir) ────────
// Trabajos agendados para HOY: presupuestos aceptados que tienen HOY entre
// sus días de trabajo ubicados (un trabajo multi-día reaparece cada uno de
// sus días). Espeja getRecontactosPendientes().
function getTrabajosDeHoy() {
  const hoy = today();
  return getH().filter(e => (e.estado || '') === 'aceptado' && agFechas(e).includes(hoy));
}

// Visitas (evaluaciones presenciales / ir a presupuestar) agendadas para HOY
// que siguen pendientes. Van al banner del día junto con las podas.
function getVisitasDeHoy() {
  const hoy = today();
  return (typeof getNotes === 'function' ? getNotes() : [])
    .filter(n => n && n.tipo === 'visita' && !n.hecho && n.fecha === hoy)
    // Las que tienen hora, en orden; las de día completo al final.
    .sort((a, b) => {
      const ha = a.hora || '99:99', hb = b.hora || '99:99';
      return ha < hb ? -1 : (ha > hb ? 1 : 0);
    });
}

// Cierra una visita desde el banner: la marca hecha (calToggleNote persiste y
// re-renderiza la Agenda) y actualiza el banner (baja a N-1 o desaparece).
// La bitácora + "Deshacer" los pone calToggleNote, que es el camino común con
// la Agenda: duplicarlo acá dejaba dos entradas por un solo toque.
function marcarVisitaHecha(id) {
  if (typeof calToggleNote === 'function') calToggleNote(id);
  renderMorningBanner();
}

// Para un trabajo multi-día, qué número de día es HOY y cuántos hay en total
// ({ idx, total }); null si es de un solo día. Sirve para el contexto
// "Día 2 de 4" en el banner del día.
function agDiaDeHoyInfo(e) {
  const total = agDiasEstimados(e);
  if (total <= 1) return null;
  const idx = agFechas(e).indexOf(today());
  if (idx < 0) return null;
  return { idx: idx + 1, total };
}

// Texto de "parada" usable para una ruta multi-punto de Google Maps: un Plus
// Code o coordenadas (workMapLink que NO es un http link) o, si no, la
// dirección de texto. Un link corto de Maps (goo.gl) no sirve como waypoint,
// así que en ese caso se cae a la dirección. Devuelve '' si no hay nada usable.
function _stopQueryForSnap(snap) {
  const link = ((snap && snap.workMapLink) || '').trim();
  const addr = ((snap && snap.workAddress) || '').trim();
  if (link && !/^https?:\/\//i.test(link)) return link;
  return addr;
}

// "Ruta del día": abre Google Maps en modo direcciones con todas las paradas
// de hoy (origen = ubicación actual, destino = última, el resto waypoints).
function rutaDelDiaMaps() {
  const stops = getTrabajosDeHoy().map(e => _stopQueryForSnap(e.snapshot)).filter(Boolean);
  if (stops.length < 2) {
    toast('Necesitás al menos dos trabajos con dirección o ubicación para armar la ruta', 'info', 3500);
    return;
  }
  // Más de 4 paradas no entran en un recorrido de Google Maps en el celular
  // (ver MAPA_RUTA_INTERMEDIAS en js/mapa.js): se ofrece en tramos. Cada
  // botón abre uno; para el siguiente se vuelve a tocar "Ruta del día".
  const tramos = _mapaRutaTramos('', stops.map(q => ({ q })), MAPA_RUTA_INTERMEDIAS);
  if (tramos.length === 1) { window.open(_mapaRutaUrl(tramos[0]), '_blank', 'noopener'); return; }
  toastAccion(`Son ${stops.length} paradas y Google Maps acepta 4 por recorrido. Abrí los tramos en orden.`,
    tramos.map((t, i) => ({ label: `Tramo ${i + 1}`, fn: () => window.open(_mapaRutaUrl(t), '_blank', 'noopener') })),
    20000);
}

// Botón "Voy en camino": abre WhatsApp con un aviso corto y editable de que
// el trabajo se hace hoy y ya estás yendo. Usa histClientPhone() (busca el
// teléfono en el snapshot y, si falta, en la DB de clientes).
function avisarVoyEnCamino(id) {
  const e = getH().find(x => x.id === id);
  if (!e) return;
  const phone = normalizeArgPhone(histClientPhone(e));
  const cliente = (e.clientName || '').trim();
  const empresa = (S.coName || '').trim();
  const saludo = cliente ? `Hola ${cliente}` : 'Hola';
  const firma = empresa ? ` Te escribo de ${empresa}.` : '';
  const msg = `${saludo}, ¿cómo estás?${firma} Te aviso que hoy hacemos el trabajo de poda y ya vamos en camino.`;
  const base = phone ? `https://wa.me/${phone}` : 'https://wa.me/';
  window.open(`${base}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
}

// Resumen del día para una lista de trabajos de hoy: monto total a cobrar
// (agrupado por moneda, por si hay trabajos en distintas monedas) y cantidad
// de árboles (suma de la cantidad de cada ítem de tipo "árbol"). Devuelve las
// partes crudas y el HTML listo (clases mb-*). Reusado por el banner fijo y
// por el pop-up de arranque del día.
function _resumenDelDia(hoy) {
  let arboles = 0;
  const porMoneda = {};
  hoy.forEach(e => {
    const snap = e.snapshot || {};
    // Un trabajo de jardinería no es un árbol, y en un ítem cobrado por metro
    // la cantidad son metros: ninguno de los dos suma al conteo de árboles.
    if (!esJardineria(snap)) (snap.items || []).forEach(it => {
      if (it && it.type === 'tree') arboles += itemUnidad(it) ? 1 : Math.max(1, parseInt(it.qty) || 1);
    });
    const cur = e.currency || 'ARS';
    porMoneda[cur] = (porMoneda[cur] || 0) + (parseFloat(e.total) || 0);
  });
  const montoStr = Object.keys(porMoneda)
    .filter(c => porMoneda[c] > 0)
    .map(c => fmtM(porMoneda[c], c))
    .join(' · ');
  const summaryHtml = (montoStr || arboles > 0) ? `
    <div class="mb-summary">
      ${montoStr ? `<span class="mb-stat">${icon('money')} A cobrar hoy: <b>${esc(montoStr)}</b></span>` : ''}
      ${arboles > 0 ? `<span class="mb-stat">${icon('tree')} <b>${arboles}</b> árbol${arboles>1?'es':''}</span>` : ''}
    </div>` : '';
  return { arboles, montoStr, summaryHtml };
}

// Pinta el banner verde de "podas de hoy" arriba del editor. Cada trabajo trae
// accesos rápidos que reusan la plomería existente (comoLlegar / WhatsApp /
// previewFromHistory / setEstadoHistory). Con más de un trabajo, agrega
// "Ruta del día". El banner queda disponible TODO el día mientras el trabajo
// siga abierto (aceptado): a la mañana saluda "Buen día"; más tarde muestra
// la misma tarjeta para poder cerrar el trabajo (marcarlo realizado) al volver.
function renderMorningBanner() {
  const el = document.getElementById('morning-banner');
  if (!el) return;
  const hoy = getTrabajosDeHoy();
  const visitas = getVisitasDeHoy();
  if (!hoy.length && !visitas.length) { el.style.display = 'none'; el.innerHTML = ''; return; }

  const n = hoy.length, nv = visitas.length;
  const esManana = new Date().getHours() < 12;
  const partes = [];
  if (n)  partes.push(`${n} poda${n>1?'s':''}`);
  if (nv) partes.push(`${nv} visita${nv>1?'s':''}`);
  const queHay = partes.join(' y ');
  const titulo = esManana
    ? `${icon('sun')} Buen día — Hoy tenés ${queHay}`
    : `${icon('tree')} Agenda de hoy: ${queHay}`;
  const subtitulo = esManana
    ? `Agendado para hoy. Accesos rápidos para llegar y avisarle al cliente.`
    : (n
      ? `Cuando termines, marcá el trabajo como realizado para cerrarlo${n>1?'s':''}.`
      : `Al terminar cada visita, marcala hecha o creá el presupuesto directo desde acá.`);

  const { summaryHtml: summary } = _resumenDelDia(hoy);

  // Recomendaciones del día (idea 6): lluvia/viento/UV/temperatura. Todos los
  // trabajos de hoy caen en la misma zona → alcanza con el pronóstico del
  // primero para hoy (o el de la primera visita si hoy solo hay visitas).
  let recosHtml = '';
  if (typeof climaRecomendaciones === 'function') {
    const d = n ? climaDe(hoy[0], today())
      : (typeof climaDeNota === 'function' ? climaDeNota(visitas[0], today()) : null);
    const recos = climaRecomendaciones(d);
    if (recos.length) recosHtml = `<div class="mb-recos">${recos.map(r => `<span class="mb-reco">${esc(r)}</span>`).join('')}</div>`;
  }

  el.style.display = 'block';
  el.innerHTML = `
    <div class="fub-head">
      <span class="fub-title">${titulo}</span>
      <button type="button" class="mb-close" onclick="dismissMorningBanner()" aria-label="Ocultar por ahora" title="Ocultar por ahora">${icon('x')}</button>
    </div>
    <div class="fub-sub">${subtitulo}</div>
    ${summary}
    ${recosHtml}
    <div class="fub-list">
      ${hoy.map(e => {
        const snap = e.snapshot || {};
        const tieneUbic = !!mapsUrlFor(snap.workMapLink, snap.workAddress);
        const tieneTel  = !!histClientPhone(e);
        const lugar = (snap.workAddress || '').trim();
        const dinfo = agDiaDeHoyInfo(e); // "Día 2 de 4" en trabajos multi-día
        const clima = (typeof climaDe === 'function') ? climaChipHTML(climaDe(e, today()), _climaTap('e', e.id, today())) : '';
        return `<div class="fub-item">
          <div class="fub-item-info" onclick="goToHistoryEntry(${e.id})" role="button" tabindex="0" title="Ver este presupuesto en el historial">
            <span><span class="fub-item-num">${esc(e.quoteNumber||'—')}</span> <span class="fub-item-client">${esc(e.clientName||'(sin nombre)')}</span></span>
            ${dinfo ? `<span class="fub-item-days">${icon('calendar')} Día ${dinfo.idx} de ${dinfo.total}</span>` : ''}
            ${lugar ? `<span class="fub-item-days">${icon('pin')} ${esc(lugar)}</span>` : ''}
            ${clima ? `<span>${clima}</span>` : ''}
          </div>
          <div class="mb-acts">
            ${tieneUbic ? `<button type="button" class="mb-act mb-act-map" onclick="comoLlegar(${e.id})">${icon('pin')} Cómo llegar</button>` : ''}
            ${tieneTel ? `<button type="button" class="mb-act mb-act-wa" onclick="avisarVoyEnCamino(${e.id})">${icon('message')} Voy en camino</button>` : ''}
            <button type="button" class="mb-act mb-act-view" onclick="previewFromHistory(${e.id})">${icon('eye')} Ver</button>
            <button type="button" class="mb-act mb-act-done" onclick="marcarTrabajoRealizado(${e.id})" title="Marcar el trabajo como realizado (te ofrece registrar la factura)">${icon('check')} Realizado</button>
          </div>
        </div>`;
      }).join('')}
      ${visitas.map(v => {
        const ubic = (v.ubic || '').trim();
        const tieneUbic = !!(ubic && mapsUrlFor(ubic, ''));
        const tieneTel  = !!(v.tel || '').trim();
        const clima = (typeof climaDeNota === 'function') ? climaChipHTML(climaDeNota(v, today()), _climaTap('n', v.id, today())) : '';
        return `<div class="fub-item fub-item-visita">
          <div class="fub-item-info" onclick="switchTab('agenda')" role="button" tabindex="0" title="Ver la visita en la Agenda">
            <span><span class="fub-item-num">Visita</span> <span class="fub-item-client">${esc(v.texto || '')}</span></span>
            ${v.hora ? `<span class="fub-item-days">${icon('clock')} ${esc(v.hora)} hs</span>` : ''}
            ${(v.cliente || '').trim() ? `<span class="fub-item-days">${icon('user')} ${esc(v.cliente)}</span>` : ''}
            ${clima ? `<span>${clima}</span>` : ''}
          </div>
          <div class="mb-acts">
            ${tieneUbic ? `<button type="button" class="mb-act mb-act-map" onclick="calOpenNoteMap('${v.id}')">${icon('pin')} Cómo llegar</button>` : ''}
            ${tieneTel ? `<button type="button" class="mb-act mb-act-wa" onclick="calChatNote('${v.id}')">${icon('message')} WhatsApp</button>` : ''}
            <button type="button" class="mb-act mb-act-crear" onclick="calCrearPresupuestoDesdeVisita('${v.id}')" title="Crear un presupuesto con los datos de esta visita">${icon('file')} Crear presupuesto</button>
            <button type="button" class="mb-act mb-act-done" onclick="marcarVisitaHecha('${v.id}')" title="Marcar la visita como hecha">${icon('check')} Hecha</button>
          </div>
        </div>`;
      }).join('')}
      ${n>1 ? `<button type="button" class="mb-route" onclick="rutaDelDiaMaps()">${icon('truck')} Ruta del día (${n} paradas)</button>` : ''}
    </div>`;
}

// ✕: oculta el banner en esta apertura (no hay gate persistido). Como el
// trabajo sigue abierto, al volver a abrir la app reaparece — así siempre lo
// tenés a mano para cerrarlo. La forma "definitiva" de que desaparezca por el
// día es marcarlo realizado (marcarTrabajoRealizado).
function dismissMorningBanner() {
  const el = document.getElementById('morning-banner');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

// Cierra el trabajo desde el banner: lo marca "realizado" (reusa
// setEstadoHistory, que persiste, re-renderiza el historial y OFRECE registrar
// la factura). Al dejar de ser "aceptado", el trabajo sale de getTrabajosDeHoy,
// así que re-renderizamos el banner: baja a N-1 o desaparece si era el último.
function marcarTrabajoRealizado(id) {
  if (typeof setEstadoHistory === 'function') setEstadoHistory(id, 'realizado');
  renderMorningBanner();
}

// Trigger de arranque: muestra la tarjeta del trabajo de hoy si hay alguno
// abierto (aceptado + fecha == hoy). Se llama en cada apertura de la app, así
// el banner queda disponible todo el día hasta que cierres el trabajo. El
// saludo cambia según la hora (mañana: "Buen día"; después: "Trabajo de hoy").
// Además, la PRIMERA vez del día, dispara el pop-up llamativo (una sola vez).
function maybeShowMorningBanner() {
  if (!getTrabajosDeHoy().length && !getVisitasDeHoy().length) return;
  renderMorningBanner();
  // El pop-up llamativo del día sigue siendo solo para días con poda.
  if (getTrabajosDeHoy().length) maybeShowDayAlert();
}

// ─── POP-UP DE ARRANQUE DEL DÍA (llamativo, 1 vez por día) ───
// La PRIMERA vez que se abre la app en un día con poda(s) agendada(s), salta
// un modal centrado que llama toda la atención. Se cierra con la ✕ o el botón
// y NO vuelve a aparecer ese día (gate persistido en LS.DAY_ALERT_SEEN). El
// banner fijo de arriba y el resto de los avisos siguen funcionando igual.
function _dayAlertSeenToday() {
  try { return localStorage.getItem(LS.DAY_ALERT_SEEN) === today(); } catch (_) { return false; }
}
function _markDayAlertSeen() {
  try { localStorage.setItem(LS.DAY_ALERT_SEEN, today()); } catch (_) {}
}

// Junta las anotaciones internas de un snapshot (nota general + notas por
// ítem de todos los sets: normal A/B y estimativo). Devuelve [{label, text}].
// Se usa para engancharlas en la notificación del día del trabajo — memoria
// privada de quien edita, no sale nunca en el PDF.
function snapshotIntNotes(snap) {
  if (!snap) return [];
  const out = [];
  if (snap.intNote && snap.intNote.trim()) out.push({ label: '', text: snap.intNote.trim() });
  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach(it => {
      if (it && it.intNote && it.intNote.trim())
        out.push({ label: itemInoteLabel(it), text: it.intNote.trim() });
    });
  };
  collect(snap.items);
  collect(snap.itemsB);
  collect(snap.estItems);
  return out;
}

// HTML del bloque de notas internas para la tarjeta del day-alert.
function _dayAlertNotesHTML(snap) {
  const notes = snapshotIntNotes(snap);
  if (!notes.length) return '';
  const lines = notes.map(nn =>
    `<span class="da-note-line">${nn.label ? `<b>${esc(nn.label)}:</b> ` : ''}${esc(nn.text)}</span>`
  ).join('');
  return `<span class="da-item-notes">${icon('bulb')}<span class="da-note-lines">${lines}</span></span>`;
}

function maybeShowDayAlert() {
  if (_dayAlertSeenToday()) return;
  // No pisar el modal de bienvenida (primer uso) u otro overlay abierto.
  if (document.querySelector('#moverlay.open, #agenda-overlay.open, #share-overlay.open')) return;
  const hoy = getTrabajosDeHoy();
  if (!hoy.length) return;
  _markDayAlertSeen();   // se marca al mostrarlo: es "la primera apertura del día"
  renderDayAlert(hoy);
}

function renderDayAlert(hoy) {
  const ov = document.getElementById('day-alert-overlay');
  const box = document.getElementById('day-alert-body');
  if (!ov || !box) return;
  const n = hoy.length;
  const { summaryHtml } = _resumenDelDia(hoy);
  const titulo = `Hoy tenés ${n} poda${n > 1 ? 's' : ''}`;
  const sub = n > 1
    ? 'Estos son los trabajos agendados para hoy. Tocá uno para verlo.'
    : 'Tenés un trabajo agendado para hoy. Tocalo para verlo.';
  box.innerHTML = `
    <div class="da-badge" aria-hidden="true">${icon('tree')}</div>
    <div class="da-kicker">¡Buen día!</div>
    <h3 class="da-title">${titulo}</h3>
    <p class="da-sub">${sub}</p>
    ${summaryHtml}
    <div class="da-list">
      ${hoy.map(e => {
        const snap = e.snapshot || {};
        const lugar = (snap.workAddress || '').trim();
        const dinfo = agDiaDeHoyInfo(e);
        const clima = (typeof climaDe === 'function') ? climaChipHTML(climaDe(e, today()), _climaTap('e', e.id, today())) : '';
        return `<button type="button" class="da-item" onclick="dayAlertGoTo(${e.id})">
          <span class="da-item-top"><span class="da-item-num">${esc(e.quoteNumber || '—')}</span> <span class="da-item-client">${esc(e.clientName || '(sin nombre)')}</span></span>
          ${dinfo ? `<span class="da-item-meta">${icon('calendar')} Día ${dinfo.idx} de ${dinfo.total}</span>` : ''}
          ${lugar ? `<span class="da-item-meta">${icon('pin')} ${esc(lugar)}</span>` : ''}
          ${clima}
          ${_dayAlertNotesHTML(snap)}
        </button>`;
      }).join('')}
    </div>
    <div class="da-btns">
      ${n > 1 ? `<button type="button" class="btn btn-g" onclick="dayAlertRuta()">${icon('truck')} Ruta del día</button>` : ''}
      <button type="button" class="btn btn-p da-go" onclick="closeDayAlert()">¡Vamos! 💪</button>
    </div>`;
  ov.classList.add('open');
}

function closeDayAlert() {
  const ov = document.getElementById('day-alert-overlay');
  if (ov) ov.classList.remove('open');
}

// Tocar un trabajo del pop-up: lo abre en el historial y cierra el modal.
function dayAlertGoTo(id) {
  closeDayAlert();
  if (typeof goToHistoryEntry === 'function') goToHistoryEntry(id);
}

// "Ruta del día" desde el pop-up: cierra y abre Maps con todas las paradas.
function dayAlertRuta() {
  closeDayAlert();
  if (typeof rutaDelDiaMaps === 'function') rutaDelDiaMaps();
}

// Tras abrir WhatsApp, ofrecemos (sin forzar) marcar el seguimiento como
// hecho. No lo marcamos automático porque el usuario podría no enviar el
// mensaje; le damos el control con un toast accionable.
function _afterWhatsapp(id) {
  setTimeout(() => {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast toast-info toast-action';
    el.innerHTML = `<span>¿Marcar seguimiento como hecho?</span>
      <button type="button" class="toast-btn">Sí</button>`;
    c.appendChild(el);
    requestAnimationFrame(()=>{ requestAnimationFrame(()=>el.classList.add('show')); });
    const close = () => { el.classList.remove('show'); setTimeout(()=>el.remove(),300); };
    el.querySelector('.toast-btn').onclick = () => { marcarSeguimientoHecho(id); close(); };
    setTimeout(close, 10000);
  }, 600);
}

// ─── SEGUIMIENTO: estado en cada tarjeta ─────
// Devuelve el HTML del indicador 🔔 para una tarjeta, o '' si ese
// presupuesto no necesita seguimiento.
function followupBadgeFor(e) {
  const cfg = (typeof getFollowupCfg === 'function') ? getFollowupCfg() : null;
  if (!cfg || !cfg.enabled) return '';
  const est = e.estado || 'borrador';
  if (!cfg.estados.includes(est)) return '';
  if (!e.enviadoEn) return '';
  if (esReemplazado(e)) return '';   // el seguimiento es de la versión nueva
  const d = daysSince(e.enviadoEn);
  if (d === null || d < cfg.days) return '';
  if (e.seguimientoHechoEn && new Date(e.seguimientoHechoEn) >= new Date(e.enviadoEn)) return '';
  return `<span class="hbadge-followup" title="Pendiente de seguimiento">${icon('bell')} ${d}d</span>`;
}

// Devuelve el HTML del indicador ⌛ "vencido" para una tarjeta, o '' si ese
// presupuesto no está vencido (mismas reglas que getExpiredQuotes).
function expiryBadgeFor(e) {
  const cfg = (typeof getFollowupCfg === 'function') ? getFollowupCfg() : null;
  if (!cfg || !cfg.enabled || !cfg.expiryEnabled) return '';
  const est = e.estado || 'borrador';
  if (!cfg.estados.includes(est)) return '';
  if (!e.enviadoEn) return '';
  if (e.vencimientoVistoEn) return '';
  const exp = e.snapshot && e.snapshot.dateExpiry;
  if (!exp) return '';
  const d = daysSinceDate(exp);
  if (d === null || d < 1) return '';
  return `<span class="hbadge-expired" title="Presupuesto vencido">${icon('hourglass')} vencido</span>`;
}

// ─── VERSIONES: estado en cada tarjeta ───────
// Indicador de dónde está este presupuesto en la cadena de versiones: "v2" si
// actualiza a uno anterior, "reemplazado" si ya lo actualizó otro. Nunca los
// dos: una v2 que a su vez fue reemplazada muestra que está fuera de juego,
// que es el dato que importa al mirar la lista.
function versionBadgeFor(e) {
  if (esReemplazado(e)) {
    return `<span class="hbadge-reemplazado" title="Se armó una versión más nueva de este presupuesto">reemplazado</span>`;
  }
  const n = parseInt(e && e.versionN, 10) || 0;
  if (n > 1) {
    return `<span class="hbadge-version" title="${esc('Versión ' + n + ((e.snapshot && e.snapshot.versionDeNum) ? ' · actualiza al ' + e.snapshot.versionDeNum : ''))}">v${n}</span>`;
  }
  return '';
}

// ¿Ofrecer "Nueva versión" en esta tarjeta? Solo donde tiene sentido: el
// presupuesto ya venció o se dio por perdido, y todavía nadie lo reemplazó.
// Un borrador se edita y listo, y un trabajo ya realizado no se re-presupuesta:
// poner el botón ahí sería un botón más peleando con "Abrir" en cada tarjeta.
function ofreceNuevaVersion(e) {
  if (!e || esReemplazado(e)) return false;
  const est = e.estado || 'borrador';
  if (est === 'borrador' || est === 'por_ver' || est === 'realizado') return false;
  if (est === 'perdido') return true;
  const exp = e.snapshot && e.snapshot.dateExpiry;
  if (!exp) return false;
  const d = daysSinceDate(exp);
  return d !== null && d >= 1;
}

// ─── SEGUIMIENTO: configuración (UI) ─────────
// Carga la config guardada en los campos del panel (pestaña Empresa).
function loadFollowupUI() {
  const cfg = getFollowupCfg();
  const en = document.getElementById('fu-enabled');
  const dy = document.getElementById('fu-days');
  const tpl= document.getElementById('fu-template');
  const opts = document.getElementById('fu-options');
  if (en) en.checked = !!cfg.enabled;
  if (dy) dy.value = cfg.days;
  const exp = document.getElementById('fu-expiry-enabled');
  if (exp) exp.checked = !!cfg.expiryEnabled;
  if (tpl) tpl.value = cfg.waTemplate;
  const sendTpl = document.getElementById('wa-send-template');
  if (sendTpl) sendTpl.value = cfg.waSendTemplate || FOLLOWUP_DEF.waSendTemplate;
  const recTpl = document.getElementById('wa-recontacto-template');
  if (recTpl) recTpl.value = cfg.waRecontactoTemplate || FOLLOWUP_DEF.waRecontactoTemplate;
  const cobroTpl = document.getElementById('wa-cobro-template');
  if (cobroTpl) cobroTpl.value = cfg.waCobroTemplate || FOLLOWUP_DEF.waCobroTemplate;
  const actTpl = document.getElementById('wa-actualizacion-template');
  if (actTpl) actTpl.value = cfg.waActualizacionTemplate || FOLLOWUP_DEF.waActualizacionTemplate;
  document.querySelectorAll('.fu-estados input[type=checkbox]').forEach(chk => {
    chk.checked = cfg.estados.includes(chk.value);
  });
  if (opts) opts.style.opacity = cfg.enabled ? '1' : '.45';
  if (opts) opts.style.pointerEvents = cfg.enabled ? 'auto' : 'none';
  const pushEl = document.getElementById('push-enabled');
  if (pushEl) pushEl.checked = !!S.pushEnabled;
  const pAg = document.getElementById('push-agenda');
  if (pAg) pAg.checked = cfg.pushAgenda !== false;
  const pHr = document.getElementById('push-hora');
  if (pHr) pHr.checked = cfg.pushHora !== false;
  if (typeof pushHorariosRender === 'function') pushHorariosRender();
  if (typeof pushEstadoRender === 'function') pushEstadoRender();
}

// Lee los campos del panel y guarda la config. Refresca banner e historial.
function saveFollowupFromUI() {
  const en = document.getElementById('fu-enabled');
  const dy = document.getElementById('fu-days');
  const tpl= document.getElementById('fu-template');
  const estados = [];
  document.querySelectorAll('.fu-estados input[type=checkbox]:checked').forEach(chk => estados.push(chk.value));
  let days = parseInt(dy && dy.value) || 10;
  if (days < 1) days = 1;
  if (days > 365) days = 365;
  const exp = document.getElementById('fu-expiry-enabled');
  // Partir de lo GUARDADO y escribir encima solo lo de este panel. Enumerar a
  // mano las otras plantillas no alcanzaba: setFollowupCfg mergea contra
  // FOLLOWUP_DEF, así que toda clave ausente volvía al texto de fábrica —
  // tocar los días del seguimiento borraba el mensaje de cobro personalizado.
  const cfg = setFollowupCfg(Object.assign({}, getFollowupCfg(), {
    enabled: en ? !!en.checked : true,
    days,
    expiryEnabled: exp ? !!exp.checked : true,
    estados: estados.length ? estados : ['enviado'],
    waTemplate: (tpl && tpl.value.trim()) ? tpl.value : FOLLOWUP_DEF.waTemplate,
  }));
  // Atenuar opciones si está apagado
  const opts = document.getElementById('fu-options');
  if (opts) {
    opts.style.opacity = cfg.enabled ? '1' : '.45';
    opts.style.pointerEvents = cfg.enabled ? 'auto' : 'none';
  }
  renderFollowupBanner();
  if (document.getElementById('panel-historial')?.classList.contains('active')) renderHistory();
  // Cambió la config → re-sincronizar los seguimientos del Worker de push.
  if (S.pushEnabled && typeof syncPushFollowups === 'function') syncPushFollowups().catch(() => {});
}

// Guarda la plantilla del mensaje de ENVÍO por WhatsApp (campo propio).
// Preserva el resto de la config de WhatsApp/seguimiento.
function saveSendTemplate() {
  const t = document.getElementById('wa-send-template');
  const cfg = getFollowupCfg();
  cfg.waSendTemplate = (t && t.value.trim()) ? t.value : FOLLOWUP_DEF.waSendTemplate;
  setFollowupCfg(cfg);
}

// Guarda la plantilla del mensaje de RECONTACTO (campo propio, ídem).
function saveRecontactoTemplate() {
  const t = document.getElementById('wa-recontacto-template');
  const cfg = getFollowupCfg();
  cfg.waRecontactoTemplate = (t && t.value.trim()) ? t.value : FOLLOWUP_DEF.waRecontactoTemplate;
  setFollowupCfg(cfg);
}

// Guarda la plantilla del mensaje de COBRO (campo propio, ídem).
function saveCobroTemplate() {
  const t = document.getElementById('wa-cobro-template');
  const cfg = getFollowupCfg();
  cfg.waCobroTemplate = (t && t.value.trim()) ? t.value : FOLLOWUP_DEF.waCobroTemplate;
  setFollowupCfg(cfg);
}

// Guarda la plantilla del mensaje de PRESUPUESTO ACTUALIZADO (campo propio).
// El texto que trae de fábrica es el que se usa en la práctica, pero cada
// colega escribe distinto: vaciar el campo vuelve al default, no lo deja mudo.
function saveActualizacionTemplate() {
  const t = document.getElementById('wa-actualizacion-template');
  const cfg = getFollowupCfg();
  cfg.waActualizacionTemplate = (t && t.value.trim()) ? t.value : FOLLOWUP_DEF.waActualizacionTemplate;
  setFollowupCfg(cfg);
}

// ─── CÓMO LLEGAR (navegación GPS) ────────────
// Arma la URL de Google Maps a partir de una "ubicación exacta" (Plus Code,
// coordenadas o link de Maps) y, si no hay, de la dirección de texto.
// La ubicación exacta tiene PRIORIDAD: la dirección de texto suele ser
// aproximada (calle/barrio sin numerar), mientras que el Plus Code/las
// coordenadas apuntan al lugar real del trabajo. Este dato es privado:
// nunca se renderiza en el PDF, solo se usa para navegar.
function mapsUrlFor(mapLink, addr) {
  const link = (mapLink || '').trim();
  const dir  = (addr || '').trim();
  const BASE = 'https://www.google.com/maps/search/?api=1&query=';
  // Un link completo de Maps (maps.app.goo.gl, google.com/maps, etc.) se abre
  // tal cual. Un Plus Code o coordenadas se pasan como búsqueda.
  if (link) {
    if (/^https?:\/\//i.test(link)) return link;
    // Coordenadas "lat,lng" (con o sin espacio): van con coma literal, sin
    // codificar, para que el link quede corto y prolijo al compartirlo por
    // WhatsApp (query=lat,lng en vez de query=lat%2C%20lng).
    const coord = link.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coord) return BASE + coord[1] + ',' + coord[2];
    return BASE + encodeURIComponent(link);
  }
  if (dir) return BASE + encodeURIComponent(dir);
  return '';
}

// Igual que mapsUrlFor, pero en modo RUTA: Google Maps abre con el camino
// ya cargado desde la ubicación del teléfono hasta el trabajo, como "Armar
// recorrido". mapsUrlFor abría la BÚSQUEDA del lugar y había que tocar
// "Cómo llegar" de nuevo adentro de Maps (pedido del usuario: que pase lo
// mismo que con el recorrido, aunque haya un solo trabajo). Sin `origin`,
// Maps sale desde donde está el teléfono. Un link completo de Maps
// (maps.app.goo.gl) no se puede convertir en destino: se abre tal cual.
// mapsUrlFor sigue para "Probar" (verificar el punto) y para compartir.
function mapsDirUrlFor(mapLink, addr) {
  const link = (mapLink || '').trim();
  const dir  = (addr || '').trim();
  const BASE = 'https://www.google.com/maps/dir/?api=1&destination=';
  if (link) {
    if (/^https?:\/\//i.test(link)) return link;
    const coord = link.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coord) return BASE + coord[1] + ',' + coord[2];
    return BASE + encodeURIComponent(link);
  }
  if (dir) return BASE + encodeURIComponent(dir);
  return '';
}

// Abre Google Maps con la ruta hasta el trabajo del presupuesto.
// Los datos viven en el snapshot (workMapLink / workAddress).
function comoLlegar(id) {
  const e = getH().find(x => x.id === id);
  const snap = (e && e.snapshot) || {};
  const url = mapsDirUrlFor(snap.workMapLink, snap.workAddress);
  if (!url) {
    toast('Este presupuesto no tiene dirección ni ubicación cargada', 'info', 3000);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

// Teléfono del cliente de un entry del historial. Primero el contacto del
// snapshot; si no parece un teléfono (o está vacío), se busca el cliente por
// nombre en la DB de clientes (los presupuestos viejos pueden no tener el
// contacto guardado, pero el cliente sí). Devuelve '' si no hay nada usable.
function histClientPhone(e) {
  const looksPhone = v => ((v || '') + '').replace(/\D/g, '').length >= 6;
  const snap = (e.snapshot && e.snapshot.clientContact) || '';
  if (looksPhone(snap)) return snap;
  const name = (e.clientName || '').trim().toLowerCase();
  if (!name) return '';
  const c = getClientDB().find(x => ((x.name || '') + '').trim().toLowerCase() === name);
  return (c && looksPhone(c.contact)) ? c.contact : '';
}

// Botón "Chat" del historial: abre el chat de WhatsApp con el cliente, sin
// mensaje prearmado (es para hablar con él — coordinar un trabajo agendado,
// avisar que estás yendo — no para reenviar el presupuesto).
function chatWhatsappHistory(id) {
  const e = getH().find(x => x.id === id);
  if (!e) return;
  const phone = normalizeArgPhone(histClientPhone(e));
  if (!phone) {
    toast('Este cliente no tiene teléfono cargado', 'info', 3000);
    return;
  }
  window.open(`https://wa.me/${phone}`, '_blank', 'noopener');
}

// Abre el chat de WhatsApp con un teléfono suelto (sin presupuesto asociado).
// Lo usan las notas de la Agenda que llevan un contacto vinculado. Sin mensaje
// prearmado: es para hablar/coordinar, no para reenviar un presupuesto.
function chatWhatsappPhone(raw) {
  const phone = normalizeArgPhone((raw || '') + '');
  if (!phone) {
    toast('Este contacto no tiene teléfono cargado', 'info', 3000);
    return;
  }
  window.open(`https://wa.me/${phone}`, '_blank', 'noopener');
}

// Botón "Probar" del editor: abre en Maps lo que el usuario está cargando
// ahora mismo (sin pasar por el historial), para verificar que el Plus Code /
// link apunta al lugar correcto antes de guardar.
function probarUbicacion() {
  const link = (document.getElementById('work-maplink') || {}).value || '';
  const addr = (document.getElementById('work-address') || {}).value || '';
  const url = mapsUrlFor(link, addr);
  if (!url) {
    toast('Cargá una ubicación o dirección para probar', 'info', 3000);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

// Botón "Mi ubicación": usa el GPS del dispositivo para completar el campo
// de ubicación exacta con las coordenadas actuales (lat,lng). Útil cuando
// estás parado en el lugar del trabajo. Las coordenadas las interpreta
// igual que un Plus Code el botón "Llegar" y Google Maps.
function usarMiUbicacion(btn) {
  const input = document.getElementById('work-maplink');
  if (!input) return;
  if (!('geolocation' in navigator)) {
    toast('Este dispositivo no permite detectar la ubicación', 'err', 4000);
    return;
  }
  // Estado de carga en el botón (se restaura al terminar/fallar).
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg class="ic"><use href="#i-pin"></use></svg> Buscando…'; }
  const restore = () => { if (btn) { btn.disabled = false; btn.innerHTML = original; } };

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      input.value = `${lat},${lng}`;
      S.workMapLink = input.value;
      const det = document.getElementById('maplink-details');
      if (det) det.open = true;
      if (typeof sched === 'function') sched(); // persistir el estado activo
      const exacta = pos.coords.accuracy ? ` (±${Math.round(pos.coords.accuracy)} m)` : '';
      toast(`Ubicación detectada${exacta}. Probala en Maps para confirmar.`, 'ok', 4000);
      restore();
    },
    (err) => {
      restore();
      let msg = 'No se pudo obtener la ubicación';
      if (err && err.code === 1) msg = 'Permiso de ubicación denegado. Activalo en los ajustes del navegador.';
      else if (err && err.code === 2) msg = 'Ubicación no disponible. Probá al aire libre o con el GPS activado.';
      else if (err && err.code === 3) msg = 'La búsqueda de ubicación tardó demasiado. Reintentá.';
      toast(msg, 'err', 5000);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// ─── RENDER ──────────────────────────────────
// El historial se agrupa por mes basado en la fecha de emisión del
// presupuesto (no la de guardado). El mes más reciente arranca abierto,
// los anteriores cerrados. Cada header muestra cantidad y total
// acumulado del mes. Con filtros activos (búsqueda o cliente), se
// muestra plano sin agrupar para ver todos los resultados de un saque.

// Estado de qué meses están expandidos. Persiste durante la sesión
// (no a través de reloads — no vale la pena).
// _userTouchedMonths: si el usuario ya tocó al menos un toggle. Antes
// de eso, el render decide qué abrir por default; después, respetamos
// completamente las decisiones del usuario.
const _expandedMonths = new Set();
let _userTouchedMonths = false;

function _monthKey(entry) {
  // Preferir dateIssue del snapshot (fecha real del presupuesto)
  // Fallback a savedAt (fecha de guardado) si no hay otra
  const snap = entry.snapshot || {};
  const d = (snap.dateIssue || entry.savedAt || '').slice(0, 7); // "2026-05"
  return d || '0000-00';
}

function _monthLabel(key) {
  // key formato "2026-05" → "Mayo 2026"
  if (!key || key === '0000-00') return 'Sin fecha';
  const [year, mon] = key.split('-');
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const m = parseInt(mon, 10);
  if (isNaN(m) || m < 1 || m > 12) return key;
  return `${months[m-1]} ${year}`;
}

// Búsqueda del historial: muestra/oculta el botón "limpiar" propio (la ✕
// nativa del type=search está oculta por CSS).
function _histSearchSync(inp){
  const w = inp.closest('.hsearch-wrap');
  if (w) w.classList.toggle('has-value', !!inp.value);
}
function clearHistSearch(){
  const inp = document.getElementById('hist-search');
  if (!inp) return;
  inp.value = '';
  _histSearchSync(inp);
  renderHistory();
  inp.focus();
}

// Re-render con retardo, para el buscador. Cada tecla disparaba un
// renderHistory() completo: con 250 presupuestos son ~340 ms de bloqueo POR
// LETRA en escritorio (y un celular de gama baja es 4-10x más lento), así que
// escribir en el buscador se sentía como un teclado roto. 180 ms es el punto
// donde ya no se percibe el retardo pero una ráfaga de tecleo cuenta como una.
let _histRenderTimer = null;
function renderHistoryDebounced() {
  clearTimeout(_histRenderTimer);
  _histRenderTimer = setTimeout(renderHistory, 180);
}

function renderHistory() {
  const list     = document.getElementById('history-list');     if(!list) return;
  // Re-render → los botones se recrean: descartar cualquier imagen lista
  // pendiente (su botón y su referencia quedaron obsoletos).
  _pngShareReady = null;
  const searchEl = document.getElementById('hist-search');
  const filterEl = document.getElementById('hist-client-filter');
  const countEl  = document.getElementById('hist-count');
  let h = getH();

  // Banner de seguimientos pendientes (arriba del listado)
  if (typeof renderFollowupBanner === 'function') renderFollowupBanner();

  // El contador dice PRESUPUESTOS. Las colaboraciones no son presupuestos y
  // sumarlas acá haría creer que se cotizó más de lo que se cotizó.
  if (countEl) countEl.textContent = h.filter(e => !esTrabajoPropio(e)).length;

  // Botón Agenda del encabezado: contador de trabajos aceptados y estado
  // del toggle (activo = filtro "aceptado" puesto → muestra "Ver todos").
  const agBtn = document.getElementById('hist-agenda-btn');
  if (agBtn) {
    const nAg  = h.filter(e => (e.estado || '') === 'aceptado').length;
    const agOn = (document.getElementById('hist-estado-filter')?.value || '') === 'aceptado';
    agBtn.classList.toggle('is-on', agOn);
    agBtn.innerHTML = agOn
      ? `${icon('x')} Ver todos`
      : `${icon('calendar')} Agenda${nAg ? `<span class="agenda-count">${nAg}</span>` : ''}`;
  }

  // "Limpiar todo" al pie: solo si hay algo que limpiar (h todavía sin filtrar).
  const footEl = document.getElementById('hist-footer');
  if (footEl) footEl.hidden = h.length === 0;

  // Rebuild client dropdown preserving current selection
  if (filterEl) {
    const selected = filterEl.value;
    const clients = [...new Set(h.map(e=>e.clientName||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
    filterEl.innerHTML = '<option value="">Todos los clientes</option>'
      + clients.map(c=>`<option value="${esc(c)}"${c===selected?' selected':''}>${esc(c)}</option>`).join('');
  }

  // Apply filters
  const q          = (searchEl?.value||'').toLowerCase().trim();
  const clientFilt = (filterEl?.value||'').toLowerCase().trim();

  // Búsqueda unificada: si el query matchea con el número, nombre de
  // cliente o lugar del trabajo, el presupuesto pasa el filtro. Más
  // intuitivo que "solo por número" — el usuario busca como recuerda.
  if (q) {
    h = h.filter(e => {
      const num     = (e.quoteNumber||'').toLowerCase();
      const client  = (e.clientName||'').toLowerCase();
      // workAddress vive dentro del snapshot, no a nivel raíz del entry.
      // Lo intentamos en ambos lugares por compatibilidad con backups
      // antiguos que podrían tenerlo plano.
      const place   = ((e.workAddress || (e.snapshot && e.snapshot.workAddress) || '')+'').toLowerCase();
      return num.includes(q) || client.includes(q) || place.includes(q);
    });
  }
  if (clientFilt) h = h.filter(e=>(e.clientName||'').toLowerCase()===clientFilt);

  // Filtro por estado comercial
  const estadoEl   = document.getElementById('hist-estado-filter');
  const estadoFilt = (estadoEl?.value || '').trim();
  if (estadoFilt) h = h.filter(e => (e.estado || 'borrador') === estadoFilt);

  // Filtro por tipo: presupuestos, colaboraciones o todo mezclado (default).
  // Aislar las colaboraciones es la vista de "qué trabajé para colegas".
  const tipoEl   = document.getElementById('hist-tipo-filter');
  const tipoFilt = (tipoEl?.value || '').trim();
  if (tipoFilt === 'colab')         h = h.filter(esColaboracion);
  else if (tipoFilt === 'directo')  h = h.filter(esTrabajoDirecto);
  else if (tipoFilt === 'presup')   h = h.filter(e => !esTrabajoPropio(e));

  // Agenda: al filtrar por "aceptado" el listado se ordena cronológicamente
  // por la fecha más próxima entre trabajo agendado y recontacto (los sin
  // nada al final) — así el filtro funciona como agenda de pendientes,
  // mezclando días de trabajo y días de llamar a coordinar.
  if (estadoFilt === 'aceptado') {
    // Clave = la fecha más próxima entre los días de trabajo ubicados y el
    // recontacto pendiente (los sin nada, al final).
    const agKey = e => {
      const cand = agFechas(e);
      if (e.recontactoEn) cand.push(e.recontactoEn);
      return cand.length ? cand.sort()[0] : '';
    };
    h = [...h].sort((a, b) => {
      const ka = agKey(a), kb = agKey(b);
      if (!ka && !kb) return 0;
      if (!ka) return 1;
      if (!kb) return -1;
      return ka.localeCompare(kb);
    });
  }

  const hasFilters = !!(q || clientFilt || estadoFilt || tipoFilt);
  const groupedByClient = clientFilt && h.length > 0;

  if (!h.length) {
    list.innerHTML = `<div class="empty-h">${hasFilters ? 'Sin resultados para los filtros aplicados.' : 'No hay presupuestos guardados.'}</div>`;
    return;
  }

  // Summary when filtered by client (acumulado total de ese cliente)
  let summaryHtml = '';

  // Subtotal propio de las colaboraciones: el único lugar del historial donde
  // se las suma, y solo cuando el usuario pidió verlas aparte. Nunca se mezcla
  // con el acumulado de presupuestos.
  if (tipoFilt === 'colab' || tipoFilt === 'directo') {
    const totColab = h.reduce((s, e) => s + (e.total || 0), 0);
    const curC = h[0].currency || 'ARS';
    summaryHtml += `<div class="hcolab-resumen">
      <span class="hcolab-resumen-n">${colabCantTxt(h.length, tipoFilt)}</span>
      <span class="hcolab-resumen-tot">${fmtM(totColab, curC)}</span>
      <span class="hcolab-resumen-nota">${tipoFilt === 'directo'
        ? 'Trabajos a clientes sin presupuesto de por medio. Suman a tus ventas, no a la conversión.'
        : 'Trabajos para colegas. No entran en las estadísticas ni en tus ventas.'}</span>
    </div>`;
  }
  if (groupedByClient) {
    // Los presupuestos reemplazados por una versión posterior NO suman: son el
    // mismo trabajo cotizado dos veces y contarlos infla el acumulado del
    // cliente (y con él la idea de cuánto se le presupuestó de verdad).
    // Las colaboraciones tampoco: no son plata de este cliente, se la paga un
    // colega. Los trabajos DIRECTOS sí suman: se los cobró a él, aunque no
    // hayan pasado por un presupuesto.
    const totalPresupuestado = h.reduce((sum,e)=>sum+((esReemplazado(e)||!sumaComoVenta(e))?0:(e.total||0)), 0);
    const cur = h[0].currency||'ARS';
    // El conteo dice PRESUPUESTOS: con un colega que solo dio colaboraciones,
    // "Presupuestos 2 · Total $0" era una contradicción.
    const nPresup = h.filter(e => !esTrabajoPropio(e)).length;
    const nColab  = h.filter(esColaboracion).length;
    const nDir    = h.filter(esTrabajoDirecto).length;
    const bloque = (titulo, txt, color) => `
      <div style="width:1px;height:32px;background:#a7f3d0"></div>
      <div><div style="font-size:12px;font-weight:700;color:var(--accent-fg);text-transform:uppercase;letter-spacing:.5px">${titulo}</div>
        <div style="font-size:14px;font-weight:700;color:${color}">${txt}</div></div>`;
    const sumaDe = (fn) => fmtM(h.reduce((s,e)=>s+(fn(e)?(e.total||0):0),0), cur);
    // El trabajo directo ya está DENTRO del total acumulado; su renglón dice
    // cuánto de ese total vino sin presupuesto.
    const colabDelCliente =
      (nDir   ? bloque('Sin presupuesto', `${nDir} · ${sumaDe(esTrabajoDirecto)}`, 'var(--text)') : '') +
      (nColab ? bloque('Colaboraciones',  `${nColab} · ${sumaDe(esColaboracion)}`, '#115e59') : '');
    summaryHtml = `<div style="background:var(--accent-light);border:1px solid #a7f3d0;border-radius:8px;padding:10px 14px;margin-bottom:10px;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
      <div><div style="font-size:12px;font-weight:700;color:var(--accent-fg);text-transform:uppercase;letter-spacing:.5px">Cliente</div>
        <div style="font-size:14px;font-weight:700;color:var(--text)">${esc(h[0].clientName||'—')}</div></div>
      <div style="width:1px;height:32px;background:#a7f3d0"></div>
      <div><div style="font-size:12px;font-weight:700;color:var(--accent-fg);text-transform:uppercase;letter-spacing:.5px">Presupuestos</div>
        <div style="font-size:14px;font-weight:700;color:var(--text)">${nPresup}</div></div>
      <div style="width:1px;height:32px;background:#a7f3d0"></div>
      <div><div style="font-size:12px;font-weight:700;color:var(--accent-fg);text-transform:uppercase;letter-spacing:.5px">Total acumulado</div>
        <div style="font-size:14px;font-weight:700;color:var(--accent-fg)">${fmtM(totalPresupuestado,cur)}</div></div>
      ${colabDelCliente}
    </div>`;
  }

  // Helper: HTML para un trabajo registrado a mano (colaboración o trabajo
  // directo). Tarjeta aparte y no una variante de la de presupuesto: acá no
  // hay nada que cargar en el editor ni versión que armar. Lo que sí comparte
  // es el ciclo de trabajo —estado, día agendado, clima y el camino a la
  // factura— y el DOCUMENTO: el snapshot ya tiene forma de presupuesto, así
  // que "Ver" y "Compartir" usan la misma maquinaria de siempre (el título y
  // las secciones los ajusta `doc` de TRABAJO_CFG, ver _docTrabajo).
  const renderColab = (e) => {
    const est = e.estado || 'realizado';
    const [txtCol, bgCol] = ESTADO_COLORS[est] || ESTADO_COLORS.realizado;
    const estadoOpts = ESTADOS.map(s =>
      `<option value="${s}"${s===est?' selected':''}>${estadoLabel(s)}</option>`
    ).join('');
    const c = e.colab || {};
    const cfg = trabajoCfg(tipoTrabajo(e));
    const dir = esTrabajoDirecto(e);
    const tieneDir = !!((e.snapshot && (e.snapshot.workMapLink || e.snapshot.workAddress) || '').trim());
    const tieneTel = !!histClientPhone(e);
    const detalle = c.nombre
      ? `${esc(c.nombre)} · ${esc(misSvcCantTxt(c.cantidad, c.unidad))}`
      : cfg.nombre;
    return `
    <div class="hitem is-colab${dir ? ' is-directo' : ''}" data-id="${e.id}">
      <div class="htop">
        <div class="hinfo">
          <div class="hnum">${esc(e.quoteNumber||'—')}<span class="hbadge-colab${dir ? ' is-directo' : ''}">${esc(cfg.badge)}</span>${e.facturado?'<span class="hbadge-estado" style="color:#065f46;background:#d1fae5">✓ Facturado</span>':''}</div>
          ${!groupedByClient?`<div class="hclient ${!e.clientName?'is-draft':''}">${esc(e.clientName|| (dir ? '(sin cliente)' : '(sin colega)'))}</div>`:''}
        </div>
        <button class="btn btn-p btn-sm hcargar" onclick="abrirColaboracion(${e.id})" title="Editar este trabajo">${icon('pencil')} Editar</button>
      </div>
      <div class="hmeta">${esc(e.currency||'')} ${fmtM(e.total||0,e.currency||'ARS')} · ${detalle} · ${fmtD(((e.snapshot&&e.snapshot.dateIssue)||e.savedAt||'').slice(0,10))}</div>
      <div class="hacts">
        <select class="hestado-sel" style="color:${txtCol};background-color:${bgCol};border-color:${bgCol}" onchange="setEstadoHistory(${e.id}, this.value)" title="Cambiar estado" aria-label="Estado del trabajo">${estadoOpts}</select>
        ${agendaChipFor(e)}
        ${typeof climaChipForEntry === 'function' ? climaChipForEntry(e) : ''}
        <button class="btn btn-g btn-sm" onclick="previewFromHistory(${e.id})" title="Ver el documento de este trabajo">${icon('eye')} Ver</button>
        <button class="btn btn-g btn-sm" onclick="sharePngFromHistory(${e.id}, this)" title="Generar una imagen del documento y compartirla (WhatsApp, etc.)">${icon('image')} Compartir</button>
        ${tieneTel ? `<button class="btn btn-g btn-sm" onclick="chatWhatsappHistory(${e.id})" title="Abrir el chat de WhatsApp" aria-label="Chat de WhatsApp">${icon('message')} Chat</button>` : ''}
        ${tieneDir ? `<button class="btn btn-g btn-sm" onclick="comoLlegar(${e.id})" title="Cómo llegar al lugar del trabajo" aria-label="Cómo llegar">${icon('pin')} Llegar</button>` : ''}
        ${!e.facturado && (e.total||0) > 0 ? `<button class="btn btn-g btn-sm" onclick="irARegistrarFactura(${e.id})" title="Registrar la factura de este trabajo">${icon('file')} Facturar</button>` : ''}
        <button class="btn-icon-del" onclick="delFromHistory(${e.id})" title="Eliminar" aria-label="Eliminar">${icon('trash')}</button>
      </div>
    </div>`;
  };

  // Helper: HTML para un entry individual del historial
  const renderEntry = (e) => {
    if (esTrabajoPropio(e)) return renderColab(e);
    const est = e.estado || 'borrador';
    const [txtCol, bgCol] = ESTADO_COLORS[est] || ESTADO_COLORS.borrador;
    const estadoOpts = ESTADOS.map(s =>
      `<option value="${s}"${s===est?' selected':''}>${estadoLabel(s)}</option>`
    ).join('');
    const tieneDir = !!((e.snapshot && (e.snapshot.workMapLink || e.snapshot.workAddress) || '').trim());
    const tieneTel = !!histClientPhone(e);
    return `
    <div class="hitem${esReemplazado(e)?' is-reemplazado':''}" data-id="${e.id}">
      <div class="htop">
        <div class="hinfo">
          <div class="hnum">${esc(e.quoteNumber||'—')}${e.isEstimative?'<span class="hbadge-est">Estimativo</span>':''}${versionBadgeFor(e)}${followupBadgeFor(e)}${expiryBadgeFor(e)}${e.facturado?'<span class="hbadge-estado" style="color:#065f46;background:#d1fae5">✓ Facturado</span>':''}</div>
          ${!groupedByClient?`<div class="hclient ${!e.clientName?'is-draft':''}">${esc(e.clientName||'(borrador sin nombre de cliente)')}</div>`:''}
        </div>
        <button class="btn btn-p btn-sm hcargar" onclick="loadFromHistory(${e.id})" title="Abrir este presupuesto en el editor">${icon('pencil')} Abrir</button>
      </div>
      <div class="hmeta">${esc(e.currency||'')} ${fmtM(e.total||0,e.currency||'ARS')} · ${e.itemCount||0} ítem(s) · ${fmtD(((e.snapshot&&e.snapshot.dateIssue)||e.savedAt||'').slice(0,10))}</div>
      <div class="hacts">
        <select class="hestado-sel" style="color:${txtCol};background-color:${bgCol};border-color:${bgCol}" onchange="setEstadoHistory(${e.id}, this.value)" title="Cambiar estado" aria-label="Estado del presupuesto">${estadoOpts}</select>
        ${agendaChipFor(e)}
        ${typeof climaChipForEntry === 'function' ? climaChipForEntry(e) : ''}
        <button class="btn btn-g btn-sm" onclick="previewFromHistory(${e.id})">${icon('eye')} Ver</button>
        ${ofreceNuevaVersion(e) ? `<button class="btn btn-g btn-sm" onclick="nuevaVersionQuote(${e.id})" title="Armar una segunda versión de este presupuesto con los precios al día">${icon('refresh')} Nueva versión</button>` : ''}
        <button class="btn btn-g btn-sm" onclick="sharePngFromHistory(${e.id}, this)" title="Generar una imagen del presupuesto y compartirla (WhatsApp, etc.)">${icon('image')} Compartir</button>
        <button class="btn btn-g btn-sm" onclick="duplicarQuote(${e.id})" title="Armar un presupuesto nuevo con los mismos datos y trabajos">${icon('copy')} Duplicar</button>
        ${tieneTel ? `<button class="btn btn-g btn-sm" onclick="chatWhatsappHistory(${e.id})" title="Abrir el chat de WhatsApp con el cliente" aria-label="Chat de WhatsApp con el cliente">${icon('message')} Chat</button>` : ''}
        ${tieneDir ? `<button class="btn btn-g btn-sm" onclick="comoLlegar(${e.id})" title="Cómo llegar a la dirección del trabajo" aria-label="Cómo llegar">${icon('pin')} Llegar</button>` : ''}
        <button class="btn-icon-del" onclick="delFromHistory(${e.id})" title="Eliminar presupuesto" aria-label="Eliminar presupuesto">${icon('trash')}</button>
      </div>
    </div>`;
  };

  // Si hay filtros activos: mostrar plano, todo visible. La agrupación
  // por mes molestaría cuando el usuario está buscando algo específico.
  if (hasFilters) {
    list.innerHTML = summaryHtml + h.map(renderEntry).join('');
    enhanceSelects(list);
    refreshCustomSelects();
    return;
  }

  // ─── AGRUPADO POR MES ───────────────────────────────────────
  // h ya está ordenado descendente por savedAt (el más reciente primero,
  // según cómo se guardan en autoSaveToHistory con unshift). Pero
  // queremos ordenar por dateIssue del snapshot para que la agrupación
  // refleje el mes del presupuesto, no el de guardado.
  const sorted = [...h].sort((a, b) => {
    const da = (a.snapshot?.dateIssue || a.savedAt || '');
    const db = (b.snapshot?.dateIssue || b.savedAt || '');
    return db.localeCompare(da); // descendente
  });

  // Agrupar
  const groups = new Map(); // key → array de entries
  sorted.forEach(e => {
    const k = _monthKey(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  });

  // Default inicial: abrir el mes más reciente. Solo se aplica si el
  // usuario todavía no tocó ningún toggle — una vez que tocó algo,
  // respetamos su decisión aunque haya cerrado todo.
  if (!_userTouchedMonths && _expandedMonths.size === 0 && groups.size > 0) {
    const firstKey = groups.keys().next().value;
    _expandedMonths.add(firstKey);
  }

  // Render: cada mes como sección colapsable.
  // El cuerpo de un mes CERRADO no se genera. Antes se armaba el HTML de las
  // 250 tarjetas siempre —487 KB, 250 ms solo en el innerHTML— y el CSS ocultaba
  // 11 de cada 12 meses. Se llena al desplegarlo (toggleHistoryMonth re-renderiza).
  // (Con filtros activos no se pasa por acá: arriba se rinde plano y visible.)
  let html = summaryHtml;
  groups.forEach((entries, key) => {
    const isOpen = _expandedMonths.has(key);
    // El total del mes es la plata del NEGOCIO: presupuestos y trabajos
    // directos (los dos se los cobra a un cliente). No suma el presupuesto
    // reemplazado por una versión posterior —el mismo trabajo cotizado dos
    // veces— ni las colaboraciones, que las paga un colega.
    const ventas = entries.filter(sumaComoVenta);
    const colabs = entries.filter(esColaboracion);
    const monthTotal = ventas.reduce((s,e)=>s+(esReemplazado(e)?0:(e.total||0)), 0);
    const colabTotal = colabs.reduce((s,e)=>s+(e.total||0), 0);
    const cur = entries[0].currency || 'ARS';
    // Renglón aparte, fuera del encabezado: las colaboraciones del mes se ven
    // sin tener que desplegar nada, y sin tocar el número del negocio.
    const colabLinea = colabs.length ? `
        <div class="hmonth-colab">${icon('users')} ${colabCantTxt(colabs.length, 'colab')}
          <span class="hmonth-colab-tot">${fmtM(colabTotal, cur)}</span></div>` : '';
    html += `
      <div class="hmonth ${isOpen?'is-open':''}" data-month="${key}">
        <button type="button" class="hmonth-header" onclick="toggleHistoryMonth('${key}')">
          <span class="hmonth-title">${icon('calendar')} ${_monthLabel(key)}</span>
          <span class="hmonth-count">${ventas.length}</span>
          <span class="hmonth-total">${fmtM(monthTotal, cur)}</span>
          <span class="hmonth-chevron">▾</span>
        </button>
        ${colabLinea}
        <div class="hmonth-body">
          ${isOpen ? entries.map(renderEntry).join('') : ''}
        </div>
      </div>`;
  });

  list.innerHTML = html;
  enhanceSelects(list);
  refreshCustomSelects();
}

// Lleva al usuario hasta un presupuesto puntual dentro del historial y lo
// resalta (parpadeo/luminescencia). Se usa al tocar un aviso del banner de
// vencidos o de seguimiento: en vez de solo abrir WhatsApp, el usuario puede
// "ir a ver" el presupuesto en su lugar del listado.
function goToHistoryEntry(id) {
  const e = getH().find(x => x.id === id);
  if (!e) return;
  // Limpiar filtros activos para garantizar que la tarjeta esté en el DOM
  // (una búsqueda o filtro podría estar ocultando justo ese presupuesto).
  const searchEl = document.getElementById('hist-search');
  const clientEl = document.getElementById('hist-client-filter');
  const estadoEl = document.getElementById('hist-estado-filter');
  const tipoEl   = document.getElementById('hist-tipo-filter');
  if (searchEl) searchEl.value = '';
  if (clientEl) clientEl.value = '';
  if (estadoEl) estadoEl.value = '';
  if (tipoEl)   tipoEl.value = '';
  // Asegurar que el mes que contiene el presupuesto quede desplegado.
  _userTouchedMonths = true;
  _expandedMonths.add(_monthKey(e));
  // Ir a la pestaña Historial (esto re-renderiza el listado ya expandido).
  switchTab('historial');
  // Tras el render, ubicar la tarjeta, centrarla y destacarla.
  requestAnimationFrame(() => {
    const card = document.querySelector(`.hitem[data-id="${id}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('hitem-flash');
    void card.offsetWidth; // reinicia la animación si ya estaba aplicada
    card.classList.add('hitem-flash');
    setTimeout(() => card.classList.remove('hitem-flash'), 2600);
  });
}

// Toggle de un mes individual del historial. Persiste el estado en
// memoria para la sesión actual.
function toggleHistoryMonth(key) {
  _userTouchedMonths = true;
  if (_expandedMonths.has(key)) _expandedMonths.delete(key);
  else _expandedMonths.add(key);
  renderHistory();
}

// ─── NUEVO PRESUPUESTO ────────────────────────
// Sin "¿Crear un nuevo presupuesto?": el que estaba abierto se guarda solo en
// el historial, así que preguntar era un toque de más en la acción más usada
// de la app. En su lugar, el aviso ofrece "Deshacer" (vuelve a abrir el
// anterior). Lo llaman el botón "+ Nuevo" de la barra superior, el del pie del
// editor y el acceso directo del ícono (?go=nuevo).
function newQuote() {
  const prevNum = (S.quoteNumber && autoSaveToHistory()) ? S.quoteNumber : '';
  resetToNewQuote();
  const m = document.getElementById('main');
  if (m) m.scrollTop = 0;
  if (!prevNum) { toast('Nuevo presupuesto ' + S.quoteNumber, 'info'); return; }
  toastAccion(`Nuevo presupuesto ${S.quoteNumber}. El ${prevNum} quedó guardado en el historial.`,
    [{ label: 'Deshacer', fn: () => deshacerNuevo(prevNum) }], 8000);
}

// "Deshacer" del aviso de newQuote: vuelve a abrir el presupuesto que estaba en
// el editor. getH() devuelve lo más reciente primero, así que con números
// repetidos gana el que se acaba de guardar. Si en el nuevo ya se cargó algo,
// loadFromHistory lo guarda antes: no se pierde nada.
function deshacerNuevo(num) {
  const e = getH().find(x => x && x.quoteNumber === num);
  if (!e) { toast('No se encontró el ' + num + ' en el historial', 'err'); return; }
  loadFromHistory(e.id);
}

// Reinicia el estado a un presupuesto en blanco con el siguiente N° libre.
// NO guarda ni pide confirmación: eso lo decide quien la llama
// (newQuote pregunta; saveToHistory guarda y sigue de largo).
function resetToNewQuote() {
  // Calcular siguiente N° libre mirando el historial completo,
  // no solo S.numNext (que puede estar atrás si se cargaron viejos).
  S.numNext = calcNextNumFromHistory();
  S.items=[]; S.estItems=[]; S.itemsB=[]; S.clientName=''; S.clientContact=''; S.workAddress=''; S.workMapLink=''; S.workDuration='';
  S.discount=0; S.surcharge=0; S.paymentConditions=''; S.observations=''; S.estObservations=''; S.intNote='';
  // El lugar de disposición se acuerda por trabajo: arranca en blanco.
  S.dispoNota=''; S.dispoPhotos=[]; S.dispoEnDoc=true;
  // Un presupuesto nuevo es original, no la versión de nada.
  S.versionN=0; S.versionDeNum=''; S.versionDeFecha=''; S.versionEnDoc=true;
  // El plan de trabajo a medida es excepcional por presupuesto: se descarta al
  // crear uno nuevo para volver a usar el default global.
  S.workPlanOverride=false; S.workPlanCustom=''; S.workPlanCustomTitle='';
  S.isEstimative = false;
  S.isRisk = false;
  // El rubro es por trabajo y casi nunca se mezcla: cada presupuesto nuevo
  // arranca en arbolado (lo más frecuente) y se cambia con un toque.
  S.rubro = 'arbolado';
  // Resetear escenarios A/B a defaults
  S.scenariosEnabled = false;
  S.scenarioLabelA = DEF.scenarioLabelA;
  S.scenarioLabelB = DEF.scenarioLabelB;
  activeScenario = 'A';
  // Resetear riskData a defaults (sino quedan defectos/datos del informe anterior)
  S.riskData = JSON.parse(JSON.stringify(DEF.riskData));
  S.dateIssue = today(); S.quoteNumber = mkQN();
  calcExpiry();
  noSync=true; restoreUI(); noSync=false;
  renderItems(); renderEstItems();
  renderRiskDefects();
  applyMode('normal');
  updateTotalsBar(); updateSurchargeUI();
  switchTab('editor');
  sched();
}
