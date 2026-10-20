'use strict';

// ═══════════════════════════════════════
// CORE.JS — Inicialización principal de la app
// ═══════════════════════════════════════

window.addEventListener('DOMContentLoaded', async () => {
  loadLS();
  // Normalizar lo que ya esté guardado en el dispositivo (puede venir de un
  // backup ajeno importado antes de que existiera js/sanitize.js). Va ANTES de
  // cualquier render: es lo que garantiza que nada inválido llegue al DOM.
  try { migrateSanitizeStored(); } catch (e) { console.error('migrateSanitizeStored', e); }
  // Corregir los totales de estimativos guardados de menos (ver C2 en la
  // auditoría). Va después de sanitizar: trabaja sobre un historial ya válido.
  try { migrateFixEstTotals(); } catch (e) { console.error('migrateFixEstTotals', e); }
  // Rearmar los vínculos de versión que el autoguardado perdía hasta la v252.
  try { migrateRepararVersiones(); } catch (e) { console.error('migrateRepararVersiones', e); }
  // Tema de la UI (claro/oscuro/auto). El atributo data-theme ya lo fijó el
  // script del <head> para evitar el flash; acá sincronizamos S, el selector
  // y los tonos del acento, y escuchamos cambios del sistema en modo auto.
  let _savedTheme = 'auto';
  try { _savedTheme = localStorage.getItem(LS.THEME) || 'auto'; } catch (_) {}
  applyTheme(_savedTheme);
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((S.themeMode || 'auto') === 'auto') applyTheme('auto');
    });
  }
  // Fotos: hidratar el caché desde IndexedDB ANTES del primer render (así
  // renderItems()/buildDoc() resuelven los IDs de foto sincrónicamente).
  // Nunca rechaza; si IDB no está disponible, sigue con el caché vacío.
  await hydratePhotoCache();
  // Migrar a IndexedDB cualquier foto embebida que aún traiga el estado
  // guardado (versiones previas): alivia la cuota de localStorage. Si migró
  // algo, persistimos el estado ya liviano.
  if (migrateInlinePhotosToIDB(S) > 0) saveLS();
  // Marcar estado inicial como "guardado" para que el badge muestre algo
  // útil desde el arranque (el estado en disk coincide con el cargado).
  _lastSaveAt = Date.now();
  _renderSaveStatus();

  if (!S.dateIssue)   S.dateIssue = today();
  if (!S.dateExpiry)  calcExpiry();
  if (!S.quoteNumber) S.quoteNumber = mkQN();

  noSync = true;
  restoreUI();
  noSync = false;

  // Reemplazar los <select> nativos por el dropdown propio (con el tema de la
  // app). Después de restoreUI para que reflejen el valor ya cargado.
  enhanceSelects(document);
  // Calendario propio para los <input type="date"> editables.
  enhanceDateInputs(document);
  // Botón "Atrás" del teléfono: cierra lo abierto o vuelve al Editor.
  try { navInit(); } catch (e) { console.error('navInit', e); }
  try { navTecladoInit(); } catch (e) { console.error('navTecladoInit', e); }
  try { navSiguienteInit(); } catch (e) { console.error('navSiguienteInit', e); }
  try { navSalirInit(); } catch (e) { console.error('navSalirInit', e); }
  try { navHojasInit(); } catch (e) { console.error('navHojasInit', e); }
  try { pvGestosInit(); } catch (e) { console.error('pvGestosInit', e); }

  // Si el presupuesto cargado está en blanco (nada en edición), poner la fecha
  // de emisión en HOY. Evita que un borrador vacío arrastre la fecha vieja del
  // día en que se creó. Con datos cargados no se toca (la fecha es intencional).
  refreshIssueDateIfBlank();

  renderItems();
  renderEstItems();

  applyMode(currentMode());

  updateTotalsBar();
  updateNumPreview();
  attachClientAutocomplete();
  updateSurchargeUI();
  renderRiskDefects(); // Renderizar defectos guardados
  renderQuickServices(); // Chips de servicios rápidos en el editor

  // Editor es la pestaña inicial → mostrar sticky totals desde el inicio.
  // Solo si el Editor SIGUE activo: este init corre después de varios
  // `await`, y si el usuario ya tocó otra pestaña la barra aparecía encima
  // del Mapa o de la Agenda (switchTab ya la había ocultado).
  const sticky = document.getElementById('sticky-totals');
  const editorActivo = document.getElementById('panel-editor')?.classList.contains('active');
  if (sticky && editorActivo) {
    sticky.style.display = 'block';
    document.body.classList.add('has-sticky-totals');
    reserveStickySpace();
  }

  // Botón "subir": aparece cuando #main pasa el umbral de scroll y lo lleva al
  // tope. #main es el único scroller (compartido por todas las pestañas), así
  // que un solo listener alcanza. Throttle con requestAnimationFrame.
  (function setupScrollTopFab(){
    const main = document.getElementById('main');
    const fab  = document.getElementById('scrolltop-fab');
    if (!main || !fab) return;
    let ticking = false;
    const update = () => { fab.classList.toggle('show', main.scrollTop > 600); ticking = false; };
    main.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  })();

  // Navegación por swipe entre pestañas. Detector liviano con LOCK DE EJE: solo
  // actúa si el gesto es claramente horizontal, así no interfiere con el
  // scroll vertical. Guardas: no navega con un modal abierto ni con el teclado
  // arriba, ni cuando el gesto arranca sobre un elemento que ya es dueño del
  // deslizamiento horizontal (mapa, columnas del calendario, tiras, filas con
  // swipe-acción, color picker, inputs/selects/dropdowns). Listeners pasivos →
  // no bloquea el scroll nativo.
  // Feedback mientras se arrastra: la pantalla acompaña al dedo (amortiguada) y
  // una pastilla dice a qué pestaña se va; al pasar el umbral se pinta y el
  // teléfono vibra corto — "ya podés soltar". Se escucha también en la barra
  // de pestañas: en el Mapa la pantalla entera es el mapa (que se arrastra) y
  // la barra es la única superficie libre para deslizar.
  (function setupTabSwipe(){
    const main = document.getElementById('main');
    if (!main) return;
    // Los campos de texto NO bloquean: en el Editor casi toda la pantalla son
    // campos y el gesto que arrancaba sobre uno no hacía nada. Lo que sí importa
    // —estar escribiendo— ya lo corta `is-typing` (teclado arriba), y el campo
    // enfocado se excluye igual por si el teclado es físico. El deslizador
    // (range) sí es dueño del arrastre horizontal.
    const BLOCK = '#map-canvas,.leaflet-container,.agc-cols,.agc-viewtoggle,' +
      '.agenda-clima-strip,.agc-swipe,.cpk-sv,.cpk-hue,input[type="range"],' +
      '.csel-pop,.cal-pop';
    const UMBRAL = 70;
    let x0 = 0, y0 = 0, tracking = false, axis = 0;  // axis: 0 indeciso, 1 horiz, 2 vert
    const CAL = '#agc-grid,#agc-grid-head';
    let panel = null, listo = false, hint = null, modo = 'tab';   // modo: 'tab' | 'cal'
    const pastilla = () => {
      if (hint) return hint;
      hint = document.createElement('div');
      hint.id = 'tab-swipe-hint';
      hint.setAttribute('aria-hidden', 'true');
      document.body.appendChild(hint);
      return hint;
    };
    const soltar = (animar) => {
      if (panel) {
        const p = panel;
        p.style.transition = animar ? 'transform .18s ease, opacity .18s ease' : '';
        p.style.transform = ''; p.style.opacity = '';
        if (animar) setTimeout(() => { p.style.transition = ''; }, 200);
      }
      if (hint) hint.classList.remove('is-on', 'is-ready');
      panel = null; listo = false;
    };
    const start = (e) => {
      tracking = false; axis = 0;
      if (e.touches.length !== 1) return;
      if (document.body.classList.contains('modal-open')) return;
      if (document.body.classList.contains('is-typing')) return;
      if (!_swipeVecina(1)) return;
      modo = 'tab';
      // Sobre la grilla de la Agenda (Mes / 3 días) el gesto cambia de mes o
      // de días, no de pestaña. Se mira antes que BLOCK: 3 días usa .agc-cols.
      if (e.target.closest && e.target.closest(CAL) &&
          typeof calSwipeActivo === 'function' && calSwipeActivo()) modo = 'cal';
      else if (e.target.closest && e.target.closest(BLOCK)) return;
      if (e.target === document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; tracking = true;
    };
    const move = (e) => {
      if (!tracking) return;
      const t = e.touches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (axis === 0) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;   // aún indeciso
        // Se bloquea en horizontal solo si domina claramente; si no, es scroll.
        axis = (Math.abs(dx) > Math.abs(dy) * 1.4) ? 1 : 2;
        if (axis === 2) { tracking = false; return; }       // scroll vertical: abandonar
        panel = modo === 'cal' ? document.getElementById('agc-grid') : document.querySelector('.tab-panel.active');
      }
      const dir = dx < 0 ? 1 : -1;                          // dedo a la izquierda → siguiente
      const dest = modo === 'cal' ? calSwipeLabel(dir) : TAB_LABELS[_swipeVecina(dir)];
      if (panel) {
        panel.style.transform = `translateX(${Math.round(dx * 0.35)}px)`;
        panel.style.opacity = String(Math.max(0.55, 1 - Math.abs(dx) / 600));
      }
      const h = pastilla();
      const ya = Math.abs(dx) > UMBRAL;
      h.textContent = dir > 0 ? `${dest || ''} →` : `← ${dest || ''}`;
      h.classList.toggle('is-next', dir > 0);
      h.classList.toggle('is-prev', dir < 0);
      h.classList.add('is-on');
      h.classList.toggle('is-ready', ya);
      if (ya && !listo) haptic(8);
      listo = ya;
    };
    const end = (e) => {
      if (!tracking || axis !== 1) { tracking = false; soltar(false); return; }
      tracking = false;
      const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (Math.abs(dx) > UMBRAL && Math.abs(dx) > Math.abs(dy) * 1.5) {
        soltar(false);
        if (modo === 'cal') _swipeCal(dx < 0 ? 1 : -1);
        else _swipeTab(dx < 0 ? 1 : -1);
      } else soltar(true);
    };
    const cancel = () => { tracking = false; soltar(true); };
    [main, document.getElementById('tabs')].forEach(el => {
      if (!el) return;
      el.addEventListener('touchstart', start, { passive: true });
      el.addEventListener('touchmove', move, { passive: true });
      el.addEventListener('touchend', end, { passive: true });
      el.addEventListener('touchcancel', cancel, { passive: true });
    });
  })();

  // Lock de scroll unificado para modales: un único observador vigila la clase
  // de todos los overlays a pantalla completa; cuando alguno abre (.open) marca
  // body.modal-open y el CSS congela el scroll de #main (el scroller real), así
  // el fondo no se mueve detrás del modal. Centraliza lo que antes hacían solo
  // un par de modales (y encima sobre el body, que no scrollea).
  (function setupModalScrollLock(){
    const ids = ['confirm-overlay','agenda-overlay','day-alert-overlay',
      'share-overlay','moverlay','notes-overlay','phrases-overlay',
      'photo-viewer-overlay','note-edit-overlay','doc-preview-overlay',
      'clima-overlay','notif-overlay','nv-overlay','colab-overlay','vsr-overlay'];
    const els = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (!els.length) return;
    const sync = () => document.body.classList.toggle(
      'modal-open', els.some(el => el.classList.contains('open')));
    const obs = new MutationObserver(sync);
    els.forEach(el => obs.observe(el, { attributes: true, attributeFilter: ['class'] }));
    sync();
  })();

  // iOS: el botón ✕ del type="search" dispara 'search', no 'input'
  const hs = document.getElementById('hist-search');
  if (hs) hs.addEventListener('search', () => { _histSearchSync(hs); renderHistory(); });

  // Seguimiento comercial: mostrar el banner de pendientes desde el
  // arranque (aunque el usuario aún no entre al Historial).
  if (typeof renderFollowupBanner === 'function') renderFollowupBanner();

  // Campanita: badge inicial con los pendientes (recontactos, trabajos/visitas
  // de hoy, seguimientos/vencimientos vencidos, clima).
  if (typeof updateNotifBadge === 'function') updateNotifBadge();

  // Recontactos: aviso global al abrir la app (toast accionable), por si
  // el usuario usa la app sin pasar por la pestaña Historial.
  if (typeof toastRecontactosPendientes === 'function') toastRecontactosPendientes();

  // Podas de hoy: banner "resumen del día" arriba del editor, una vez por
  // día al abrir, si hay trabajos agendados para hoy.
  if (typeof maybeShowMorningBanner === 'function') maybeShowMorningBanner();

  // Salud de la conexión: escuchar los cambios de red y dejar el indicador del
  // topbar al día. Va ANTES del clima: es el gate de todo lo automático.
  if (typeof netInit === 'function') { netInit(); netRenderEstado(); }

  // Clima: bajar el pronóstico de los días con trabajos agendados (silencioso,
  // solo con señal SANA) y avisar si viene lluvia para una poda de hoy o mañana.
  if (typeof climaRefresh === 'function') climaRefresh();

  // Importar de contactos: mostrar el botón solo si el dispositivo soporta
  // la Contact Picker API (Chrome Android sobre HTTPS).
  if (typeof initContactPicker === 'function') initContactPicker();

  // Protección de datos: verificar almacenamiento, mostrar bienvenida la
  // primera vez y recordar backups si hace falta.
  if (checkStorageAvailable()) {
    maybeShowWelcome();
    checkBackupReminder();
    espacioAvisarSiLleno();
    // Pedir al navegador que no borre los datos automáticamente (Brave/Safari).
    // Solo cuando hay presupuestos guardados para proteger.
    const _h = (typeof getH === 'function') ? getH() : [];
    if (_h.length) requestPersistentStorage();
  }

  // Copia de seguridad en Google Drive / sync de Calendar (inertes si no están
  // configuradas). Se DIFIEREN para que no compitan con el primer render: la
  // app queda usable al instante y Google se acomoda cuando el hilo principal
  // está libre. Así, aun cuando la pestaña se recargó al volver de segundo
  // plano, la reapertura se siente inmediata y el sync ocurre invisible detrás.
  const _deferIdle = (typeof requestIdleCallback === 'function')
    ? (fn) => requestIdleCallback(fn, { timeout: 3000 })
    : (fn) => setTimeout(fn, 800);
  // Volvemos de Google por redirección: el token viene en el fragmento y hay
  // que sacarlo de la URL YA (no diferido), antes de que quede en el historial.
  let _volviendoDeGoogle = false;
  try { _volviendoDeGoogle = (typeof gcalHandleRedirectReturn === 'function') && gcalHandleRedirectReturn(); } catch(_){}
  _deferIdle(() => {
    if (typeof gdriveInitOnLoad === 'function') gdriveInitOnLoad();
    // Si acabamos de volver de Google, gcalHandleRedirectReturn ya está
    // sincronizando: no arrancar una segunda pasada encima.
    if (!_volviendoDeGoogle && typeof gcalInitOnLoad === 'function') gcalInitOnLoad();
    if (typeof preloadGIS === 'function') preloadGIS();
  });
  // Notificaciones push (inerte si no está configurado el Worker).
  if (typeof initPush === 'function') initPush();
  // Al pasar la app a segundo plano, subir cambios pendientes de inmediato
  // (solo si hay señal; sin conexión queda pendiente para el evento 'online').
  // Flush inmediato del estado activo al pasar a segundo plano / cerrar.
  // El guardado normal está "debounced" (700 ms en sched()); si la app se
  // cierra o se manda a segundo plano antes de que el timer dispare, ese
  // guardado pendiente puede no ejecutarse nunca (iOS suele congelar/matar
  // los timers al suspender la PWA). Persistimos YA para garantizar que, al
  // reabrir, el editor tenga exactamente lo último que se estaba editando.
  function flushActiveState() {
    try { if (typeof syncFromUI === 'function') syncFromUI(); } catch (_) {}
    try {
      clearTimeout(saveTimer);
      if (typeof saveLS === 'function') saveLS();
      // Cerrar el ciclo del indicador: el guardado normal (sched) es el que
      // pasa el cartel a "✓ Guardado". Como acá cancelamos ese timer y
      // guardamos a mano, hay que actualizar el estado o quedaría colgado en
      // "● Guardando…" al volver del segundo plano.
      _lastSaveAt = Date.now();
      if (typeof _renderSaveStatus === 'function') _renderSaveStatus();
    } catch (_) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    flushActiveState();
    if (typeof GDRIVE !== 'undefined' &&
        GDRIVE._dirty && navigator.onLine !== false &&
        gdriveConfigured() && gdriveConnected()) {
      clearTimeout(GDRIVE._timer);
      gdriveAutoUpload();
    }
  });
  // Al volver del segundo plano (p. ej. la app quedó abierta de un día para
  // otro): si no hay nada en edición, poner la fecha de emisión en HOY para
  // que un borrador vacío no arranque con la fecha de ayer. Y refrescar el
  // pronóstico (tiene TTL propio: no golpea la API en cada vuelta).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refreshIssueDateIfBlank();
    if (typeof climaRefresh === 'function') climaRefresh();
  });
  // pagehide cubre el cierre real de la pestaña/app (y el bfcache), donde
  // visibilitychange a veces no llega a tiempo.
  window.addEventListener('pagehide', flushActiveState);
  // Al volver la conexión, subir lo que haya quedado pendiente mientras
  // trabajabas sin señal (modo offline).
  window.addEventListener('online', () => {
    if (typeof GDRIVE !== 'undefined' && GDRIVE._dirty &&
        gdriveConfigured() && gdriveConnected()) {
      clearTimeout(GDRIVE._timer);
      gdriveAutoUpload();
    }
    // Al volver la señal, subir la sync de Calendar que haya quedado pendiente.
    if (typeof GCAL !== 'undefined' && GCAL._dirty &&
        gcalConfigured() && gcalConnected()) {
      clearTimeout(GCAL._timer);
      gcalAutoSync();
    }
    // Al volver la señal, re-sincronizar los seguimientos del Worker de push.
    if (typeof syncPushFollowups === 'function' && S.pushEnabled) syncPushFollowups().catch(() => {});
  });

  // Accesos directos del manifest (long-press en el ícono): al abrir con
  // ?go=… disparamos la acción y limpiamos la URL para que un reload no la
  // repita. Reutiliza las mismas funciones que los botones de la UI.
  try {
    const params = new URLSearchParams(location.search);
    const go = params.get('go');
    if (go) {
      history.replaceState(null, '', location.pathname);
      irDestino(go);
    }
    // Web Share Target: el SW redirigió aquí tras compartir fotos a la app.
    // Limpiamos la URL (para que un reload no reabra la bandeja) y procesamos
    // los blobs stasheados en IndexedDB (vaciando la bandeja).
    if (params.get('share') === '1') {
      history.replaceState(null, '', location.pathname);
      if (typeof processSharedPhotos === 'function') processSharedPhotos();
    }
  } catch (e) {}
});

