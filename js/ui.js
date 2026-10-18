'use strict';

// ═══════════════════════════════════════
// UI.JS — Restore/sync UI, tabs, modo, color, logo, fechas, numeración
// ═══════════════════════════════════════

// ─── RESTORE UI FROM STATE ───────────────────
function restoreUI() {
  sv('quote-number', S.quoteNumber);
  sv('date-issue', S.dateIssue);
  sv('date-expiry', S.dateExpiry);
  sv('client-name', S.clientName);
  sv('client-contact', S.clientContact);
  sv('work-address', S.workAddress);
  sv('work-maplink', S.workMapLink);
  // Abrir el desplegable de ubicación si hay un dato cargado (sino, colapsado
  // para no ocupar espacio).
  const _mapDet = document.getElementById('maplink-details');
  if (_mapDet) _mapDet.open = !!(S.workMapLink || '').trim();
  sv('work-duration', S.workDuration);
  sv('currency', S.currency);
  sv('discount', S.discount);
  sv('surcharge-pct', S.surcharge||0);
  sv('payment-conditions', S.paymentConditions);
  sv('observations', S.observations);
  sv('dispo-nota', S.dispoNota);
  sc('dispo-en-doc', S.dispoEnDoc !== false);
  renderDispo();
  updateNotesButton();
  sc('show-work-plan', S.showWorkPlan !== false);
  sc('wp-override', !!S.workPlanOverride);
  sv('wp-custom-title', S.workPlanCustomTitle);
  renderLineList('wp-custom-list');
  { const box = document.getElementById('wp-override-box'); if (box) box.style.display = S.workPlanOverride ? 'block' : 'none'; }
  sc('show-criteria', S.showCriteria);
  sc('show-expiry',   S.showExpiry !== false);
  sc('show-sig-owner', S.showSigOwner);
  sc('show-sig-client', S.showSigClient);
  sv('co-name', S.coName);
  sv('co-owner', S.coOwner);
  sv('co-subtitle', S.coSubtitle);
  sv('co-cuit', S.coCuit);
  sv('co-whatsapp', S.coWhatsapp);
  sv('co-city', S.coCity);
  sv('co-email', S.coEmail);
  sv('co-alias-pago', S.coAliasPago);
  sv('co-alias-titular', S.coAliasTitular);
  sv('co-cbu', S.coCbu);
  sv('co-banco', S.coBanco);
  sv('co-tech-notes', S.coTechNotes);
  sv('co-footer', S.coFooter);
  sv('co-eslogan', S.coEslogan || '');
  sc('show-tech-notes', S.showTechNotes);
  sc('show-footer', S.showFooter);
  sv('validity-days', S.validityDays);
  sv('num-prefix', S.numPrefix);
  sv('num-next', S.numNext);
  sv('est-observations', S.estObservations);
  sv('doc-title',         S.docTitle);
  sv('doc-title-est',     S.docTitleEst);
  sv('doc-title-jard',    S.docTitleJard);
  sv('doc-title-est-jard', S.docTitleEstJard);
  sv('doc-title-risk',    S.docTitleRisk);
  sv('doc-title-risk-editor', S.docTitleRisk);
  sv('co-evaluador',      S.coEvaluador || '');
  sv('doc-risk-limits',   S.docRiskLimits || '');
  sv('doc-est-banner',    S.docEstBanner);
  sv('doc-disclaimer',    S.docDisclaimer);
  sv('doc-disclaimer-svc',S.docDisclaimerSvc);
  sv('doc-work-plan-title', S.workPlanTitle);
  renderLineList('doc-work-plan-list');
  renderLineList('doc-criteria-list');
  sv('doc-greeting',      S.docGreeting);
  sv('doc-criteria-title',  S.docCriteriaTitle);
  sv('doc-criteria-intro',  S.docCriteriaIntro);
  sv('doc-discount-label',  S.docDiscountLabel);
  sv('doc-discount-note',   S.docDiscountNote);
  if (typeof renderSectionOrder === 'function') renderSectionOrder();
  // color
  applyAccent(S.accentColor);
  renderCustomColors();
  document.querySelectorAll('#color-presets .cpreset').forEach(el=>el.classList.toggle('active', String(el.dataset.color||'').toLowerCase()===String(S.accentColor).toLowerCase()));
  // Estilo propio: color de detalle, monograma, aviso de fábrica y juegos de
  // textos (v244).
  estiloUISync(false);
  _cpkInit();
  const _hx = document.getElementById('cpk-hex'); if(_hx) _hx.value = S.accentColor;
  const _pv = document.getElementById('cpk-preview'); if(_pv) _pv.style.background = S.accentColor;
  _cpkSetFromHex(S.accentColor);
  // pdf theme
  const _thm = S.pdfTheme || 'clasico';
  document.querySelectorAll('.tpreset').forEach(el=>el.classList.toggle('active', el.dataset.theme===_thm));
  const _cmp = document.getElementById('pdf-compact'); if(_cmp) _cmp.checked = !!S.pdfCompact;
  const _trl = document.getElementById('pdf-transl'); if(_trl) _trl.checked = !!S.pdfTransl;
  // pdf font
  const _fnt = S.pdfFont || 'auto';
  document.querySelectorAll('.fpreset').forEach(el=>el.classList.toggle('active', el.dataset.font===_fnt));
  // logo
  if(S.logo) showLogo(S.logo);
  // expiry visibility
  const _fg = document.getElementById('expiry-fg');
  const _se = S.showExpiry !== false;
  if (_fg) _fg.style.opacity = _se ? '1' : '0.4';
  _applyExpiryStrike(!_se);
  // riskData
  const rd = S.riskData || {};
  // Las opciones de la evaluación dependen de la matriz del informe: se
  // cargan ANTES de poner los valores (un <select> descarta un value que no
  // está entre sus opciones).
  riskOptsSync();
  sv('risk-species',       rd.species||'');
  sv('risk-height',        rd.height||'');
  sv('risk-dap',           rd.dap||'');
  sv('risk-location',      rd.location||'');
  sv('risk-vitalidad',     rd.vitalidad||'');
  sv('risk-nivel',         rd.nivel||'');
  sv('risk-plazo',         rd.plazo||'12');
  sv('risk-target',        rd.target||'');
  sv('risk-wind',          rd.windExposure||'');
  sv('risk-inclination',   rd.inclination||'');
  sv('risk-soil',          rd.soilCondition||'');
  sv('risk-prior',         rd.priorInterventions||'');
  sv('risk-fail-prob',     rd.failureProbability||'');
  sv('risk-impact-prob',   rd.impactProbability||'');
  sv('risk-consequences',  rd.consequences||'');
  sv('risk-res-fail',      rd.resFailure||'');
  sv('risk-res-impact',    rd.resImpact||'');
  sv('risk-res-cons',      rd.resConsequences||'');
  sv('risk-reinsp',        rd.reinsp||'');
  sv('risk-mitigation',    rd.mitigationGoals||'');
  sv('risk-observations',  rd.riskObservations||'');
  sv('risk-limitaciones',  rd.limitaciones||'');
  riskTecnicasRender();
  updateRiskLevelDisplay();
  // Escenarios A/B
  sc('scenarios-toggle', !!S.scenariosEnabled);
  sv('scn-label-a', S.scenarioLabelA || '');
  sv('scn-label-b', S.scenarioLabelB || '');
  updateScenarioUI();
  // Sincronizar los dropdowns y fechas propias con los valores recién cargados.
  refreshCustomSelects();
  refreshCustomDates();
  // Shell del editor: el estado de cada ficha se deriva de S, que acaba de
  // cambiar (arranque de la app, cargar del historial, importar).
  if (typeof editorShellSync === 'function') editorShellSync();
}

// ─── SYNC FROM UI TO STATE ───────────────────
function syncFromUI() {
  if (noSync) return;
  S.clientName        = gv('client-name');
  S.clientContact     = gv('client-contact');
  S.workAddress       = gv('work-address');
  S.workMapLink       = gv('work-maplink');
  S.workDuration      = gv('work-duration');
  S.currency          = gv('currency');
  S.discount          = parseFloat(gv('discount')) || 0;
  S.paymentConditions = gv('payment-conditions');
  S.observations      = gv('observations');
  S.dispoNota         = gv('dispo-nota');
  S.dispoEnDoc        = gc('dispo-en-doc');
  S.showWorkPlan      = gc('show-work-plan');
  S.workPlanOverride    = gc('wp-override');
  S.workPlanCustomTitle = gv('wp-custom-title');
  // S.workPlanCustom lo maneja el editor de lista (wp-custom-list).
  S.showCriteria      = gc('show-criteria');
  S.showExpiry        = gc('show-expiry');
  S.showSigOwner      = gc('show-sig-owner');
  S.showSigClient     = gc('show-sig-client');
  S.coName            = gv('co-name');
  S.coOwner           = gv('co-owner');
  S.coSubtitle        = gv('co-subtitle');
  S.coCuit            = gv('co-cuit');
  S.coWhatsapp        = gv('co-whatsapp');
  S.coCity            = gv('co-city');
  S.coEmail           = gv('co-email');
  S.coAliasPago       = gv('co-alias-pago');
  S.coAliasTitular    = gv('co-alias-titular');
  S.coCbu             = gv('co-cbu');
  S.coBanco           = gv('co-banco');
  S.coTechNotes       = gv('co-tech-notes');
  S.coFooter          = gv('co-footer');
  if (document.getElementById('co-eslogan')) S.coEslogan = gv('co-eslogan').slice(0, 120);
  S.showTechNotes     = gc('show-tech-notes');
  S.showFooter        = gc('show-footer');
  const di = gv('date-issue'); if (di) S.dateIssue = di;
  const vd = parseInt(gv('validity-days')); if (vd > 0) S.validityDays = vd;
  S.estObservations   = gv('est-observations');
  S.docTitle          = gv('doc-title')         || S.docTitle;
  S.docTitleEst       = gv('doc-title-est')     || S.docTitleEst;
  S.docTitleJard      = gv('doc-title-jard')    || S.docTitleJard;
  S.docTitleEstJard   = gv('doc-title-est-jard') || S.docTitleEstJard;
  const riskTitleSettings = gv('doc-title-risk');
  const riskTitleEditor = gv('doc-title-risk-editor');
  S.docTitleRisk = (document.activeElement && document.activeElement.id === 'doc-title-risk-editor')
    ? (riskTitleEditor || S.docTitleRisk)
    : (riskTitleSettings || riskTitleEditor || S.docTitleRisk);
  S.docEstBanner      = gv('doc-est-banner')    || S.docEstBanner;
  S.docDisclaimer     = gv('doc-disclaimer')    || S.docDisclaimer;
  S.docDisclaimerSvc  = gv('doc-disclaimer-svc')|| S.docDisclaimerSvc;
  S.workPlanTitle     = gv('doc-work-plan-title') || S.workPlanTitle;
  // S.workPlan y S.docCriteria los manejan sus editores de lista
  // (doc-work-plan-list / doc-criteria-list).
  S.docGreeting       = gv('doc-greeting');
  S.docCriteriaTitle  = gv('doc-criteria-title') || S.docCriteriaTitle;
  S.docCriteriaIntro  = gv('doc-criteria-intro') || S.docCriteriaIntro;
  S.docDiscountLabel  = gv('doc-discount-label') || S.docDiscountLabel;
  S.docDiscountNote   = gv('doc-discount-note');
  S.coEvaluador       = gv('co-evaluador');
  S.docRiskLimits     = gv('doc-risk-limits');
  // riskData
  if (!S.riskData) normalizeRiskData();
  // Sin opciones todavía (antes del primer restoreUI) los desplegables de la
  // evaluación leerían '' y borrarían lo cargado.
  { const fp = document.getElementById('risk-fail-prob'); if (fp && !fp.options.length) riskOptsSync(); }
  S.riskData.species             = gv('risk-species');
  S.riskData.height              = gv('risk-height');
  S.riskData.dap                 = gv('risk-dap');
  S.riskData.location            = gv('risk-location');
  S.riskData.vitalidad           = gv('risk-vitalidad');
  S.riskData.nivel               = gv('risk-nivel');
  S.riskData.plazo               = gv('risk-plazo') || '12';
  S.riskData.target              = gv('risk-target');
  S.riskData.windExposure        = gv('risk-wind');
  S.riskData.inclination         = gv('risk-inclination');
  S.riskData.soilCondition       = gv('risk-soil');
  S.riskData.priorInterventions  = gv('risk-prior');
  S.riskData.failureProbability  = gv('risk-fail-prob');
  S.riskData.impactProbability   = gv('risk-impact-prob');
  S.riskData.consequences        = gv('risk-consequences');
  S.riskData.resFailure          = gv('risk-res-fail');
  S.riskData.resImpact           = gv('risk-res-impact');
  S.riskData.resConsequences     = gv('risk-res-cons');
  S.riskData.reinsp              = gv('risk-reinsp');
  S.riskData.mitigationGoals     = gv('risk-mitigation');
  S.riskData.riskObservations    = gv('risk-observations');
  S.riskData.limitaciones        = gv('risk-limitaciones');
  updateRiskLevelDisplay();
  // Escenarios A/B (labels editables; el toggle se sincroniza vía
  // toggleScenarios() porque tiene efectos colaterales — render, dragSrc)
  S.scenarioLabelA = gv('scn-label-a') || S.scenarioLabelA;
  S.scenarioLabelB = gv('scn-label-b') || S.scenarioLabelB;
  // Refrescar las etiquetas de los botones de tab por si el usuario
  // cambió alguna label
  updateScenarioUI();
  sched();
}

function mirrorRiskTitleInput(target) {
  if (!target || (target.id !== 'doc-title-risk' && target.id !== 'doc-title-risk-editor')) return;
  const otherId = target.id === 'doc-title-risk' ? 'doc-title-risk-editor' : 'doc-title-risk';
  const other = document.getElementById(otherId);
  if (other && other.value !== target.value) other.value = target.value;
}

// Hook all field changes to syncFromUI
document.addEventListener('input', e  => { if(!noSync && e.target.closest('#app')) { mirrorRiskTitleInput(e.target); syncFromUI(); } });
document.addEventListener('change', e => { if(!noSync && e.target.closest('#app')) syncFromUI(); });

// ─── TABS ────────────────────────────────────
// ─── SUB-TABS dentro de Empresa ──────────────
// Las sub-pestañas reducen el scroll vertical de la pestaña Empresa.
// Renderiza solo lo necesario al entrar en cada sub-tab.
function switchSubtab(name) {
  const names = ['negocio','textos','estilo','datos'];
  document.querySelectorAll('.subtab-btn').forEach((b,i)=>b.classList.toggle('active', names[i]===name));
  document.querySelectorAll('.subpanel').forEach(p=>p.classList.remove('active'));
  const p = document.getElementById('subpanel-'+name); if(p) p.classList.add('active');
  // Los monogramas de muestra usan el nombre y el logo actuales, que pudieron
  // cambiar en "Mi negocio".
  if (name === 'estilo') estiloUISync(false);
  // Al entrar a "datos", solo actualizamos los CONTADORES de los headers.
  // Las listas se renderizan al abrir cada sección colapsable (lazy).
  if (name === 'datos') {
    updateCollapsibleCounts();
    espacioRender();
  }
}

