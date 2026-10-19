'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR.JS — Pestaña "Agenda": vista de calendario (mes) que superpone TODO
// lo que tiene fecha en la app. Es una CAPA DE VISUALIZACIÓN: no inventa datos
// nuevos salvo las notas manuales. Las fuentes son:
//   · trabajo      → días agendados de un presupuesto (agFechas)
//   · recontacto   → e.recontactoEn (aceptado)
//   · vencimiento  → e.snapshot.dateExpiry (respeta la config de seguimiento)
//   · seguimiento  → e.enviadoEn + cfg.days (día en que toca contactar)
//   · nota         → anotaciones/recordatorios propios (LS.NOTES), lo único
//                    que se guarda de nuevo. Sobrevive backup/restore.
//   · visita       → nota con tipo:'visita' (evaluación presencial / ir a
//                    presupuestar): concepto propio, color azul, prioridad
//                    junto al trabajo, chip de clima y botón "Crear presupuesto".
// Todas las fechas son LOCALES (YYYY-MM-DD), nunca UTC (regla del proyecto).
// La semana arranca en LUNES (convención AR).

const CAL_MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CAL_WD_MON = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const CAL_DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
// Orden de prioridad de los tipos (para ordenar dentro de un día y los puntos).
// La visita (evaluación presencial / ir a presupuestar) va pegada al trabajo:
// es un compromiso con lugar y persona, no un recordatorio suelto.
const CAL_TIPO_ORD = { trabajo:0, visita:1, recontacto:2, vencimiento:3, seguimiento:4, nota:5 };
const CAL_TIPO_LBL = { trabajo:'Trabajo', visita:'Visita', recontacto:'Recontacto', vencimiento:'Vence', seguimiento:'Seguimiento', nota:'Nota' };

let _calY = null, _calM = null;   // año / mes (0-11) que se está mostrando (vista mes)
let _calAnchor = null;            // fecha ancla (iso) para las grillas semana/3-días
let _calSel = null;               // día seleccionado (iso) o null
let _calView = 'agenda';          // 'mes' | 'semana' | '3dias' (grillas) | 'agenda' (lista)
let _calOverdueOpen = false;      // sección "Atrasado" desplegada (colapsada por defecto)

// ─── NOTAS MANUALES (localStorage) ───────────────────────────
// Cada nota: { id, fecha:'YYYY-MM-DD', texto, hecho:bool, creadoEn }.
// Campo opcional tipo:'visita' → evaluación presencial / ir a presupuestar
// (se muestra como concepto propio en la Agenda; sin tipo = nota común).
// Campo opcional hora:'HH:MM' → compromiso con horario; sin hora es de día
// completo (como fue siempre). La hora viaja a Google Calendar y al .ics.
function getNotes() {
  try {
    const a = JSON.parse(localStorage.getItem(LS.NOTES) || '[]');
    if (Array.isArray(a)) return a;
    const fixed = sanitizeNotes(a);
    try { safeSetLS(LS.NOTES, JSON.stringify(fixed)); } catch (_) {}
    return fixed;
  } catch (e) { return []; }
}
function setNotes(a) {
  safeSetLS(LS.NOTES, JSON.stringify(a || []));
  if (typeof scheduleGcalSync === 'function') scheduleGcalSync();
  if (typeof schedulePushSync === 'function') schedulePushSync();
  // Las visitas de hoy viven también en el banner del día → mantenerlo al día.
  try { if (typeof renderMorningBanner === 'function') renderMorningBanner(); } catch (_) {}
}

// ─── HELPERS DE FECHA (locales) ──────────────────────────────
// Suma n días a una fecha ISO local y devuelve otra ISO local.
function _calAddDays(iso, n) {
  const p = String(iso).split('-');
  if (p.length !== 3) return iso;
  const d = new Date(+p[0], +p[1] - 1, +p[2] + (n || 0));
  return toLocalISODate(d);
}
// ─── HORA DE UN COMPROMISO ───────────────────────────────────
// Cuánto dura, por defecto, una nota/visita con hora (Google y el .ics piden un
// fin). Una hora es lo razonable para una evaluación o un recordatorio.
const CAL_EV_MINS = 60;
// Suma minutos a { iso, 'HH:MM' } y devuelve { fecha, hora } — puede caer al día
// siguiente (una visita a las 23:30 termina el día después).
function _calHoraMas(iso, hm, mins) {
  const p = String(hm || '00:00').split(':');
  const t = (+p[0] || 0) * 60 + (+p[1] || 0) + (mins || 0);
  const dias = Math.floor(t / 1440);
  const rest = ((t % 1440) + 1440) % 1440;
  const p2 = n => String(n).padStart(2, '0');
  return { fecha: dias ? _calAddDays(iso, dias) : iso, hora: p2(Math.floor(rest / 60)) + ':' + p2(rest % 60) };
}
// ISO local a partir de un timestamp (e.enviadoEn se guarda como ISO UTC con
// hora; para el calendario nos importa el DÍA local en que se envió).
function _calTsToLocalISO(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return toLocalISODate(d);
}
// "Lunes 12 de julio" (día seleccionado). Construye el Date con partes locales.
function _calLongDate(iso) {
  const p = String(iso).split('-');
  if (p.length !== 3) return fmtD(iso);
  const dt = new Date(+p[0], +p[1] - 1, +p[2]);
  return `${CAL_DIAS[dt.getDay()]} ${+p[2]} de ${CAL_MESES[+p[1] - 1].toLowerCase()}`;
}
// Date LOCAL a partir de un iso 'YYYY-MM-DD' (sin correr el día por UTC).
function _calDateFromISO(iso) {
  const p = String(iso).split('-');
  return (p.length === 3) ? new Date(+p[0], +p[1] - 1, +p[2]) : new Date();
}
// Título de rango: "12–18 jul" (mismo mes) o "28 jul – 3 ago" (cruza de mes).
function _calRangeLabel(a, b) {
  const ma = CAL_MESES[a.getMonth()].slice(0, 3).toLowerCase();
  const mb = CAL_MESES[b.getMonth()].slice(0, 3).toLowerCase();
  return (a.getMonth() === b.getMonth())
    ? `${a.getDate()}–${b.getDate()} ${mb}`
    : `${a.getDate()} ${ma} – ${b.getDate()} ${mb}`;
}

