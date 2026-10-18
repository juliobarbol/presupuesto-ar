'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFS.JS — Centro de notificaciones (campanita del topbar).
// Resuelve dos necesidades: (1) revisar los avisos VIGENTES aunque se haya
// cerrado el toast, y (2) recuperar los que ya pasaron / recuperar de una
// acción hecha sin querer (ej: tocar "Realizado" en el banner del día).
//
// El panel tiene dos zonas:
//   · Pendientes → DERIVADO del estado (se recalcula al abrir; nada que se
//     "pierda"): recontactos, trabajos/visitas de hoy, seguimientos y
//     vencimientos que ya tocan, y clima adverso para hoy/mañana.
//   · Recientes  → BITÁCORA persistida en LS.NOTIF_LOG (ring buffer capado,
//     incluido en el backup). La llenan logNotif() desde los puntos donde hoy
//     se disparan toasts efímeros y desde las acciones reversibles, que además
//     dejan un botón "Deshacer".
// La caja/overlay reusa el estilo del panel de clima (#notif-box ~ #clima-box).
// ═══════════════════════════════════════════════════════════════════════════

const NOTIF_CAP = 50;

function getNotifLog(){
  try {
    const a = JSON.parse(localStorage.getItem(LS.NOTIF_LOG) || '[]');
    if (Array.isArray(a)) return a;
    const fixed = sanitizeNotifLog(a);
    try { localStorage.setItem(LS.NOTIF_LOG, JSON.stringify(fixed)); } catch(_){}
    return fixed;
  } catch(_){ return []; }
}
// Escritura directa (no safeSetLS): el log es chico y NO queremos disparar un
// backup a Drive por cada aviso. Ya viaja en el backup vía buildBackupObject.
function setNotifLog(arr){
  try { localStorage.setItem(LS.NOTIF_LOG, JSON.stringify((arr || []).slice(0, NOTIF_CAP))); } catch(_){}
}

// Registrar un aviso en la bitácora. rec = { icon, text, kind?, action?, undo?,
// dedupeKey? }. dedupeKey evita duplicar el mismo aviso el mismo día (ej: el
// resumen de recontactos que se dispara en cada apertura).
function logNotif(rec){
  if (!rec || !rec.text) return;
  const log = getNotifLog();
  if (rec.dedupeKey) {
    const hoy = today();
    if (log.some(n => n.dedupeKey === rec.dedupeKey && toLocalISODate(new Date(n.ts)) === hoy)) return;
  }
  log.unshift({
    id:   'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts:   Date.now(),
    icon: rec.icon || '🔔',
    text: String(rec.text),
    kind: rec.kind || 'info',
    action: rec.action || null,
    undo:   rec.undo || null,
    dedupeKey: rec.dedupeKey || null,
  });
  setNotifLog(log);
  updateNotifBadge();
  if (document.querySelector('#notif-overlay.open')) notifRender();
}

// ─── PENDIENTES (derivado) ───────────────────────────────────
// Junta TODO lo que necesita atención ahora, recalculado desde el estado. Cada
// ítem lleva:
//   · key    → identidad estable (para el badge "visto / nuevo")
//   · bucket → 'hoy' (arriba de todo) o 'atrasado' (más abajo)
//   · ord    → prioridad dentro del bucket
//   · fecha  → día del aviso (YYYY-MM-DD), para ordenar lo atrasado
//   · dias   → antigüedad en días (0 = hoy)
const NOTIF_ORD = { trabajo: 1, visita: 2, clima: 3, recontacto: 4, seguimiento: 5, vencimiento: 6 };

// Antigüedad en texto corto ("hace 3 días", "hace 2 semanas", "hace 5 meses").
// El panel mostraba solo "atrasado": con 25 avisos encimados, uno de ayer y
// otro de hace medio año se leían igual.
function notifHaceTxt(dias){
  const d = Math.max(0, dias | 0);
  if (d === 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 14) return `hace ${d} días`;
  if (d < 60) { const s = Math.round(d / 7); return `hace ${s} semanas`; }
  const m = Math.round(d / 30);
  if (m < 12) return `hace ${m} meses`;
  const a = Math.floor(m / 12);
  return `hace más de ${a} año${a > 1 ? 's' : ''}`;
}