// Actualiza los contadores en los headers colapsables de "Datos guardados".
// Se llama al entrar a la sub-tab y después de cualquier cambio (agregar/borrar).
function updateCollapsibleCounts() {
  const setCnt = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(n);
  };
  if (typeof getClientDB === 'function')   setCnt('cs-clients-count',  getClientDB().length);
  if (typeof getSpeciesDB === 'function')  setCnt('cs-species-count',  getSpeciesDB().length);
  if (typeof getServicesDB === 'function') setCnt('cs-services-count', getServicesDB().length);
  if (typeof getMisServicios === 'function') setCnt('cs-missvc-count', getMisServicios().length);
}

// Abre/cierra una sección colapsable. Lazy: solo renderiza la lista
// al abrir (no se gasta tiempo renderizando listas que no se ven).
function toggleCollapsibleSection(id) {
  const section = document.getElementById(id);
  if (!section) return;
  const willOpen = !section.classList.contains('is-open');
  section.classList.toggle('is-open', willOpen);
  if (willOpen) {
    // Renderizar solo al abrir (lazy)
    if (id === 'cs-clients'  && typeof renderClientManager   === 'function') renderClientManager();
    if (id === 'cs-species'  && typeof renderSpeciesManager  === 'function') renderSpeciesManager();
    if (id === 'cs-services' && typeof renderServicesManager === 'function') renderServicesManager();
    if (id === 'cs-missvc'   && typeof renderMisServiciosManager === 'function') renderMisServiciosManager();
  }
}

// Memoria de scroll por pestaña. Como TODAS las pestañas comparten el único
// scroller (#main), al cambiar de pestaña el scrollTop se "filtraba" de una a
// otra (entrabas al Editor scrolleado a la mitad porque venías scrolleado del
// Historial). Guardamos la posición de la pestaña que dejamos y restauramos la
// de la que entramos (0 la primera vez que se visita).
const _tabScroll = {};
function switchTab(name) {
  // El puente presupuesto→factura solo aplica dentro de Facturación; al salir
  // a otra pestaña descartamos el enlace pendiente para no atar la factura a
  // un presupuesto que no corresponde.
  if (name !== 'facturacion') _pendingFacturaQuote = null;
  // Botón "Atrás": apila (o consume) la capa de pestaña. Ver js/nav.js.
  if (typeof _navTab === 'function') _navTab(name);
  // Recordar dónde quedó la pestaña que estamos dejando (antes de ocultarla).
  const _main = document.getElementById('main');
  const _prev = document.querySelector('.tab-panel.active');
  if (_main && _prev) _tabScroll[_prev.id] = _main.scrollTop;
  // Empresa y Estilo ya no tienen botón en la barra (viven en el engranaje ⚙);
  // este array debe coincidir en orden con los .tab-btn que SÍ quedan en #tabs.
  const names = ['editor','historial','agenda','mapa','facturacion'];
  document.querySelectorAll('.tab-btn').forEach((b,i)=>b.classList.toggle('active', names[i]===name));
  // Resaltar el engranaje cuando estamos en una pantalla de Configuración
  // (esos paneles no tienen botón de pestaña que se marque activo).
  const _gear = document.getElementById('btn-config');
  if (_gear) _gear.classList.toggle('is-active', name==='empresa');
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  const p = document.getElementById('panel-'+name); if(p) p.classList.add('active');
  if(name==='historial')   renderHistory();
  if(name==='mapa'      && typeof mapaInit === 'function') mapaInit();
  if(name==='agenda'    && typeof calInit === 'function') calInit();
  if(name==='empresa')     {
    // Actualizamos contadores en los headers colapsables; las listas
    // mismas se renderizan al abrir cada sección (lazy).
    updateCollapsibleCounts();
    // Si no hay sub-tab activa (primera vez entrando), poner "negocio"
    if (!document.querySelector('.subtab-btn.active')) switchSubtab('negocio');
    // Cargar config de seguimiento en sus campos
    if (typeof loadFollowupUI === 'function') loadFollowupUI();
    if (typeof gdriveUpdateUI === 'function') gdriveUpdateUI();
  }
  if(name==='facturacion') factInit();
  // Sticky totals solo en el editor — no tiene sentido en otras pestañas
  const sticky = document.getElementById('sticky-totals');
  if (sticky) {
    if (name === 'editor') {
      sticky.style.display = 'block';
      document.body.classList.add('has-sticky-totals');
      // Refrescar valores (por si veníamos de otra pestaña con datos viejos)
      updateTotalsBar();
    } else {
      sticky.style.display = 'none';
      document.body.classList.remove('has-sticky-totals');
    }
  }
  // Reservar el espacio de la barra de totales (solo en Editor) antes de
  // restaurar el scroll, para que el scrollTop se calcule sobre la altura final.
  reserveStickySpace();
  // Restaurar la posición propia de la pestaña que entra (0 si es su primera
  // visita). Va al final: el contenido ya se re-renderizó (renderHistory, etc.)
  // así que el scrollTop se aplica sobre la altura correcta. Los callers que
  // hacen su propio scrollIntoView tras switchTab (p. ej. abrir un presupuesto
  // del historial) corren después y ganan — no hay conflicto.
  if (_main) _main.scrollTop = _tabScroll['panel-' + name] || 0;
}

// Reserva, dentro del scroller #main, el alto real de la barra de totales fija
// para que el contenido no quede tapado. Se mide con offsetHeight (incluye la
// safe-area del dispositivo). Fuera del Editor la barra está oculta → se limpia
// el padding y vuelve al valor por defecto del CSS.
function reserveStickySpace() {
  const main = document.getElementById('main');
  const bar  = document.getElementById('sticky-totals');
  if (!main || !bar) return;
  const shown = document.body.classList.contains('has-sticky-totals') && bar.style.display !== 'none';
  const alto = bar.offsetHeight;   // incluye la safe-area del dispositivo
  main.style.paddingBottom = shown ? (alto + 16) + 'px' : '';
  // Y el FAB de "subir" se apoya en el alto MEDIDO, no en una constante. Antes
  // el CSS tenía 56px a mano, que alcanzaba para la barra de una fila; con las
  // dos filas de la Fase 2 el FAB quedaba encima de la barra. Se publica como
  // custom property para que el cálculo siga viviendo en el CSS.
  document.documentElement.style.setProperty('--sticky-h', (shown ? alto : 0) + 'px');
}

// Vuelve #main al tope con scroll suave (botón "subir").
function scrollMainToTop() {
  const main = document.getElementById('main');
  if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
}

// Orden de las pestañas de la barra (para navegar con swipe). Debe coincidir
// con el orden de los .tab-btn y con el array `names` de switchTab. 'empresa'
// (Configuración) no está: se llega por el engranaje, no por swipe.
const TAB_ORDER = ['editor', 'historial', 'agenda', 'mapa', 'facturacion'];
const TAB_LABELS = { editor: 'Editor', historial: 'Historial', agenda: 'Agenda', mapa: 'Mapa', facturacion: 'Facturas' };

// Pestaña vecina de la actual en la dirección dir (+1 siguiente, -1 anterior),
// con wrap circular: desde Facturas (última) sigue a Editor (primera) y
// viceversa. El +len antes del módulo evita el negativo con dir=-1. Devuelve
// null en una pantalla sin swipe (Configuración).
function _swipeVecina(dir) {
  const cur = document.querySelector('.tab-panel.active');
  if (!cur) return null;
  const i = TAB_ORDER.indexOf(cur.id.replace('panel-', ''));
  if (i < 0) return null;
  return TAB_ORDER[(i + dir + TAB_ORDER.length) % TAB_ORDER.length];
}

// Navega a la pestaña vecina con una animación de entrada. La usa el gesto.
// OJO con el nombre: hasta la v234 se llamaba `_navTab`, igual que la función
// del botón Atrás de js/nav.js. Como todo el JS vive en un mismo ámbito global,
// la declaración de nav.js (más abajo) pisaba a esta y el swipe terminaba
// llamando a la del botón Atrás con 1/-1: no cambiaba de pestaña. Por eso
// test/gestos.test.cjs exige que no haya dos funciones con el mismo nombre.
function _swipeTab(dir) {
  const dest = _swipeVecina(dir);
  if (!dest) return;
  switchTab(dest);
  const p = document.getElementById('panel-' + dest);
  if (p) {
    const cls = dir > 0 ? 'tab-slide-next' : 'tab-slide-prev';
    p.classList.remove('tab-slide-next', 'tab-slide-prev');
    void p.offsetWidth;              // reflow: reinicia la animación
    p.classList.add(cls);
    p.addEventListener('animationend', () => p.classList.remove(cls), { once: true });
  }
}

// Paso del calendario por gesto: misma animación de entrada que las pestañas,
// aplicada a la grilla (el elemento se conserva entre renders).
function _swipeCal(dir) {
  calStep(dir);
  const g = document.getElementById('agc-grid');
  if (!g) return;
  const cls = dir > 0 ? 'tab-slide-next' : 'tab-slide-prev';
  g.classList.remove('tab-slide-next', 'tab-slide-prev');
  void g.offsetWidth;
  g.classList.add(cls);
  g.addEventListener('animationend', () => g.classList.remove(cls), { once: true });
}

// ─── MODE ────────────────────────────────────
// Devuelve el modo activo a partir de los flags de state. Centraliza la
// lógica para que loadFromHistory, impIndividual, impBackup, etc. no la
// dupliquen (y olviden el caso 'riesgo' como pasaba antes).
function currentMode() {
  if (S.isRisk)       return 'riesgo';
  if (S.isEstimative) return 'estimativo';
  return 'normal';
}

function setMode(mode) {
  S.isEstimative = (mode === 'estimativo');
  S.isRisk       = (mode === 'riesgo');
  // Cancelar cualquier drag en curso: dragSrc es global y compartido
  // entre listas (items normales y estimativos). Si el usuario empieza
  // un drag en una lista y cambia de modo antes del drop, un drop
  // posterior usaría el índice viejo contra el array nuevo y corrompería
  // datos silenciosamente.
  dragSrc = null;
  applyMode(mode);
  sched();
}

// ─── ESCENARIOS A/B ──────────────────────────
function toggleScenarios() {
  S.scenariosEnabled = !!gc('scenarios-toggle');
  if (!Array.isArray(S.itemsB)) S.itemsB = [];
  // Al deshabilitar, asegurar que el escenario activo vuelva a A para
  // que la lista visible sea S.items (evita ver lista vacía si quedaba en B).
  if (!S.scenariosEnabled) activeScenario = 'A';
  // Cancelar cualquier drag en curso por la misma razón que setMode.
  dragSrc = null;
  updateScenarioUI();
  renderItems();
  updateTotalsBar();
  sched();
}

function setActiveScenario(s) {
  if (s !== 'A' && s !== 'B') return;
  activeScenario = s;
  dragSrc = null;
  updateScenarioUI();
  renderItems();
  updateTotalsBar();
}

// Aplica visualmente el estado del panel de escenarios. Llamada desde
// toggleScenarios, setActiveScenario y restoreUI.
function updateScenarioUI() {
  const ctrl = document.getElementById('scenarios-controls');
  if (ctrl) ctrl.style.display = S.scenariosEnabled ? 'block' : 'none';
  const tA = document.getElementById('scn-tab-a');
  const tB = document.getElementById('scn-tab-b');
  if (tA && tB) {
    tA.className = 'btn btn-sm ' + (activeScenario === 'A' ? 'btn-p' : 'btn-g');
    tB.className = 'btn btn-sm ' + (activeScenario === 'B' ? 'btn-p' : 'btn-g');
    // Mostrar la etiqueta en el botón para que se vea de qué escenario es
    const labelA = (S.scenarioLabelA || 'A').replace(/^Opción\s+[AB]\s*—\s*/i, '').trim() || 'A';
    const labelB = (S.scenarioLabelB || 'B').replace(/^Opción\s+[AB]\s*—\s*/i, '').trim() || 'B';
    tA.textContent = 'A · ' + labelA;
    tB.textContent = 'B · ' + labelB;
  }
}

// ─── SHELL DEL EDITOR (Fase 1 del rediseño) ──
// Las secciones del editor, EN EL ORDEN EN QUE APARECEN EN EL DOM: la
// numeración se calcula sobre las visibles y tiene que leerse de arriba abajo.
// `body` es el elemento cuya visibilidad decide applyMode() (null = la sección
// se ve en los tres modos). Las 6 section-card del informe ISA cuentan como
// UNA sección; ver docs/rediseno-editor.md.
const EDITOR_SECTIONS = [
  { key:'ident',      body:null },
  { key:'cliente',    body:null },
  { key:'items',      body:'section-normal-items' },
  { key:'risk',       body:'section-risk-analysis' },
  { key:'est-items',  body:'section-est-items' },
  { key:'conditions', body:'section-conditions' },
  { key:'dispo',      body:null },
  { key:'adjust',     body:'section-adjustments' },
  { key:'est-obs',    body:'section-est-observations' },
];

// ── ETAPAS de la vista `consola` (Fase 1b) ──
// Cada etapa agrupa secciones del editor y se muestra una por vez. El orden es
// el MISMO que el del editor (y que la numeración de las fichas), así que un
// número nunca va para atrás al cambiar de etapa.
//
// La etapa `informe` existe solo en modo riesgo, y va aparte y no dentro de
// `datos` por una razón medida: las 6 tarjetas del ISA suman ~1.900 px. Metidas
// en `datos` daban una etapa de ~2.600 px — más larga que el editor completo en
// modo normal, o sea justo lo que esta vista viene a resolver.
const EDITOR_ETAPAS = [
  { key:'datos',    label:'Datos',    secs:['ident','cliente'] },
  { key:'trabajos', label:'Trabajos', secs:['items','est-items'] },
  { key:'informe',  label:'Informe',  secs:['risk'] },
  { key:'cierre',   label:'Cierre',   secs:['conditions','dispo','adjust','est-obs'] },
];

// Sección abierta en la vista "fichas" y etapa activa en la vista "consola".
// Las dos son estado de pantalla, no del presupuesto: no se guardan ni viajan
// en el backup (invariante I3).
// La ficha que arranca abierta es Cliente: Identificación se autocompleta
// (número, fechas) y casi nunca se toca.
let _esecOpen = 'cliente';
let _esecEtapa = 'datos';
// Identificación desplegada (vistas clásica y consola). Estado de pantalla.
let _identAbierta = false;

// La vista efectiva. Cualquier valor que no esté en la lista blanca cae a
// 'clasica', que es la pantalla conocida-buena (invariante I2).
function currentVistaEditor() {
  return (EDITOR_VIEWS.indexOf(S.vistaEditor) >= 0) ? S.vistaEditor : 'clasica';
}

// Cambia la vista del editor. La UI para elegirla llega en la Fase 4; por
// ahora se usa desde la consola y desde los tests.
function setVistaEditor(v) {
  S.vistaEditor = (EDITOR_VIEWS.indexOf(v) >= 0) ? v : 'clasica';
  if (!_esecOpen) _esecOpen = 'cliente';
  editorShellSync();
  saveLS();
}