// ─── ÍNDICE DE EVENTOS ───────────────────────────────────────
// Recorre el historial (una vez) + las notas y arma { 'YYYY-MM-DD': [ev, …] }.
// Cada ev: { tipo, title, sub, entryId?, noteId?, done? }.
function calBuildIndex() {
  const idx = {};
  const push = (iso, ev) => { if (!iso) return; ev._iso = iso; (idx[iso] || (idx[iso] = [])).push(ev); };
  const h = (typeof getH === 'function') ? getH() : [];
  const cfg = (typeof getFollowupCfg === 'function') ? getFollowupCfg() : null;

  h.forEach(e => {
    const est = e.estado || 'borrador';
    const quien = (e.clientName || '').trim() || '(sin nombre)';
    const num = e.quoteNumber ? `N° ${e.quoteNumber}` : '';
    // Teléfono del cliente (para el botón de chat directo en la Agenda). Se
    // deriva una sola vez por presupuesto; '' si no hay nada usable.
    const tel = (typeof histClientPhone === 'function') ? histClientPhone(e) : '';
    // URL de Maps del trabajo (ubicación exacta o dirección del snapshot), para
    // el botón "Llegar" y para adjuntarla al compartir. '' si no hay ubicación.
    const mapUrl = (typeof mapsUrlFor === 'function')
      ? mapsUrlFor(e.snapshot && e.snapshot.workMapLink, e.snapshot && e.snapshot.workAddress) : '';

    // Trabajo(s): días ubicados de la agenda (multi-día soportado).
    const fechas = (typeof agFechas === 'function') ? agFechas(e) : (e.fechaTrabajo ? [e.fechaTrabajo] : []);
    if (fechas.length) {
      const total = (typeof agDiasEstimados === 'function') ? agDiasEstimados(e) : fechas.length;
      // Anotaciones internas del presupuesto (memoria privada de quien edita):
      // se adjuntan al evento de trabajo para verlas en la Agenda (in-app).
      // NO se envían a Google Calendar ni al .ics (esos salen de la app).
      const notas = (typeof snapshotIntNotes === 'function') ? snapshotIntNotes(e.snapshot) : [];
      // Una colaboración se ve como cualquier otro día de trabajo (mismo
      // concepto, mismo clima, misma ruta), pero el subtítulo dice qué es y
      // para qué tarifa: en la Agenda, "Martín" solo no distingue una poda
      // propia de una jornada trabajada para un colega.
      const colabSub = esTrabajoPropio(e)
        ? trabajoCfg(tipoTrabajo(e)).badge + ((e.colab && e.colab.nombre) ? ' · ' + e.colab.nombre : '')
        : '';
      fechas.forEach((f, i) => {
        const dnum = total > 1 ? ` · día ${i + 1} de ${total}` : '';
        // Pronóstico del día del trabajo (cache local; null si no hay dato).
        const clima = (typeof climaDe === 'function') ? climaDe(e, f) : null;
        push(f, { tipo: 'trabajo', title: quien, sub: (colabSub || (num ? num : '')) + dnum, entryId: e.id, tel, mapUrl, notes: notas, clima });
      });
    }

    // Recontacto: solo mientras siga aceptado (coordinar la fecha del trabajo).
    if (e.recontactoEn && est === 'aceptado') {
      push(e.recontactoEn, {
        tipo: 'recontacto', title: `Llamar a ${quien}`,
        sub: (e.recontactoNota || '').trim() || num, entryId: e.id, tel, mapUrl
      });
    }

    // Vencimiento y seguimiento respetan la config de seguimiento (misma que
    // los banners): si el usuario los apagó, tampoco aparecen acá.
    const estOk = cfg && cfg.enabled && Array.isArray(cfg.estados) && cfg.estados.includes(est);
    if (estOk) {
      const exp = e.snapshot && e.snapshot.dateExpiry;
      // El reemplazado no vence más: su versión nueva trae su propia fecha y
      // dos vencimientos del mismo trabajo en la Agenda no dicen nada.
      if (cfg.expiryEnabled && exp && !esReemplazado(e)) {
        push(exp, { tipo: 'vencimiento', title: `Vence ${quien}`, sub: num, entryId: e.id, tel, mapUrl });
      }
      if (e.enviadoEn) {
        // ¿Ya se hizo el seguimiento después del envío? Entonces no lo mostramos.
        let hecho = false;
        if (e.seguimientoHechoEn) {
          const seg = new Date(e.seguimientoHechoEn).getTime();
          const env = new Date(e.enviadoEn).getTime();
          hecho = seg >= env;
        }
        if (!hecho) {
          const base = _calTsToLocalISO(e.enviadoEn);
          const due = base ? _calAddDays(base, cfg.days || 0) : null;
          if (due) push(due, { tipo: 'seguimiento', title: `Seguimiento ${quien}`, sub: num, entryId: e.id, tel, mapUrl });
        }
      }
    }
  });

  // Notas manuales. Pueden llevar un contacto vinculado (cliente + tel) para el
  // botón de chat directo, y una ubicación (coordenadas / Plus Code / link de
  // Maps) para navegar y compartir. El nombre del contacto va como subtítulo.
  getNotes().forEach(n => {
    if (!n || !n.fecha) return;
    const ubic = (n.ubic || '').trim();
    const esVisita = n.tipo === 'visita';
    // Visitas: pronóstico del día (mismo chip que los trabajos — evaluar un
    // árbol con lluvia o ráfagas también es mala idea). Solo días no pasados.
    const clima = (esVisita && n.fecha >= today() && typeof climaDeNota === 'function')
      ? climaDeNota(n, n.fecha) : null;
    // Título: el texto de la nota. Una visita puede no tener título (se explica
    // sola): entonces mostramos el contacto, o "Visita" a secas si tampoco hay.
    // Si el título cae en el contacto, el subtítulo se omite para no repetirlo.
    const cliente = (n.cliente || '').trim();
    const texto = (n.texto || '').trim();
    const titulo = texto || (esVisita ? (cliente || 'Visita') : '(nota)');
    push(n.fecha, {
      tipo: esVisita ? 'visita' : 'nota', title: titulo, sub: (titulo === cliente) ? '' : cliente,
      noteId: n.id, done: !!n.hecho, tel: (n.tel || '').trim(),
      hora: sanHoraHM(n.hora),
      ubic, mapUrl: ubic && typeof mapsUrlFor === 'function' ? mapsUrlFor(ubic, '') : '',
      clima
    });
  });

  // Ordenar cada día por prioridad de tipo y, dentro del mismo tipo, por hora
  // (los que no tienen hora van después: son de día completo).
  Object.keys(idx).forEach(k => idx[k].sort((a, b) => {
    const d = (CAL_TIPO_ORD[a.tipo] || 9) - (CAL_TIPO_ORD[b.tipo] || 9);
    if (d) return d;
    const ha = a.hora || '99:99', hb = b.hora || '99:99';
    return ha < hb ? -1 : (ha > hb ? 1 : 0);
  }));
  return idx;
}

// ─── RENDER: GRILLAS (mes / semana / 3-días) ─────────────────
const CAL_VIEWS = ['mes', 'semana', '3dias', 'agenda'];
function calInit() {
  if (_calY == null || _calM == null) {
    const t = today().split('-');
    _calY = +t[0]; _calM = +t[1] - 1;
    _calAnchor = today();
    _calSel = today();
    // Vista recordada (por defecto Agenda: es lo que el usuario quiere ver primero).
    try { const v = localStorage.getItem(LS.CAL_VIEW); if (CAL_VIEWS.includes(v)) _calView = v; } catch (_) {}
  }
  renderCal();
}

// Navegación unificada: despacha según la vista activa. Mes se mueve por meses
// (_calY/_calM); semana/3-días desplazan la fecha ancla ±7 / ±3 días.
function calStep(dir) {
  if (_calView === 'semana') { _calAnchor = _calAddDays(_calAnchor || today(), 7 * dir); }
  else if (_calView === '3dias') { _calAnchor = _calAddDays(_calAnchor || today(), 3 * dir); }
  else {
    _calM += dir;
    if (_calM < 0) { _calM = 11; _calY--; }
    else if (_calM > 11) { _calM = 0; _calY++; }
  }
  renderCal();
}
function calPrev() { calStep(-1); }
function calNext() { calStep(1); }
// Deslizar sobre el calendario (setupTabSwipe): en Mes y en 3 días el gesto
// horizontal es del calendario —pasa de mes o de tanda de días, como en
// cualquier app de calendario— y no de la barra de pestañas. Semana queda
// afuera porque sus columnas ya se desplazan de costado.
function calSwipeActivo() {
  return _calView === 'mes' || _calView === '3dias';
}
// Lo que dice la pastilla mientras se arrastra: a dónde se va.
function calSwipeLabel(dir) {
  if (_calView === '3dias') return dir > 0 ? 'Días siguientes' : 'Días anteriores';
  let m = (_calM == null ? +today().split('-')[1] - 1 : _calM) + dir, y = _calY == null ? +today().split('-')[0] : _calY;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  const ya = +today().split('-')[0];
  return CAL_MESES[m] + (y !== ya ? ' ' + y : '');
}
function calToday() {
  const t = today().split('-');
  _calY = +t[0]; _calM = +t[1] - 1;
  _calAnchor = today(); _calSel = today();
  renderCal();
}
function calSelectDay(iso) { _calSel = iso; renderCal(); }

// Cambia de vista (Mes / Semana / 3 días / Agenda). Recuerda la elección para la
// próxima vez que se abra la pestaña.
function calSetView(v) {
  _calView = CAL_VIEWS.includes(v) ? v : 'mes';
  try { localStorage.setItem(LS.CAL_VIEW, _calView); } catch (_) {}
  renderCal();
}

// Despliega/colapsa la sección "Atrasado" de la vista Agenda.
function calToggleOverdue() { _calOverdueOpen = !_calOverdueOpen; renderCalList(); }

// Dispatcher: muestra/oculta el bloque de grilla o el de lista según la vista y
// sincroniza el segmentado (4 tabs). Se hace en cada render para que quede
// consistente aunque se entre a la pestaña con una vista ya elegida.
function renderCal() {
  const monthWrap = document.getElementById('agc-month');
  const listWrap = document.getElementById('agc-list');
  const esAgenda = _calView === 'agenda';
  if (monthWrap) monthWrap.hidden = esAgenda;
  if (listWrap) listWrap.hidden = !esAgenda;
  [['mes', 'agc-vtab-mes'], ['semana', 'agc-vtab-semana'], ['3dias', 'agc-vtab-3dias'], ['agenda', 'agc-vtab-agenda']]
    .forEach(([v, id]) => { const el = document.getElementById(id); if (el) el.classList.toggle('active', _calView === v); });
  if (esAgenda) renderCalList();
  else if (_calView === 'semana' || _calView === '3dias') renderCalCols();
  else renderCalGrid();
  _calInitSwipe();   // engancha el deslizamiento de notas (una sola vez)
  if (typeof calUpdateDot === 'function') calUpdateDot();
}

