'use strict';

// ═══════════════════════════════════════
// NAV.JS — Botón "Atrás" del teléfono
// ═══════════════════════════════════════
// Antes la app no escuchaba "Atrás": en Android (app instalada o TWA) cerraba
// la app entera aunque hubiera una ventana abierta encima (vista previa,
// agenda, frases, un desplegable…). Regla de ahora:
//   1. Con algo abierto encima, "Atrás" lo cierra.
//   2. En una pestaña que no es el Editor, "Atrás" vuelve al Editor.
//   3. En el Editor y sin nada abierto, "Atrás" sale (lo normal en Android).
//
// Cómo: cada cosa que se abre apila una entrada en el historial del navegador
// (history.pushState) y una "capa" en _navCapas, su espejo. "Atrás" dispara
// popstate y se cierran las capas que quedaron arriba. Si la ventana se cierra
// por su propio botón, la capa se consume con history.back() para que el
// próximo "Atrás" no quede en el aire. Las ventanas se detectan solas (clase
// `open` de cada overlay y los desplegables .csel-pop/.cal-pop que se montan en
// <body>): no hay que tocar cada función que abre o cierra algo.
//
// Solo se apila con un toque reciente del usuario (navigator.userActivation).
// Chrome marca "salteable" la entrada de una página que apila historial sin
// gesto (la defensa contra páginas que secuestran el botón Atrás), y entonces
// "Atrás" saltearía la app entera. Lo que se abre solo al arrancar (el aviso
// del día, la bienvenida) no apila: ahí "Atrás" se comporta como antes.
//
// Capa "muerta": la que se cerró por la UI sin estar arriba de todo (no se puede
// sacar del medio del historial). Al llegarle, "Atrás" la saltea solo.

// Overlay → cómo se cierra. Al sumar un overlay nuevo, agregarlo acá.
const NAV_OVERLAYS = {
  'confirm-overlay':      () => { const b = document.getElementById('confirm-cancel'); if (b) b.click(); },
  'photo-viewer-overlay': () => closePhotoViewer(),
  'note-edit-overlay':    () => calCloseNoteEdit(),
  'clima-overlay':        () => closeClimaDetail(),
  'nv-overlay':           () => nvClose(),
  'estilo-overlay':       () => estiloCerrar(),
  'colab-overlay':        () => colabClose(),
  'agenda-overlay':       () => closeAgendaDlg(),
  'phrases-overlay':      () => closePhrasesModal(),
  'share-overlay':        () => closeShareTray(),
  'doc-preview-overlay':  () => closePreview(),
  'notif-overlay':        () => notifClose(),
  'notes-overlay':        () => closeNotesPanel(),
  'day-alert-overlay':    () => closeDayAlert(),
  'moverlay':             () => closeModal(),
};
const NAV_POP = '_pop';   // desplegables y calendario (closeCsel cierra los dos)
let _navCapas = [];        // [{ t:'ov'|'tab', id, muerta? }]

function _navConGesto() {
  const ua = navigator.userActivation;
  return !ua || ua.isActive;
}

function _navPush(capa) {
  if (!_navConGesto()) return false;
  try { history.pushState({ pq: 1, n: _navCapas.length + 1 }, ''); } catch (_) { return false; }
  _navCapas.push(capa);
  return true;
}

function _navViva(t, id) {
  return _navCapas.some(c => c.t === t && c.id === id && !c.muerta);
}

// Se cerró desde la UI: consumir su capa.
function _navSoltar(t, id) {
  for (let i = _navCapas.length - 1; i >= 0; i--) {
    const c = _navCapas[i];
    if (c.t !== t || c.id !== id || c.muerta) continue;
    if (i === _navCapas.length - 1) {
      _navCapas.pop();
      try { history.back(); } catch (_) {}
    } else {
      c.muerta = true;
    }
    return;
  }
}

function _navCerrar(c) {
  try {
    if (c.t === 'salir') { _navAvisoSalir(); return; }
    if (c.t === 'tab') {
      const ed = document.getElementById('panel-editor');
      if (ed && !ed.classList.contains('active')) switchTab('editor');
      return;
    }
    if (c.id === NAV_POP) { if (typeof closeCsel === 'function') closeCsel(); return; }
    const el = document.getElementById(c.id);
    if (el && el.classList.contains('open') && NAV_OVERLAYS[c.id]) NAV_OVERLAYS[c.id]();
  } catch (e) { console.warn('nav: no se pudo cerrar', c, e); }
}