// Resumen de una línea de Identificación: "2026-0036 · emitido 02/10/2026 ·
// vence 01/11/2026". Solo lee S y escribe texto/atributos (invariante I3).
function identResSync() {
  const res = document.getElementById('ident-res');
  const campos = document.getElementById('ident-campos');
  if (!res || !campos) return;
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('ident-res-num', S.quoteNumber || '—');
  const partes = [];
  if (S.dateIssue)  partes.push('emitido ' + fmtD(S.dateIssue));
  if (S.dateExpiry) partes.push('vence ' + fmtD(S.dateExpiry));
  if (S.currency && S.currency !== 'ARS') partes.push(S.currency);
  set('ident-res-meta', partes.join(' · '));
  set('ident-res-acc', _identAbierta ? 'Ocultar' : 'Cambiar');
  res.setAttribute('aria-expanded', _identAbierta ? 'true' : 'false');
  campos.hidden = !_identAbierta;
}

function identToggle() {
  _identAbierta = !_identAbierta;
  identResSync();
}

function editorToggleSection(key) {
  if (currentVistaEditor() !== 'fichas') return;   // en clásica/consola no hay plegado
  _esecOpen = (_esecOpen === key) ? '' : key;
  editorShellSync();
}

// Cambia de etapa (vista consola). Vuelve al tope: cambiar de etapa es cambiar
// de pantalla, y quedarse a mitad de scroll de la anterior desorienta.
function editorSetEtapa(key) {
  if (currentVistaEditor() !== 'consola') return;
  if (!EDITOR_ETAPAS.some(e => e.key === key)) return;
  _esecEtapa = key;
  editorShellSync();
  const main = document.getElementById('main');
  if (main) main.scrollTop = 0;
}

// Estado que muestra cada sección a la derecha de su encabezado. `done` es lo
// que cuenta para la barra de progreso y para pintar la barra de acento.
// El texto va en minúsculas: el versalita lo pone el CSS.
function _esecEstado(key) {
  const lleno = v => !!String(v == null ? '' : v).trim();
  const items = n => n ? { txt:(n + (n === 1 ? ' ítem' : ' ítems')), done:true }
                       : { txt:'Pendiente', done:false };
  switch (key) {
    // Se autocompleta: siempre está lista, y lo útil es ver el número. No
    // cuenta para el progreso (cuenta:false): no es algo que el usuario cargue.
    case 'ident':      return { txt:S.quoteNumber || '—', done:true, cuenta:false };
    case 'cliente':    return lleno(S.clientName) ? { txt:'Completo ✓', done:true }
                                                  : { txt:'Pendiente', done:false };
    case 'items':      return items((activeItemsArr() || []).length);
    case 'est-items':  return items((S.estItems || []).length);
    case 'risk': {
      const lvl = riskEval(S.riskData).nivel;
      return lvl ? { txt:'Riesgo ' + (RISK_LABELS.riskLevel[lvl] || lvl), done:true }
                 : { txt:'Pendiente', done:false };
    }
    case 'conditions': return (lleno(S.paymentConditions) || lleno(S.observations))
                              ? { txt:'Completo ✓', done:true } : { txt:'Pendiente', done:false };
    case 'est-obs':    return lleno(S.estObservations) ? { txt:'Completo ✓', done:true }
                                                      : { txt:'Pendiente', done:false };
    // No acordar nada es válido (el cliente se queda con toda la leña y listo):
    // como `adjust`, cuenta resuelta aunque esté vacía.
    case 'dispo': {
      const nf = dispoPhotoRefs().length;
      if (nf) return { txt:(nf === 1 ? '1 foto' : nf + ' fotos'), done:true, cuenta:false };
      return { txt: lleno(S.dispoNota) ? 'Anotado ✓' : 'Sin definir', done:true, cuenta:false };
    }
    // Vacío es una respuesta válida: sin ajustes también está resuelta.
    case 'adjust': {
      const partes = [];
      const sur = Number(S.surcharge) || 0, dsc = Number(S.discount) || 0;
      if (sur > 0) partes.push('+' + sur + '%');
      if (dsc > 0) partes.push('−' + dsc + '%');
      return { txt: partes.length ? partes.join(' · ') : 'Sin ajustes', done:true, cuenta:false };
    }
  }
  return { txt:'', done:true };
}

// Nombre de cada sección en el "Falta: …" del encabezado.
const ESH_FALTA = { cliente:'cliente', items:'trabajos', 'est-items':'trabajos',
  risk:'informe', conditions:'condiciones', 'est-obs':'observaciones' };

// Encabezado del editor + barra de progreso. `secs` = las secciones visibles
// que CUENTAN ({key, done}, en orden): así el segmento pintado es el de la
// sección resuelta, no los N primeros. Antes contaban también Identificación,
// Disposición y Ajustes, que se dan por resueltas solas: un presupuesto vacío
// arrancaba en "4 de 6 secciones", como si ya estuviera a mitad de camino.
// Ahora dice lo que falta cargar.
function _eshRender(secs) {
  const flags = secs.map(x => x.done);
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const modo = currentMode();
  set('esh-num', S.quoteNumber || '—');
  set('esh-client', String(S.clientName || '').trim() || 'Sin cliente');
  set('esh-mode', modo === 'estimativo' ? 'Estimativo' : modo === 'riesgo' ? 'Riesgo' : 'Normal');
  set('esh-note', modo === 'estimativo' ? 'Valor referencial'
                : modo === 'riesgo'     ? 'Informe ISA' : 'Precios cerrados');
  const faltan = secs.filter(x => !x.done).map(x => ESH_FALTA[x.key] || x.key);
  const lista = faltan.length > 1 ? faltan.slice(0, -1).join(', ') + ' y ' + faltan[faltan.length - 1] : (faltan[0] || '');
  set('esh-count', faltan.length ? 'Falta: ' + lista : 'Todo cargado ✓');
  const bar = document.getElementById('esh-bar');
  if (!bar) return;
  if (bar.children.length !== flags.length) {
    bar.innerHTML = flags.map(() => '<span class="esh-seg"></span>').join('');
  }
  Array.from(bar.children).forEach((seg, i) => seg.classList.toggle('is-done', !!flags[i]));
}

// Tabs de etapa de la vista `consola`. Los cuatro botones están en el markup;
// acá se decide cuáles corresponden al modo, cuál está activa y cuáles tienen
// secciones sin resolver (el punto).
function _econRenderTabs(etapas, vis) {
  const cont = document.getElementById('editor-etapas');
  if (!cont) return;
  const hay = etapas.map(e => e.key);
  cont.querySelectorAll('.econ-tab').forEach(btn => {
    const k = btn.dataset.etapa;
    const enModo = hay.indexOf(k) >= 0;
    btn.hidden = !enModo;
    const act = enModo && (k === _esecEtapa);
    btn.classList.toggle('is-active', act);
    btn.setAttribute('aria-selected', act ? 'true' : 'false');
    const def = EDITOR_ETAPAS.find(e => e.key === k);
    const falta = !!def && vis.some(v => def.secs.indexOf(v.sec.key) >= 0 && !v.done);
    btn.classList.toggle('is-pending', enModo && falta);
  });
}

