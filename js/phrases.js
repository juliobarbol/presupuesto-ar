'use strict';

// ═══════════════════════════════════════
// FRASES RÁPIDAS — biblioteca de frases reusables para insertar en
// textareas de descripción, observaciones y condiciones de pago.
//
// Modelo: 3 DBs separadas (una por categoría) en localStorage. Cada
// una es string[]. Se siembran la primera vez con frases sacadas del
// análisis de patrones del histórico. Después el usuario las edita
// libremente: agrega/borra/guarda nuevas.
//
// A diferencia de los servicios (que se aprenden solos al escribir),
// las frases NO se guardan automáticamente — son textos largos y
// únicos por trabajo. Se guardan solo si el usuario lo pide
// explícitamente desde el modal con "Guardar como frase".
// ═══════════════════════════════════════

const PHRASE_KEYS = {
  desc: 'pq_phrases_desc',  // Descripciones de trabajo
  obs:  'pq_phrases_obs',   // Observaciones técnicas
  pay:  'pq_phrases_pay',   // Condiciones de pago
};

// Etiquetas humanas por categoría (para los headers de modal y toasts)
const PHRASE_LABELS = {
  desc: 'Descripciones de trabajo',
  obs:  'Observaciones técnicas',
  pay:  'Condiciones de pago',
};

// Defaults sembrados la primera vez (vienen del análisis del histórico).
// Si el usuario las borra todas, no se vuelven a sembrar (respetamos
// su decisión via flag de "ya sembrado").
const PHRASE_DEFAULTS = {
  desc: [
    'Extracción de [especie] hasta lo más bajo que nos permita la motosierra. Trozado tamaño transportable y disposición de los restos al pie del árbol.',
    'Extracción del árbol hasta la altura de [X] m. Trozado tamaño transportable y disposición de los restos en el lugar acordado con el cliente.',
    'Extracción y trozado para leña.',
    'Poda de saneamiento y despeje de la edificación.',
    'Poda de reducción de altura.',
    'Poda de despeje de la casa.',
    'Poda de elevación de copa.',
    'Poda de limpieza, aclareo y saneamiento.',
    'Poda de reducción de copa hasta la altura de los soportes de sustento.',
    'Poda hasta la altura del paredón.',
    'Limpieza de ramas secas y enredadera.',
    'Trozado tamaño transportable y disposición de los restos al pie del árbol.',
    'Trozado tamaño transportable y disposición de los restos en el lugar acordado con el cliente.',
    'Trozado tamaño transportable y disposición de los restos en contenedor.',
  ],
  obs: [
    'El ejemplar presenta muerte descendente en uno de sus ejes principales, razón por la cual se deberán tomar medidas de seguridad adicionales.',
    'El árbol presenta heridas en su base y muerte de sus ramas con su debida degradación estructural, lo que demanda medidas de seguridad extra.',
    'Alta dificultad y riesgo debido a la muerte del ejemplar y la cercanía a estructuras. Se tomarán medidas de seguridad adicionales.',
    'Complejidad extra debido a la densidad del follaje, la cantidad de espinas por rama y el enredo general de las ramas a extraer.',
    'Solamente un trepador podrá entrar al árbol, lo cual duplica el tiempo de trabajo. La mayor parte de la extracción se deberá realizar mediante el apeo (descenso) controlado por cuerdas.',
    'Se podrían tomar medidas de seguridad adicionales si la condición de inestabilidad estructural del árbol lo requiere.',
    'Se requiere permiso del municipio de [localidad] previo al inicio del trabajo.',
  ],
  pay: [
    'Totalidad del pago al finalizar el trabajo.',
    'Totalidad del pago al finalizar el trabajo, existiendo la posibilidad de solicitar una fracción del mismo durante el trabajo para cubrir gastos operativos.',
    'Totalidad del pago al finalizar el trabajo a menos que tardemos más de un día (en ese caso se pedirá parte del pago para cubrir gastos).',
    'En caso de coordinar fecha para el trabajo se volverá a consultar el costo a la empresa que presta el servicio.',
  ],
};