function notifBuildPendientes(){
  const out = [];
  const hoy = today();

  // 1. Recontactos pendientes (aceptados que quedaron en coordinar fecha).
  if (typeof getRecontactosPendientes === 'function') {
    getRecontactosPendientes().forEach(p => {
      const e = p.entry;
      const cuando = notifHaceTxt(p.dias);
      out.push({ icon: '📞', kind: 'recontacto', key: `recontacto|${e.id}`,
        bucket: p.dias === 0 ? 'hoy' : 'atrasado', ord: NOTIF_ORD.recontacto,
        fecha: e.recontactoEn || hoy, dias: p.dias,
        text: `Recontactar a ${(e.clientName || '').trim() || '(sin nombre)'}`,
        sub: `Coordinar la fecha del trabajo · ${cuando}`,
        action: { type: 'entry', id: e.id } });
    });
  }

  // 2. Trabajos agendados para hoy.
  if (typeof getTrabajosDeHoy === 'function') {
    getTrabajosDeHoy().forEach(e => {
      out.push({ icon: '🪚', kind: 'trabajo', key: `trabajo|${e.id}`,
        bucket: 'hoy', ord: NOTIF_ORD.trabajo, fecha: hoy, dias: 0,
        text: `Trabajo de hoy: ${(e.clientName || '').trim() || '(sin nombre)'}`,
        sub: e.quoteNumber ? `N° ${e.quoteNumber}` : '',
        action: { type: 'entry', id: e.id } });
    });
  }

  // 3. Visitas (evaluaciones) de hoy.
  if (typeof getVisitasDeHoy === 'function') {
    getVisitasDeHoy().forEach(n => {
      const cli = (n.cliente || '').trim();
      const t = (n.texto || '').trim() || cli || 'Visita';
      const cuando = n.hora ? `${n.hora} hs` : '';
      out.push({ icon: '📍', kind: 'visita', key: `visita|${n.id}`,
        bucket: 'hoy', ord: NOTIF_ORD.visita, fecha: hoy, dias: 0,
        text: `Visita de hoy: ${t}`,
        sub: [cuando, (cli && t !== cli) ? cli : ''].filter(Boolean).join(' · '),
        action: { type: 'tab', tab: 'agenda' } });
    });
  }

  // 4. Seguimientos y vencimientos que YA tocan (hoy o atrasados). Respetan la
  //    config de seguimiento porque salen de calBuildIndex.
  //    El vencimiento que el usuario YA descartó con el ✓ del banner
  //    (vencimientoVistoEn) no vuelve acá: en la Agenda sigue siendo el día en
  //    que venció, pero como pendiente ya lo cerró. Sin este filtro la
  //    campanita acumulaba para siempre todo lo que él había dado por visto.
  if (typeof calBuildIndex === 'function') {
    let idx = {};
    try { idx = calBuildIndex() || {}; } catch(_){ idx = {}; }
    const vistos = new Set();
    try {
      ((typeof getH === 'function') ? getH() : []).forEach(e => {
        if (e && e.vencimientoVistoEn) vistos.add(e.id);
      });
    } catch(_){}
    Object.keys(idx).filter(iso => iso <= hoy).sort().forEach(iso => {
      idx[iso].forEach(ev => {
        if (ev.tipo !== 'seguimiento' && ev.tipo !== 'vencimiento') return;
        if (ev.tipo === 'vencimiento' && vistos.has(ev.entryId)) return;
        const atras = iso < hoy;
        const dias = atras ? (daysSinceDate(iso) || 0) : 0;
        out.push({ icon: ev.tipo === 'vencimiento' ? '⏳' : '📨', kind: ev.tipo,
          key: `${ev.tipo}|${ev.entryId}`, bucket: atras ? 'atrasado' : 'hoy', ord: NOTIF_ORD[ev.tipo],
          fecha: iso, dias, entryId: ev.entryId,
          text: ev.title,
          sub: (ev.sub ? ev.sub + ' · ' : '') + notifHaceTxt(dias),
          action: { type: 'entry', id: ev.entryId } });
      });
    });
  }

  // 5. Clima adverso (lluvia / viento fuerte) para trabajos de hoy o mañana.
  notifClimaPendientes().forEach(c => out.push(c));

  return out;
}