// Destino de un acceso directo (?go=…) o de una notificación tocada. Con la app
// ya abierta, el Service Worker no puede cambiarle la URL: manda el destino
// por mensaje (`pq-go`, ver notificationclick en sw.js) y se resuelve acá.
// Antes la notificación solo traía la app al frente y el destino se perdía.
//
// v238: además de la pestaña, el destino puede decir el LUGAR exacto (antes
// "Presupuesto vencido: López" abría el Historial con los avisos plegados y
// nada hablaba de López). Formatos —los arma _buildPushAvisos y el Worker—:
//   agenda:YYYY-MM-DD[:idNota]  el día del aviso, con la nota resaltada
//   hist:<id>                   ese presupuesto, centrado y resaltado
//   historial:seg|venc          el banner de seguimientos / vencidos, abierto
// Llega desde afuera (URL, mensaje del SW) y termina en selectores: se valida
// con estas regex y lo que no calce no hace nada.
const IR_AGENDA_RE = /^agenda:(\d{4}-\d{2}-\d{2})(?::([\w-]{1,40}))?$/;
function irDestino(go) {
  go = String(go || '');
  let m;
  if (go === 'nuevo' && typeof newQuote === 'function') newQuote();
  else if (['historial', 'agenda', 'mapa', 'facturacion', 'editor'].includes(go)) switchTab(go);
  else if ((m = IR_AGENDA_RE.exec(go))) irAgendaDia(m[1], m[2]);
  else if ((m = /^hist:(\d{1,20})$/.exec(go))) {
    const id = Number(m[1]);
    // Borrado desde que salió el aviso: al menos, el Historial.
    if (getH().some(e => e.id === id)) goToHistoryEntry(id);
    else switchTab('historial');
  }
  else if ((m = /^historial:(seg|venc)$/.exec(go))) irAvisosHistorial(m[1]);
}