// Aplica la vista al editor: qué fichas se ven, con qué número, qué estado y
// cuál está abierta. SOLO toca clases, atributos y texto de los encabezados —
// nunca reconstruye el DOM del editor ni toca S (invariante I3).
// Se llama desde applyMode(), restoreUI() y sched().
function editorShellSync() {
  const panel = document.getElementById('panel-editor');
  if (!panel) return;
  const vista = currentVistaEditor();
  try {
    panel.dataset.vista = vista;
    // Visibles = las que applyMode() no ocultó. Se lee el display inline, que
    // es justamente lo que applyMode escribe.
    const vis = [];
    EDITOR_SECTIONS.forEach(sec => {
      const wrap = document.getElementById('esec-' + sec.key);
      if (!wrap) return;
      const body = sec.body ? document.getElementById(sec.body) : null;
      const oculta = !!(body && body.style.display === 'none');
      wrap.hidden = oculta;
      if (!oculta) vis.push({ sec, wrap });
    });
    // Si la sección abierta quedó fuera del modo activo, abrir la primera.
    if (!vis.some(v => v.sec.key === _esecOpen)) _esecOpen = vis.length ? vis[0].sec.key : '';
    // Numeración, estado y realce. La numeración es GLOBAL a las secciones
    // visibles del modo, no por etapa: así el número de una sección es el mismo
    // en las tres vistas.
    vis.forEach((v, i) => {
      const est = _esecEstado(v.sec.key);
      v.done = !!est.done;
      v.cuenta = est.cuenta !== false;
      const nEl = v.wrap.querySelector('.esec-num');
      if (nEl) nEl.textContent = String(i + 1).padStart(2, '0');
      const sEl = v.wrap.querySelector('.esec-status'); if (sEl) sEl.textContent = est.txt;
      v.wrap.classList.toggle('is-done', v.done);
      v.wrap.classList.toggle('is-pending', !v.done);
      // Solo `fichas` pliega; en clásica y consola todas cuentan como abiertas.
      const abierta = (vista !== 'fichas') || (v.sec.key === _esecOpen);
      v.wrap.classList.toggle('is-open', abierta);
      const hEl = v.wrap.querySelector('.esec-head');
      if (hEl) hEl.setAttribute('aria-expanded', abierta ? 'true' : 'false');
    });
    // Etapas (vista consola). Una etapa existe si tiene al menos una sección
    // visible en el modo activo — por eso `informe` aparece solo en riesgo.
    const claves = vis.map(v => v.sec.key);
    const etapas = EDITOR_ETAPAS.filter(e => e.secs.some(k => claves.indexOf(k) >= 0));
    if (!etapas.some(e => e.key === _esecEtapa)) _esecEtapa = etapas.length ? etapas[0].key : '';
    const activa = EDITOR_ETAPAS.find(e => e.key === _esecEtapa);
    vis.forEach(v => {
      const fuera = (vista === 'consola') &&
                    !!activa && activa.secs.indexOf(v.sec.key) < 0;
      v.wrap.classList.toggle('esec-offstage', fuera);
    });
    _econRenderTabs(etapas, vis);
    _eshRender(vis.filter(v => v.cuenta).map(v => ({ key: v.sec.key, done: v.done })));
  } catch (e) {
    // Invariante I2: ante cualquier error, la vista conocida-buena.
    console.warn('editorShellSync', e);
    panel.dataset.vista = 'clasica';
  }
  try { identResSync(); } catch (e) { console.warn('identResSync', e); }
  // El segmentado de Empresa → Estilo. Se lee del atributo ya aplicado, así el
  // botón marcado es la vista que el usuario está viendo de verdad (incluso si
  // el fallback de arriba la bajó a 'clasica').
  document.querySelectorAll('#vista-editor-mode .theme-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.vista === panel.dataset.vista));
}

function applyMode(mode) {
  const isEst  = (mode === 'estimativo');
  const isRisk = (mode === 'riesgo');
  const isNorm = !isEst && !isRisk;

  // Botones de modo
  const btnNorm = document.getElementById('mode-btn-normal');
  const btnEst  = document.getElementById('mode-btn-est');
  const btnRisk = document.getElementById('mode-btn-riesgo');
  if (btnNorm) btnNorm.classList.toggle('active', isNorm);
  if (btnEst)  btnEst.classList.toggle('active', isEst);
  if (btnRisk) btnRisk.classList.toggle('active', isRisk);

  // Banner estimativo
  const banner = document.getElementById('est-banner');
  if (banner) banner.classList.toggle('show', isEst);

  // Secciones de ítems
  const secNorm = document.getElementById('section-normal-items');
  const secEst  = document.getElementById('section-est-items');
  const secRisk = document.getElementById('section-risk-analysis');
  if (secNorm) secNorm.style.display = (isNorm || isRisk) ? '' : 'none';
  if (secEst)  secEst.style.display  = isEst ? '' : 'none';
  if (secRisk) secRisk.style.display = isRisk ? '' : 'none';

  // Secciones de condiciones y observaciones
  const condSec   = document.getElementById('section-conditions');
  const estObsSec = document.getElementById('section-est-observations');
  if (condSec)   condSec.style.display   = isEst ? 'none' : '';
  if (estObsSec) estObsSec.style.display = isEst ? '' : 'none';

  // La barra de totales ya no se toca acá: desde la Fase 2 la única es la fija
  // (#sticky-totals) y su variante la elige _stickyShowVariant() desde
  // updateTotalsBar(), que corre al final de esta función.

  // Sección "Ajustes de precio" (recargo interno + descuento): visible en
  // modo normal/riesgo, oculta en estimativo.
  const adjSec = document.getElementById('section-adjustments');
  if (adjSec) adjSec.style.display = isEst ? 'none' : '';

  // Panel de escenarios A/B: solo en modo normal (no en riesgo ni estimativo)
  const scnPanel = document.getElementById('scenarios-panel');
  if (scnPanel) scnPanel.style.display = isNorm ? '' : 'none';

  // Chips de servicios rápidos: solo en modo normal
  if (typeof renderQuickServices === 'function') renderQuickServices();

  // Rubro: el selector se oculta en riesgo y, en un presupuesto de jardinería,
  // las tarjetas cambian de etiquetas al entrar o salir de riesgo (el informe
  // ISA es de un árbol), así que se re-dibujan. renderItems llama a rubroSync.
  if (S.rubro === 'jardineria') renderItems(); else rubroSync();

  updateTotalsBar();
  // Shell del editor: la numeración y el progreso se calculan sobre las
  // secciones que quedaron visibles, así que va DESPUÉS de decidirlo.
  editorShellSync();
}

// ─── RIESGO: MATRIZ, ALCANCE Y OPCIONES (v243) ─────
function riskPlazoTxt(m) {
  const n = parseInt(m, 10);
  if (!n) return '';
  return n % 12 === 0 ? (n === 12 ? '1 año' : (n / 12) + ' años') : n + ' meses';
}

// Carga las opciones de la evaluación según la matriz del informe (ISA o la
// anterior) y muestra/oculta lo que solo existe con la ISA (alcance, residual,
// limitaciones). Conserva el valor elegido si sigue existiendo. Solo toca el
// DOM: no escribe en S.
function riskOptsSync() {
  const rd = S.riskData || {};
  const metodo = riskMetodo(rd);
  const isa = metodo === 'isa2';
  const o = RISK_OPTS[metodo] || RISK_OPTS.isa2;
  // Sin opciones todavía (antes del primer restoreUI) el valor vigente es el
  // de S: leer el del <select> vacío borraría lo cargado.
  const fill = (id, list, first, sVal) => {
    const sel = document.getElementById(id); if (!sel) return;
    const v = sel.options.length ? sel.value : (sVal || '');
    sel.innerHTML = `<option value="">${esc(first)}</option>` +
      list.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
    sel.value = v;
    if (sel._cselBtn) syncCsel(sel);
  };
  fill('risk-fail-prob',    o.failureProbability, '— Seleccionar —', rd.failureProbability);
  fill('risk-impact-prob',  o.impactProbability,  '— Seleccionar —', rd.impactProbability);
  fill('risk-consequences', o.consequences,       '— Seleccionar —', rd.consequences);
  fill('risk-res-fail',   RISK_OPTS.isa2.failureProbability, '— Seleccionar —', rd.resFailure);
  fill('risk-res-impact', RISK_OPTS.isa2.impactProbability,  '— Igual que ahora —', rd.resImpact);
  fill('risk-res-cons',   RISK_OPTS.isa2.consequences,       '— Igual que ahora —', rd.resConsequences);
  const leg = document.getElementById('risk-legacy');
  if (leg) leg.hidden = isa;
  document.querySelectorAll('#section-risk-analysis .risk-isa').forEach(el => { el.hidden = !isa; });
  const t = document.getElementById('risk-eval-title');
  if (t) t.textContent = isa ? 'Evaluación de Riesgo (metodología ISA)' : 'Evaluación de Riesgo (matriz anterior)';
  const pz = isa ? riskPlazoTxt(rd.plazo || '12') : '';
  document.querySelectorAll('.risk-plazo-txt').forEach(el => { el.textContent = pz ? `(en ${pz})` : ''; });
}

// Chips de "Técnicas usadas" (selección múltiple).
function riskTecnicasRender() {
  const cont = document.getElementById('risk-tecnicas');
  if (!cont) return;
  const sel = (S.riskData && Array.isArray(S.riskData.tecnicas)) ? S.riskData.tecnicas : [];
  cont.innerHTML = RISK_TECNICAS.map(([k, l]) => {
    const on = sel.indexOf(k) >= 0;
    return `<button type="button" class="cobro-b${on ? ' on' : ''}" aria-pressed="${on}" onclick="riskTecToggle('${k}')">${esc(l)}</button>`;
  }).join('');
}

function riskTecToggle(k) {
  if (!RISK_TECNICAS.some(t => t[0] === k)) return;
  if (!S.riskData) normalizeRiskData();
  const arr = Array.isArray(S.riskData.tecnicas) ? S.riskData.tecnicas : (S.riskData.tecnicas = []);
  const i = arr.indexOf(k);
  if (i >= 0) arr.splice(i, 1); else arr.push(k);
  // La inspección aérea es lo que hace "avanzada" a una evaluación (Nivel 3
  // de la ISA): si el nivel quedó vacío o más bajo, se ajusta solo.
  if (k === 'aerea' && i < 0 && S.riskData.nivel !== '3') {
    S.riskData.nivel = '3';
    sv('risk-nivel', '3');
    const ns = document.getElementById('risk-nivel'); if (ns && ns._cselBtn) syncCsel(ns);
    toast('Con inspección aérea la evaluación es de Nivel 3 (avanzada)', 'info', 2600);
  }
  riskTecnicasRender();
  sched();
}

// Un informe hecho con la matriz anterior pasa a la de la ISA. Las opciones
// de impacto se corren un escalón (la "Media" vieja era uso ocasional, que en
// la ISA es "Baja"); la "Alta" vieja juntaba frecuente y constante, así que se
// vacía para que el usuario elija. "Catastróficas" no existe en la ISA: pasa a
// "Severas", que ya incluye la muerte.
function riskPasarAIsa() {
  const rd = S.riskData; if (!rd) return;
  const mapI = { baja:'muybaja', media:'baja', alta:'' };
  rd.impactProbability = mapI[rd.impactProbability] !== undefined ? mapI[rd.impactProbability] : '';
  if (rd.consequences === 'catastroficas') rd.consequences = 'severas';
  rd.metodo = 'isa2';
  riskOptsSync();
  sv('risk-fail-prob', rd.failureProbability || '');
  sv('risk-impact-prob', rd.impactProbability || '');
  sv('risk-consequences', rd.consequences || '');
  refreshCustomSelects(document.getElementById('section-risk-analysis'));
  riskTecnicasRender();
  updateRiskLevelDisplay();
  sched();
  if (typeof editorShellSync === 'function') editorShellSync();
  toast(rd.impactProbability
    ? 'Listo: el informe usa la matriz de la ISA. Revisá los tres campos de la evaluación.'
    : 'Listo: el informe usa la matriz de la ISA. Elegí de nuevo la probabilidad de impacto: ahora tiene 4 niveles.',
    'ok', 6000);
}

// ─── RIESGO: DEFECTOS ────────────────────────
function addRiskDefect() {
  if (!S.riskData) normalizeRiskData();
  if (!Array.isArray(S.riskData.defects)) S.riskData.defects = [];
  S.riskData.defects.push({ type:'', location:'', desc:'', altura:'', orient:'', photos:[] });
  renderRiskDefects();
  sched();
}

function removeRiskDefect(idx) {
  if (!S.riskData || !S.riskData.defects) return;
  S.riskData.defects.splice(idx, 1);
  renderRiskDefects();
  sched();
}

function syncDefect(idx, field, value) {
  if (!S.riskData || !S.riskData.defects || !S.riskData.defects[idx]) return;
  S.riskData.defects[idx][field] = value;
  sched();
}

// Foto(s) de un defecto: la cavidad o la grieta vista en altura.
function pickRiskDefectPhoto(idx) {
  _pickPhotos(ref => {
    const d = S.riskData && S.riskData.defects && S.riskData.defects[idx];
    if (!d) return false;
    if (!Array.isArray(d.photos)) d.photos = [];
    d.photos.push(ref);
    return true;
  }, renderRiskDefects, 'al defecto');
}

function removeRiskDefectPhoto(idx, pi) {
  const d = S.riskData && S.riskData.defects && S.riskData.defects[idx];
  if (!d || !Array.isArray(d.photos) || pi < 0 || pi >= d.photos.length) return;
  d.photos.splice(pi, 1);
}

function renderRiskDefects() {
  const container = document.getElementById('risk-defects-list');
  if (!container) return;
  const defects = riskDefectList(S);
  if (!defects.length) {
    container.innerHTML = `<div class="risk-defect-empty">Sin defectos registrados. Usá el botón para agregar.</div>`;
    return;
  }
  const opts = (list, v, ocultos) => list
    .filter(([k]) => !(ocultos && ocultos.indexOf(k) >= 0 && k !== v))
    .map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
  container.innerHTML = defects.map((d, i) => {
    const refs = Array.isArray(d.photos) ? d.photos.filter(Boolean) : [];
    return `
    <div class="risk-defect-row" data-idx="${i}">
      <div class="risk-defect-header">
        <span class="risk-defect-num">Defecto ${i+1}</span>
        <button class="btn btn-xs btn-d" onclick="removeRiskDefect(${i})">✕ Eliminar</button>
      </div>
      <div class="risk-defect-fields">
        <div class="fg">
          <label>Tipo de defecto</label>
          <select onchange="syncDefect(${i},'type',this.value)">
            <option value="">— Seleccionar —</option>
            ${opts(RISK_DEFECT_TYPES, d.type, RISK_DEFECT_OCULTOS)}
          </select>
        </div>
        <div class="fg">
          <label>Ubicación en el árbol</label>
          <select onchange="syncDefect(${i},'location',this.value)">
            <option value="">— Seleccionar —</option>
            ${opts(RISK_DEFECT_LOC, d.location)}
          </select>
        </div>
        <div class="fg">
          <label>Altura (m)</label>
          <input type="text" inputmode="decimal" placeholder="Ej: 9" value="${esc(d.altura || '')}" oninput="syncDefect(${i},'altura',this.value)">
        </div>
        <div class="fg">
          <label>Orientación</label>
          <select onchange="syncDefect(${i},'orient',this.value)">
            <option value="">—</option>
            ${RISK_ORIENT.map(k => `<option value="${k}"${k === d.orient ? ' selected' : ''}>${k}</option>`).join('')}
          </select>
        </div>
        <div class="fg fg-full">
          <label>Descripción</label>
          <textarea rows="2" placeholder="Detalle del defecto observado…" oninput="syncDefect(${i},'desc',this.value)">${esc(d.desc||'')}</textarea>
        </div>
        <div class="fg fg-full">
          <button type="button" class="btn btn-g btn-sm" onclick="pickRiskDefectPhoto(${i})">${refs.length ? `${icon('camera')} Fotos ✓ (${refs.length})` : `${icon('camera')} Foto del defecto`}</button>
          ${photoGalleryHTML(refs)}
        </div>
      </div>
    </div>`;
  }).join('');
  container.querySelectorAll('.risk-defect-row').forEach(row => {
    const i = parseInt(row.dataset.idx, 10);
    wireItemPhotoGallery(row, pi => removeRiskDefectPhoto(i, pi), renderRiskDefects);
  });
  if (typeof enhanceSelects === 'function') enhanceSelects(container);
}

// ─── RIESGO: NIVEL CALCULADO ─────────────────
function _riskBadgeHTML(level, txt) {
  const color = RISK_COLORS[level] || '#374151';
  const label = RISK_LABELS.riskLevel[level] || String(level).toUpperCase();
  return `<div class="risk-level-badge" style="background:${color}20;border:2px solid ${color};color:${color}">
      <span class="risk-level-icon"><span class="ic-dot lvl-${level==='extremo'||level==='alto'||level==='moderado'?level:'bajo'}"></span></span>
      <span class="risk-level-text">${txt}: <strong>${label}</strong></span>
    </div>`;
}

function updateRiskLevelDisplay() {
  const el = document.getElementById('risk-level-display');
  if (!el) return;
  const rd = S.riskData || {};
  const ev = riskEval(rd);
  const isa = ev.metodo === 'isa2';
  document.querySelectorAll('.risk-plazo-txt').forEach(x => {
    const pz = isa ? riskPlazoTxt(rd.plazo || '12') : '';
    x.textContent = pz ? `(en ${pz})` : '';
  });
  if (!ev.nivel) {
    el.innerHTML = `<span class="risk-level-pending">Completar los tres campos de evaluación para calcular el nivel de riesgo</span>`;
  } else {
    el.innerHTML = _riskBadgeHTML(ev.nivel, 'Nivel de Riesgo') +
      (ev.combinada ? `<div class="risk-level-sub">Probabilidad de falla e impacto: <strong>${esc(RISK_LABELS.combinada[ev.combinada])}</strong></div>` : '') +
      (isa ? `<div class="risk-level-sub">${esc(RISK_SIGNIFICA[ev.nivel] || '')}</div>` : '');
  }
  const res = document.getElementById('risk-residual-display');
  if (!res) return;
  if (!isa || !ev.nivel) { res.innerHTML = ''; return; }
  res.innerHTML = ev.residual
    ? `<div class="risk-res-row">${_riskBadgeHTML(ev.nivel, 'Hoy')}<span class="risk-res-arrow" aria-hidden="true">→</span>${_riskBadgeHTML(ev.residual, 'Después del trabajo')}</div>`
    : `<span class="risk-level-pending">Elegí la probabilidad de falla después del trabajo para mostrar el riesgo residual.</span>`;
}

// ─── DATES ───────────────────────────────────
function calcExpiry() {
  if (!S.dateIssue) return;
  const d = new Date(S.dateIssue+'T00:00:00');
  d.setDate(d.getDate()+(S.validityDays||30));
  S.dateExpiry = toLocalISODate(d);
  sv('date-expiry', S.dateExpiry);
  { const e = document.getElementById('date-expiry'); if (e && e._cdateBtn) syncCdate(e); }
}

// Aplica el tachado de "vencimiento oculto" al display propio (o al input
// nativo de fallback si todavía no se enhanceó, p. ej. en el primer restoreUI).
function _applyExpiryStrike(strike){
  const fi = document.getElementById('date-expiry');
  if (!fi) return;
  (fi._cdateBtn || fi).style.textDecoration = strike ? 'line-through' : '';
}

function onDateChange() {
  S.dateIssue = gv('date-issue');
  calcExpiry();
  sched();
}

// Auto-actualiza la fecha de emisión al día de hoy SOLO si no hay nada en
// edición (presupuesto en blanco). La fecha vive en localStorage y quedaba
// congelada en el día en que se creó el borrador vacío: si el usuario abría la
// app días después sin tocar "Nuevo", el presupuesto arrancaba con una fecha
// pasada. Cuando ya hay datos cargados NO se toca (esa fecha es intencional).
// Devuelve true si actualizó algo. Se llama al abrir la app y al volver del
// segundo plano (visibilitychange). `noSync` evita disparar un guardado
// espurio: la fecha de un borrador vacío no vale la pena persistir sola.
function refreshIssueDateIfBlank() {
  if (typeof isBlankQuote !== 'function' || !isBlankQuote()) return false;
  const hoy = today();
  if (S.dateIssue === hoy) return false;
  S.dateIssue = hoy;
  sv('date-issue', S.dateIssue);
  { const e = document.getElementById('date-issue'); if (e && e._cdateBtn) syncCdate(e); }
  calcExpiry();
  return true;
}

function onValidityChange() {
  S.validityDays = parseInt(gv('validity-days')) || 30;
  calcExpiry();
  sched();
}

function onShowExpiryChange() {
  S.showExpiry = gc('show-expiry');
  const fg = document.getElementById('expiry-fg');
  if (fg) fg.style.opacity = S.showExpiry ? '1' : '0.4';
  _applyExpiryStrike(!S.showExpiry);
  sched();
}

// ─── NUMERACIÓN ──────────────────────────────
function mkQN() { return (S.numPrefix||'2026-')+String(S.numNext||1).padStart(4,'0'); }

function updateNumPreview() {
  sv('num-preview', gv('num-prefix')+String(parseInt(gv('num-next'))||1).padStart(4,'0'));
}

function applyNumConfig() {
  S.numPrefix   = gv('num-prefix');
  S.numNext     = parseInt(gv('num-next'))||1;
  S.quoteNumber = mkQN();
  sv('quote-number', S.quoteNumber);
  sched();
}

// ─── COLOR ───────────────────────────────────
// Aplica el color de marca a la UI de pantalla. Además del --accent
// derivamos un --accent-light coherente (tinte claro usado en hovers,
// chips, badges y fondos suaves) para que al elegir un color que NO sea
// el verde por defecto la interfaz no quede con restos verdes.
// Para el verde por defecto se conserva el mint original del CSS.
function applyAccent(c) {
  const root = document.documentElement.style;
  const rgb = _hexToRgb(c);
  const isDefault = String(c).toLowerCase() === '#064e3b';
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  // Para el verde por defecto se quitan TODOS los overrides y rigen los
  // valores de :root / [data-theme=dark] (look idéntico al original en cada
  // tema). Para cualquier otro color se derivan tonos coherentes — y en modo
  // oscuro el acento como texto se aclara (--accent-fg) y el tinte mezcla
  // hacia la card, para que se lea bien sobre fondo oscuro.
  if (rgb && !isDefault) {
    const [r, g, b] = rgb;
    root.setProperty('--accent', c);
    root.setProperty('--accent-rgb', `${r},${g},${b}`);
    if (dark) {
      root.setProperty('--accent-fg',    _mixWhite(r, g, b, 0.5));
      root.setProperty('--accent-light', _mix(r, g, b, 26, 35, 30, 0.82));
      root.setProperty('--accent-dark',  _mixWhite(r, g, b, 0.12));
      root.setProperty('--accent-2',     _mixWhite(r, g, b, 0.28));
    } else {
      root.setProperty('--accent-fg',    c);
      root.setProperty('--accent-light', _mixWhite(r, g, b, 0.88));
      root.setProperty('--accent-dark',  _mixBlack(r, g, b, 0.18));
      root.setProperty('--accent-2',     _mixWhite(r, g, b, 0.25));
    }
  } else {
    ['--accent', '--accent-rgb', '--accent-fg', '--accent-light', '--accent-dark', '--accent-2']
      .forEach(v => root.removeProperty(v));
  }
}

// ─── MODO OSCURO ──────────────────────────────────────────────────────
// Tema de la UI de pantalla (el PDF/documento siempre va en claro). Tres
// modos: 'auto' (sigue el sistema), 'light', 'dark'. Se persiste por
// dispositivo en LS.THEME. applyTheme re-deriva los tonos del acento para
// el tema activo (colores personalizados) y refleja el selector.
function _prefersDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
function _effectiveDark(mode) {
  return mode === 'dark' || (mode === 'auto' && _prefersDark());
}
function applyTheme(mode) {
  mode = (mode === 'light' || mode === 'dark') ? mode : 'auto';
  S.themeMode = mode;
  const dark = _effectiveDark(mode);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  // Recalcular los tonos del acento para el tema activo (no afecta al verde
  // por defecto, que usa los valores de CSS).
  if (S.accentColor) applyAccent(S.accentColor);
  document.querySelectorAll('.theme-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  try { localStorage.setItem(LS.THEME, mode); } catch (_) {}
}
function setThemeMode(mode) { applyTheme(mode); }
function _hexToRgb(c) {
  let h = String(c).replace('#', '');
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function _mixWhite(r, g, b, t) {
  const m = v => Math.round(v * (1 - t) + 255 * t);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
function _mixBlack(r, g, b, t) {
  const m = v => Math.round(v * (1 - t));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
// Mezcla un color (r,g,b) hacia otro color destino (R,G,B) en proporción t.
function _mix(r, g, b, R, G, B, t) {
  const m = (a, z) => Math.round(a * (1 - t) + z * t);
  return `rgb(${m(r, R)},${m(g, G)},${m(b, B)})`;
}

// Aplica un color de acento. `reposition` mueve el cursor del selector propio
// a ese color (true cuando el cambio viene de afuera: preset, campo hexa, carga;
// false durante el arrastre, para que el punto no "salte" por redondeos HSV).
function _setAccentColor(c, reposition) {
  c = safeColor(c);
  S.accentColor = c;
  applyAccent(c);
  const hx = document.getElementById('cpk-hex'); if(hx && hx.value.toLowerCase() !== c) hx.value = c;
  const pv = document.getElementById('cpk-preview'); if(pv) pv.style.background = c;
  document.querySelectorAll('#color-presets .cpreset').forEach(el=>el.classList.toggle('active', String(el.dataset.color).toLowerCase()===c.toLowerCase()));
  if (reposition) _cpkSetFromHex(c);
  // El color de detalle "igual al principal" y los monogramas de muestra se
  // pintan con el principal (v244).
  if (typeof estiloUISync === 'function') estiloUISync(false);
  sched();
}

function applyColor(c) { _setAccentColor(c, true); }
function selectColor(el) { applyColor(el.dataset.color); }

// ─── COLORES RÁPIDOS PERSONALIZADOS ───────────────────────────────
// El usuario puede guardar colores propios (de la paleta) en la fila de
// selección rápida. Viven en S.customColors (se persisten con el resto del
// estado). OJO: S es copia superficial de DEF, así que SIEMPRE reasignamos
// el array (concat/filter), nunca push, para no contaminar DEF.customColors.
function addCurrentColor() {
  const c = safeColor(S.accentColor);
  const exists = Array.prototype.some.call(
    document.querySelectorAll('#color-presets .cpreset[data-color]'),
    el => String(el.dataset.color).toLowerCase() === c.toLowerCase());
  if (exists) { toast('Ese color ya está en la selección rápida.', 'info'); return; }
  if ((S.customColors || []).length >= 12) { toast('Llegaste al máximo de 12 colores guardados.', 'info'); return; }
  S.customColors = (S.customColors || []).concat([c]);
  renderCustomColors();
  saveLS();   // acción deliberada: persistir ya (sin esperar el debounce)
  toast('Color agregado a la selección rápida.', 'ok');
}
function removeCustomColor(c) {
  S.customColors = (S.customColors || []).filter(x => String(x).toLowerCase() !== String(c).toLowerCase());
  renderCustomColors();
  saveLS();   // acción deliberada: persistir ya (sin esperar el debounce)
}
async function _confirmRemoveColor(c) {
  const ok = await confirmDlg('Quitar color', '¿Quitar este color de la selección rápida?', 'Quitar', 'btn-d');
  if (ok) { removeCustomColor(c); toast('Color quitado.', 'info'); }
}
// Re-dibuja los chips personalizados (antes del botón "+"). Cada chip se
// selecciona con un toque y se quita manteniéndolo presionado (long-press).
function renderCustomColors() {
  const row = document.getElementById('color-presets'); if (!row) return;
  Array.prototype.forEach.call(row.querySelectorAll('.cpreset-custom'), n => n.remove());
  const addBtn = document.getElementById('cpreset-add');
  const cur = String(S.accentColor || '').toLowerCase();
  (S.customColors || []).forEach(c => {
    const el = document.createElement('div');
    el.className = 'cpreset cpreset-custom' + (String(c).toLowerCase() === cur ? ' active' : '');
    el.dataset.color = c;
    el.style.background = c;
    el.title = c + ' · mantené presionado para quitar';
    let lpTimer = null, lpFired = false;
    const startLP = () => { lpFired = false; lpTimer = setTimeout(() => { lpFired = true; _confirmRemoveColor(c); }, 550); };
    const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
    el.addEventListener('pointerdown', startLP);
    el.addEventListener('pointerup', cancelLP);
    el.addEventListener('pointerleave', cancelLP);
    el.addEventListener('pointercancel', cancelLP);
    el.addEventListener('click', () => { if (lpFired) { lpFired = false; return; } selectColor(el); });
    if (addBtn) row.insertBefore(el, addBtn); else row.appendChild(el);
  });
}

// ─── SELECTOR DE COLOR PROPIO (HSV) ───────────────────────────────
// Reemplaza al <input type="color"> nativo (en muchos Android muestra barras
// negras confusas). Mantiene H/S/V como fuente de verdad del cursor.
const CPK = { h:160, s:80, v:30 };
let _cpkReady = false;

function _hsvToRgb(h, s, v) {
  s/=100; v/=100;
  const c = v*s, x = c*(1 - Math.abs((h/60)%2 - 1)), m = v - c;
  let r,g,b;
  if (h<60)      [r,g,b]=[c,x,0];
  else if (h<120)[r,g,b]=[x,c,0];
  else if (h<180)[r,g,b]=[0,c,x];
  else if (h<240)[r,g,b]=[0,x,c];
  else if (h<300)[r,g,b]=[x,0,c];
  else           [r,g,b]=[c,0,x];
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}
function _rgbToHsv(r, g, b) {
  r/=255; g/=255; b/=255;
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx-mn;
  let h = 0;
  if (d) {
    if (mx===r)      h = ((g-b)/d) % 6;
    else if (mx===g) h = (b-r)/d + 2;
    else             h = (r-g)/d + 4;
    h *= 60; if (h<0) h += 360;
  }
  return [h, (mx ? d/mx : 0)*100, mx*100];
}
function _hsvToHex(h, s, v) {
  const [r,g,b] = _hsvToRgb(h,s,v);
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}

// Repinta cursor del cuadro SV, pulgar del tono y fondo del cuadro.
function _cpkRender() {
  const sv = document.getElementById('cpk-sv');
  const dot = document.getElementById('cpk-sv-dot');
  const thumb = document.getElementById('cpk-hue-thumb');
  if (sv)  sv.style.background = `hsl(${CPK.h},100%,50%)`;
  if (dot) { dot.style.left = CPK.s + '%'; dot.style.top = (100 - CPK.v) + '%'; }
  if (thumb) thumb.style.left = (CPK.h/360*100) + '%';
}
// Posiciona el selector a partir de un color hexa (preset, campo, carga).
function _cpkSetFromHex(hex) {
  const rgb = _hexToRgb(hex); if (!rgb) return;
  const hsv = _rgbToHsv(rgb[0], rgb[1], rgb[2]);
  CPK.h = hsv[0]; CPK.s = hsv[1]; CPK.v = hsv[2];
  _cpkRender();
}
// Inicializa el selector una sola vez. Usa DELEGACIÓN en `document`: así los
// handlers sobreviven aunque el panel se reconstruya (los listeners no quedan
// atados a un nodo puntual) y el arrastre sigue aunque el dedo salga del área.
function _cpkInit() {
  if (_cpkReady) return;
  _cpkReady = true;
  let active = null;            // 'sv' | 'hue' mientras se arrastra
  const update = (clientX, clientY) => {
    const el = document.getElementById(active === 'sv' ? 'cpk-sv' : 'cpk-hue');
    if (!el) return;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top)  / r.height));
    if (active === 'sv') { CPK.s = Math.round(x*100); CPK.v = Math.round((1-y)*100); }
    else                 { CPK.h = Math.round(x*360); }
    _cpkRender();
    _setAccentColor(_hsvToHex(CPK.h, CPK.s, CPK.v), false);
  };
  document.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#cpk-sv'))       active = 'sv';
    else if (t.closest('#cpk-hue')) active = 'hue';
    else return;
    update(e.clientX, e.clientY);
    e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => { if (!active) return; update(e.clientX, e.clientY); e.preventDefault(); });
  const end = () => { active = null; };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  // Campo hexa (también por delegación).
  document.addEventListener('input', (e) => {
    if (!e.target || e.target.id !== 'cpk-hex') return;
    let v = e.target.value.trim(); if (v && v[0] !== '#') v = '#' + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) applyColor(v.toLowerCase());
  });
}