// Clima adverso hoy/mañana — mismo criterio que _climaAvisar pero SIN el gate
// diario (acá siempre queremos mostrar lo vigente, no "una vez por día").
function notifClimaPendientes(){
  const out = [];
  if (typeof _climaProximosTrabajos !== 'function' || typeof _climaMotivo !== 'function'
      || typeof climaDe !== 'function' || typeof _calAddDays !== 'function') return out;
  const hoy = today();
  const man = _calAddDays(hoy, 1);
  try {
    _climaProximosTrabajos().forEach(t => {
      t.fechas.filter(f => f === hoy || f === man).forEach(f => {
        const d = climaDe(t.e, f);
        const motivo = _climaMotivo(d);
        if (!motivo.txt) return;
        const cuando = f === hoy ? 'hoy' : 'mañana';
        const emoji = motivo.viento && !motivo.lluvia ? '💨' : '⛈️';
        const cap = (typeof _cap === 'function') ? _cap(motivo.txt) : motivo.txt;
        out.push({ icon: emoji, kind: 'clima', key: `clima|${t.e.id}|${f}`,
          bucket: 'hoy', ord: NOTIF_ORD.clima, fecha: f, dias: 0,
          text: `${cap} ${cuando}: ${(t.e.clientName || '').trim() || '(sin nombre)'}`,
          sub: 'Considerá reprogramar el trabajo',
          action: { type: 'clima', id: t.e.id, f } });
      });
    });
  } catch(_){}
  return out;
}

// ─── ACCIONES (abrir el aviso) ───────────────────────────────
// Los avisos guardan un descriptor serializable (no funciones), que este
// dispatcher traduce a la navegación correspondiente.
function notifRunAction(a){
  if (!a) return;
  notifClose();
  try {
    if (a.type === 'entry' && typeof goToHistoryEntry === 'function') goToHistoryEntry(a.id);
    else if (a.type === 'tab' && typeof switchTab === 'function') switchTab(a.tab);
    else if (a.type === 'clima' && typeof climaOpenDetail === 'function') climaOpenDetail('e', a.id, a.f);
  } catch(_){}
}

// ─── DESHACER (acciones reversibles) ─────────────────────────
function notifUndo(recId){
  const log = getNotifLog();
  const rec = log.find(n => n.id === recId);
  if (!rec || !rec.undo || rec.undoneAt) return;
  const u = rec.undo;
  let ok = false;
  try {
    if (u.type === 'estado') {
      const h = getH(); const e = h.find(x => x.id === u.id);
      if (e) { e.estado = u.prev; setH(h); ok = true; }
    } else if (u.type === 'recontacto') {
      const h = getH(); const e = h.find(x => x.id === u.id);
      if (e) {
        if (u.recontactoEn) e.recontactoEn = u.recontactoEn;
        if (u.recontactoNota != null && u.recontactoNota !== '') e.recontactoNota = u.recontactoNota;
        setH(h); ok = true;
      }
    } else if (u.type === 'vencVisto') {
      const h = getH(); const e = h.find(x => x.id === u.id);
      if (e) { delete e.vencimientoVistoEn; setH(h); ok = true; }
    } else if (u.type === 'segHecho') {
      const h = getH(); const e = h.find(x => x.id === u.id);
      if (e) { delete e.seguimientoHechoEn; setH(h); ok = true; }
    } else if (u.type === 'note') {
      const notes = (typeof getNotes === 'function') ? getNotes() : [];
      const n = notes.find(x => x && x.id === u.id);
      if (n) { n.hecho = false; if (typeof setNotes === 'function') setNotes(notes); ok = true; }
    }
  } catch(_){}
  if (!ok) { if (typeof toast === 'function') toast('No se pudo deshacer', 'err'); return; }
  rec.undoneAt = Date.now();
  setNotifLog(log);
  if (typeof renderHistory === 'function') renderHistory();
  if (typeof renderMorningBanner === 'function') renderMorningBanner();
  if (typeof renderCal === 'function' && document.querySelector('#panel-agenda.active')) { try { renderCal(); } catch(_){} }
  if (typeof toast === 'function') toast('✓ Deshecho', 'ok');
  updateNotifBadge();
  if (document.querySelector('#notif-overlay.open')) notifRender();
}