function _navOnPop(ev) {
  const st = ev.state;
  const n = (st && st.pq) ? Math.max(0, st.n | 0) : 0;
  let quitadas = 0, cerro = false;
  while (_navCapas.length > n) {
    const c = _navCapas.pop();
    quitadas++;
    if (!c.muerta) { _navCerrar(c); cerro = true; }
  }
  // Solo había capas muertas: este "Atrás" no cerró nada visible, seguir de largo.
  if (quitadas && !cerro) { try { history.back(); } catch (_) {} }
}

// Lo llama switchTab. Una sola capa de pestaña: desde cualquier pestaña,
// "Atrás" vuelve al Editor (la pantalla de inicio de la app).
function _navTab(name) {
  const hay = _navViva('tab', 'tab');
  if (name === 'editor') { if (hay) _navSoltar('tab', 'tab'); }
  else if (!hay) _navPush({ t: 'tab', id: 'tab' });
}

// "Tocá Atrás de nuevo para salir" (como las apps de Android). En el Editor y sin
// nada abierto, "Atrás" cerraba la app de un toque: con el pulgar cerca del
// borde, a mitad de un presupuesto, es fácil tocarlo sin querer. No se pierde
// nada (el presupuesto se autoguarda), pero hay que volver a abrir la app y
// encontrar dónde se estaba. Ahora el primer "Atrás" deja un aviso y recién el
// segundo, dentro de NAV_SALIR_MS, sale.
// Cómo: una capa 'salir' al FONDO de la pila, armada con el primer toque en el
// Editor (sin gesto no se puede apilar, ver _navConGesto). Al consumirla se
// avisa y se deja de armar por NAV_SALIR_MS: el "Atrás" siguiente encuentra la
// pila vacía y sale. Pasado ese tiempo, el próximo toque la vuelve a armar.
// Solo en pantallas táctiles: en la compu el "Atrás" del navegador no cierra
// nada y un aviso ahí sería ruido.
const NAV_SALIR_MS = 2500;
let _navSalirHasta = 0;
function _navAvisoSalir() {
  _navSalirHasta = Date.now() + NAV_SALIR_MS;
  if (typeof toast === 'function') toast('Tocá Atrás de nuevo para salir', 'info', NAV_SALIR_MS);
}
function _navArmarSalida() {
  if (_navCapas.length || Date.now() < _navSalirHasta) return;
  const ed = document.getElementById('panel-editor');
  if (!ed || !ed.classList.contains('active')) return;
  _navPush({ t: 'salir', id: 'salir' });
}
function navSalirInit() {
  if (!window.matchMedia || !window.matchMedia('(pointer:coarse)').matches) return;
  if (!window.history || typeof history.pushState !== 'function') return;
  // pointerup (no click): corre ANTES del click, así si ese toque abre una
  // ventana o cambia de pestaña, la capa 'salir' queda debajo de la nueva.
  document.addEventListener('pointerup', _navArmarSalida, true);
  document.addEventListener('keyup', _navArmarSalida, true);
}

// Cerrar ventanas deslizando hacia abajo (como una hoja de Android/iOS). Solo
// las ventanas de consulta o de carga corta; quedan afuera la confirmación (es
// una decisión: que la tome un botón), la vista previa (un documento que se
// recorre y se agranda) y el visor de fotos (tiene sus propios gestos). El
// gesto arranca solo si lo que está debajo del dedo está scrolleado arriba de
// todo — si no, deslizar hacia abajo es volver hacia arriba en la lista — y
// nunca sobre campos ni sobre las tiras que se arrastran de costado. Se cierra
// con la misma función que la ✕ (NAV_OVERLAYS), así "Atrás" queda en orden.
const NAV_HOJAS = ['clima-overlay', 'notif-overlay', 'notes-overlay', 'day-alert-overlay',
  'phrases-overlay', 'moverlay', 'agenda-overlay', 'note-edit-overlay', 'nv-overlay', 'colab-overlay',
  'estilo-overlay'];
const NAV_HOJA_BLOCK = 'input,textarea,select,[contenteditable="true"],.agenda-clima-strip,' +
  '.csel-pop,.cal-pop,.cpk-sv,.cpk-hue,.agc-swipe,[draggable="true"]';