// Destella un elemento al llegar (misma animación que goToHistoryEntry).
function _irFlash(el) {
  el.classList.remove('hitem-flash');
  void el.offsetWidth;
  el.classList.add('hitem-flash');
  setTimeout(() => el.classList.remove('hitem-flash'), 2600);
}

// La Agenda parada en ese día, en la vista que el usuario tenga elegida. Con
// nota (visita/recordatorio con hora), esa tarjeta centrada y resaltada.
function irAgendaDia(iso, noteId) {
  switchTab('agenda');   // calInit: arma el estado y la vista recordada
  const p = iso.split('-').map(Number);
  _calY = p[0]; _calM = p[1] - 1; _calAnchor = iso; _calSel = iso;
  renderCal();
  requestAnimationFrame(() => {
    const panel = document.getElementById('panel-agenda');
    if (!panel) return;
    const visible = (el) => !!el && el.offsetParent !== null;
    let card = noteId
      ? [...panel.querySelectorAll(`[data-note-id="${noteId}"]`)].find(visible)
      : null;
    if (card && card.classList.contains('agc-swipe')) card = card.querySelector('.agc-ev') || card;
    const dia = _calView === 'agenda' ? panel.querySelector(`.agc-list-group[data-iso="${iso}"]`)
      : _calView === 'mes' ? document.getElementById('agc-day')
      : panel.querySelector('.agc-col.is-sel');
    const dest = card || (visible(dia) ? dia : null);
    if (!dest) return;
    dest.scrollIntoView({ behavior: 'smooth', block: card ? 'center' : 'start' });
    if (card) _irFlash(card);
  });
}