// ─── TEMA PDF ────────────────────────────────
function applyPdfTheme(theme) {
  S.pdfTheme = theme;
  document.querySelectorAll('.tpreset').forEach(el => el.classList.toggle('active', el.dataset.theme === theme));
  sched();
}

// Modificador "Compacto": densifica el documento (fuentes y paddings más
// chicos) para que los presupuestos con muchos ítems entren en menos páginas.
// Es ORTOGONAL al tema: se aplica como clase extra (pdoc-compact) y se combina
// con cualquier diseño.
function applyPdfCompact(on) {
  S.pdfCompact = !!on;
  sched();
}

// Selector de tipografía del documento. ORTOGONAL al tema: se aplica como clase
// extra (pdoc-font-X) y se combina con cualquier diseño. 'auto' = la tipografía
// la decide el diseño (sin clase). Ver fonts.css + .pdoc.pdoc-font-X en el CSS.
function applyPdfFont(font) {
  S.pdfFont = font;
  document.querySelectorAll('.fpreset').forEach(el => el.classList.toggle('active', el.dataset.font === font));
  sched();
}

// ─── ESTILO PROPIO (v244) ─────────────────────
// Colegas de la misma zona usan la app y le cotizan a los mismos clientes: con
// todo de fábrica, los PDF salían iguales salvo el nombre de arriba. Tres
// piezas para que eso no pase:
//   1. Más ejes de diseño ortogonales al tema: color de DETALLE
//      (S.accentColor2) y MONOGRAMA con las iniciales (S.pdfMono).
//   2. Juegos de textos (TEXTOS_JUEGOS): redacciones completas, y los de
//      fábrica de antes ('original') solo si se eligen a mano.
//   3. La MÁQUINA (estiloSortear/estiloAbrir): sortea diseño, colores,
//      tipografía, monograma y, si siguen de fábrica, los textos. Corre sola
//      la primera vez que se abre la app (estiloPrimeraVez) y se le ofrece UNA
//      vez a quien ya la tenía con el diseño de fábrica (estiloOfrecer).
// Regla: la máquina nunca pisa un texto que el usuario escribió
// (textoEsDeFabrica) y lo que cambia se puede deshacer ("Dejar como estaba").
const ESTILO_COLORES = [['#064e3b','Verde oscuro'],['#1e3a5f','Azul marino'],['#3b0764','Púrpura'],['#7c2d12','Rojo oscuro'],
  ['#713f12','Marrón'],['#164e63','Cian oscuro'],['#1c1917','Negro'],['#0369a1','Azul']];
const ESTILO_DETALLES = [['','Igual al principal'],['#b08d3c','Dorado'],['#c2410c','Terracota'],['#65a30d','Verde hoja'],
  ['#0891b2','Celeste'],['#94a3b8','Gris'],['#be123c','Bordó']];
const ESTILO_TEMA_LBL = { clasico:'Clásico', profesional:'Profesional', calido:'Cálido', minimalista:'Minimalista',
  lateral:'Lateral', tecnico:'Técnico', elegante:'Elegante' };
const ESTILO_FUENTE_LBL = { auto:'Según diseño', dm:'Clásico', plex:'IBM Plex', 'lora-inter':'Lora + Inter', inter:'Inter' };
const ESTILO_MONO_LBL = { ninguno:'Sin monograma', circulo:'Círculo', escudo:'Escudo', hoja:'Hoja', rombo:'Rombo', sello:'Sello' };
// Elementos del documento (v245): un eje por fila de chips en Estilo. `fuerte`
// marca las opciones que cargan la hoja de color; la máquina combina como
// mucho ESTILO_MAX_FUERTES para que el documento no salga recargado.
const ESTILO_ELEMENTOS = [
  { k:'pdfEncabezado', titulo:'Encabezado', opts:PDF_ENCABEZADOS, fuerte:['banda'],
    lbl:{ auto:'Según diseño', centrado:'Centrado', banda:'Banda de color' } },
  { k:'pdfTitulos', titulo:'Títulos', opts:PDF_TITULOS, fuerte:['pildora'],
    lbl:{ auto:'Según diseño', subrayado:'Subrayado', pildora:'Píldora', numerado:'Numerados', costado:'Línea al costado', versalitas:'Versalitas' } },
  { k:'pdfTabla', titulo:'Tabla', opts:PDF_TABLAS, fuerte:['cebra'],
    lbl:{ auto:'Según diseño', lineas:'Solo líneas', cebra:'Filas alternadas', grilla:'Con bordes' } },
  { k:'pdfTotal', titulo:'Total', opts:PDF_TOTALES, fuerte:['banda'],
    lbl:{ auto:'Según diseño', banda:'En banda', grande:'Número grande' } },
  { k:'pdfPie', titulo:'Pie', opts:PDF_PIES, fuerte:['franja'],
    lbl:{ auto:'Según diseño', franja:'Franja con contacto', eslogan:'Con eslogan' } },
  // Fondo (v246): cualquier dibujo carga la hoja, así que todos son "fuertes".
  { k:'pdfFondo', titulo:'Fondo', opts:PDF_FONDOS, fuerte:['hojas','curvas','veta','marca','logo'],
    lbl:{ auto:'Liso', hojas:'Hojas', curvas:'Curvas de nivel', veta:'Veta de madera', marca:'Marca con iniciales', logo:'Marca con el logo' } },
];
const ESTILO_MAX_FUERTES = 2;
const ESTILO_CAMPOS = ['pdfTheme','accentColor','accentColor2','pdfFont','pdfMono']
  .concat(ESTILO_ELEMENTOS.map(e => e.k));