// Grilla del mes (7×N celdas). Panorama del mes: los días con poda se tintan de
// fondo (mapa de trabajo) y los otros conceptos van como puntos. Semana y 3-días
// usan columnas por día (renderCalCols). El encabezado Lun…Dom se muestra con
// style.display (no `hidden`: el `[hidden]` lo pisa el `display:grid` del CSS).
function renderCalGrid() {
  const grid = document.getElementById('agc-grid');
  const head = document.getElementById('agc-grid-head');
  const title = document.getElementById('agc-title');
  if (!grid || !head) return;
  if (_calY == null) { const t = today().split('-'); _calY = +t[0]; _calM = +t[1] - 1; }

  grid.classList.remove('agc-cols', 'agc-cols-3', 'agc-grid-3');
  grid.scrollLeft = 0;
  head.hidden = false;
  head.style.display = '';
  head.innerHTML = CAL_WD_MON.map(d => `<span>${d}</span>`).join('');
  if (title) title.textContent = `${CAL_MESES[_calM]} ${_calY}`;

  const idx = calBuildIndex();
  const hoy = today();
  const first = new Date(_calY, _calM, 1);
  const startOffset = (first.getDay() + 6) % 7;         // lunes = 0
  const daysInMonth = new Date(_calY, _calM + 1, 0).getDate();
  const weeks = Math.ceil((startOffset + daysInMonth) / 7);
  const cells = weeks * 7;
  const gridStart = new Date(_calY, _calM, 1 - startOffset);

  let html = '';
  for (let i = 0; i < cells; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const iso = toLocalISODate(d);
    const evs = idx[iso] || [];
    let cls = 'agc-cell';
    if (d.getMonth() !== _calM) cls += ' is-other';
    if (iso === hoy) cls += ' is-today';
    if (iso === _calSel) cls += ' is-sel';
    const nTrab = _calJobCount(evs);
    if (nTrab > 0) cls += ' agc-cell-work';   // día con poda → fondo tintado (mapa de trabajo)
    const load = nTrab >= 2 ? `<span class="agc-load" title="${nTrab} trabajos agendados">${nTrab}</span>` : '';
    // El trabajo se marca con el fondo; recontacto/vence/seguimiento/nota siguen como puntos.
    const otras = evs.filter(ev => ev.tipo !== 'trabajo');
    const dots = otras.length
      ? `<div class="agc-dots">${otras.slice(0, 4).map(ev => `<i class="agc-dot agc-c-${ev.tipo}"></i>`).join('')}${otras.length > 4 ? `<span class="agc-more">+${otras.length - 4}</span>` : ''}</div>`
      : '';
    html += `<div class="${cls}" onclick="calSelectDay('${iso}')"><span class="agc-daynum">${d.getDate()}</span>${load}${dots}</div>`;
  }
  grid.innerHTML = html;
  renderCalDay();
}

// Columnas por día (Semana / 3-días): cada día es una columna con el encabezado
// (día de semana + número) y debajo los eventos como BLOQUES con el texto a la
// vista (cliente + dato), sin tener que tocar para ver qué hay. Semana = Lun→Dom
// con scroll horizontal (no entran 7 columnas legibles en el teléfono); 3-días =
// 3 columnas que llenan el ancho. Debajo queda el alta de nota para el día tocado.
function renderCalCols() {
  const grid = document.getElementById('agc-grid');
  const head = document.getElementById('agc-grid-head');
  const title = document.getElementById('agc-title');
  if (!grid) return;
  if (!_calAnchor) _calAnchor = today();

  const es3 = _calView === '3dias';
  const a = _calDateFromISO(_calAnchor);
  let gridStart, cells;
  if (es3) { gridStart = a; cells = 3; }
  else {
    const off = (a.getDay() + 6) % 7;                   // lunes = 0
    gridStart = new Date(a.getFullYear(), a.getMonth(), a.getDate() - off);
    cells = 7;
  }
  const startISO = toLocalISODate(gridStart);
  const endD = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + cells - 1);
  if (title) title.textContent = _calRangeLabel(gridStart, endD);
  // Ocultar el encabezado Lun…Dom con style.display: `hidden` no alcanza porque el
  // CSS le pone display:grid (cada columna ya trae su propio día de semana).
  if (head) { head.hidden = true; head.style.display = 'none'; }
  grid.classList.add('agc-cols');
  grid.classList.toggle('agc-cols-3', es3);             // 3-días: columnas que llenan el ancho
  grid.classList.remove('agc-grid-3');

  // Mantener la selección (para el alta de nota de abajo) dentro del rango visible.
  const hoy = today();
  const endISO = toLocalISODate(endD);
  if (!_calSel || _calSel < startISO || _calSel > endISO) {
    _calSel = (hoy >= startISO && hoy <= endISO) ? hoy : startISO;
  }

  const idx = calBuildIndex();
  let html = '';
  for (let i = 0; i < cells; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const iso = toLocalISODate(d);
    const evs = idx[iso] || [];
    let cls = 'agc-col';
    if (iso === hoy) cls += ' is-today';
    if (iso === _calSel) cls += ' is-sel';
    const nTrab = _calJobCount(evs);
    const load = nTrab >= 2 ? `<span class="agc-load" title="${nTrab} trabajos agendados">${nTrab}</span>` : '';
    const body = evs.length
      ? evs.map(_calColEv).join('')
      : `<div class="agc-col-empty">·</div>`;
    html += `<div class="${cls}">`
      + `<button type="button" class="agc-col-head" onclick="calSelectDay('${iso}')" title="Elegir este día para agregar una nota">`
      + `<span class="agc-col-wd">${CAL_WD_MON[(d.getDay() + 6) % 7]}</span>`
      + `<span class="agc-col-num">${d.getDate()}</span>${load}</button>`
      + `<div class="agc-col-body">${body}</div></div>`;
  }
  grid.innerHTML = html;

  // Semana: al abrir/navegar, traer a la vista la columna del día elegido (hoy por
  // defecto) si quedó fuera del scroll horizontal — evita abrir en días vacíos.
  const target = grid.querySelector('.agc-col.is-sel') || grid.querySelector('.agc-col.is-today');
  if (target && grid.scrollWidth > grid.clientWidth + 1) {
    const cr = grid.getBoundingClientRect(), tr = target.getBoundingClientRect();
    if (tr.left < cr.left || tr.right > cr.right) grid.scrollLeft += (tr.left - cr.left) - 6;
  }

  renderCalDay(true);   // abajo: solo el alta de nota del día elegido (sin re-listar)
}

// Bloque de evento dentro de una columna de día: título (cliente/asunto) + sub
// con el texto a la vista, envuelve si hace falta. Tocarlo abre el presupuesto o
// alterna la nota. Barra de color por tipo (patrón `t-<tipo>`).
function _calColEv(ev) {
  const sub = ev.sub ? `<div class="agc-col-ev-sub">${esc(ev.sub)}</div>` : '';
  const hora = ev.hora ? `<span class="agc-col-ev-h">${esc(ev.hora)}</span>` : '';
  let act = '';
  if (ev.entryId != null) act = `onclick="goToHistoryEntry(${ev.entryId})" title="Ver el presupuesto"`;
  else if (ev.noteId != null) act = `onclick="calToggleNote('${ev.noteId}')" data-note-id="${esc(String(ev.noteId))}" title="${ev.done ? 'Marcar pendiente' : 'Marcar hecho'}"`;
  return `<button type="button" class="agc-col-ev t-${ev.tipo}${ev.done ? ' done' : ''}" ${act}>`
    + `<div class="agc-col-ev-title">${hora}${esc(ev.title)}</div>${sub}</button>`;
}