// Varios seguimientos/vencidos en un aviso: el Historial con su banner abierto.
function irAvisosHistorial(cual) {
  switchTab('historial');   // renderHistory repinta los banners
  const ban = document.getElementById(cual === 'seg' ? 'followup-banner' : 'expiry-banner');
  if (!ban || !(parseInt(ban.dataset.n, 10) > 0)) return;   // ya resueltos
  histAvisosToggle(true);
  requestAnimationFrame(() => {
    ban.scrollIntoView({ behavior: 'smooth', block: 'start' });
    _irFlash(ban);
  });
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (ev) => {
    const d = ev && ev.data;
    if (d && d.type === 'pq-go' && typeof d.go === 'string') irDestino(d.go);
  });
}

// ═══════════════════════════════════════════════════════════
// PWA — Service Worker + botón "Instalar app"
// ═══════════════════════════════════════════════════════════
(function setupPWA() {
  'use strict';

  // ── 1. Registrar el Service Worker ──────────────────────────
  // Solo funciona servido por http(s), no con file://. Si abrís el
  // HTML directo desde el disco, esto se omite silenciosamente.
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      // ¿La página ya estaba controlada por un SW al cargar? Si NO, esta es
      // la primera instalación y no debemos recargar al tomar control.
      const hadController = !!navigator.serviceWorker.controller;
      let refreshing = false;

      // Cuando un SW NUEVO toma control (tras un deploy), recargamos UNA vez
      // para cargar la versión nueva de forma limpia. Esto evita el estado
      // mezclado que antes obligaba a desinstalar/reinstalar la app.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing || !hadController) return;
        refreshing = true;
        window.location.reload();
      });

      navigator.serviceWorker.register('./sw.js').then((reg) => {
        // Si aparece un SW nuevo, lo activamos enseguida (skip waiting).
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              nw.postMessage('SKIP_WAITING');
            }
          });
        });
      }).catch(() => { /* sin SW; la app sigue andando normal */ });
    });
  }

  // ── 2. Botón "Instalar app" ─────────────────────────────────
  let deferredPrompt = null;

  function showInstallButton() {
    if (document.getElementById('pwa-install-btn')) return;
    const topbar = document.getElementById('topbar');
    if (!topbar) return;
    const menu = topbar.querySelector('.topbar-menu');
    const btn = document.createElement('button');
    btn.id = 'pwa-install-btn';
    btn.className = 'tbtn';
    btn.type = 'button';
    btn.title = 'Instalar como app';
    btn.setAttribute('aria-label', 'Instalar app');
    btn.innerHTML = icon('download') + ' Instalar';
    btn.style.cssText = 'margin-right:6px;white-space:nowrap;';
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) {}
      deferredPrompt = null;
      btn.remove();
    });
    // Insertar antes del menú ⋯ si existe, sino al final del topbar
    if (menu) topbar.insertBefore(btn, menu);
    else topbar.appendChild(btn);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const b = document.getElementById('pwa-install-btn');
    if (b) b.remove();
    if (typeof toast === 'function') toast('App instalada ✓');
  });
})();