// ¿El diseño es el de fábrica? (lo que tiene cualquiera que nunca entró a Estilo)
function estiloEsDeFabrica(s) {
  s = s || S;
  return (s.pdfTheme || 'clasico') === 'clasico'
    && String(s.accentColor || '#064e3b').toLowerCase() === '#064e3b'
    && (s.pdfFont || 'auto') === 'auto'
    && !s.accentColor2
    && (s.pdfMono || 'ninguno') === 'ninguno'
    && ESTILO_ELEMENTOS.every(e => (s[e.k] || 'auto') === 'auto');
}

// Un texto es "de fábrica" si coincide exacto con el de algún juego. Vacío no
// cuenta: un saludo borrado a propósito es una decisión del usuario.
function textoEsDeFabrica(campo, v) {
  if (typeof v !== 'string' || !v) return false;
  return Object.keys(TEXTOS_JUEGOS).some(k => TEXTOS_JUEGOS[k].t[campo] === v);
}
function textosHayDeFabrica() { return TEXTOS_CAMPOS.some(c => textoEsDeFabrica(c, S[c])); }
// Juego al que corresponden TODOS los textos actuales ('' si están mezclados o
// retocados).
function textosJuegoActual() {
  return Object.keys(TEXTOS_JUEGOS).find(k => TEXTOS_CAMPOS.every(c => S[c] === TEXTOS_JUEGOS[k].t[c])) || '';
}

// Copia del estilo y los textos actuales, para "Dejar como estaba" / Deshacer.
// Incluye el modo compacto y el eslogan, que también son parte de "cómo sale".
const ESTILO_FOTO_CAMPOS = ESTILO_CAMPOS.concat(['pdfCompact', 'pdfTransl', 'coEslogan'], TEXTOS_CAMPOS);
function _estiloFoto() {
  const f = {};
  ESTILO_FOTO_CAMPOS.forEach(k => { f[k] = S[k]; });
  return f;
}
function _estiloRestaurar(f) {
  if (!f) return;
  ESTILO_FOTO_CAMPOS.forEach(k => { if (k in f) S[k] = f[k]; });
  estiloUISync(true);
  sched();
}

// Lleva los textos de S a los campos de Empresa → Textos del PDF. Hace falta
// cada vez que se cambian desde código: syncFromUI (vista previa, guardado)
// lee de esos campos y, si quedaran los viejos, los volvería a escribir en S.
function _textosAlUI() {
  sv('doc-title', S.docTitle);
  sv('doc-title-est', S.docTitleEst);
  sv('doc-disclaimer', S.docDisclaimer);
  sv('doc-disclaimer-svc', S.docDisclaimerSvc);
  sv('doc-work-plan-title', S.workPlanTitle);
  sv('doc-greeting', S.docGreeting);
  sv('doc-criteria-title', S.docCriteriaTitle);
  sv('doc-criteria-intro', S.docCriteriaIntro);
  if (typeof renderLineList === 'function') {
    renderLineList('doc-work-plan-list');
    renderLineList('doc-criteria-list');
  }
}

// Aplica un juego de textos. Con `soloFabrica`, únicamente reemplaza los que
// siguen de fábrica (lo que usa la máquina); sin él, todos (elección a mano).
function _aplicarTextos(key, soloFabrica) {
  const j = TEXTOS_JUEGOS[key];
  if (!j) return;
  TEXTOS_CAMPOS.forEach(c => {
    if (!soloFabrica || textoEsDeFabrica(c, S[c])) S[c] = j.t[c];
  });
  _textosAlUI();
  textosJuegosSync();
}

// Chips de Empresa → Textos del PDF. El Original va último y con aclaración.
function textosJuegosSync() {
  const host = document.getElementById('textos-juegos');
  if (!host) return;
  const act = textosJuegoActual();
  host.innerHTML = Object.keys(TEXTOS_JUEGOS).map(k =>
    `<button type="button" class="nv-chip${k === act ? ' is-active' : ''}" data-juego="${k}" aria-pressed="${k === act}">${esc(TEXTOS_JUEGOS[k].label)}${k === 'original' ? ' (los de antes)' : ''}</button>`
  ).join('');
  host.querySelectorAll('[data-juego]').forEach(b => { b.onclick = () => elegirJuegoTextos(b.dataset.juego); });
}

// Elección a mano de un juego. Si había textos escritos por el usuario,
// confirma antes de reemplazarlos; siempre deja "Deshacer".
async function elegirJuegoTextos(key) {
  if (!TEXTOS_JUEGOS[key]) return;
  syncFromUI();
  const propios = TEXTOS_CAMPOS.some(c => S[c] && !textoEsDeFabrica(c, S[c]));
  if (propios) {
    const ok = await confirmDlg('¿Reemplazar tus textos?',
      `Los textos del documento que escribiste se reemplazan por el juego «${TEXTOS_JUEGOS[key].label}». Después podés retocarlos.`,
      'Reemplazar', 'btn-p');
    if (!ok) return;
  }
  const antes = _estiloFoto();
  _aplicarTextos(key, false);
  sched();
  toastAccion(`Textos: juego «${TEXTOS_JUEGOS[key].label}».`, [{ label:'Deshacer', fn:() => _estiloRestaurar(antes) }]);
}

// ── Controles de Estilo ──
function applyColor2(c) {
  S.accentColor2 = sanColor2(c);
  estiloUISync(false);
  sched();
}
// Recuadros translúcidos (v249): ver _docTranslucido.
function applyPdfTransl(on) {
  S.pdfTransl = !!on;
  sched();
}
function applyPdfMono(m) {
  S.pdfMono = sanEnum(m, PDF_MONOS, 'ninguno');
  estiloUISync(false);
  sched();
}
function applyElemento(k, v) {
  const e = ESTILO_ELEMENTOS.find(x => x.k === k);
  if (!e) return;
  S[k] = sanEnum(v, e.opts, 'auto');
  estiloUISync(false);
  sched();
}
// El aviso "sin eslogan sale el pie de siempre" depende de lo que se escribe.
function estiloEsloganInput() {
  S.coEslogan = gv('co-eslogan').slice(0, 120);
  estiloUISync(false);
  sched();
}

// Repinta todo lo de Estilo que depende de estos campos. `todo` además
// reposiciona los controles que ya existían (tema, color, tipografía) y los
// textos: hace falta cuando el cambio vino de la máquina o de un Deshacer.
function estiloUISync(todo) {
  if (todo) {
    document.querySelectorAll('.tpreset').forEach(el => el.classList.toggle('active', el.dataset.theme === S.pdfTheme));
    document.querySelectorAll('.fpreset[data-font]').forEach(el => el.classList.toggle('active', el.dataset.font === (S.pdfFont || 'auto')));
    // Lo mismo que _setAccentColor, sin su sched() (y sin volver a llamar acá):
    // solo repintar.
    const c = safeColor(S.accentColor);
    applyAccent(c);
    const hx = document.getElementById('cpk-hex'); if (hx) hx.value = c;
    const pv = document.getElementById('cpk-preview'); if (pv) pv.style.background = c;
    document.querySelectorAll('#color-presets .cpreset').forEach(el => el.classList.toggle('active', String(el.dataset.color || '').toLowerCase() === c.toLowerCase()));
    if (typeof _cpkSetFromHex === 'function') _cpkSetFromHex(c);
    const cmp = document.getElementById('pdf-compact'); if (cmp) cmp.checked = !!S.pdfCompact;
    const trl = document.getElementById('pdf-transl'); if (trl) trl.checked = !!S.pdfTransl;
    sv('co-eslogan', S.coEslogan || '');
    _textosAlUI();
  }
  const det = sanColor2(S.accentColor2);
  const h2 = document.getElementById('color2-presets');
  if (h2) {
    h2.style.setProperty('--cp-main', safeColor(S.accentColor));
    h2.innerHTML = ESTILO_DETALLES.map(([c, n]) => c
      ? `<button type="button" class="cpreset${det.toLowerCase() === c ? ' active' : ''}" style="background:${c}" title="${n}" aria-label="${n}" data-color2="${c}"></button>`
      : `<button type="button" class="cpreset cpreset-igual${!det ? ' active' : ''}" title="${n}" aria-label="${n}" data-color2=""></button>`
    ).join('');
    h2.querySelectorAll('[data-color2]').forEach(b => { b.onclick = () => applyColor2(b.dataset.color2); });
  }
  const hm = document.getElementById('mono-presets');
  if (hm) {
    const nombre = S.coName || 'Mi negocio';
    const col = safeColor(S.accentColor);
    hm.innerHTML = PDF_MONOS.map(m => `<button type="button" class="fpreset mpreset${(S.pdfMono || 'ninguno') === m ? ' active' : ''}" data-mono="${m}">`
      + (m === 'ninguno' ? '<span class="mpreset-none">—</span>' : _monoSVG(m, nombre, col, '#ffffff', ''))
      + `<span class="fpreset-label">${ESTILO_MONO_LBL[m]}</span></button>`).join('');
    hm.querySelectorAll('[data-mono]').forEach(b => { b.onclick = () => applyPdfMono(b.dataset.mono); });
  }
  const mh = document.getElementById('mono-hint');
  if (mh) mh.textContent = S.logo
    ? 'Tenés un logo cargado: el documento usa el logo. El monograma sale si lo quitás.'
    : (S.coName ? 'Una marca con las iniciales de tu negocio en el encabezado, para cuando no tenés logo.'
                : 'Una marca con las iniciales de tu negocio. Cargá el nombre en Mi negocio para verla.');
  ESTILO_ELEMENTOS.forEach(e => {
    const host = document.getElementById('el-' + e.k);
    if (!host) return;
    const act = sanEnum(S[e.k], e.opts, 'auto');
    host.innerHTML = e.opts.filter(o => o !== 'logo' || S.logo || o === act).map(o => `<button type="button" class="nv-chip${o === act ? ' is-active' : ''}" data-el="${o}" aria-pressed="${o === act}">${esc(e.lbl[o])}</button>`).join('');
    host.querySelectorAll('[data-el]').forEach(b => { b.onclick = () => applyElemento(e.k, b.dataset.el); });
  });
  const pista = (k, txt) => { const h = document.getElementById('el-hint-' + k); if (h) { h.textContent = txt; h.hidden = !txt; } };
  pista('pdfEncabezado', S.pdfTheme === 'lateral' && S.pdfEncabezado !== 'auto'
    ? 'El diseño Lateral tiene su propio encabezado: esta opción se aplica con los otros diseños.' : '');
  pista('pdfTitulos', S.pdfTitulos === 'numerado' ? 'El informe de riesgo ya numera sus secciones: ahí salen como siempre.' : '');
  pista('pdfTabla', '');
  const ht = document.getElementById('pdf-transl-hint');
  if (ht) ht.textContent = (S.pdfFondo || 'auto') === 'auto'
    ? 'Se nota cuando hay un fondo o una marca de agua.'
    : 'Los recuadros claros (cliente, plan, criterios, cómo pagar y vigencia) dejan ver un poco el fondo. Los de color fuerte quedan como están.';
  pista('pdfFondo', S.pdfFondo === 'marca' && !(S.coName || '').trim()
    ? 'La marca de agua usa las iniciales del negocio: cargá el nombre en Mi negocio para que aparezca.'
    : S.pdfFondo === 'logo' && !S.logo
    ? 'Para la marca con el logo, cargá tu logo en Mi negocio (mejor un PNG con fondo transparente).'
    : 'Un dibujo muy suave del color principal detrás de la hoja. Las marcas de agua (con tus iniciales o con tu logo) salen en grande, detrás de la primera hoja.');
  pista('pdfTotal', '');
  pista('pdfPie', S.pdfPie === 'eslogan' && !(S.coEslogan || '').trim() ? 'Escribí tu eslogan acá abajo; mientras tanto sale el pie de siempre.'
    : (S.pdfPie !== 'auto' && S.showFooter === false ? 'El pie está apagado en Textos del PDF → Visibilidad.' : ''));
  const fab = document.getElementById('estilo-fabrica');
  if (fab) fab.hidden = !estiloEsDeFabrica();
  textosJuegosSync();
  estilosGuardadosRender();
}