// Markup de una tarjeta de evento (reusado por el detalle del día y la lista de
// la vista Agenda). `dateLabel` (opcional) antepone la fecha en la etiqueta del
// tipo — útil en la sección "Atrasado", donde cada fila es de un día distinto.
function _calEvHTML(ev, dateLabel) {
  const kind = CAL_TIPO_LBL[ev.tipo] || '';
  const kindTxt = (dateLabel ? `${kind} · ${esc(dateLabel)}` : kind)
    + (ev.hora ? ` · <span class="agc-ev-hora">${esc(ev.hora)}</span>` : '');
  const sub = ev.sub ? `<div class="agc-ev-sub">${esc(ev.sub)}</div>` : '';
  let acts = '';
  // Botón de chat directo por WhatsApp cuando el evento tiene un teléfono
  // asociado (cliente del presupuesto, o el contacto vinculado a la nota).
  const chat = ev.tel
    ? `<button class="agc-ev-btn agc-ev-wa" onclick="${ev.entryId != null ? `chatWhatsappHistory(${ev.entryId})` : `calChatNote('${ev.noteId}')`}" title="Abrir el chat de WhatsApp con el cliente">${icon('message')}<span>Chat</span></button>`
    : '';
  // Compartir el recordatorio (nota / vencimiento / seguimiento / trabajo…) con un
  // compañero: abre el menú nativo (WhatsApp, etc.) con el texto ya armado.
  const share = `<button class="agc-ev-btn agc-ev-share" onclick="calShareEvent(this)" data-share="${esc(_calShareText(ev))}" title="Compartir este recordatorio">${icon('share')}<span>Compartir</span></button>`;
  if (ev.entryId != null) {
    acts = chat + share + `<button class="agc-ev-btn" onclick="goToHistoryEntry(${ev.entryId})" title="Ver el presupuesto en el historial">${icon('book')}<span>Ver</span></button>`;
  } else if (ev.noteId != null) {
    // "Hecho" y "Eliminar" se accionan deslizando la tarjeta (ver abajo); en el
    // botonera quedan chat (si hay contacto), Maps (si hay ubicación),
    // compartir y editar, más grandes. Las visitas suman "Crear presupuesto":
    // al volver de la evaluación, pasa los datos de la visita al editor.
    const mapBtn = ev.mapUrl
      ? `<button class="agc-ev-btn agc-ev-map" onclick="calOpenNoteMap('${ev.noteId}')" title="Cómo llegar: abre la ruta en Maps">${icon('pin')}<span>Mapa</span></button>`
      : '';
    const crearBtn = (ev.tipo === 'visita' && !ev.done)
      ? `<button class="agc-ev-btn" onclick="calCrearPresupuestoDesdeVisita('${ev.noteId}')" title="Crear un presupuesto con los datos de esta visita">${icon('file')}<span>Presupuestar</span></button>`
      : '';
    acts = chat + mapBtn + crearBtn + share
         + `<button class="agc-ev-btn" onclick="calEditNote('${ev.noteId}')" title="Editar la nota / ubicación / contacto">${icon('pencil')}<span>Editar</span></button>`;
  }
  // Anotaciones internas (solo en eventos de trabajo): memoria privada de
  // quien edita, se muestra en la Agenda pero no sale del dispositivo.
  const notesHtml = (ev.notes && ev.notes.length)
    ? `<div class="agc-ev-notes">${ev.notes.map(nn =>
        `<span class="agc-ev-note">${icon('bulb')}<span class="agc-ev-note-tx">${nn.label ? `<b>${esc(nn.label)}:</b> ` : ''}${esc(nn.text)}</span></span>`
      ).join('')}</div>`
    : '';
  // Pronóstico del día (eventos de trabajo y visitas con dato cacheado). El
  // chip es tocable: abre el panel de detalle del clima para ese día.
  const climaTap = ev.entryId != null
    ? _climaTap('e', ev.entryId, ev._iso)
    : (ev.noteId != null ? _climaTap('n', ev.noteId, ev._iso) : '');
  const climaHtml = (ev.clima && typeof climaChipHTML === 'function') ? climaChipHTML(ev.clima, climaTap) : '';
  const card = `<div class="agc-ev t-${ev.tipo}${ev.done ? ' done' : ''}">
    <span class="agc-ev-bar"></span>
    <div class="agc-ev-body">
      <span class="agc-ev-kind">${kindTxt}</span>
      <div class="agc-ev-title">${esc(ev.title)}</div>
      ${sub}
      ${climaHtml}
      ${notesHtml}
      <div class="agc-ev-acts">${acts}</div>
    </div>
  </div>`;
  // Solo las notas manuales se deslizan (son las que se marcan hechas o se
  // borran). El resto de eventos (seguimiento, trabajo, vencimiento…) no.
  if (ev.noteId == null) return card;
  const doneLbl = ev.done ? 'Pendiente' : 'Hecho';
  return `<div class="agc-swipe" data-note-id="${esc(String(ev.noteId))}">
    <div class="agc-swipe-bg agc-swipe-done">${icon('check')}<span>${doneLbl}</span></div>
    <div class="agc-swipe-bg agc-swipe-del"><span>Eliminar</span>${icon('trash')}</div>
    <div class="agc-swipe-fg">${card}</div>
  </div>`;
}

// ─── RENDER: DETALLE DEL DÍA SELECCIONADO ────────────────────
// `noList` (Semana/3-días): los eventos ya se ven en las columnas, así que abajo
// solo va el encabezado del día + el alta de nota (no se re-listan los eventos).
function renderCalDay(noList) {
  const box = document.getElementById('agc-day');
  if (!box) return;
  const iso = _calSel;
  if (!iso) { box.innerHTML = ''; return; }
  const evs = calBuildIndex()[iso] || [];
  const esHoy = iso === today();
  const nTrab = _calJobCount(evs);
  const loadChip = nTrab >= 2 ? ` <span class="agc-day-load">${nTrab} trabajos</span>` : '';

  const list = noList
    ? ''
    : (evs.length
      ? evs.map(ev => _calEvHTML(ev)).join('')
      : `<div class="agc-day-empty">No hay nada agendado este día. Podés dejar una nota o recordatorio abajo.</div>`);

  box.innerHTML = `
    <div class="agc-day-head">
      <span class="agc-day-title">${esc(_calLongDate(iso))}${esHoy ? ' · hoy' : ''}${loadChip}</span>
    </div>
    ${list}
    <div class="agc-note-form">
      <input type="text" id="agc-note-input" placeholder="Anotá un recordatorio para este día…" maxlength="140" onkeydown="if(event.key==='Enter'){calSaveNote();}">
    </div>
    <div class="agc-note-acts">
      <label class="agc-note-hora" onclick="_calHoraPick(event)" title="Hora (opcional): sin hora queda como recordatorio de todo el día">
        ${icon('clock')}
        <input type="time" id="agc-note-hora" aria-label="Hora (opcional)">
      </label>
      <button class="btn btn-p btn-sm" onclick="calSaveNote()">${icon('plus')} Nota</button>
      <button class="btn btn-visita btn-sm" onclick="calSaveNote('visita')" title="Guardar como visita: evaluación presencial / ir a presupuestar">${icon('plus')} Visita</button>
    </div>
    <details class="agc-note-contact">
      <summary>${icon('message')} Vincular contacto (chat directo)</summary>
      <div class="agc-note-crow">
        <div class="agc-cli-wrap"><input type="text" id="agc-note-cli" placeholder="Cliente" maxlength="80" autocomplete="off"></div>
        <input type="tel" id="agc-note-tel" placeholder="Teléfono / WhatsApp" maxlength="40" inputmode="tel" autocomplete="off">
        <button type="button" id="agc-note-import" class="btn btn-g btn-sm" onclick="importContactToNote()" style="display:none" title="Importar un contacto del teléfono">${icon('idcard')} Importar</button>
      </div>
    </details>
    <details class="agc-note-contact">
      <summary>${icon('pin')} Agregar ubicación (para compartir en Maps)</summary>
      <input type="text" id="agc-note-ubic" placeholder="Coordenadas, Plus Code o link de Maps" maxlength="200" autocomplete="off">
      <div class="agc-ubic-btns">
        <button type="button" class="btn btn-g btn-sm" onclick="usarMiUbicacionInput('agc-note-ubic', this)" title="Detectar dónde estoy ahora">${icon('pin')} Mi ubicación</button>
        <button type="button" class="btn btn-g btn-sm" onclick="probarUbicacionInput('agc-note-ubic')" title="Abrir en Maps para verificar">${icon('pin')} Ver en Maps</button>
      </div>
    </details>`;
  _calSetupNoteContact();
}

// Engancha el dropdown nativo de clientes al alta de nota y muestra el botón de
// importar contacto si el dispositivo lo soporta. Se llama en cada render porque
// renderCalDay recrea los inputs.
function _calSetupNoteContact() {
  const cli = document.getElementById('agc-note-cli');
  const tel = document.getElementById('agc-note-tel');
  if (cli) attachClientDropdown(cli, tel);
  const imp = document.getElementById('agc-note-import');
  if (imp) imp.style.display = (typeof contactPickerSupported === 'function' && contactPickerSupported()) ? 'inline-flex' : 'none';
}
// El campo de hora vacío es un blanco chico ("--:--"): que toda la cajita —el
// icono del reloj incluido— abra el selector, no solo los dígitos.
function _calHoraPick(ev) {
  const inp = document.getElementById('agc-note-hora');
  if (!inp || (ev && ev.target === inp)) return;   // tocando el input ya se abre solo
  try { if (inp.showPicker) { inp.showPicker(); return; } } catch (e) { /* sin showPicker → foco */ }
  inp.focus();
}
// Importa un contacto del teléfono hacia los campos del alta de nota.
function importContactToNote() {
  importContactToFields(document.getElementById('agc-note-cli'), document.getElementById('agc-note-tel'));
}