// ─── RENDER DEL PANEL ────────────────────────────────────────
// Las acciones NO se serializan dentro del atributo onclick. Antes iban como
// onclick='notifRunAction({"type":"entry","id":123})': una comilla simple en
// cualquier campo rompía el atributo y ejecutaba código ajeno (los avisos
// vienen del backup, que puede ser de un tercero). Ahora quedan en este array
// por render y el markup solo lleva su índice; un listener delegado las
// resuelve. Al DOM no viaja ningún dato del usuario.
let _notifActions = [];
// Cuántos atrasados se muestran antes de plegar el resto (se despliega con el
// botón y vuelve a plegarse al cerrar y reabrir el panel).
const NOTIF_ATRAS_TOPE = 8;
let _notifVerAtrasado = false;
function notifVerAtrasado(){ _notifVerAtrasado = true; notifRender(); }

// ─── CRITERIO DE ORDEN (elegible) ────────────────────────────
// Las dos formas de leer el panel son legítimas y ninguna sirve para las dos
// cosas: por FECHA se busca "qué pasó último" (lo más reciente arriba, sin que
// el tipo de aviso importe); por TIPO se trabaja el día (primero el trabajo,
// después la visita, el clima, el recontacto…). Por eso es un interruptor y no
// una decisión tomada de antemano. La preferencia es del dispositivo: se
// guarda directo en localStorage y NO va al backup, como LS.CAL_VIEW.
const NOTIF_ORDENES = ['fecha', 'tipo'];
function notifGetOrden(){
  try { const v = localStorage.getItem(LS.NOTIF_ORDEN); if (NOTIF_ORDENES.includes(v)) return v; } catch(_){}
  return 'fecha';
}
function notifSetOrden(v){
  const val = NOTIF_ORDENES.includes(v) ? v : 'fecha';
  try { localStorage.setItem(LS.NOTIF_ORDEN, val); } catch(_){}
  notifRender();
}
// Comparadores. Cada uno usa al otro de desempate: dos avisos del mismo día se
// ordenan por tipo, y dos del mismo tipo por fecha.
function _notifCmp(orden){
  const porTipo  = (a, b) => (a.ord || 9) - (b.ord || 9);
  const porFecha = (a, b) => {
    const fa = a.fecha || '', fb = b.fecha || '';
    return fa === fb ? 0 : (fa < fb ? 1 : -1);   // lo más reciente arriba
  };
  return orden === 'tipo'
    ? (a, b) => porTipo(a, b) || porFecha(a, b)
    : (a, b) => porFecha(a, b) || porTipo(a, b);
}
// Nombre de cada concepto como encabezado de grupo (modo "tipo").
const NOTIF_GRUPO = {
  trabajo: 'Trabajos', visita: 'Visitas', clima: 'Clima',
  recontacto: 'Recontactos', seguimiento: 'Seguimientos', vencimiento: 'Vencimientos',
};
// Los grupos que dibuja el panel, según el criterio elegido. El switch no
// puede ser solo un reordenamiento: con la lista real del usuario —donde casi
// todo son vencimientos— los dos criterios daban EXACTAMENTE la misma pantalla
// y el control se sentía roto. Así que cada criterio arma su propia vista:
//   · fecha → Hoy / Atrasado, lo más reciente arriba (buscar el último aviso).
//   · tipo  → un grupo por concepto, en orden de prioridad, y adentro por
//             fecha (trabajar el día: todos los recontactos juntos, etc.).
// `plegable` marca los grupos a los que se les corta la cola vieja: "Hoy"
// nunca, porque es justamente lo que hay que ver entero.
function _notifGrupos(pend, orden){
  if (orden === 'tipo') {
    const porFecha = _notifCmp('fecha');
    return Object.keys(NOTIF_GRUPO)
      .map(k => ({ titulo: NOTIF_GRUPO[k], items: pend.filter(p => p.kind === k).sort(porFecha), plegable: true }))
      .filter(g => g.items.length);
  }
  const cmp = _notifCmp('fecha');
  return [
    { titulo: 'Hoy',      items: pend.filter(p => p.bucket === 'hoy').sort(cmp), plegable: false },
    { titulo: 'Atrasado', items: pend.filter(p => p.bucket !== 'hoy').sort(cmp), plegable: true },
  ].filter(g => g.items.length);
}
function _notifOrdenHTML(orden){
  const b = (v, txt) => `<button type="button" class="nt-ord-b${orden === v ? ' active' : ''}" onclick="notifSetOrden('${v}')">${txt}</button>`;
  return `<div class="nt-ord" role="group" aria-label="Orden de los avisos">
    <span class="nt-ord-lbl">Ordenar por</span>${b('fecha', 'Fecha')}${b('tipo', 'Tipo')}
  </div>`;
}
function _notifActionAttr(action){
  if (!action) return '';
  const i = _notifActions.push(action) - 1;
  return ` data-nt-act="${i}"`;
}