// ── La máquina ──
function _azar(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
// Sortea un estilo. Nunca sale el de fábrica (el monograma siempre tiene
// forma) y el juego de textos nunca es el 'original' (TEXTOS_JUEGOS_AZAR).
function estiloSortear(conTextos) {
  const r = {
    pdfTheme:     _azar(PDF_THEMES),
    accentColor:  _azar(ESTILO_COLORES)[0],
    accentColor2: _azar(ESTILO_DETALLES)[0],
    pdfFont:      _azar(PDF_FONTS),
    pdfMono:      _azar(PDF_MONOS.filter(m => m !== 'ninguno')),
  };
  // Elementos: al azar, con a lo sumo ESTILO_MAX_FUERTES de los que cargan
  // color. El tema Lateral trae su encabezado, y el pie con eslogan solo si
  // hay una frase escrita.
  for (let i = 0; i < 50; i++) {
    ESTILO_ELEMENTOS.forEach(e => {
      let opts = e.opts;
      if (e.k === 'pdfEncabezado' && r.pdfTheme === 'lateral') opts = ['auto'];
      if (e.k === 'pdfPie' && !(S.coEslogan || '').trim()) opts = opts.filter(o => o !== 'eslogan');
      // Fondo: la mitad de las veces liso (un dibujo en cada tirada cansa), y
      // la marca de agua solo si hay nombre del que sacar las iniciales.
      if (e.k === 'pdfFondo') {
        const dibujos = opts.filter(o => o !== 'auto' && (o !== 'marca' || (S.coName || '').trim()) && (o !== 'logo' || S.logo));
        r[e.k] = Math.random() < .5 ? 'auto' : _azar(dibujos);
        return;
      }
      r[e.k] = _azar(opts);
    });
    if (estiloFuertes(r) <= ESTILO_MAX_FUERTES) break;
  }
  if (conTextos) r.juego = _azar(TEXTOS_JUEGOS_AZAR);
  return r;
}
function estiloFuertes(r) {
  return ESTILO_ELEMENTOS.filter(e => e.fuerte.includes(r[e.k])).length;
}
function _estiloAplicar(r) {
  ESTILO_CAMPOS.forEach(k => { if (k in r) S[k] = r[k]; });
  if (r.juego) _aplicarTextos(r.juego, true);
  estiloUISync(true);
  sched();
}

// Los rodillos frenan de a uno cada ESTILO_REEL_PASO ms (11 rodillos: < 2 s).
const ESTILO_REEL_PASO = 130;
let _estiloPrevio = null;
let _estiloTimers = [];
const _ESTILO_REELS = [
  ['pdfTheme',     'Diseño',     () => PDF_THEMES.map(t => ESTILO_TEMA_LBL[t])],
  ['accentColor',  'Color',      () => ESTILO_COLORES.map(c => c[1])],
  ['accentColor2', 'Detalle',    () => ESTILO_DETALLES.map(c => c[1])],
  ['pdfFont',      'Tipografía', () => PDF_FONTS.map(f => ESTILO_FUENTE_LBL[f])],
  ['pdfMono',      'Monograma',  () => PDF_MONOS.map(m => ESTILO_MONO_LBL[m])],
  ...ESTILO_ELEMENTOS.map(e => [e.k, e.titulo, () => e.opts.map(o => e.lbl[o])]),
  ['textos',       'Textos',     () => Object.keys(TEXTOS_JUEGOS).map(k => TEXTOS_JUEGOS[k].label)],
];
function _estiloValorReel(k) {
  const dot = c => `<span class="estilo-dot" style="background:${safeColor(c)}"></span>`;
  if (k === 'pdfTheme') return esc(ESTILO_TEMA_LBL[S.pdfTheme] || S.pdfTheme);
  if (k === 'accentColor') {
    const c = safeColor(S.accentColor), n = (ESTILO_COLORES.find(x => x[0] === c.toLowerCase()) || [c, 'Propio'])[1];
    return dot(c) + esc(n);
  }
  if (k === 'accentColor2') {
    const c = sanColor2(S.accentColor2);
    if (!c) return 'Igual al principal';
    return dot(c) + esc((ESTILO_DETALLES.find(x => x[0] === c.toLowerCase()) || [c, 'Propio'])[1]);
  }
  if (k === 'pdfFont') return esc(ESTILO_FUENTE_LBL[S.pdfFont || 'auto'] || S.pdfFont);
  if (k === 'pdfMono') return esc(ESTILO_MONO_LBL[S.pdfMono || 'ninguno']) + (S.logo ? ' (usás tu logo)' : '');
  const el = ESTILO_ELEMENTOS.find(e => e.k === k);
  if (el) return esc(el.lbl[sanEnum(S[k], el.opts, 'auto')]);
  const j = textosJuegoActual();
  return j ? esc(TEXTOS_JUEGOS[j].label) : 'Los tuyos';
}
// Dibuja los rodillos: giran mostrando opciones y frenan de a uno en el valor
// que quedó en S. Sin animación si el sistema pide movimiento reducido.
function _estiloReels(animar) {
  const host = document.getElementById('estilo-reels');
  if (!host) return;
  _estiloTimers.forEach(t => clearInterval(t));
  _estiloTimers = [];
  const quieto = !animar || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  host.innerHTML = _ESTILO_REELS.map(([k, l]) =>
    `<div class="estilo-reel${quieto ? ' listo' : ''}" data-k="${k}"><span class="estilo-reel-l">${l}</span><span class="estilo-reel-v">${quieto ? _estiloValorReel(k) : '…'}</span></div>`
  ).join('');
  if (quieto) return;
  [...host.children].forEach((row, i) => {
    const [k, , opciones] = _ESTILO_REELS[i];
    const v = row.querySelector('.estilo-reel-v');
    const lista = opciones();
    const t = setInterval(() => { v.textContent = _azar(lista); }, 70);
    _estiloTimers.push(t);
    setTimeout(() => {
      clearInterval(t);
      v.innerHTML = _estiloValorReel(k);
      row.classList.add('listo');
    }, 420 + i * ESTILO_REEL_PASO);
  });
}

// Abre la máquina. opts.tirar: sortea al abrir (Sorprendeme, oferta); sin él
// muestra lo que ya hay (el "Ver" del aviso de la primera vez). opts.textos:
// arranca con "cambiar también los textos" tildado.
function estiloAbrir(opts) {
  opts = opts || {};
  try { syncFromUI(); } catch (_) {}
  _estiloPrevio = _estiloFoto();
  const hayFab = textosHayDeFabrica();
  const row = document.getElementById('estilo-textos-row');
  const chk = document.getElementById('estilo-textos');
  if (row) row.style.display = hayFab ? '' : 'none';
  if (chk) chk.checked = hayFab && !!opts.textos;
  const tit = document.getElementById('estilo-title');
  if (tit) tit.textContent = opts.tirar ? 'Armando tu estilo…' : 'Tu estilo';
  const ov = document.getElementById('estilo-overlay');
  if (ov) ov.classList.add('open');
  // Antes de sortear, lo que había queda como "El anterior" (si no estaba ya
  // guardado): probar no puede costar el estilo que te gustaba.
  if (opts.tirar) { _estiloGuardarAnterior(_estiloDatosActuales()); estiloTirar(); }
  else _estiloReels(true);
}
function estiloTirar() {
  const chk = document.getElementById('estilo-textos');
  const r = estiloSortear(!!(chk && chk.checked));
  _estiloAplicar(r);
  _estiloReels(true);
  const tit = document.getElementById('estilo-title');
  if (tit) setTimeout(() => { tit.textContent = 'Tu estilo'; }, 420 + _ESTILO_REELS.length * ESTILO_REEL_PASO);
}
// Tildar = sortear un juego para los textos de fábrica; destildar = volver a
// los textos que había al abrir.
function estiloTextosToggle(on) {
  if (on) _aplicarTextos(_azar(TEXTOS_JUEGOS_AZAR), true);
  else if (_estiloPrevio) { TEXTOS_CAMPOS.forEach(c => { S[c] = _estiloPrevio[c]; }); _textosAlUI(); textosJuegosSync(); }
  sched();
  const v = document.querySelector('#estilo-reels [data-k="textos"] .estilo-reel-v');
  if (v) v.innerHTML = _estiloValorReel('textos');
}
function estiloCerrar() {
  _estiloTimers.forEach(t => clearInterval(t));
  _estiloTimers = [];
  const ov = document.getElementById('estilo-overlay');
  if (ov) ov.classList.remove('open');
}
function estiloDeshacer() {
  const f = _estiloPrevio;
  estiloCerrar();
  if (!f) return;
  _estiloRestaurar(f);
  toast('Volvió el estilo que tenías.', 'info');
}
function estiloVer() {
  estiloCerrar();
  previewCurrent();
}
function estiloPersonalizar() {
  estiloCerrar();
  switchTab('empresa');
  switchSubtab('estilo');
  const el = document.getElementById('estilo-propio');
  if (el && el.scrollIntoView) el.scrollIntoView({ block:'start' });
}

// ── Mis estilos (v247) ──
// "Quiero probar otras opciones sin tener que acordarme después de cómo era la
// que me gustaba" (pedido del dueño). Los estilos viven en LS.ESTILOS, fuera
// de S: S se copia entero en cada presupuesto del historial y no tiene sentido
// cargar ahí la lista. Un estilo guarda TODO lo de ESTILO_FOTO_CAMPOS (diseño,
// colores, monograma, elementos, fondo, compacto, eslogan y textos).
// "El anterior" (auto:true, id ESTILO_ANTERIOR_ID) es la red de seguridad: lo
// llenan la máquina y "Usar" con lo que había, salvo que ya estuviera guardado.
const ESTILO_ANTERIOR_ID = 'anterior';
function getEstilos() {
  try { return sanitizeEstilos(JSON.parse(localStorage.getItem(LS.ESTILOS) || '[]')); } catch (_) { return []; }
}
function setEstilos(arr) { safeSetLS(LS.ESTILOS, JSON.stringify(sanitizeEstilos(arr))); }
function _estiloDatosActuales() {
  const d = {};
  ESTILO_CAMPOS.forEach(k => { d[k] = S[k]; });
  d.pdfCompact = !!S.pdfCompact;
  d.pdfTransl = !!S.pdfTransl;
  d.coEslogan = S.coEslogan || '';
  d.textos = {};
  TEXTOS_CAMPOS.forEach(c => { d.textos[c] = S[c]; });
  return sanitizeEstiloDatos(d);
}
// Mismos datos = mismo estilo (sanitizeEstiloDatos arma siempre el mismo orden).
function _estiloIgual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function _estiloAplicarDatos(d) {
  d = sanitizeEstiloDatos(d);
  ESTILO_CAMPOS.forEach(k => { S[k] = d[k]; });
  S.pdfCompact = d.pdfCompact;
  S.pdfTransl = d.pdfTransl;
  S.coEslogan = d.coEslogan;
  TEXTOS_CAMPOS.forEach(c => { if (typeof d.textos[c] === 'string') S[c] = d.textos[c]; });
  estiloUISync(true);
  sched();
}
function _estiloGuardarAnterior(datos) {
  const lista = getEstilos();
  const sinAuto = lista.filter(e => !e.auto);
  if (sinAuto.some(e => _estiloIgual(e.datos, datos))) return;
  setEstilos(sinAuto.concat([{ id: ESTILO_ANTERIOR_ID, nombre: 'El anterior', auto: true, creado: today(), datos }]));
}
function _estiloResumen(d) {
  // "Según diseño" no le dice nada a quien lee la lista: la tipografía va
  // solo si es una elegida.
  const partes = [ESTILO_TEMA_LBL[d.pdfTheme], d.pdfFont !== 'auto' ? ESTILO_FUENTE_LBL[d.pdfFont] : ''];
  if (d.pdfMono !== 'ninguno') partes.push('monograma ' + ESTILO_MONO_LBL[d.pdfMono].toLowerCase());
  if (d.pdfFondo !== 'auto') partes.push('fondo ' + ESTILO_ELEMENTOS.find(e => e.k === 'pdfFondo').lbl[d.pdfFondo].toLowerCase());
  return partes.filter(Boolean).join(' · ');
}
function estilosGuardadosRender() {
  const host = document.getElementById('eg-lista');
  if (!host) return;
  const lista = getEstilos();
  const actual = _estiloDatosActuales();
  // El automático va último: es la red de seguridad, no uno de "mis" estilos.
  const orden = lista.filter(e => !e.auto).concat(lista.filter(e => e.auto));
  host.innerHTML = orden.length ? orden.map(e => {
    const d = e.datos, uso = _estiloIgual(d, actual);
    const det = d.accentColor2 || d.accentColor;
    return `<div class="eg-item${uso ? ' is-uso' : ''}${e.auto ? ' is-auto' : ''}" data-id="${e.id}">
      <span class="eg-sw" style="background:${safeColor(d.accentColor)}"><span style="background:${safeColor(det)}"></span></span>
      <div class="eg-txt"><b>${esc(e.nombre)}</b><span>${esc(e.auto ? 'Se guardó solo antes del último cambio' : _estiloResumen(d))}</span></div>
      ${uso ? '<span class="eg-uso">En uso</span>' : '<button type="button" class="btn btn-g btn-sm" data-eg="usar">Usar</button>'}
      <button type="button" class="eg-del" data-eg="borrar" aria-label="Borrar ${esc(e.nombre)}" title="Borrar">✕</button>
    </div>`;
  }).join('') : '<div class="eg-vacio">Todavía no guardaste ningún estilo.</div>';
  host.onclick = ev => {
    const b = ev.target.closest('[data-eg]');
    const it = b && b.closest('.eg-item');
    if (!it) return;
    if (b.dataset.eg === 'usar') estiloUsar(it.dataset.id);
    else estiloBorrar(it.dataset.id);
  };
}
function estiloGuardarAbrir() {
  const f = document.getElementById('eg-form');
  if (!f) return;
  f.hidden = false;
  const inp = document.getElementById('eg-nombre');
  if (inp) { inp.value = ''; inp.focus(); }
}
function estiloGuardarCerrar() {
  const f = document.getElementById('eg-form');
  if (f) f.hidden = true;
}
async function estiloGuardar() {
  try { syncFromUI(); } catch (_) {}
  const inp = document.getElementById('eg-nombre');
  const nombre = (inp ? inp.value : '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!nombre) { toast('Ponele un nombre al estilo.', 'info'); if (inp) inp.focus(); return; }
  const datos = _estiloDatosActuales();
  let lista = getEstilos();
  const manuales = lista.filter(e => !e.auto);
  const igual = manuales.find(e => _estiloIgual(e.datos, datos));
  const mismoNombre = manuales.find(e => e.nombre.toLowerCase() === nombre.toLowerCase());
  if (igual && (!mismoNombre || mismoNombre === igual)) {
    estiloGuardarCerrar();
    toast(`Este estilo ya está guardado como «${igual.nombre}».`, 'info');
    return;
  }
  if (mismoNombre) {
    const ok = await confirmDlg('¿Reemplazar el estilo?', `Ya tenés un estilo llamado «${mismoNombre.nombre}». Se reemplaza por el actual.`, 'Reemplazar', 'btn-p');
    if (!ok) return;
    lista = lista.map(e => e === mismoNombre ? Object.assign({}, e, { datos, creado: today() }) : e);
  } else {
    if (manuales.length >= ESTILO_MAX_GUARDADOS) {
      toast(`Ya tenés ${ESTILO_MAX_GUARDADOS} estilos guardados: borrá alguno para guardar otro.`, 'info', 6000);
      return;
    }
    const id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    lista = lista.concat([{ id, nombre, auto: false, creado: today(), datos }]);
  }
  // Si "El anterior" quedó igual al que se acaba de guardar, sobra.
  lista = lista.filter(e => !(e.auto && _estiloIgual(e.datos, datos)));
  setEstilos(lista);
  estiloGuardarCerrar();
  estilosGuardadosRender();
  toast(`Estilo «${nombre}» guardado.`, 'ok');
}
function estiloUsar(id) {
  try { syncFromUI(); } catch (_) {}
  const e = getEstilos().find(x => x.id === id);
  if (!e) return;
  const antes = _estiloDatosActuales();
  const destino = e.datos;          // tomarlo ANTES de pisar "El anterior"
  _estiloGuardarAnterior(antes);
  _estiloAplicarDatos(destino);
  toastAccion(`Estilo «${e.auto ? 'El anterior' : e.nombre}» aplicado.`, [{ label: 'Deshacer', fn: () => _estiloAplicarDatos(antes) }]);
}
function estiloBorrar(id) {
  const lista = getEstilos();
  const i = lista.findIndex(x => x.id === id);
  if (i < 0) return;
  const e = lista[i];
  setEstilos(lista.slice(0, i).concat(lista.slice(i + 1)));
  estilosGuardadosRender();
  toastAccion(`Estilo «${e.nombre}» borrado.`, [{ label: 'Deshacer', fn: () => {
    const l = getEstilos();
    setEstilos(l.slice(0, i).concat([e], l.slice(i)));
    estilosGuardadosRender();
  } }]);
}

// Primera vez que se abre la app (desde maybeShowWelcome): la máquina elige
// sola, y cuando se cierra la bienvenida sale el aviso de que todo se cambia.
// Solo con el diseño de fábrica y sin presupuestos: un dispositivo que ya tiene
// datos (o que restauró un backup) conserva lo suyo.
function estiloPrimeraVez() {
  try { localStorage.setItem(LS.ESTILO_OFERTA, '1'); } catch (_) {}
  const h = (typeof getH === 'function') ? getH() : [];
  if (h.length || !estiloEsDeFabrica()) return false;
  _estiloAplicar(estiloSortear(true));
  saveLS();
  colaAviso(() => toastAccion('🎲 Tus presupuestos ya tienen un estilo propio, elegido al azar para que no salgan iguales a los de otro colega. Podés cambiarlo cuando quieras.',
    [{ label:'Ver', fn:() => estiloAbrir({}) }, { label:'Personalizar', fn:estiloPersonalizar }], 14000));
  return true;
}

// A quien ya usaba la app con el diseño de fábrica, se le ofrece UNA vez armar
// uno propio. No se cambia nada sin que acepte, y lo personalizado no se toca.
function estiloOfrecer() {
  let visto;
  try { visto = localStorage.getItem(LS.ESTILO_OFERTA); } catch (_) { visto = '1'; }
  if (visto) return false;
  try { localStorage.setItem(LS.ESTILO_OFERTA, '1'); } catch (_) {}
  if (!estiloEsDeFabrica()) return false;
  colaAviso(() => toastAccion('Tus presupuestos tienen el diseño de fábrica: salen iguales a los de cualquier colega que use la app.',
    [{ label:'Armar uno propio', fn:() => estiloAbrir({ tirar:true, textos:true }) }], 15000));
  return true;
}

// ─── LOGO ────────────────────────────────────
function handleLogoUpload(e) {
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ev => {
    compressLogoDataUrl(ev.target.result).then(src => {
      S.logo = src;
      showLogo(S.logo);
      sched();
      if (src !== ev.target.result) toast('Logo optimizado para guardar menos espacio', 'info');
    });
  };
  r.readAsDataURL(f);
}

function compressLogoDataUrl(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const maxW = 900, maxH = 500;
      const ratio = Math.min(1, maxW / img.width, maxH / img.height);
      const w = Math.max(1, Math.round(img.width * ratio));
      const h = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const type = src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const out = canvas.toDataURL(type, type === 'image/jpeg' ? 0.82 : undefined);
      resolve(out.length < src.length ? out : src);
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

function showLogo(src) {
  const img = document.getElementById('logo-preview-img');
  const ph  = document.getElementById('logo-ph');
  if(img){ img.src=src; img.style.display='block'; }
  if(ph)  ph.style.display='none';
}

function removeLogo() {
  S.logo = '';
  const img = document.getElementById('logo-preview-img');
  const ph  = document.getElementById('logo-ph');
  if(img){ img.src=''; img.style.display='none'; }
  if(ph)  ph.style.display='block';
  sched();
}

// ─── MODAL ───────────────────────────────────
// ─── TOP MENU "⋯" ────────────────────────────
// Menú colapsable del topbar. Contiene acciones secundarias que antes
// vivían como botones permanentes en la barra (Exportar/Importar).
function toggleTopMenu(ev) {
  if (ev) ev.stopPropagation();
  const pop = document.getElementById('top-menu-pop');
  const btn = ev && ev.currentTarget;
  if (!pop) return;
  const isOpen = pop.style.display === 'block';
  if (isOpen) {
    closeTopMenu();
  } else {
    pop.style.display = 'block';
    if (btn) btn.setAttribute('aria-expanded', 'true');
    // Cerrar al clickear afuera (un solo listener)
    setTimeout(() => {
      document.addEventListener('click', closeTopMenu, {once:true});
    }, 0);
  }
}
function closeTopMenu() {
  const pop = document.getElementById('top-menu-pop');
  if (pop) pop.style.display = 'none';
  const btn = document.querySelector('.tbtn-menu');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function openModal(type) {
  const ov = document.getElementById('moverlay');
  const ti = document.getElementById('mtitle');
  const bo = document.getElementById('mbody');
  if(!ov||!ti||!bo) return;
  if(type==='export'){
    ti.textContent='Exportar';
    bo.innerHTML=`<div class="msec"><h4>Opciones de exportación</h4>
      <button class="btn btn-p btn-bl" onclick="expCurrent()"><svg class="ic"><use href="#i-file"></use></svg> Presupuesto actual (JSON)</button>
      <button class="btn btn-s btn-bl" onclick="expHistory()"><svg class="ic"><use href="#i-book"></use></svg> Historial completo (JSON)</button>
      <button class="btn btn-s btn-bl" onclick="expBackup()"><svg class="ic ic-c-green"><use href="#i-save"></use></svg> Backup total (JSON)</button>
    </div>`;
  } else if(type==='import'){
    ti.textContent='Importar';
    bo.innerHTML=`<div class="msec"><h4>Seleccionar archivo .json</h4>
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px">Se detectará automáticamente el tipo de archivo.</p>
      <input type="file" id="imp-input" accept=".json" onchange="handleImport(event)">
      <button class="btn btn-p btn-bl" onclick="document.getElementById('imp-input').click()"><svg class="ic"><use href="#i-folder"></use></svg> Elegir archivo JSON</button>
    </div><div id="imp-opts"></div>`;
  } else if(type==='welcome'){
    ti.innerHTML=icon('hand')+' ¡Bienvenido/a!';
    bo.innerHTML=`<div class="msec">
      <p style="margin:0 0 12px">Con esta app creás presupuestos de poda y los compartís por WhatsApp o PDF en minutos. Antes de empezar, cargá los datos de tu negocio para que tus presupuestos salgan con <b>tu</b> nombre, logo y contacto.</p>
      <ol style="margin:0 0 12px;padding-left:20px;line-height:1.7">
        <li><b>Cargá tu negocio</b> — nombre, logo, WhatsApp y datos de contacto.</li>
        <li><b>Creá tu presupuesto</b> — sumá los trabajos y sus precios.</li>
        <li><b>Compartilo</b> — descargá el PDF o enviálo por WhatsApp.</li>
      </ol>
      <p style="font-size:12px;color:var(--muted);margin:0 0 14px"><svg class="ic ic-c-green"><use href="#i-save"></use></svg> Tus datos se guardan <b>solo en este dispositivo</b>. Hacé un backup cada tanto desde ⚙ Configuración → Datos → Copia de seguridad para no perderlos.</p>
      <button class="btn btn-p btn-bl" onclick="startOnboarding()"><svg class="ic"><use href="#i-building"></use></svg> Configurar mi negocio</button>
      <button class="btn btn-s btn-bl" onclick="closeModal()">Lo hago después</button>
    </div>`;
  }
  ov.classList.add('open');
}

function closeModal(){ const o=document.getElementById('moverlay'); if(o) o.classList.remove('open'); }
function closeModalOutside(e){ if(e.target.id==='moverlay') closeModal(); }

// ─── ONBOARDING (primer uso) ─────────────────
// Muestra una bienvenida la primera vez que se abre la app. Marcamos el
// flag apenas se muestra, así no reaparece en cada recarga aunque el
// usuario la cierre sin completar nada.
function maybeShowWelcome() {
  let seen;
  try { seen = localStorage.getItem(LS.ONBOARDED); } catch(_) { seen = '1'; }
  // Ya la conocía: a lo sumo, la oferta única de armar un estilo propio.
  if (seen) { estiloOfrecer(); return; }
  try { localStorage.setItem(LS.ONBOARDED, '1'); } catch(_) {}
  openModal('welcome');
  // Primera vez: la máquina de estilo elige diseño y textos (v244). Va DESPUÉS
  // de abrir la bienvenida: su aviso sale por colaAviso, que espera a que la
  // bienvenida se cierre — si se encolara antes, saldría debajo de ella.
  estiloPrimeraVez();
}

// Botón "Configurar mi negocio": cierra la bienvenida y lleva al usuario
// directo a la pestaña Empresa → Mi negocio.
function startOnboarding() {
  closeModal();
  switchTab('empresa');
  if (typeof switchSubtab === 'function') switchSubtab('negocio');
  const f = document.getElementById('co-name');
  if (f) f.focus();
}

// ─── PROTECCIÓN DE DATOS ─────────────────────
// Verifica que localStorage realmente funcione. En algunos navegadores
// (modo privado estricto, almacenamiento bloqueado) escribir lanza una
// excepción: ahí el trabajo NO se guarda y conviene avisar fuerte.
// Devuelve true si el almacenamiento está disponible.
function checkStorageAvailable() {
  try {
    const k = '__pq_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch(e) {
    toast('⚠️ Este navegador no está guardando datos (¿modo privado?). Tus presupuestos se perderán al cerrar. Usá una ventana normal.', 'err', 10000);
    return false;
  }
}

// Pide al navegador que marque el almacenamiento de la app como persistente
// (no lo borre automáticamente). Crítico en Brave/Safari, que de lo contrario
// pueden limpiar localStorage entre sesiones sin avisar.
// Se llama solo cuando ya hay datos para proteger; si el navegador rechaza
// la persistencia, muestra un aviso para que el usuario haga backup manual.
function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return;
  navigator.storage.persisted().then(already => {
    if (already) return; // ya es persistente, nada que hacer
    navigator.storage.persist().then(granted => {
      if (!granted) {
        // El navegador no garantiza persistencia: avisamos con discreción.
        // Con Drive conectado la copia ya sale sola: el aviso sobra. Y si en
        // esta apertura ya salió el recordatorio de backup, no se apila otro
        // (los dos juntos tapaban la barra de abajo).
        setTimeout(() => {
          if (typeof gdriveConnected === 'function' && gdriveConnected()) return;
          avisoBackup('⚠️ Este navegador puede borrar los datos al cerrar. Hacé un backup para no perderlos.');
        }, 3000);
      }
    });
  });
}

// Recuerda hacer backup si hay presupuestos guardados y pasó tiempo desde
// el último. No bloquea: es un toast informativo de mayor duración.
function checkBackupReminder() {
  let hist = [];
  try { hist = (typeof getH === 'function') ? getH() : []; } catch(_) {}
  if (!hist.length) return; // sin presupuestos guardados, nada que perder aún
  let last;
  try { last = localStorage.getItem(LS.LAST_BACKUP); } catch(_) {}
  const daysSince = last
    ? (Date.now() - new Date(last+'T00:00:00').getTime()) / 86400000
    : Infinity;
  if (daysSince < 14) return;
  setTimeout(()=>{
    avisoBackup(isFinite(daysSince)
      ? `Hace ${Math.floor(daysSince)} días que no hacés un backup de tus presupuestos.`
      : 'Todavía no hiciste ningún backup de tus presupuestos.');
  }, 2500);
}

// Aviso de backup con sus botones. Antes era un texto que mandaba a
// "⚙ Configuración → Mi empresa → Copia de seguridad": "Mi empresa" no existe
// y la sección quedaba en la 6ª pantalla (hoy vive en Configuración → Datos). Ahora
// el aviso exporta de una o lleva derecho a la sección. Uno solo por apertura.
let _avisoBackupMostrado = false;
function avisoBackup(msg) {
  if (_avisoBackupMostrado) return;
  _avisoBackupMostrado = true;
  colaAviso(() => toastAccion(msg, [
    { label: 'Exportar ahora', fn: () => openModal('export') },
    { label: 'Más opciones',   fn: () => irABackup() },
  ], 12000));
}

// Lleva a Configuración → Datos → Copia de seguridad (archivo y Drive) y la
// marca un momento para que se vea dónde quedó.
function irABackup() {
  switchTab('empresa');
  if (typeof switchSubtab === 'function') switchSubtab('datos');
  const sec = document.getElementById('backup-file-section');
  if (!sec) return;
  requestAnimationFrame(() => {
    sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    sec.classList.add('is-destacada');
    setTimeout(() => sec.classList.remove('is-destacada'), 2200);
  });
}

// ─── ESPACIO EN EL DISPOSITIVO ──────────────
// localStorage tiene un tope por sitio y, cuando se llena, safeSetLS ya no
// puede guardar: el usuario se enteraba con el toast de error, o sea tarde.
// El tope medido en Chrome es 5 MiB contando CARACTERES de claves y valores
// (con o sin tildes da lo mismo); Firefox y Safari andan por ahí. Las fotos
// viven en IndexedDB y no cuentan para este tope.
const ESPACIO_TOPE = 5 * 1024 * 1024;
const ESPACIO_ALERTA = 0.8;   // desde acá se marca y se avisa al abrir
const ESPACIO_CRITICO = 0.95;

function espacioUso() {
  const partes = { hist: 0, notas: 0, otros: 0 };
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const n = k.length + (localStorage.getItem(k) || '').length;
      total += n;
      if (k === LS.HISTORY || k === LS.HISTORY_LEGACY) partes.hist += n;
      else if (k === LS.NOTES) partes.notas += n;
      else partes.otros += n;
    }
  } catch (_) {}
  let fotos = 0;
  photoCache.forEach(v => { fotos += (v || '').length; });
  return { total, tope: ESPACIO_TOPE, pct: total / ESPACIO_TOPE, partes, fotos, nFotos: photoCache.size };
}

function _espacioTxt(n) {
  // \u00a0: que el número y la unidad no queden en renglones distintos
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + '\u00a0KB';
  return (n / (1024 * 1024)).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '\u00a0MB';
}

function espacioRender() {
  const sec = document.getElementById('espacio-section');
  if (!sec) return;
  const u = espacioUso();
  const pct = Math.min(100, Math.round(u.pct * 100));
  sec.classList.toggle('is-warn', u.pct >= ESPACIO_ALERTA && u.pct < ESPACIO_CRITICO);
  sec.classList.toggle('is-fail', u.pct >= ESPACIO_CRITICO);
  const fill = document.getElementById('esp-fill');
  if (fill) fill.style.width = Math.max(pct, 1) + '%';
  const barra = sec.querySelector('.esp-barra');
  if (barra) barra.setAttribute('aria-valuenow', String(pct));
  const txt = document.getElementById('esp-txt');
  if (!txt) return;
  const partes = [['presupuestos', u.partes.hist], ['agenda', u.partes.notas], ['resto', u.partes.otros]]
    .filter(p => p[1] > 0).map(p => p[0] + ' ' + _espacioTxt(p[1]));
  let html = `Usado: <b>${_espacioTxt(u.total)}</b> de ${_espacioTxt(u.tope)} (${pct}\u00a0%)`
    + (partes.length ? ' · ' + partes.join(', ') : '') + '.';
  if (u.nFotos) html += ` Las fotos (${u.nFotos}, ${_espacioTxt(u.fotos)}) se guardan aparte y no cuentan para este límite.`;
  if (u.pct >= ESPACIO_ALERTA) {
    html += '<br><b>Se está llenando:</b> exportá una copia de seguridad y, si podés, borrá del Historial presupuestos viejos que ya no necesites. Lleno, la app no puede guardar cambios.';
  }
  txt.innerHTML = html;
}

// Al abrir: si pasó el umbral, un aviso por día (no en cada apertura: con el
// medidor en Configuración alcanza para seguirlo).
function espacioAvisarSiLleno() {
  const u = espacioUso();
  if (u.pct < ESPACIO_ALERTA) return;
  const hoy = today();
  try { if (localStorage.getItem(LS.ESPACIO_AVISO) === hoy) return; } catch (_) {}
  safeSetLS(LS.ESPACIO_AVISO, hoy, { backup: false });
  colaAviso(() => toastAccion(
    `⚠️ El espacio de la app en este dispositivo está al ${Math.round(u.pct * 100)} %. Cuando se llena no puede guardar cambios.`,
    [{ label: 'Ver qué hacer', fn: () => irAEspacio() }], 12000));
}

function irAEspacio() {
  switchTab('empresa');
  if (typeof switchSubtab === 'function') switchSubtab('datos');
  const sec = document.getElementById('espacio-section');
  if (!sec) return;
  requestAnimationFrame(() => {
    sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    sec.classList.add('is-destacada');
    setTimeout(() => sec.classList.remove('is-destacada'), 2200);
  });
}