// Flag para no resembrar si el usuario borró todo deliberadamente
const PHRASE_SEEDED_KEY = 'pq_phrases_seeded';

// ─── PLACEHOLDER [especie] ───────────────────
// Las frases de trabajo vienen con "[especie]" adentro ("Extracción de
// [especie] hasta lo más bajo que nos permita la motosierra…"). Cambiarlo
// a mano en cada ítem era tipeo repetido y, sobre todo, se olvidaba: el
// corchete terminaba impreso en el presupuesto del cliente.
//
// Se completa con la especie DE ESE ítem, no con una global — por eso
// funciona con varios árboles distintos: cada tarjeta tiene su propio
// campo "Especie/s" y su propia frase, y cada inserción mira la suya.
// Si todavía no hay especie cargada, el corchete se deja intacto y se
// rellena solo al salir del campo (ver _fillSpeciesInCard en items.js).

// Regex nueva en cada llamada: con la flag /g, `lastIndex` es estado y un
// .test() reusado alterna true/false entre llamadas.
function _speciesPhRe() { return /\[\s*especies?\s*\]/gi; }

function hasSpeciesPlaceholder(text) { return _speciesPhRe().test(String(text || '')); }

// "Eucaliptus, Ciprés" → "Eucaliptus y Ciprés". El campo admite varias
// especies separadas por coma; pegadas tal cual quedaba "Extracción de
// Eucaliptus, Ciprés hasta lo más bajo…", que no se lee como una frase.
function speciesForPhrase(raw) {
  const parts = String(raw || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' y ' + parts[parts.length - 1];
}

// Reemplaza [especie] por la especie del ítem. Sin especie devuelve el
// texto tal cual (el corchete es el recordatorio de que falta cargarla).
function fillSpeciesPlaceholder(text, rawSpecies) {
  const sp = speciesForPhrase(rawSpecies);
  if (!sp) return String(text || '');
  return String(text || '').replace(_speciesPhRe(), sp);
}

// La especie que le corresponde al textarea destino: la de SU tarjeta.
function _speciesOfTargetEl(el) {
  const card = el && el.closest ? el.closest('.icard') : null;
  const sf = card ? card.querySelector('.sp-f') : null;
  return sf ? sf.value : '';
}

// ─── HUECOS SIN COMPLETAR ────────────────────
// Red de seguridad para el error caro de las frases con plantilla: el
// corchete que se escapa al documento del cliente ("hasta la altura de
// [X] m"). Antes de imprimir o de mandar el presupuesto se avisa QUÉ
// quedó sin completar y DÓNDE; nunca se bloquea: manda el usuario.
const PLACEHOLDER_RE_1 = /\[[^\]\n]{1,40}\]/;   // el primero
const PLACEHOLDER_RE_G = /\[[^\]\n]{1,40}\]/g;  // todos

function _huecosDeTexto(txt) {
  const m = String(txt || '').match(PLACEHOLDER_RE_G);
  return m ? [...new Set(m)] : [];
}

// Recorre SOLO lo que sale en la hoja del cliente del modo activo: el
// estimativo no imprime observaciones ni condiciones de pago, así que
// avisar por ellas sería un falso positivo.
function huecosPendientes() {
  const out = [];
  const add = (donde, txt) => { const ph = _huecosDeTexto(txt); if (ph.length) out.push({ donde, ph }); };
  const addItems = (arr, pref) => (arr || []).forEach((it, i) => add(pref + ' ' + (i + 1), it.desc));

  if (S.isEstimative) {
    addItems(S.estItems, 'Trabajo');
  } else {
    const conB = !!S.scenariosEnabled;
    addItems(S.items, conB ? (S.scenarioLabelA || 'Opción A') + ' · ítem' : 'Ítem');
    if (conB) addItems(S.itemsB, (S.scenarioLabelB || 'Opción B') + ' · ítem');
    add('Observaciones', S.observations);
    add('Condiciones de pago', S.paymentConditions);
  }
  if (S.dispoEnDoc) add('Disposición de leña', S.dispoNota);
  return out;
}