// ─── RENDER: VISTA AGENDA (lista cronológica) ────────────────
// Muestra lo que viene, agrupado por día (Hoy · Mañana · fecha), más una
// sección "Atrasado" arriba con lo que quedó pendiente y ya pasó de fecha
// (recontactos/seguimientos/vencimientos pasados y notas sin marcar). Los días
// de trabajo ya pasados NO ensucian: son registro histórico, viven en el mes.
function renderCalList() {
  const box = document.getElementById('agc-list');
  if (!box) return;
  const idx = calBuildIndex();
  const hoy = today();
  const overdue = [];      // {iso, ev} TAREAS pendientes con fecha < hoy
  const futuros = {};      // iso -> [ev], iso >= hoy

  Object.keys(idx).sort().forEach(iso => {
    idx[iso].forEach(ev => {
      if (iso >= hoy) { (futuros[iso] || (futuros[iso] = [])).push(ev); return; }
      // Pasado: "Atrasado" es para TAREAS que siguen sin resolverse.
      //  · VENCIMIENTO no es una tarea sino un dato (el presupuesto dejó de estar
      //    vigente) y ya lo avisa el banner rojo del Historial → NO se apila acá.
      //  · TRABAJO pasado es registro histórico (vive en la grilla) → tampoco.
      //  · SEGUIMIENTO se deriva de CADA presupuesto enviado, así que los viejos
      //    se acumularían para siempre. Solo cuenta como "atrasado" si es
      //    reciente (últimos 30 días); pasado eso el presupuesto está muerto.
      //  · RECONTACTO y NOTA los creás a mano (son intenciones deliberadas) → se
      //    mantienen sin importar la antigüedad; los resolvés o borrás vos.
      let pend = false;
      if (ev.tipo === 'nota' || ev.tipo === 'visita') pend = !ev.done;
      else if (ev.tipo === 'recontacto') pend = true;
      else if (ev.tipo === 'seguimiento') { const d = daysSinceDate(iso); pend = (d != null && d <= 30); }
      if (pend) overdue.push({ iso, ev });
    });
  });

  const dias = Object.keys(futuros).sort();
  let html = '';

  // Sección "Atrasado": colapsada por defecto para que lo primero que se vea sea
  // HOY. Se auto-despliega solo si no hay nada próximo (para no dejar la pantalla
  // con una sola barra). Muestra el conteo aunque esté cerrada.
  if (overdue.length) {
    const abierta = _calOverdueOpen || !dias.length;
    const n = overdue.length;
    const rows = abierta ? overdue.map(o => _calEvHTML(o.ev, fmtDiaCorto(o.iso))).join('') : '';
    html += `<div class="agc-list-group agc-list-overdue">
      <button type="button" class="agc-overdue-toggle${abierta ? ' open' : ''}" onclick="calToggleOverdue()" aria-expanded="${abierta}">
        ${icon('hourglass','ic-c-red')}<span class="agc-overdue-lbl">Atrasado · ${n} pendiente${n>1?'s':''}</span>
        <span class="agc-overdue-caret">${abierta ? '▾' : '▸'}</span>
      </button>
      ${rows}
    </div>`;
  }

  if (dias.length) {
    html += dias.map(iso => {
      let lbl;
      if (iso === hoy) lbl = 'Hoy';
      else if (iso === _calAddDays(hoy, 1)) lbl = 'Mañana';
      else lbl = fmtDiaCorto(iso);
      const rows = futuros[iso].map(ev => _calEvHTML(ev)).join('');
      // Aviso de carga del día (≥2 trabajos) en el encabezado de la lista.
      const nTrab = _calJobCount(futuros[iso]);
      const load = nTrab >= 2 ? ` <span class="agc-day-load">${nTrab} trabajos</span>` : '';
      return `<div class="agc-list-group" data-iso="${iso}">
        <h4 class="agc-list-dayhead${iso === hoy ? ' is-today' : ''}">${esc(lbl)}${load}</h4>
        ${rows}
      </div>`;
    }).join('');
  }

  if (!html) {
    html = `<div class="agc-list-empty">${icon('calendar')} No tenés nada agendado próximamente.<br><span class="agc-list-empty-sub">Los trabajos, recontactos y recordatorios que cargues van a aparecer acá ordenados por fecha.</span></div>`;
  }

  box.innerHTML = html;
}

// ─── NOTAS: alta / toggle / borrado ──────────────────────────
// `tipo` opcional: 'visita' guarda la nota como visita (evaluación presencial).
function calSaveNote(tipo) {
  const inp = document.getElementById('agc-note-input');
  if (!inp || !_calSel) return;
  const esVisita = tipo === 'visita';
  const texto = (inp.value || '').trim();
  // Contacto opcional vinculado a la nota.
  const cliEl = document.getElementById('agc-note-cli');
  const telEl = document.getElementById('agc-note-tel');
  let cliente = cliEl ? (cliEl.value || '').trim() : '';
  let tel     = telEl ? (telEl.value || '').trim() : '';
  // Si escribieron el teléfono en el campo del cliente (y el de tel quedó
  // vacío), lo reubicamos para no perderlo.
  if (!tel && cliente && /^[\d\s()+.-]+$/.test(cliente) && cliente.replace(/\D/g, '').length >= 6) {
    tel = cliente; cliente = '';
  }
  // Si eligió/tipeó un cliente existente sin tocar el teléfono, lo tomamos de la DB.
  if (cliente && !tel) {
    const c = getClientDB().find(x => ((x.name || '') + '').trim().toLowerCase() === cliente.toLowerCase());
    if (c && c.contact) tel = c.contact;
  }
  const ubicEl = document.getElementById('agc-note-ubic');
  const ubic = ubicEl ? (ubicEl.value || '').trim() : '';
  // Hora opcional: sin ella el recordatorio es de día completo.
  const horaEl = document.getElementById('agc-note-hora');
  const hora = sanHoraHM(horaEl ? (horaEl.value || '').trim() : '');
  // Validación: una nota común necesita texto. Una visita se explica sola (es
  // una evaluación presencial), así que puede guardarse sin título mientras
  // esté anclada a algo —un contacto o una ubicación—; sin nada de eso pedimos
  // al menos un dato para no crear un evento vacío por un toque accidental.
  if (!texto) {
    if (!esVisita) { toast('Escribí algo para la nota', 'info', 2200); return; }
    if (!cliente && !tel && !ubic) { toast('Vinculá un contacto o una ubicación, o escribí a quién vas a ver', 'info', 3200); return; }
  }
  const notes = getNotes();
  const nueva = {
    id: 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    fecha: _calSel, texto: texto, hecho: false, creadoEn: new Date().toISOString(),
    cliente: cliente, tel: tel
  };
  if (ubic) nueva.ubic = ubic;
  if (hora) nueva.hora = hora;
  if (esVisita) nueva.tipo = 'visita';
  notes.push(nueva);
  setNotes(notes);
  // Guardar/enriquecer el cliente en la DB con lo que se anotó (teléfono +
  // ubicación): si no existe lo crea, si existe completa los campos vacíos. Así
  // "importás" a la app un cliente al que todavía no le hiciste presupuesto —con
  // su ubicación ya cargada para cuando se lo hagas— tanto si lo tipeaste como
  // si lo trajiste de los contactos del teléfono.
  saveNoteClientToDB(cliente, tel, ubic);
  inp.value = '';
  if (cliEl) cliEl.value = '';
  if (telEl) telEl.value = '';
  if (ubicEl) ubicEl.value = '';
  if (horaEl) horaEl.value = '';
  renderCal();
  // Visitas: asegurar el pronóstico de la zona para pintar el chip de clima.
  if (esVisita && typeof climaEnsureNota === 'function') climaEnsureNota(nueva, () => renderCal());
  const cuando = hora ? ' a las ' + hora : '';
  toast((esVisita ? 'Visita agendada' : 'Nota agendada') + cuando, 'ok');
}
// Abre el chat de WhatsApp del contacto vinculado a una nota.
function calChatNote(id) {
  const n = getNotes().find(x => x.id === id);
  if (!n) { toast('No se encontró la nota', 'info', 2500); return; }
  chatWhatsappPhone(n.tel || '');
}

// ─── VISITA → PRESUPUESTO ────────────────────────────────────
// Cierra el círculo de la evaluación presencial: crea un presupuesto nuevo con
// los datos de la visita ya cargados (cliente, teléfono, ubicación y el texto
// como nota interna), marca la visita como hecha y abre el Editor. El borrador
// actual se guarda solo en el historial (mismo criterio que newQuote).
async function calCrearPresupuestoDesdeVisita(id) {
  const notes = getNotes();
  const n = notes.find(x => x.id === id);
  if (!n) { toast('No se encontró la visita', 'info', 2500); return; }
  const quien = (n.cliente || '').trim() || (n.texto || '').trim() || 'esta visita';
  const ok = await confirmDlg('Crear presupuesto',
    `¿Crear un presupuesto nuevo con los datos de la visita a ${quien}? El borrador actual se guardará automáticamente en el historial y la visita quedará marcada como hecha.`,
    'Crear presupuesto', 'btn-p');
  if (!ok) return;
  autoSaveToHistory();
  resetToNewQuote();
  S.clientName = (n.cliente || '').trim();
  S.clientContact = (n.tel || '').trim();
  S.workMapLink = (n.ubic || '').trim();
  if ((n.texto || '').trim()) S.intNote = 'Visita: ' + n.texto.trim();
  noSync = true; restoreUI(); noSync = false;
  sched();
  if (!n.hecho) {
    n.hecho = true;
    setNotes(notes);
  }
  renderCal();
  if (typeof renderMorningBanner === 'function') renderMorningBanner();
  toast('Presupuesto creado con los datos de la visita', 'ok', 3500);
}