const NAV_HOJA_UMBRAL = 110;
function navHojasInit() {
  if (!window.matchMedia || !window.matchMedia('(pointer:coarse)').matches) return;
  let g = null;
  const volver = (box) => {
    box.style.transition = 'transform .18s ease, opacity .18s ease';
    box.style.transform = ''; box.style.opacity = '';
    setTimeout(() => { box.style.transition = ''; }, 200);
  };
  NAV_HOJAS.forEach(id => {
    const ov = document.getElementById(id);
    const box = ov && ov.querySelector('[role="dialog"]');
    if (!box || !NAV_OVERLAYS[id]) return;
    box.classList.add('hoja-desliza');
    ov.addEventListener('touchstart', (e) => {
      g = null;
      if (e.touches.length !== 1 || !ov.classList.contains('open')) return;
      const t = e.target;
      if (!box.contains(t) || (t.closest && t.closest(NAV_HOJA_BLOCK))) return;
      for (let el = t; el; el = el.parentElement) {
        if (el.scrollTop > 0) return;
        if (el === box) break;
      }
      const p = e.touches[0];
      g = { ov, box, id, x0: p.clientX, y0: p.clientY, t0: Date.now(), eje: 0, dy: 0, listo: false };
    }, { passive: true });
    ov.addEventListener('touchmove', (e) => {
      if (!g || g.ov !== ov) return;
      const p = e.touches[0], dx = p.clientX - g.x0, dy = p.clientY - g.y0;
      if (!g.eje) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        g.eje = (dy > 0 && dy > Math.abs(dx) * 1.3) ? 1 : 2;
        if (g.eje === 2) { g = null; return; }
      }
      if (e.cancelable) e.preventDefault();   // que no rebote ni recargue la página
      g.dy = Math.max(0, dy);
      box.style.transition = 'none';
      box.style.transform = `translateY(${g.dy}px)`;
      box.style.opacity = String(Math.max(0.4, 1 - g.dy / 500));
      const listo = g.dy > NAV_HOJA_UMBRAL;
      if (listo && !g.listo) haptic(8);
      g.listo = listo;
    }, { passive: false });
    const fin = (cancelado) => {
      const s = g; g = null;
      if (!s || s.ov !== ov || s.eje !== 1) return;
      const vel = s.dy / Math.max(1, Date.now() - s.t0);       // px/ms: un tirón corto también cierra
      if (!cancelado && (s.dy > NAV_HOJA_UMBRAL || (s.dy > 50 && vel > 0.6))) {
        box.style.transition = 'transform .16s ease, opacity .16s ease';
        box.style.transform = `translateY(${Math.round(window.innerHeight * 0.6)}px)`;
        box.style.opacity = '0';
        setTimeout(() => {
          try { NAV_OVERLAYS[id](); } catch (err) { console.warn('hoja: no se pudo cerrar', id, err); }
          box.style.transition = ''; box.style.transform = ''; box.style.opacity = '';
        }, 150);
      } else volver(box);
    };
    ov.addEventListener('touchend', () => fin(false), { passive: true });
    ov.addEventListener('touchcancel', () => fin(true), { passive: true });
  });
}

function _navEsPop(nd) {
  return nd && nd.nodeType === 1 && nd.classList &&
    (nd.classList.contains('csel-pop') || nd.classList.contains('cal-pop'));
}

// Teclado abierto → body.is-typing. En el celular las pestañas van abajo
// (bloque "CELULAR" del CSS) y con el teclado abierto se esconden: la pantalla
// útil se reduce a la mitad y una barra de navegación ahí no sirve. Solo
// campos de texto (no casillas, no botones) y solo en pantallas táctiles.
const NAV_TIPEO = /^(text|number|tel|email|search|url|password|date|time)$/;
function _navEsCampoTexto(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  return el.tagName === 'INPUT' && NAV_TIPEO.test(el.type || 'text');
}
function navTecladoInit() {
  if (!window.matchMedia || !window.matchMedia('(pointer:coarse)').matches) return;
  let t = null;
  const aplicar = (on) => {
    if (document.body.classList.contains('is-typing') === on) return;
    document.body.classList.toggle('is-typing', on);
    if (typeof reserveStickySpace === 'function') reserveStickySpace();
  };
  document.addEventListener('focusin', (e) => { if (_navEsCampoTexto(e.target)) { clearTimeout(t); aplicar(true); } });
  // Con retardo: al saltar de un campo al siguiente no hay que mostrar y
  // esconder la barra en el medio.
  document.addEventListener('focusout', () => { clearTimeout(t); t = setTimeout(() => {
    if (!_navEsCampoTexto(document.activeElement)) aplicar(false);
  }, 150); });
}