// Diálogo común a los caminos de salida (imprimir / WhatsApp). Resuelve
// true si no hay nada pendiente o si el usuario decide seguir igual.
function confirmarHuecos(accion) {
  const pend = huecosPendientes();
  if (!pend.length) return Promise.resolve(true);
  const detalle = pend.map(p => '• ' + p.donde + ': ' + p.ph.join(' ')).join('\n');
  return confirmDlg(
    'Quedó texto sin completar',
    'Estos corchetes de las frases todavía están sin reemplazar y salen así en el documento del cliente:\n\n'
      + detalle + '\n\n¿Seguimos igual?',
    accion, 'btn-p'
  );
}

// ─── API ─────────────────────────────────────

function getPhrasesDB(cat) {
  const key = PHRASE_KEYS[cat];
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      // Primera vez tocando esta categoría: sembrar con defaults SOLO si
      // no se sembró antes (respeta usuario que borró todas las frases)
      const seeded = localStorage.getItem(PHRASE_SEEDED_KEY) === '1';
      if (!seeded) {
        // Sembrar las 3 categorías de una sola pasada
        Object.entries(PHRASE_DEFAULTS).forEach(([c, arr]) => {
          safeSetLS(PHRASE_KEYS[c], JSON.stringify(arr));
        });
        safeSetLS(PHRASE_SEEDED_KEY, '1');
        return (PHRASE_DEFAULTS[cat] || []).slice();
      }
      return [];
    }
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch(e) { return []; }
}

function savePhraseToDB(cat, text) {
  const key = PHRASE_KEYS[cat];
  if (!key) return false;
  text = (text || '').trim();
  if (text.length < 5) return false;  // muy corta no aporta
  const db = getPhrasesDB(cat);
  // Evitar duplicados exactos (case-insensitive)
  const k = text.toLowerCase();
  if (db.some(p => p.toLowerCase() === k)) return false;
  db.push(text);
  // Las frases se ordenan por momento de uso natural (no alfabético).
  // Mantenemos orden de inserción para que las más viejas queden arriba
  // y las nuevas abajo — pero acá podríamos invertir si preferís ver
  // las recientes arriba. De momento las dejamos abajo (más estable).
  safeSetLS(key, JSON.stringify(db));
  return true;
}

function deletePhraseFromDB(cat, text) {
  const key = PHRASE_KEYS[cat];
  if (!key) return;
  const db = getPhrasesDB(cat).filter(p => p !== text);
  safeSetLS(key, JSON.stringify(db));
}

async function confirmDeletePhrase(cat, text) {
  const ok = await confirmDlg(
    'Eliminar frase',
    `¿Eliminar esta frase de "${PHRASE_LABELS[cat]}"? No se puede deshacer.`,
    'Eliminar', 'btn-d'
  );
  if (!ok) return;
  deletePhraseFromDB(cat, text);
  // Re-renderizar el modal si está abierto
  renderPhrasesModal(cat);
  toast('Frase eliminada', 'info');
}

// ─── MODAL DE INSERCIÓN ──────────────────────
// El modal se abre desde un botón "📝 Frases" al lado del textarea.
// El parámetro _phraseTargetId guarda cuál textarea recibirá la frase
// elegida — se setea al abrir y se limpia al cerrar.
let _phraseTargetId = null;
let _phraseCat = null;

function openPhrasesModal(cat, targetId) {
  if (!PHRASE_KEYS[cat]) return;
  _phraseCat = cat;
  _phraseTargetId = targetId;
  const ov = document.getElementById('phrases-overlay');
  if (!ov) return;
  ov.classList.add('open');
  renderPhrasesModal(cat);
}

function closePhrasesModal() {
  const ov = document.getElementById('phrases-overlay');
  if (ov) ov.classList.remove('open');
  const hint = document.getElementById('phrases-modal-hint');
  if (hint) hint.hidden = true;
  _phraseTargetId = null;
  _phraseCat = null;
}