// ─── EDICIÓN DE NOTA (modal) ─────────────────────────────────
// Permite editar el texto de una nota ya creada y agregarle/cambiar el contacto
// (cliente + teléfono) para el chat directo.
let _editNoteId = null;
let _editNoteFecha = null;   // fecha original, para avisar cuándo se está moviendo
function calEditNote(id) {
  const n = getNotes().find(x => x.id === id);
  if (!n) return;
  _editNoteId = id;
  _editNoteFecha = n.fecha || today();
  const ov  = document.getElementById('note-edit-overlay');
  const txt = document.getElementById('agc-edit-text');
  const cli = document.getElementById('agc-edit-cli');
  const tel = document.getElementById('agc-edit-tel');
  const imp = document.getElementById('agc-edit-import');
  if (!ov || !txt) return;
  txt.value = n.texto || '';
  if (cli) cli.value = n.cliente || '';
  if (tel) tel.value = n.tel || '';
  _neSetTipo(n.tipo === 'visita' ? 'visita' : '');
  const fec = document.getElementById('agc-edit-fecha');
  if (fec) { fec.value = _editNoteFecha; if (typeof syncCdate === 'function') syncCdate(fec); }
  _neFechaSync();
  const hor = document.getElementById('agc-edit-hora');
  if (hor) hor.value = sanHoraHM(n.hora);
  const ubicEl = document.getElementById('agc-edit-ubic');
  if (ubicEl) ubicEl.value = n.ubic || '';
  if (cli) attachClientDropdown(cli, tel);
  if (imp) imp.style.display = (typeof contactPickerSupported === 'function' && contactPickerSupported()) ? 'inline-flex' : 'none';
  ov.classList.add('open');
  document.addEventListener('keydown', _calNoteEditKey);
  setTimeout(() => { txt.focus(); }, 50);
}
// Escape cierra el modal, salvo que esté abierto el calendario del datepicker:
// ahí el Escape es para cerrar ese popover (lo maneja _cselKey), no el modal.
function _calNoteEditKey(e) { if (e.key === 'Escape' && !_cselOpen) calCloseNoteEdit(); }
function calCloseNoteEdit() {
  const ov = document.getElementById('note-edit-overlay');
  if (ov) ov.classList.remove('open');
  document.removeEventListener('keydown', _calNoteEditKey);
  _editNoteId = null;
  _editNoteFecha = null;
}
// Importa un contacto del teléfono hacia los campos del modal de edición.
function importContactToNoteEdit() {
  importContactToFields(document.getElementById('agc-edit-cli'), document.getElementById('agc-edit-tel'));
}
// ─── SELECTOR DE TIPO (segmentado Nota/Visita del modal de edición) ──────────
// Segmentado de dos botones en vez de un <select> nativo: dentro del modal el
// popup del select abría detrás del overlay. Marca activo el botón elegido.
function _neSetTipo(v) {
  document.querySelectorAll('#agc-edit-tipo .ne-seg-btn').forEach(b => {
    const on = (b.dataset.tipo || '') === (v || '');
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}
function _neGetTipo() {
  const b = document.querySelector('#agc-edit-tipo .ne-seg-btn.is-active');
  return b ? (b.dataset.tipo || '') : '';
}
function _neSelTipo(btn) { _neSetTipo(btn.dataset.tipo || ''); }
// ─── FECHA DEL RECORDATORIO (mover el compromiso de día) ─────────────────────
// El campo abre el calendario propio y ahí se elige el día nuevo. Antes había
// además atajos (− 1 día / + 1 día / + 1 semana / Hoy): se sacaron porque con
// el calendario alcanza y ocupaban media pantalla del modal.
// Debajo del campo: el día de la semana elegido y, si cambió, de dónde se mueve.
function _neFechaSync() {
  const fec = document.getElementById('agc-edit-fecha');
  const msg = document.getElementById('agc-edit-fecha-msg');
  if (!msg) return;
  const v = fec ? (fec.value || '') : '';
  if (!v) { msg.textContent = 'Sin fecha no se puede guardar.'; msg.className = 'ne-datemsg'; return; }
  const p = v.split('-');
  const dia = CAL_DIAS[new Date(+p[0], +p[1] - 1, +p[2]).getDay()];
  const movida = _editNoteFecha && v !== _editNoteFecha;
  msg.textContent = movida
    ? `Se mueve al ${dia.toLowerCase()} ${fmtD(v)} (estaba el ${fmtD(_editNoteFecha)}).`
    : `${dia} ${fmtD(v)}`;
  msg.className = 'ne-datemsg' + (movida ? ' is-moved' : '');
}
// ─── HORA DEL RECORDATORIO ───────────────────────────────────────────────────
// "Sin hora" vuelve el compromiso a día completo: el <input type="time"> de
// Android no ofrece manera de vaciarlo una vez que se eligió una hora.
function _neHoraClear() {
  const h = document.getElementById('agc-edit-hora');
  if (h) { h.value = ''; h.focus(); }
}
function calSaveNoteEdit() {
  if (!_editNoteId) { calCloseNoteEdit(); return; }
  const txt = document.getElementById('agc-edit-text');
  const cli = document.getElementById('agc-edit-cli');
  const tel = document.getElementById('agc-edit-tel');
  const texto = txt ? (txt.value || '').trim() : '';
  if (!texto) { toast('La nota no puede quedar vacía', 'info', 2200); return; }
  const fecEl = document.getElementById('agc-edit-fecha');
  const fecha = sanISODate(fecEl ? fecEl.value : '');
  if (!fecha) { toast('Elegí una fecha válida', 'info', 2200); return; }
  let cliente = cli ? (cli.value || '').trim() : '';
  let telef   = tel ? (tel.value || '').trim() : '';
  if (!telef && cliente && /^[\d\s()+.-]+$/.test(cliente) && cliente.replace(/\D/g, '').length >= 6) {
    telef = cliente; cliente = '';
  }
  if (cliente && !telef) {
    const c = getClientDB().find(x => ((x.name || '') + '').trim().toLowerCase() === cliente.toLowerCase());
    if (c && c.contact) telef = c.contact;
  }
  const ubicEl = document.getElementById('agc-edit-ubic');
  const ubic = ubicEl ? (ubicEl.value || '').trim() : '';
  const horaEl = document.getElementById('agc-edit-hora');
  const hora = sanHoraHM(horaEl ? (horaEl.value || '').trim() : '');
  const notes = getNotes();
  const n = notes.find(x => x.id === _editNoteId);
  if (!n) { calCloseNoteEdit(); return; }
  const movida = n.fecha !== fecha;
  const antes = n.fecha;
  const ubicCambio = (n.ubic || '') !== ubic;
  n.fecha = fecha;
  n.texto = texto;
  n.cliente = cliente;
  n.tel = telef;
  if (ubic) n.ubic = ubic; else delete n.ubic;
  if (hora) n.hora = hora; else delete n.hora;
  if (_neGetTipo() === 'visita') n.tipo = 'visita'; else delete n.tipo;
  setNotes(notes);
  // Guardar/enriquecer el cliente en la DB con lo editado (teléfono + ubicación):
  // si no existe lo crea, si existe completa los campos vacíos sin pisar nada.
  saveNoteClientToDB(cliente, telef, ubic);
  const eraVisita = _neGetTipo() === 'visita';
  // Si la visita cambió de día o de lugar, asegurar el pronóstico de esa zona:
  // el día nuevo puede caer fuera de lo cacheado, o el lugar nuevo ser una zona
  // que todavía no se bajó. Respeta el TTL (no golpea la API por mover un día).
  if (eraVisita && (movida || ubicCambio) && typeof climaEnsureNota === 'function') {
    climaEnsureNota(n, () => { try { renderCal(); } catch (_) {} });
  }
  calCloseNoteEdit();
  renderCal();
  if (typeof renderMorningBanner === 'function') renderMorningBanner();
  toast(movida
    ? `${eraVisita ? 'Visita movida' : 'Nota movida'} del ${fmtD(antes)} al ${fmtD(fecha)}`
    : 'Nota actualizada', 'ok', movida ? 3200 : undefined);
}
// Marcar/desmarcar hecha una nota o visita. El registro en la bitácora vive
// ACÁ y no en quien llama: el mismo toque se da desde la Agenda y desde el
// banner del día, y antes solo el del banner dejaba "Deshacer".
function calToggleNote(id) {
  const notes = getNotes();
  const n = notes.find(x => x.id === id);
  if (!n) return;
  n.hecho = !n.hecho;
  setNotes(notes);
  renderCal();
  if (n.hecho && typeof logNotif === 'function') {
    const esVisita = n.tipo === 'visita';
    const cli = (n.cliente || '').trim();
    const t = (n.texto || '').trim() || cli || (esVisita ? 'Visita' : 'Nota');
    logNotif({
      icon: esVisita ? '📍' : '🗒️', kind: esVisita ? 'visita' : 'nota',
      text: `${esVisita ? 'Visita' : 'Nota'} marcada hecha: ${t}`,
      action: { type: 'tab', tab: 'agenda' },
      undo: { type: 'note', id: n.id },
    });
  }
  if (typeof updateNotifBadge === 'function') updateNotifBadge();
}
function calDeleteNote(id) {
  const notes = getNotes().filter(x => x.id !== id);
  setNotes(notes);
  renderCal();
  toast('Nota borrada', 'info', 2000);
}

// ─── COMPARTIR RECORDATORIOS ─────────────────────────────────
// Arma el texto a compartir de un evento de la Agenda (nota, vencimiento,
// seguimiento, recontacto o trabajo). Pensado para mandárselo a un compañero
// por WhatsApp: encabezado con emoji + tipo + fecha, y el detalle abajo.
function _calShareText(ev) {
  const EMO = { trabajo: '🌳', visita: '📋', recontacto: '📞', vencimiento: '⏰', seguimiento: '🔔', nota: '📝' };
  const kind = CAL_TIPO_LBL[ev.tipo] || 'Recordatorio';
  const emo = EMO[ev.tipo] || '📌';
  let fecha = '';
  if (ev._iso) {
    const anio = String(ev._iso).split('-')[0] || '';
    fecha = _calLongDate(ev._iso) + (anio ? ` de ${anio}` : '');
  }
  const lines = [`${emo} ${kind}${fecha ? ' · ' + fecha : ''}${ev.hora ? ' · ' + ev.hora + ' hs' : ''}`];
  if (ev.title) lines.push(ev.title);
  // No repetir el contacto cuando el título ya lo contiene (p. ej. una visita
  // "Presupuesto Mara Cejas" con el contacto "Mara Cejas" vinculado).
  const tituloLC = (ev.title || '').toLowerCase();
  const subLC = (ev.sub || '').toLowerCase();
  if (ev.sub && !(subLC && tituloLC.includes(subLC))) lines.push(ev.sub);
  // Ubicación: el 📍 y la tarjeta de vista previa de WhatsApp ya indican que es
  // una ubicación, así que va el link a secas (sin la palabra "Ubicación:").
  if (ev.mapUrl) lines.push(`📍 ${ev.mapUrl}`);
  // Pronóstico del día, si la tarjeta lo tiene (ev.clima es el mismo dato que
  // pinta el chip). Cuando se le pasa un trabajo a un compañero, "cómo va a
  // estar" es parte del recordatorio: define si lleva agua, si va la altura o
  // si conviene salir temprano. Sin dato cacheado no se agrega nada.
  if (ev.clima && typeof climaResumenLineas === 'function') {
    lines.push(...climaResumenLineas(ev.clima));
  }
  return lines.join('\n');
}
// Comparte el texto guardado en el data-share del botón (se arma en el render).
function calShareEvent(btn) {
  const text = (btn && btn.dataset && btn.dataset.share) || '';
  if (text) shareText(text);
}
// Compartir texto: usa el menú nativo del sistema (Web Share API) si existe —
// así el usuario elige a quién mandárselo (WhatsApp, etc.). Si no, copia al
// portapapeles; y como último recurso abre WhatsApp con el selector de contacto.
async function shareText(text, title) {
  const data = title ? { title, text } : { text };
  if (navigator.share) {
    try { await navigator.share(data); return; }
    catch (e) { if (e && e.name === 'AbortError') return; /* si falla de verdad, seguimos con el fallback */ }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      toast('Copiado al portapapeles', 'ok', 2200);
      return;
    }
  } catch (e) { /* sin portapapeles → WhatsApp */ }
  try { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank'); }
  catch (e) { toast('No se pudo compartir', 'info', 2200); }
}

// ─── UBICACIÓN DE NOTAS ──────────────────────────────────────
// Mensaje de error de geolocalización según el código (reusable).
function _geoErrMsg(err) {
  if (err && err.code === 1) return 'Permiso de ubicación denegado. Activalo en los ajustes del navegador.';
  if (err && err.code === 2) return 'Ubicación no disponible. Probá al aire libre o con el GPS activado.';
  if (err && err.code === 3) return 'La búsqueda de ubicación tardó demasiado. Reintentá.';
  return 'No se pudo obtener la ubicación';
}
// GPS → completa el input indicado con las coordenadas actuales (lat,lng).
// Genérico: lo usan el alta y la edición de notas. Las coordenadas se
// interpretan igual que un Plus Code en Maps.
function usarMiUbicacionInput(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (!('geolocation' in navigator)) { toast('Este dispositivo no permite detectar la ubicación', 'err', 4000); return; }
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg class="ic"><use href="#i-pin"></use></svg> Buscando…'; }
  const restore = () => { if (btn) { btn.disabled = false; btn.innerHTML = original; } };
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      input.value = `${lat},${lng}`;
      const exacta = pos.coords.accuracy ? ` (±${Math.round(pos.coords.accuracy)} m)` : '';
      toast(`Ubicación detectada${exacta}.`, 'ok', 4000);
      restore();
    },
    (err) => { restore(); toast(_geoErrMsg(err), 'err', 5000); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}
// Abre en Maps lo que hay cargado en el input de ubicación (para verificar).
function probarUbicacionInput(inputId) {
  const v = (document.getElementById(inputId) || {}).value || '';
  const url = (typeof mapsUrlFor === 'function') ? mapsUrlFor(v, '') : '';
  if (!url) { toast('Cargá una ubicación para verla en Maps', 'info', 3000); return; }
  window.open(url, '_blank', 'noopener');
}
// Botón de Maps de la tarjeta de nota (y "Cómo llegar" de la visita en el
// banner de hoy): abre la ruta hasta la ubicación guardada de la nota.
function calOpenNoteMap(id) {
  const n = getNotes().find(x => x.id === id);
  const url = (n && typeof mapsDirUrlFor === 'function') ? mapsDirUrlFor((n.ubic || '').trim(), '') : '';
  if (!url) { toast('Esta nota no tiene ubicación cargada', 'info', 3000); return; }
  window.open(url, '_blank', 'noopener');
}

// Borrado con opción de deshacer (lo usa el deslizamiento, más fácil de gatillar
// por accidente que un botón). Guarda la nota y ofrece restaurarla por unos
// segundos con un toast accionable.
function calDeleteNoteUndoable(id) {
  const notes = getNotes();
  const idx = notes.findIndex(x => x.id === id);
  if (idx < 0) return;
  const removed = notes[idx];
  notes.splice(idx, 1);
  setNotes(notes);
  renderCal();
  _toastUndo('Nota borrada', () => {
    const cur = getNotes();
    if (!cur.some(x => x.id === removed.id)) {
      cur.push(removed);
      setNotes(cur);
      renderCal();
      toast('Nota restaurada', 'ok', 1600);
    }
  });
}

// Toast con botón "Deshacer" (reusa el estilo de toast-action).
function _toastUndo(msg, onUndo, dur = 6000) {
  const c = document.getElementById('toast-container');
  if (!c) { toast(msg, 'info', 2000); return; }
  const el = document.createElement('div');
  el.className = 'toast toast-info toast-action';
  el.innerHTML = `<span>${esc(msg)}</span><button type="button" class="toast-btn">Deshacer</button>`;
  c.appendChild(el);
  requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  el.querySelector('.toast-btn').onclick = () => { try { onUndo && onUndo(); } finally { close(); } };
  setTimeout(close, dur);
}

// ─── DESLIZAR NOTAS (estilo Gmail) ───────────────────────────
// Deslizar una tarjeta de nota a la DERECHA la marca hecha/pendiente; a la
// IZQUIERDA la elimina (con deshacer). Se engancha una sola vez a nivel de
// documento (delegación) para sobrevivir a los re-render de renderCal.
let _swState = null;
function _calInitSwipe() {
  if (_calInitSwipe._done) return;
  _calInitSwipe._done = true;
  document.addEventListener('pointerdown', _swDown, { passive: true });
  document.addEventListener('pointermove', _swMove, { passive: false });
  document.addEventListener('pointerup', _swUp, { passive: true });
  document.addEventListener('pointercancel', _swEnd, { passive: true });
}
function _swReset(wrap, fg) {
  if (fg) { fg.style.transition = ''; fg.style.transform = ''; }
  if (wrap) {
    wrap.classList.remove('agc-swipe-ready');
    wrap.querySelectorAll('.agc-swipe-bg').forEach(b => { b.style.opacity = ''; });
  }
}
function _swDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const fg = e.target.closest && e.target.closest('.agc-swipe-fg');
  if (!fg) return;
  const wrap = fg.parentNode;
  _swState = {
    fg, wrap, id: wrap.getAttribute('data-note-id'),
    startX: e.clientX, startY: e.clientY, dx: 0, w: fg.offsetWidth,
    commit: 0, swiping: false
  };
}
function _swMove(e) {
  const s = _swState;
  if (!s) return;
  const dx = e.clientX - s.startX;
  const dy = e.clientY - s.startY;
  if (!s.swiping) {
    if (Math.abs(dx) < 10) return;
    if (Math.abs(dx) <= Math.abs(dy)) { _swState = null; return; } // gesto vertical → dejar scrollear
    s.swiping = true;
    s.commit = Math.min(Math.max(s.w * 0.35, 72), 170);
    s.fg.style.transition = '';
  }
  e.preventDefault();
  s.dx = dx;
  s.fg.style.transform = `translateX(${dx}px)`;
  const ratio = Math.min(Math.abs(dx) / s.commit, 1);
  const done = s.wrap.querySelector('.agc-swipe-done');
  const del  = s.wrap.querySelector('.agc-swipe-del');
  if (done) done.style.opacity = dx > 0 ? String(0.45 + 0.55 * ratio) : '0';
  if (del)  del.style.opacity  = dx < 0 ? String(0.45 + 0.55 * ratio) : '0';
  const listo = Math.abs(dx) >= s.commit;
  if (listo && !s.wrap.classList.contains('agc-swipe-ready')) haptic(8);
  s.wrap.classList.toggle('agc-swipe-ready', listo);
}
function _swUp() {
  const s = _swState;
  _swState = null;
  if (!s || !s.swiping) return;
  // Cancelar el "click" que dispara el navegador al soltar tras deslizar, para
  // que no se abra por accidente el botón que quedó debajo del dedo.
  const kill = ev => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', kill, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', kill, true), 400);
  if (Math.abs(s.dx) >= s.commit) {
    const dir = s.dx > 0 ? 1 : -1;
    s.fg.style.transition = 'transform .18s ease';
    s.fg.style.transform = `translateX(${dir * s.fg.offsetWidth}px)`;
    const id = s.id;   // string 'n_...' — mismo formato que usan los onclick
    setTimeout(() => {
      if (dir > 0) calToggleNote(id);
      else calDeleteNoteUndoable(id);
    }, 160);
  } else {
    s.fg.style.transition = 'transform .18s ease';
    s.fg.style.transform = 'translateX(0)';
    setTimeout(() => _swReset(s.wrap, s.fg), 200);
  }
}
function _swEnd() {
  const s = _swState;
  _swState = null;
  if (!s || !s.swiping) return;
  s.fg.style.transition = 'transform .18s ease';
  s.fg.style.transform = 'translateX(0)';
  setTimeout(() => _swReset(s.wrap, s.fg), 200);
}