function notifItemHTML(p){
  const tap = p.action ? ' nt-tap' : '';
  // ✓ "no avisarme más", en el aviso mismo. Antes solo estaba en el banner de
  // vencidos, y un aviso que no se puede cerrar donde se lee es un aviso que
  // se queda arriba para siempre. El id va por data-* (lo resuelve el listener
  // delegado): interpolarlo en un onclick es lo que se prohíbe con datos que
  // pueden venir de un backup ajeno.
  const ok = (p.kind === 'vencimiento' && p.entryId != null)
    ? `<button type="button" class="nt-undo" data-nt-venc="${esc(String(p.entryId))}" title="No avisarme más de este">✓</button>`
    : '';
  return `<div class="nt-item${tap}"${_notifActionAttr(p.action)}>
    <span class="nt-ico">${esc(p.icon || '🔔')}</span>
    <div class="nt-body">
      <div class="nt-txt">${esc(p.text)}</div>
      ${p.sub ? `<div class="nt-sub">${esc(p.sub)}</div>` : ''}
    </div>
    ${ok}
  </div>`;
}

// Descartar un vencimiento desde el panel. El trabajo (y la bitácora con
// "Deshacer") lo hace marcarVencimientoVisto, que es el mismo camino del ✓ del
// banner; acá solo se valida el id que vino del DOM y se repinta el panel.
function notifDescartarVenc(id){
  const nid = (typeof sanNumId === 'function') ? sanNumId(id) : Number(id);
  if (!nid) return;
  marcarVencimientoVisto(nid);
  notifRender();
}

function notifLogItemHTML(r){
  const tap = r.action ? ' nt-tap' : '';
  const undoBtn = r.undo
    ? `<button type="button" class="nt-undo"${r.undoneAt ? ' disabled' : ''} data-nt-undo="${esc(r.id)}">${r.undoneAt ? 'Deshecho' : 'Deshacer'}</button>`
    : '';
  return `<div class="nt-item${tap}${r.undoneAt ? ' nt-done' : ''}"${_notifActionAttr(r.action)}>
    <span class="nt-ico">${esc(r.icon || '🔔')}</span>
    <div class="nt-body">
      <div class="nt-txt">${esc(r.text)}</div>
      <div class="nt-when">${esc(notifRelTime(r.ts))}</div>
    </div>
    ${undoBtn}
  </div>`;
}

// Listener delegado del panel: resuelve la acción por índice y el "Deshacer"
// por id. Se engancha una sola vez sobre el contenedor.
function _wireNotifPanel(body){
  if (!body || body._ntWired) return;
  body.addEventListener('click', (ev) => {
    const undo = ev.target.closest('[data-nt-undo]');
    if (undo) { ev.stopPropagation(); notifUndo(undo.getAttribute('data-nt-undo')); return; }
    const venc = ev.target.closest('[data-nt-venc]');
    if (venc) { ev.stopPropagation(); notifDescartarVenc(venc.getAttribute('data-nt-venc')); return; }
    const item = ev.target.closest('[data-nt-act]');
    if (!item) return;
    const a = _notifActions[parseInt(item.getAttribute('data-nt-act'), 10)];
    if (a) notifRunAction(a);
  });
  body._ntWired = true;
}

// Timestamp → texto relativo corto ("recién", "hace 5 min", "hoy 14:30", "ayer…").
function notifRelTime(ts){
  if (!ts) return '';
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 60) return 'recién';
  if (secs < 3600) { const m = Math.round(secs / 60); return `hace ${m} min`; }
  const d = new Date(ts);
  const iso = toLocalISODate(d);
  const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const hoy = today();
  if (iso === hoy) return `hoy ${hh}`;
  if (iso === _calAddDays(hoy, -1)) return `ayer ${hh}`;
  const p = iso.split('-');
  return `${p[2]}/${p[1]} ${hh}`;
}