// Aviso arriba de la lista: con qué se va a completar [especie] en este
// ítem, o que todavía falta cargar la especie. Solo aplica a las frases
// de descripción, que son las únicas que viven dentro de una tarjeta.
function _phrasesHintRender() {
  const hint = document.getElementById('phrases-modal-hint');
  if (!hint) return;
  const el = _phraseTargetId ? document.getElementById(_phraseTargetId) : null;
  const card = el && el.closest ? el.closest('.icard') : null;
  if (_phraseCat !== 'desc' || !card) { hint.hidden = true; return; }
  const sp = speciesForPhrase(_speciesOfTargetEl(el));
  hint.hidden = false;
  hint.className = 'phrases-hint ' + (sp ? 'is-on' : 'is-off');
  hint.innerHTML = sp
    ? `<code>[especie]</code> se reemplaza por <b>${esc(sp)}</b>`
    : `<code>[especie]</code> se completa solo, en cuanto cargues <b>Especie/s</b> en este ítem`;
}

function renderPhrasesModal(cat) {
  cat = cat || _phraseCat;
  if (!cat) return;
  const titleEl = document.getElementById('phrases-modal-title');
  const listEl  = document.getElementById('phrases-modal-list');
  if (titleEl) titleEl.innerHTML = icon('pencil') + ' ' + esc(PHRASE_LABELS[cat]);
  _phrasesHintRender();
  if (!listEl) return;
  const db = getPhrasesDB(cat);
  if (!db.length) {
    listEl.innerHTML = `<div class="phrases-empty">No hay frases guardadas en esta categoría.<br><small>Agregá una abajo con el botón "+ Nueva frase".</small></div>`;
    return;
  }
  // Cada fila: ↑↓ a la izquierda (reordenar) · texto tappable (insertar) · 🗑 (borrar)
  // El índice va en data-idx para identificar cada frase al mover/borrar
  // sin depender del texto (que puede tener caracteres raros).
  listEl.innerHTML = db.map((p, idx) => {
    const isFirst = idx === 0;
    const isLast  = idx === db.length - 1;
    return `
    <div class="phrase-row">
      <div class="phrase-move">
        <button class="phrase-move-btn phrase-up-btn" data-idx="${idx}" ${isFirst ? 'disabled' : ''} title="Subir" aria-label="Subir">▲</button>
        <button class="phrase-move-btn phrase-down-btn" data-idx="${idx}" ${isLast ? 'disabled' : ''} title="Bajar" aria-label="Bajar">▼</button>
      </div>
      <button class="phrase-text" data-text="${esc(p)}" title="Insertar esta frase">${esc(p)}</button>
      <button class="btn-icon-del phrase-del-btn" data-text="${esc(p)}" data-idx="${idx}" title="Eliminar frase">${icon('trash')}</button>
    </div>`;
  }).join('');
  // Listener delegado para insertar, borrar y reordenar
  // (un solo listener en el contenedor para todos los elementos)
  if (!listEl._phraseListener) {
    listEl.addEventListener('click', (e) => {
      const upBtn = e.target.closest('.phrase-up-btn');
      if (upBtn && !upBtn.disabled) {
        movePhrase(_phraseCat, parseInt(upBtn.dataset.idx, 10), -1);
        return;
      }
      const downBtn = e.target.closest('.phrase-down-btn');
      if (downBtn && !downBtn.disabled) {
        movePhrase(_phraseCat, parseInt(downBtn.dataset.idx, 10), 1);
        return;
      }
      const insertBtn = e.target.closest('.phrase-text');
      if (insertBtn) {
        const txt = insertBtn.dataset.text;
        if (txt) insertPhraseIntoTarget(txt);
        return;
      }
      const delBtn = e.target.closest('.phrase-del-btn');
      if (delBtn) {
        const txt = delBtn.dataset.text;
        if (txt) confirmDeletePhrase(_phraseCat, txt);
      }
    });
    listEl._phraseListener = true;
  }
}