// Cuenta cuántos eventos de tipo "trabajo" hay en un array de eventos del día.
function _calJobCount(evs) {
  if (!Array.isArray(evs)) return 0;
  return evs.reduce((a, ev) => a + (ev && ev.tipo === 'trabajo' ? 1 : 0), 0);
}

// ─── EXPORT .ICS (agenda completa) ───────────────────────────
// Genera UN archivo .ics con los trabajos, recontactos y notas PRÓXIMOS
// (fecha >= hoy) para suscribir la agenda entera en el calendario del teléfono
// de una sola vez, sin depender de red (offline-first). A diferencia del botón
// "Google Calendar" del historial (un evento por vez), esto exporta todo junto.
// Eventos de día completo: DTEND es EXCLUSIVO → día siguiente (mismo criterio
// que agendaGcalUrl). Fechas en LOCAL (YYYYMMDD), nunca UTC.
function _icsEsc(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
// Plegado de líneas largas (RFC 5545): continúa con CRLF + espacio. Cortamos por
// unidades de código JS (nunca partimos un carácter); un leve exceso sobre 75
// octetos por tildes lo toleran todos los parsers.
function _icsFold(line) {
  if (line.length <= 73) return line;
  let out = '', rest = line;
  while (rest.length > 73) { out += rest.slice(0, 73) + '\r\n '; rest = rest.slice(73); }
  return out + rest;
}
// Fecha+hora LOCAL "flotante" (sin Z ni TZID): el evento cae a esa hora del
// reloj en el calendario que lo importe, que es justo lo que se quiere para un
// compromiso local. Con TZID habría que embeber un VTIMEZONE completo.
function _icsLocalDT(iso, hm) {
  return String(iso).replace(/-/g, '') + 'T' + String(hm).replace(':', '') + '00';
}
function _icsStamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
    + 'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}
// Título, descripción y lugar de un evento de la Agenda, para Google Calendar
// (gcalSync) y para el .ics (calExportIcs). Era una sola idea escrita dos
// veces, y las dos copias ya habían empezado a decir cosas distintas.
function calEvTexto(ev, e){
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
  // El teléfono del cliente ya va como "Contacto": no repetirlo.
  if (ev.tel && !desc.includes('Contacto: ' + ev.tel)) desc.push('Tel: ' + ev.tel);
  if (ev.mapUrl) { desc.push('Ubicación: ' + ev.mapUrl); if (!loc) loc = ev.mapUrl; }
  return { summary, desc: desc.join('\n'), loc };
}

function calExportIcs() {
  const idx = calBuildIndex();
  const hoy = today();
  const h = (typeof getH === 'function') ? getH() : [];
  const byId = {};
  h.forEach(e => { if (e && e.id != null) byId[e.id] = e; });

  const stamp = _icsStamp();
  const body = [];
  const seenUid = {};   // evita UIDs repetidos (un evento pisaría a otro al importar)
  let count = 0;

  Object.keys(idx).sort().forEach(iso => {
    if (iso < hoy) return;                       // solo lo que viene
    idx[iso].forEach(ev => {
      // Exportamos tareas concretas: trabajos, recontactos, visitas y notas
      // pendientes. Vencimientos/seguimientos son derivados y ruidosos → afuera.
      if (ev.tipo === 'nota' || ev.tipo === 'visita') { if (ev.done) return; }
      else if (ev.tipo !== 'trabajo' && ev.tipo !== 'recontacto') return;

      const dstart = iso.replace(/-/g, '');
      const dend = _calAddDays(iso, 1).replace(/-/g, '');
      const e = (ev.entryId != null) ? byId[ev.entryId] : null;

      const { summary, desc, loc } = calEvTexto(ev, e);

      let uidBase = (ev.entryId != null ? 'e' + ev.entryId + '-' + ev.tipo : 'n' + (ev.noteId || count))
        + '-' + dstart;
      const nRep = (seenUid[uidBase] = (seenUid[uidBase] || 0) + 1);
      const uid = uidBase + (nRep > 1 ? '-' + nRep : '') + '@presupuesto-ar';

      body.push('BEGIN:VEVENT');
      body.push('UID:' + _icsEsc(uid));
      body.push('DTSTAMP:' + stamp);
      // Con hora → evento con horario (una hora de duración); sin hora → día
      // completo, como fue siempre.
      if (ev.hora) {
        const fin = _calHoraMas(iso, ev.hora, CAL_EV_MINS);
        body.push('DTSTART:' + _icsLocalDT(iso, ev.hora));
        body.push('DTEND:' + _icsLocalDT(fin.fecha, fin.hora));
      } else {
        body.push('DTSTART;VALUE=DATE:' + dstart);
        body.push('DTEND;VALUE=DATE:' + dend);
      }
      body.push('SUMMARY:' + _icsEsc(summary));
      if (desc) body.push('DESCRIPTION:' + _icsEsc(desc));
      if (loc) body.push('LOCATION:' + _icsEsc(loc));
      body.push('END:VEVENT');
      count++;
    });
  });

  if (!count) { toast('No hay trabajos ni recontactos próximos para exportar', 'info', 3000); return; }

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Presupuestos AR//Agenda//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
    .concat(body, ['END:VCALENDAR']);
  const ics = lines.map(_icsFold).join('\r\n') + '\r\n';

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  a.download = 'agenda-presupuestos-' + hoy + '.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  const plural = count > 1 ? 's' : '';
  toast(count + ' evento' + plural + ' exportado' + plural + ' a .ics', 'ok');
}

// Globito en la pestaña Agenda: se enciende si HOY hay algo agendado.
function calUpdateDot() {
  const dot = document.getElementById('tab-agenda-dot');
  if (!dot) return;
  const hoy = today();
  const evs = calBuildIndex()[hoy] || [];
  // Notas/visitas ya hechas no cuentan como "pendiente de hoy".
  const hay = evs.some(ev => !((ev.tipo === 'nota' || ev.tipo === 'visita') && ev.done));
  dot.hidden = !hay;
}