function notifRender(){
  const body = document.getElementById('notif-dlg-body');
  if (!body) return;
  const pend = notifBuildPendientes();
  const log = getNotifLog();
  _notifActions = [];   // se rellena al armar el markup (ver _notifActionAttr)

  const orden = notifGetOrden();

  let h = (typeof pushCtaHTML === 'function') ? pushCtaHTML() : '';
  if (!pend.length) {
    h += `<div class="nt-sec">Pendientes</div><div class="nt-empty">Nada pendiente. Todo al día 👌</div>`;
  } else {
    h += _notifOrdenHTML(orden);
    _notifGrupos(pend, orden).forEach(g => {
      // La cola vieja se pliega: lo accionable son los últimos, no la pila
      // entera. El resto sigue a un toque de distancia.
      const tope = (g.plegable && !_notifVerAtrasado) ? Math.min(g.items.length, NOTIF_ATRAS_TOPE) : g.items.length;
      const resto = g.items.length - tope;
      h += `<div class="nt-sec">${esc(g.titulo)} · ${g.items.length}</div>`;
      h += `<div class="nt-list">${g.items.slice(0, tope).map(notifItemHTML).join('')}</div>`;
      if (resto > 0) h += `<button type="button" class="nt-clear" onclick="notifVerAtrasado()">Ver los ${resto} más viejos</button>`;
    });
  }

  h += `<div class="nt-sec">Recientes</div>`;
  if (log.length) {
    h += `<div class="nt-list">${log.map(notifLogItemHTML).join('')}</div>`;
    h += `<button type="button" class="nt-clear" onclick="notifClearLog()">Vaciar recientes</button>`;
  } else {
    h += `<div class="nt-empty">Los avisos que aparezcan van a quedar acá para que puedas volver a verlos.</div>`;
  }
  if (typeof pushDisponible === 'function' && pushDisponible() && S.pushEnabled) {
    h += `<button type="button" class="nt-clear" onclick="irAPush()">📲 Avisos en el teléfono: activos · Configurar</button>`;
  }
  body.innerHTML = h;
  _wireNotifPanel(body);
}

function notifOpen(){
  _notifVerAtrasado = false;
  notifRender();
  const ov = document.getElementById('notif-overlay');
  if (ov) ov.classList.add('open');
  // Marcar como vistos todos los pendientes actuales: el badge se apaga y solo
  // vuelve a aparecer cuando surja algo NUEVO (no cada vez que quede algún
  // atrasado). Es el comportamiento esperado de una campanita.
  try { _notifMarkSeen(notifBuildPendientes().map(p => p.key)); } catch(_){}
  updateNotifBadge();
}
function notifClose(){
  const ov = document.getElementById('notif-overlay');
  if (ov) ov.classList.remove('open');
}
function notifClearLog(){
  setNotifLog([]);
  updateNotifBadge();
  notifRender();
}

// "Visto": snapshot de los keys de pendientes que el usuario ya miró (se
// reemplaza en cada apertura del panel). No va al backup (estado local de
// lectura, propio de cada dispositivo).
function _notifSeenSet(){
  try { const a = JSON.parse(localStorage.getItem(LS.NOTIF_SEEN) || '[]'); return new Set(Array.isArray(a) ? a : []); }
  catch(_){ return new Set(); }
}
function _notifMarkSeen(keys){
  try { localStorage.setItem(LS.NOTIF_SEEN, JSON.stringify(Array.from(new Set(keys || [])))); } catch(_){}
}

// Badge de la campanita = cantidad de pendientes NUEVOS (los que aún no se
// vieron). Tras abrir el panel queda en 0 hasta que aparezca algo nuevo. Se
// recalcula al iniciar y tras cada render del historial / banner del día.
function updateNotifBadge(){
  const b = document.getElementById('notif-badge');
  if (!b) return;
  let n = 0;
  try {
    const seen = _notifSeenSet();
    n = notifBuildPendientes().filter(p => !seen.has(p.key)).length;
  } catch(_){ n = 0; }
  b.textContent = n > 99 ? '99+' : String(n);
  b.hidden = n === 0;
}