// Mueve una frase en la lista por delta posiciones (+1 = bajar, -1 = subir).
// Persiste el nuevo orden y re-renderiza el modal para reflejar el cambio.
function movePhrase(cat, fromIdx, delta) {
  const key = PHRASE_KEYS[cat];
  if (!key) return;
  const db = getPhrasesDB(cat);
  const toIdx = fromIdx + delta;
  if (fromIdx < 0 || fromIdx >= db.length) return;
  if (toIdx   < 0 || toIdx   >= db.length) return;
  // Swap simple: sacar el item y reinsertarlo en la nueva posición
  const [item] = db.splice(fromIdx, 1);
  db.splice(toIdx, 0, item);
  safeSetLS(key, JSON.stringify(db));
  renderPhrasesModal(cat);
}

// Inserta el texto elegido en el textarea/input destino. Si el campo ya
// tiene contenido, agrega salto de línea + frase al final. Si está
// vacío, simplemente la pone.
function insertPhraseIntoTarget(text) {
  if (!_phraseTargetId) { closePhrasesModal(); return; }
  const el = document.getElementById(_phraseTargetId);
  if (!el) { closePhrasesModal(); return; }

  // [especie] → la especie de ESTE ítem (ver PLACEHOLDER arriba)
  let msg = 'Frase insertada';
  if (hasSpeciesPlaceholder(text)) {
    const sp = speciesForPhrase(_speciesOfTargetEl(el));
    if (sp) { text = fillSpeciesPlaceholder(text, sp); msg = 'Frase insertada con "' + sp + '"'; }
    else    { msg = 'Frase insertada · cargá la especie y se completa sola'; }
  }

  const current = el.value || '';
  const prefijo = current.trim() ? current.replace(/\s+$/,'') + '\n' : '';
  el.value = prefijo + text;
  // Disparar input event para que se sincronice el estado de la app
  el.dispatchEvent(new Event('input', {bubbles:true}));
  closePhrasesModal();

  // Si quedó un corchete sin completar ([X] de altura, [localidad]…), se
  // deja SELECCIONADO: en el celular, cazarlo con el dedo entre tres
  // renglones es justo lo que hace que se olvide y termine impreso.
  // Seleccionado, se reemplaza tipeando encima.
  const hueco = text.match(PLACEHOLDER_RE_1);
  el.focus();
  if (hueco && typeof el.setSelectionRange === 'function') {
    const ini = prefijo.length + hueco.index;
    try { el.setSelectionRange(ini, ini + hueco[0].length); } catch(_) {}
    if (!hasSpeciesPlaceholder(hueco[0])) msg = 'Frase insertada · completá ' + hueco[0];
  }
  toast(msg, 'ok', 1800);
}

// Guarda lo que esté ACTUALMENTE en el textarea destino como nueva frase
// de la categoría actual. Útil cuando el usuario escribe algo bueno y quiere
// reusarlo en el futuro.
function savePhraseFromTarget() {
  if (!_phraseCat || !_phraseTargetId) return;
  const el = document.getElementById(_phraseTargetId);
  if (!el) return;
  const text = (el.value || '').trim();
  if (text.length < 5) {
    toast('Escribí algo en el campo para guardarlo como frase', 'err');
    return;
  }
  const saved = savePhraseToDB(_phraseCat, text);
  if (saved) {
    toast('Frase guardada en la biblioteca', 'ok');
    renderPhrasesModal(_phraseCat);
  } else {
    toast('Esa frase ya está guardada', 'info');
  }
}

// Agrega manualmente desde un input dedicado del modal
function addPhraseFromInput() {
  if (!_phraseCat) return;
  const input = document.getElementById('phrases-add-input');
  if (!input) return;
  const text = (input.value || '').trim();
  if (text.length < 5) {
    toast('La frase es muy corta (mínimo 5 caracteres)', 'err');
    return;
  }
  const saved = savePhraseToDB(_phraseCat, text);
  if (saved) {
    input.value = '';
    renderPhrasesModal(_phraseCat);
    toast('Frase agregada', 'ok');
  } else {
    toast('Esa frase ya existe', 'info');
  }
}