// Vibración corta de confirmación (Android; iOS no expone la API y se ignora).
// Solo en pantallas táctiles: en la compu no hay nada que vibrar. Se usa al
// cruzar el umbral de un gesto ("ya podés soltar"), no en cada toque.
function haptic(ms) {
  try {
    if (!navigator.vibrate || !window.matchMedia || !window.matchMedia('(pointer:coarse)').matches) return;
    navigator.vibrate(ms || 8);
  } catch (_) {}
}

// Tecla de acción del teclado del celular ("Siguiente" / "Listo"). Sin esto,
// en el Editor y en Configuración el Enter de un campo de una línea no hacía
// nada y había que cerrar el teclado y tocar el campo siguiente. Ahora pasa al
// próximo campo de texto VISIBLE de la misma pantalla y, en el último, cierra
// el teclado. El teclado muestra la flecha correcta porque al enfocar se pone
// `enterkeyhint`. Fuera de esas dos pantallas no se toca nada (las notas de la
// Agenda guardan con Enter), ni los campos que ya usan Enter (si el handler
// propio hace preventDefault, se respeta), ni las áreas de texto (Enter es
// salto de línea), ni la búsqueda.
const NAV_SIG_ZONA = '#panel-editor, #panel-empresa';
const NAV_SIG_ORIGEN = /^(text|number|tel|email|url)$/;
function _navSigEsOrigen(el) {
  return el && el.tagName === 'INPUT' && NAV_SIG_ORIGEN.test(el.type || 'text') &&
    !el.readOnly && !el.disabled && el.closest && el.closest(NAV_SIG_ZONA);
}
function _navSigCampos(el) {
  const zona = el.closest(NAV_SIG_ZONA);
  if (!zona) return [];
  return Array.prototype.filter.call(zona.querySelectorAll('input, textarea'), c =>
    (c.tagName === 'TEXTAREA' || NAV_SIG_ORIGEN.test(c.type || 'text')) &&
    !c.readOnly && !c.disabled && c.tabIndex >= 0 && c.getClientRects().length > 0);
}
function _navSiguiente(el) {
  const campos = _navSigCampos(el);
  const i = campos.indexOf(el);
  return i >= 0 ? (campos[i + 1] || null) : null;
}
function navSiguienteInit() {
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!_navSigEsOrigen(el) || el.hasAttribute('data-ekh-propio')) return;
    if (el.hasAttribute('enterkeyhint') && !el.hasAttribute('data-ekh')) { el.setAttribute('data-ekh-propio', ''); return; }
    el.setAttribute('enterkeyhint', _navSiguiente(el) ? 'next' : 'done');
    el.setAttribute('data-ekh', '');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing) return;
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target;
    if (!_navSigEsOrigen(el)) return;
    e.preventDefault();
    const sig = _navSiguiente(el);
    if (sig) sig.focus();
    else el.blur();                    // último campo: "Listo" cierra el teclado
  });
}

function navInit() {
  if (!window.history || typeof history.pushState !== 'function' || typeof MutationObserver === 'undefined') return;
  // Recarga parada sobre una entrada nuestra (las entradas sobreviven al
  // reload): no hay nada abierto que corresponda, así que son capas muertas.
  const st = history.state;
  if (st && st.pq && st.n > 0) for (let i = 0; i < st.n; i++) _navCapas.push({ t: 'ov', id: '_viejo', muerta: true });
  window.addEventListener('popstate', _navOnPop);
  const abierto = cls => /(^|\s)open(\s|$)/.test(cls || '');
  const mo = new MutationObserver(recs => recs.forEach(r => {
    if (r.type === 'attributes') {
      const id = r.target.id, antes = abierto(r.oldValue), ahora = r.target.classList.contains('open');
      if (!antes && ahora) { if (!_navViva('ov', id)) _navPush({ t: 'ov', id }); }
      else if (antes && !ahora) _navSoltar('ov', id);
    } else {
      r.addedNodes.forEach(nd => { if (_navEsPop(nd) && !_navViva('ov', NAV_POP)) _navPush({ t: 'ov', id: NAV_POP }); });
      r.removedNodes.forEach(nd => { if (_navEsPop(nd)) _navSoltar('ov', NAV_POP); });
    }
  }));
  Object.keys(NAV_OVERLAYS).forEach(id => {
    const el = document.getElementById(id);
    if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  });
  mo.observe(document.body, { childList: true });
}
