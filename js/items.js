'use strict';

// ═══════════════════════════════════════
// ITEMS.JS — Ítems normales, estimativos y recargo (surcharge)
// ═══════════════════════════════════════

// ─── HELPERS DE CANTIDAD ─────────────────────
// Precio unitario x cantidad, calculado en centavos para evitar redondeos raros.
function itemTotalCents(item) {
  // Clamp defensivo: ni precio negativo ni cantidad < 1 deben restar al total
  // (no tienen sentido en este dominio y podrían colarse por un valor tipeado
  // o un import manipulado). Los inputs ya llevan min="0"/min="1".
  const price = Math.max(0, moneyToCents(item.price));
  // Trabajo cobrado por metro / m² / jornada: precio unitario × cantidad (que
  // puede tener decimales: 12,5 m). Redondeo al centavo, como todo lo demás.
  if (itemUnidad(item)) return Math.round(price * itemCant(item));
  const qty   = (item.type === 'service') ? Math.max(1, parseInt(item.qty) || 1) : 1;
  return price * qty;
}

// ─── RUBRO Y COBRO POR UNIDAD (v241) ─────────
// ¿El presupuesto (S o un snapshot) es de jardinería? El modo riesgo nunca lo
// es: el informe ISA evalúa un árbol.
function esJardineria(st) {
  const x = st || S;
  return !!x && x.rubro === 'jardineria' && !x.isRisk;
}
// Textos de cada unidad: `uno`/`varios` para la cantidad ("1 jornada" /
// "3 jornadas"), `por` para el precio ("$ 3.000 por metro").
const ITEM_UNIDAD_TXT = {
  m:       { uno: 'm',       varios: 'm',        por: 'por metro',   chip: 'Por metro' },
  m2:      { uno: 'm²',      varios: 'm²',       por: 'por m²',      chip: 'Por m²' },
  jornada: { uno: 'jornada', varios: 'jornadas', por: 'por jornada', chip: 'Por jornada' },
};
// Unidad válida de un ítem de trabajo, o '' (precio cerrado). Solo los ítems
// 'tree' la llevan: el servicio ya tiene su cantidad, la nota no suma.
function itemUnidad(item) {
  return (item && item.type === 'tree' && ITEM_UNIDADES.indexOf(item.unidad) >= 0) ? item.unidad : '';
}
// Cantidad de un trabajo con unidad: positiva, hasta 2 decimales; acepta coma.
function itemCant(item) {
  const q = parseFloat(String(item && item.qty != null ? item.qty : '').replace(',', '.'));
  return (q > 0 && isFinite(q)) ? Math.round(q * 100) / 100 : 1;
}
// "40 m", "12,5 m²", "1 jornada", "3 jornadas".
function itemCantTxt(item) {
  const u = ITEM_UNIDAD_TXT[itemUnidad(item)];
  if (!u) return '';
  const q = itemCant(item);
  return q.toLocaleString('es-AR', { maximumFractionDigits: 2 }) + ' ' + (q === 1 ? u.uno : u.varios);
}

function itemTotal(item) {
  return centsToMoney(itemTotalCents(item));
}

// ─── HELPER ESCENARIOS A/B ───────────────────
// Devuelve el array de ítems "activo" para renderizar/editar:
// - Si scenariosEnabled está prendido y activeScenario='B' → S.itemsB
// - En todos los demás casos (incluyendo modo deshabilitado) → S.items
// Esto deja todo el flujo viejo intacto cuando scenariosEnabled=false.
function activeItemsArr() {
  if (S.scenariosEnabled && activeScenario === 'B') {
    if (!Array.isArray(S.itemsB)) S.itemsB = [];
    return S.itemsB;
  }
  return S.items;
}

// ─── NORMAL ITEMS ────────────────────────────
function addItem(type) {
  activeItemsArr().push({id:Date.now(), type, species:'', desc:'', price:'',
    qty: 1, showQty: false
  });
  renderItems();
  sched();
}

// Atajo: crea un ítem service con la descripción precargada (desde un
// chip de servicios rápidos). Acelera el flujo de carga, especialmente
// para los servicios usados con frecuencia (Camión, Bobcat, etc.).
function addServiceFromQuick(desc) {
  activeItemsArr().push({id:Date.now(), type:'service', species:'', desc, price:'',
    qty: 1, showQty: false
  });
  renderItems();
  sched();
  toast(`Servicio "${desc}" agregado`, 'ok', 1500);
  // Scroll suave al ítem recién agregado (es el último de la lista)
  setTimeout(() => {
    const list = document.getElementById('items-list');
    const last = list && list.lastElementChild;
    if (last && last.scrollIntoView) last.scrollIntoView({behavior:'smooth', block:'nearest'});
  }, 50);
}

// Renderiza los chips de servicios rápidos. Toma los servicios pineados
// por el usuario (configurable desde Empresa → Datos guardados). Si no
// hay ninguno pineado, hace fallback a los primeros 4 de la DB completa
// (comportamiento inicial — funciona out of the box hasta que el usuario
// configure sus favoritos).
//
// IMPORTANTE: el nombre del servicio se pasa via data-name (no como
// argumento dentro de onclick) para evitar problemas de escape de
// comillas/caracteres especiales en el atributo HTML. Un listener
// delegado lee el atributo y llama addServiceFromQuick limpio.
function renderQuickServices() {
  const wrap = document.getElementById('quick-services');
  if (!wrap) return;
  // Solo en modo normal: en estimativo/riesgo el editor es distinto
  if (S.isEstimative || S.isRisk) { wrap.style.display = 'none'; return; }
  const allServices = (typeof getServicesDB === 'function') ? getServicesDB() : [];
  if (!allServices.length) { wrap.style.display = 'none'; return; }
  // Preferir pineados; si no hay, fallback a los primeros 4
  const pinned = (typeof getPinnedServices === 'function') ? getPinnedServices() : [];
  const top = pinned.length ? pinned : allServices.slice(0, 4);
  if (!top.length) { wrap.style.display = 'none'; return; }
  wrap.innerHTML =
    `<div class="quick-services-label">${icon('zap')} Servicios rápidos</div>` +
    top.map(sv => `<button class="qs-chip" data-name="${esc(sv)}"><span class="qs-chip-plus">+</span>${esc(sv)}</button>`).join('');
  wrap.style.display = 'flex';
  // Listener delegado: un solo handler en el contenedor lee data-name
  // del chip clickeado. Más robusto que onclick inline con JSON.stringify
  // que rompe con cualquier carácter especial. Lo asignamos una sola vez.
  if (!wrap._quickListener) {
    wrap.addEventListener('click', (e) => {
      const chip = e.target.closest('.qs-chip');
      if (!chip) return;
      const name = chip.dataset.name;
      if (name) addServiceFromQuick(name);
    });
    wrap._quickListener = true;
  }
}

function removeItem(idx) { activeItemsArr().splice(idx,1); renderItems(); sched(); }

function moveItem(idx, dir) {
  const arr = activeItemsArr();
  const next = idx + dir;
  if (next < 0 || next >= arr.length) return;
  const [item] = arr.splice(idx, 1);
  arr.splice(next, 0, item);
  renderItems(); sched();
}

function dupItem(idx) {
  const arr = activeItemsArr();
  const c = JSON.parse(JSON.stringify(arr[idx])); c.id = Date.now();
  delete c._basePrice;
  arr.splice(idx+1, 0, c); renderItems(); sched();
}

// ─── PRECIO SUGERIDO POR ESPECIE ─────────────
// El último precio cobrado por la misma especie, buscado en el historial (lo
// más reciente primero). Es una SUGERENCIA, nunca se carga sola: el precio
// depende del tamaño y del acceso de cada árbol, y un número puesto por la app
// que el usuario no revisó es peor que el campo vacío. La especie se compara
// sin mayúsculas ni tildes. No mira el presupuesto abierto ni los trabajos sin
// presupuesto. "Último" es por fecha de emisión, no por orden de guardado (un
// presupuesto viejo reabierto y vuelto a guardar queda primero en el array).
// Devuelve { price, desc, num } o null.
function _normEspecie(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function ultimoPrecioEspecie(species, unidad) {
  const k = _normEspecie(species);
  // Solo compara precios cobrados de la MISMA forma: un precio por metro no
  // sirve de referencia para un precio cerrado, ni al revés.
  const uni = unidad || '';
  if (!k) return null;
  let mejor = null, mejorFecha = '';
  for (const e of getH()) {
    if (!e || !e.snapshot || e.quoteNumber === S.quoteNumber) continue;
    if (typeof esTrabajoPropio === 'function' && esTrabajoPropio(e)) continue;
    const snap = e.snapshot;
    const fecha = String(snap.dateIssue || e.savedAt || '').slice(0, 10);
    if (mejor && fecha <= mejorFecha) continue;
    for (const arr of [snap.items, snap.itemsB]) {
      if (!Array.isArray(arr)) continue;
      const it = arr.find(x => x && x.type === 'tree' && _normEspecie(x.species) === k && itemUnidad(x) === uni &&
        moneyToCents((x._basePrice !== undefined && x._basePrice !== '') ? x._basePrice : x.price) > 0);
      if (!it) continue;
      // El precio de base (sin el recargo por viáticos de aquel trabajo).
      const p = (it._basePrice !== undefined && it._basePrice !== '') ? it._basePrice : it.price;
      mejor = { price: p, desc: String(it.desc || '').trim(), num: e.quoteNumber || '' };
      mejorFecha = fecha;
      break;
    }
  }
  return mejor;
}
// Pinta (o esconde) la sugerencia debajo del precio. Solo con el precio vacío.
function precioSugSync(card, idx) {
  const box = card && card.querySelector('.pr-sug');
  const sf = card && card.querySelector('.sp-f');
  const pf = card && card.querySelector('.pr-f');
  if (!box || !sf || !pf) return;
  const uni = itemUnidad(activeItemsArr()[idx]);
  const u = moneyToCents(pf.value) > 0 ? null : ultimoPrecioEspecie(sf.value, uni);
  if (!u) { box.hidden = true; box.innerHTML = ''; return; }
  const desc = u.desc ? ' · ' + (u.desc.length > 40 ? u.desc.slice(0, 40) + '…' : u.desc) : '';
  // Con recargo por viáticos en ESTE presupuesto, el campo es el precio
  // ajustado: se propone la base de aquella vez con el recargo de hoy.
  const sur = Number(S.surcharge) || 0;
  const val = sur > 0 ? roundMoney((moneyToCents(u.price) / 100) * (1 + sur / 100)) : moneyToCents(u.price) / 100;
  const por = uni ? ' ' + ITEM_UNIDAD_TXT[uni].por : '';
  box.innerHTML = `<span class="pr-sug-tx">Última vez: <b>${esc(fmtM(val, S.currency || 'ARS'))}</b>${por}${sur > 0 ? ' (con +' + sur + '%)' : ''}${u.num ? ' · ' + esc(u.num) : ''}${esc(desc)}</span>`
    + `<button type="button" class="pr-sug-btn">Usar</button>`;
  box.hidden = false;
  box.querySelector('.pr-sug-btn').onclick = () => {
    pf.value = String(val);
    pf.dispatchEvent(new Event('input', { bubbles: true }));
    box.hidden = true;
  };
}

function setItemField(idx, f, v) { const arr=activeItemsArr(); if(arr[idx]) arr[idx][f]=v; sched(); }

// Cambia cómo se cobra un trabajo ('' = a ojo). Al pasar a una unidad la
// cantidad arranca en 1, así el total no cambia hasta que se carguen los metros.
function setItemUnidad(idx, u) {
  const it = activeItemsArr()[idx];
  if (!it || it.type !== 'tree') return;
  if (ITEM_UNIDADES.indexOf(u) >= 0) {
    if (it.unidad !== u) it.qty = 1;
    it.unidad = u;
  } else {
    delete it.unidad;
    it.qty = 1;
  }
  renderItems();
  updateTotalsBar();
  sched();
}

// Cambia el rubro del presupuesto abierto (selector de arriba del editor).
function setRubro(r) {
  S.rubro = sanEnum(r, RUBROS, 'arbolado');
  rubroSync();
  renderItems();
  if (typeof renderEstItems === 'function') renderEstItems();
  sched();
}

// Refleja el rubro en el editor: botón activo, selector oculto en riesgo y la
// clase .is-jardineria en el panel, que esconde lo que en jardinería no va
// (plan de trabajo, criterios) y cambia "+ Árbol / Trabajo" por "+ Trabajo".
// Solo clases: no escribe en S.
function rubroSync() {
  const jard = esJardineria();
  const panel = document.getElementById('panel-editor');
  if (panel) panel.classList.toggle('is-jardineria', jard);
  const sw = document.getElementById('rubro-switch');
  if (sw) sw.hidden = !!S.isRisk;
  RUBROS.forEach(r => {
    const b = document.getElementById('rubro-btn-' + r);
    if (b) { const on = (r === 'jardineria') === jard; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  });
}

// Completa el placeholder [especie] del "Trabajo a realizar" de UNA tarjeta
// con la especie de esa misma tarjeta. Escribe en el textarea y dispara
// 'input' para que el estado se sincronice por el camino de siempre.
function _fillSpeciesInCard(card, rawSpecies) {
  if (!card) return;
  const ta = card.querySelector('.ds-f');
  if (!ta || !hasSpeciesPlaceholder(ta.value)) return;
  const filled = fillSpeciesPlaceholder(ta.value, rawSpecies);
  if (filled === ta.value) return;   // sin especie cargada todavía
  ta.value = filled;
  ta.dispatchEvent(new Event('input', {bubbles:true}));
  toast('Especie completada en el trabajo a realizar', 'ok', 1600);
}

// Lista de trabajos vacía → solo "+ Árbol / Trabajo", bien a la vista. El
// pedido: "sería muy raro que yo anote un servicio antes de algún árbol o
// trabajo", y los servicios rápidos + "Dos opciones en un PDF" empujaban el
// botón fuera de la pantalla al entrar a la etapa Trabajos. Mira la lista del
// escenario activo (en B vacío también aplica). "Dos opciones en un PDF" se ve
// siempre: es una decisión de cómo armar el presupuesto, y puede tomarse antes
// del primer trabajo (pedido del usuario, v229).
function itemsVacioSync() {
  const sec = document.getElementById('section-normal-items');
  if (!sec) return;
  sec.classList.toggle('is-vacio', !(activeItemsArr() || []).length);
}

function renderItems() {
  const list = document.getElementById('items-list'); if(!list) return;
  const arr  = activeItemsArr();
  const cnt  = document.getElementById('items-count'); if(cnt) cnt.textContent = arr.length;
  itemsVacioSync();
  rubroSync();
  list.innerHTML = '';

  arr.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'icard';
    card.draggable = true;

    const photoRefs = itemPhotoRefs(item);

    let bc='ib-svc', bl='Servicio';
    const jard = esJardineria();
    if(item.type==='tree'){ bc='ib-tree'; bl=jard ? icon('leaf')+' Trabajo' : icon('tree')+' Árbol / Trabajo'; }
    else if(item.type==='note'){ bc='ib-note'; bl='Nota'; }

    let inner = `<span class="drag-h" title="Arrastrar para ordenar">⠿</span><span class="ibadge ${bc}">${bl}</span>`;

    if(item.type==='tree'){
      const basePrice    = item._basePrice !== undefined ? item._basePrice : '';
      const hasSurcharge = S.surcharge > 0 && item._basePrice !== undefined;
      const adjBadge = hasSurcharge
        ? `<div class="adj-badge">${icon('fuel')} +${S.surcharge}% aplicado <span class="adj-orig">(base: ${fmtM(basePrice, S.currency||'ARS')})</span></div>`
        : '';
      // Orden de la tarjeta = orden en que se piensa el trabajo: qué árbol →
      // qué se le hace → cuánto sale (v227; antes el precio iba antes del
      // trabajo). El precio lleva debajo la sugerencia del último precio
      // cobrado por esa especie (precioSugSync), que se usa con un toque.
      // Cobro por unidad (v241): el selector se ve en jardinería, o si el
      // ítem ya tiene unidad (así nunca queda un multiplicador escondido).
      const uni = itemUnidad(item);
      const uTxt = ITEM_UNIDAD_TXT[uni];
      const cobroH = (jard || uni) ? `
        <div class="cobro-row">
          <div class="isub">Cobro</div>
          <div class="cobro-seg" role="group" aria-label="Cómo se cobra">
            <button type="button" class="cobro-b${uni ? '' : ' on'}" data-u="" aria-pressed="${!uni}">A ojo</button>
            ${ITEM_UNIDADES.map(k => `<button type="button" class="cobro-b${uni === k ? ' on' : ''}" data-u="${k}" aria-pressed="${uni === k}">${ITEM_UNIDAD_TXT[k].chip}</button>`).join('')}
          </div>
        </div>` : '';
      const cantH = uni ? `
          <div><div class="isub">Cantidad (${uTxt.varios})</div>
          <input class="ii cant-f" type="text" inputmode="decimal" placeholder="1" value="${esc(String(item.qty == null ? '' : item.qty))}"></div>` : '';
      inner += `
        <div class="mb8">
          <div class="isub">${jard ? 'Planta / Sector' : 'Especie/s'}</div>
          <input class="ii sp-f" type="text" placeholder="${jard ? 'Ej: Cerco de jazmín amarillo, terreno, césped...' : 'Ej: Eucaliptus, Ciprés...'}" value="${esc(item.species||'')}">
        </div>
        <div class="isub mb-row">
          <span>Trabajo a realizar</span>
          <button type="button" class="phrase-btn phrase-btn-mini" onclick="openPhrasesModal('desc','desc-${item.id}')" title="Insertar frase guardada">${icon('pencil')}</button>
        </div>
        <textarea id="desc-${item.id}" class="ita ds-f" placeholder="${jard ? 'Poda de cerco, desmalezado, limpieza de terreno...' : 'Poda de altura, extracción, despeje de ramas...'}">${esc(item.desc||'')}</textarea>
        ${cobroH}
        <div class="item-grid-2" style="margin-top:8px;margin-bottom:${hasSurcharge?'4px':'0'}">
          ${cantH}
          <div><div class="isub">Precio${uni ? ' ' + uTxt.por : ''}${hasSurcharge?' (ajustado)':''}</div>
          <input class="ii pr-f" type="number" min="0" placeholder="0" inputmode="decimal" value="${esc(String(item.price||''))}"></div>
        </div>
        ${uni ? `<div class="qty-preview cobro-prev"></div>` : ''}
        <div class="pr-sug" hidden></div>
        ${adjBadge}`;

    } else if(item.type==='service'){
      const qtyRow = _servicioQtyRowHTML(item, '');

      inner += `
        <div class="item-grid-2">
          <div><div class="isub">Descripción</div>
          <input class="ii ds-f" type="text" placeholder="Servicio (ej: Camión - Viaje)..." value="${esc(item.desc||'')}"></div>
          <div><div class="isub">Precio unitario</div>
          <input class="ii pr-f" type="number" min="0" placeholder="0" inputmode="decimal" value="${esc(String(item.price||''))}"></div>
        </div>
        ${qtyRow}`;

    } else {
      inner += `<div class="isub">Texto de la nota</div>
        <textarea class="ita ds-f" placeholder="Nota informativa...">${esc(item.desc||'')}</textarea>`;
    }

    // Punto amarillo (esquina sup. der.) cuando el ítem tiene una anotación
    // interna. Es indicador + acceso directo: al tocarlo abre el panel de
    // Notas enfocado en este ítem. Agregar/editar se hace desde el panel
    // unificado "Notas" (arriba del editor). No ocupa espacio propio.
    if(item.intNote && item.intNote.trim())
      inner = `<button class="card-note-dot" title="Tiene una anotación interna — tocá para verla" aria-label="Anotación interna"></button>` + inner;

    inner += `<div class="iactions">
      <button class="btn btn-g btn-sm ia-up" ${idx===0?'disabled':''} title="Subir">↑</button>
      <button class="btn btn-g btn-sm ia-down" ${idx===arr.length-1?'disabled':''} title="Bajar">↓</button>
      <button class="btn btn-g btn-sm ia-dup">⧉ Duplicar</button>
      ${item.type!=='note' ? photoBtnHTML(photoRefs) : ''}
      <button class="btn btn-d btn-sm ia-del">✕ Eliminar</button>
    </div>
    ${photoGalleryHTML(photoRefs)}`;
    card.innerHTML = inner;

    const df = card.querySelector('.ds-f');
    if(df) {
      df.addEventListener('input', ()=>setItemField(idx,'desc',df.value));
      // Autocomplete con la DB de servicios (solo para tipo service —
      // y solo cuando ds-f es <input>, no <textarea>; el cambio a input
      // se hace arriba en la generación del HTML).
      if (item.type === 'service' && df.tagName === 'INPUT') {
        attachServiceAutocomplete(df, idx);
      }
    }

    const pf = card.querySelector('.pr-f');
    if(pf) pf.addEventListener('input', ()=>{
      const arrLive = activeItemsArr();
      if(arrLive[idx] && arrLive[idx].type==='tree' && S.surcharge > 0) {
        const newAdj = roundMoney(pf.value);
        arrLive[idx]._basePrice = roundMoney(newAdj / (1 + S.surcharge/100));
      } else if(arrLive[idx]) {
        delete arrLive[idx]._basePrice;
      }
      setItemField(idx,'price',pf.value);
      updateTotalsBar();
      _refreshQtyPreview(card, idx);
    });

    _wireServicioQty(card, '', (k, v) => setItemField(idx, k, v), () => _refreshQtyPreview(card, idx));

    // Cobro por unidad: elegir la unidad re-dibuja la tarjeta (cambian los
    // campos); la cantidad se guarda tal cual se tipea y se lee con itemCant.
    card.querySelectorAll('.cobro-b').forEach(b => b.addEventListener('click', () => setItemUnidad(idx, b.dataset.u)));
    const cf = card.querySelector('.cant-f');
    if(cf) cf.addEventListener('input', ()=>{
      setItemField(idx,'qty',cf.value);
      updateTotalsBar();
      _refreshQtyPreview(card, idx);
    });
    if(item.type==='tree' && itemUnidad(item)) _refreshQtyPreview(card, idx);

    const sf = card.querySelector('.sp-f');
    if(sf && item.type==='tree'){
      // Sugerencia de precio: se recalcula al cambiar la especie o el precio.
      let _sugT = null;
      const sug = () => { clearTimeout(_sugT); _sugT = setTimeout(() => precioSugSync(card, idx), 250); };
      sf.addEventListener('input', sug);
      if (pf) pf.addEventListener('input', sug);
      precioSugSync(card, idx);
    }
    if(sf){
      sf.addEventListener('input', ()=>setItemField(idx,'species',sf.value));
      // Al salir del campo se completa cualquier [especie] que haya
      // quedado en la descripción de ESTA tarjeta (frase insertada antes
      // de cargar la especie, o tarjeta duplicada). En 'blur' y no en
      // 'input': tipeando "Euc" el reemplazo se comería el corchete a
      // medio escribir y no habría vuelta atrás.
      sf.addEventListener('blur', ()=>_fillSpeciesInCard(card, sf.value));
      attachSpeciesAutocomplete(sf, idx);
    }

    // Punto de anotación interna → abre el panel de Notas enfocado en el ítem.
    // Se pasa el objeto `item` (referencia real) para sobrevivir reordenamientos.
    const noteDot = card.querySelector('.card-note-dot');
    if(noteDot) noteDot.addEventListener('click', (e)=>{ e.stopPropagation(); openNotesPanel(item); });

    const dupBtn = card.querySelector('.ia-dup');
    const delBtn = card.querySelector('.ia-del');
    const upBtn = card.querySelector('.ia-up');
    const downBtn = card.querySelector('.ia-down');
    if(upBtn) upBtn.addEventListener('click', ()=>moveItem(idx, -1));
    if(downBtn) downBtn.addEventListener('click', ()=>moveItem(idx, 1));
    if(dupBtn) dupBtn.addEventListener('click', ()=>dupItem(idx));
    if(delBtn) delBtn.addEventListener('click', ()=>removeItem(idx));

    // Foto del ítem (árbol/servicio): abrir selector de imagen y comprimir.
    const photoBtn = card.querySelector('.ia-photo');
    if (photoBtn) photoBtn.addEventListener('click', ()=>pickItemPhoto(idx));
    wireItemPhotoGallery(card, pi => removeItemPhotoRef(activeItemsArr()[idx], pi), renderItems);

    card.addEventListener('dragstart', e=>{ dragSrc=idx; card.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
    card.addEventListener('dragend',   ()=>{ card.classList.remove('dragging'); document.querySelectorAll('.icard').forEach(c=>c.classList.remove('drag-over')); });
    card.addEventListener('dragover',  e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; card.classList.add('drag-over'); });
    card.addEventListener('dragleave', ()=> card.classList.remove('drag-over'));
    card.addEventListener('drop', e=>{
      e.preventDefault(); card.classList.remove('drag-over');
      if(dragSrc===null||dragSrc===idx) return;
      // Validar rango: dragSrc puede ser un índice basura si quedó de
      // otra sesión (mode change, drop sin dragstart, etc.).
      const arrLive = activeItemsArr();
      if(dragSrc<0 || dragSrc>=arrLive.length){ dragSrc=null; return; }
      const mv = arrLive.splice(dragSrc,1)[0]; arrLive.splice(idx,0,mv);
      dragSrc = null; renderItems(); sched();
    });
    list.appendChild(card);
  });
  updateNotesButton();
}

// Campo "Cantidad" de un servicio. Se guarda al tipear, pero el campo NO se
// reescribe mientras se edita: antes, borrar el "1" lo volvía a poner al
// instante (vacío → 1) y para pasar a 2 había que tipear "12" y borrar el 1.
// Vacío cuenta como 1 y se completa recién al salir del campo. Al entrar se
// selecciona el número, así se reemplaza tipeando encima.
function wireQtyInput(qf, onVal) {
  const leer = () => Math.max(1, parseInt(qf.value) || 1);
  qf.addEventListener('focus', () => { try { qf.select(); } catch (_) {} });
  qf.addEventListener('input', () => onVal(leer()));
  qf.addEventListener('blur', () => {
    const v = leer();
    if (qf.value !== String(v)) { qf.value = v; onVal(v); }
  });
}

// ─── Cantidad de un servicio (presupuesto normal y estimativo) ───
// La tarjeta del servicio estaba copiada en los dos editores, y el bug de la
// cantidad que no se podía borrar estaba dos veces. Ahora la fila, su texto y
// su cableado salen de acá. `pre` es el prefijo de clases de cada editor
// ('' o 'est-'): los tests y el resto del código buscan `.qty-f`/`.est-qty-f`.

// "3 × $ 100.000 = $ 300.000", o '' con 1 unidad o sin precio.
function _servicioQtyTxt(item) {
  const qty = parseInt(item.qty) || 1;
  if (qty <= 1 || !(moneyToCents(item.price) > 0)) return '';
  return `${qty} × ${fmtM(item.price, S.currency||'ARS')} = ${fmtM(itemTotal(item), S.currency||'ARS')}`;
}

// El cálculo va en un renglón propio (.qty-preview, css/components.css): al
// lado del campo, en un celular de 360 px se partía en "= $" / "1.200.000".
function _servicioQtyRowHTML(item, pre) {
  const qty = parseInt(item.qty) || 1;
  return `
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px;padding:7px 10px;background:#f1f5f4;border-radius:6px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:140px">
            <div class="isub" style="margin:0;white-space:nowrap">Cantidad</div>
            <input class="ii ${pre}qty-f" type="number" min="1" step="1" inputmode="numeric" value="${qty}"
              style="width:64px;text-align:center;font-weight:700;font-size:14px">
          </div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12.5px;color:var(--muted);white-space:nowrap;flex-shrink:0">
            <span class="tgl" style="width:32px;height:18px">
              <input type="checkbox" class="${pre}showqty-f" ${item.showQty?'checked':''}>
              <span class="tgl-sl"></span>
            </span>
            Desglosar en PDF
          </label>
          <span class="qty-preview">${_servicioQtyTxt(item)}</span>
        </div>`;
}

// `set(campo, valor)` guarda en el ítem de ese editor; `refrescar()` repinta
// el texto de la fila.
function _wireServicioQty(card, pre, set, refrescar) {
  const qf = card.querySelector('.' + pre + 'qty-f');
  if (qf) wireQtyInput(qf, v => { set('qty', v); updateTotalsBar(); refrescar(); });
  const sqf = card.querySelector('.' + pre + 'showqty-f');
  if (sqf) sqf.addEventListener('change', () => set('showQty', sqf.checked));
}

// Actualiza el preview "3 × $X = $Y" en el card sin re-renderizar todo
function _refreshQtyPreview(card, idx) {
  const item = activeItemsArr()[idx]; if(!item) return;
  if (itemUnidad(item)) {
    const span = card.querySelector('.cobro-prev');
    if (span) span.textContent = moneyToCents(item.price) > 0
      ? `${itemCantTxt(item)} × ${fmtM(item.price, S.currency||'ARS')} = ${fmtM(itemTotal(item), S.currency||'ARS')}`
      : '';
    return;
  }
  if(item.type!=='service') return;
  const span = card.querySelector('.qty-preview');
  if(span) span.textContent = _servicioQtyTxt(item);
}

// ─── PANEL DE NOTAS (memoria interna del editor) ──────────────────────────
// Anotaciones privadas que NO salen en el PDF. Un único panel reúne la nota
// general del presupuesto y una nota por cada ítem. El botón "Notas" del
// editor muestra el total y cada tarjeta con nota lleva un punto amarillo.

// Los ítems que muestra el panel = los que se están editando en pantalla
// (escenario activo en normal/riesgo; estItems en estimativo).
function currentEditorItems() {
  if (S.isEstimative) return Array.isArray(S.estItems) ? S.estItems : [];
  return activeItemsArr();
}

// Etiqueta legible de un ítem para el panel / accesibilidad.
function itemInoteLabel(item) {
  if (!item) return 'Ítem';
  if (item.type === 'service') return (item.desc || '').trim() || 'Servicio';
  if (item.type === 'note')    return (item.desc || '').trim() || 'Nota';
  // tree (normal) / work (estimativo)
  return (item.species || '').trim() || (item.desc || '').trim() || 'Árbol / Trabajo';
}

function itemInoteIcon(item) {
  if (!item) return icon('clipboard');
  if (item.type === 'service') return icon('truck');
  if (item.type === 'note')    return icon('pencil');
  return icon('tree');
}

// Cantidad total de notas cargadas (general + ítems del set activo).
function notesCount() {
  let n = (S.intNote && S.intNote.trim()) ? 1 : 0;
  currentEditorItems().forEach(it => { if (it && it.intNote && it.intNote.trim()) n++; });
  return n;
}

// Refresca el contador del botón "Notas" del editor.
function updateNotesButton() {
  const badge = document.getElementById('notes-count');
  if (!badge) return;
  const n = notesCount();
  if (n > 0) { badge.textContent = n; badge.hidden = false; }
  else       { badge.hidden = true; }
  const btn = document.getElementById('btn-notes-panel');
  if (btn) btn.classList.toggle('has-notes', n > 0);
}

// Abre el panel. Si se pasa `focusItem`, hace scroll hasta su nota (sin
// enfocarla). NO abrimos el teclado al abrir: la mayoría de las veces se
// abre solo para leer; el usuario toca el campo si quiere escribir.
function openNotesPanel(focusItem) {
  const ov = document.getElementById('notes-overlay'); if (!ov) return;
  renderNotesPanel();
  ov.classList.add('open');
  if (focusItem && focusItem.id != null) {
    setTimeout(() => {
      const target = document.querySelector(`#notes-item-list .notes-item-ta[data-id="${focusItem.id}"]`);
      if (target) {
        try { target.scrollIntoView({ block: 'center' }); } catch (_) {}
        // Resaltar la nota unos segundos para ubicarla fácil (sin abrir el
        // teclado: es solo un flash visual, no un foco).
        const row = target.closest('.notes-item');
        if (row) {
          row.classList.remove('notes-item-flash');
          void row.offsetWidth;            // reinicia la animación si se repite
          row.classList.add('notes-item-flash');
          setTimeout(() => row.classList.remove('notes-item-flash'), 2600);
        }
      }
    }, 60);
  }
}

function closeNotesPanel() {
  const ov = document.getElementById('notes-overlay'); if (ov) ov.classList.remove('open');
  // Re-render de los ítems para reflejar los puntos amarillos actualizados.
  if (S.isEstimative) { if (typeof renderEstItems === 'function') renderEstItems(); }
  else { if (typeof renderItems === 'function') renderItems(); }
  updateNotesButton();
}

// Arma el contenido del panel: nota general (con su valor + listener) y la
// lista de ítems, cada uno con su textarea de nota vinculada al objeto real.
function renderNotesPanel() {
  const gen = document.getElementById('notes-general-text');
  if (gen) {
    gen.value = S.intNote || '';
    if (!gen._wired) {
      gen.addEventListener('input', () => {
        S.intNote = gen.value;
        updateNotesButton();
        sched();
      });
      gen._wired = true;
    }
  }

  const list = document.getElementById('notes-item-list');
  const head = document.getElementById('notes-items-head');
  if (!list) return;
  const items = currentEditorItems();
  list.innerHTML = '';
  if (head) head.style.display = items.length ? '' : 'none';

  if (!items.length) {
    list.innerHTML = `<div class="notes-empty">Todavía no hay árboles ni servicios cargados. Agregalos en el editor para poder anotarles algo.</div>`;
    return;
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'notes-item';
    const has = !!(item.intNote && item.intNote.trim());
    row.innerHTML =
      `<div class="notes-item-hd"><span class="notes-item-ic">${itemInoteIcon(item)}</span>` +
      `<span class="notes-item-name">${esc(itemInoteLabel(item))}</span>` +
      `<span class="notes-item-dot${has ? ' on' : ''}" aria-hidden="true"></span></div>` +
      `<textarea class="notes-item-ta" data-id="${esc(String(item.id))}" rows="2" placeholder="Anotación para este ítem…">${esc(item.intNote || '')}</textarea>`;
    const ta = row.querySelector('.notes-item-ta');
    ta.addEventListener('input', () => {
      item.intNote = ta.value;
      const dot = row.querySelector('.notes-item-dot');
      if (dot) dot.classList.toggle('on', !!ta.value.trim());
      updateNotesButton();
      sched();
    });
    list.appendChild(row);
  });
}

// ─── SURCHARGE ───────────────────────────────
function applySurcharge() {
  const pct = parseFloat(gv('surcharge-pct')) || 0;
  if (pct <= 0)   { toast('Ingresá un porcentaje mayor a 0', 'err'); return; }
  if (pct > 200)  { toast('El porcentaje máximo es 200%', 'err'); return; }

  // El recargo se aplica al escenario activo (A o B).
  const arr = activeItemsArr();

  arr.forEach(item => {
    if (item.type === 'tree' && item._basePrice !== undefined) {
      item.price = item._basePrice;
    }
  });

  const factor = 1 + pct / 100;
  let affected = 0;
  arr.forEach(item => {
    if (item.type === 'tree' && item.price !== '' && item.price !== null) {
      const baseCents = moneyToCents(item.price);
      if (baseCents > 0) {
        const base = centsToMoney(baseCents);
        item._basePrice = base;
        item.price = centsToMoney(Math.round(baseCents * factor));
        affected++;
      }
    }
  });

  if (affected === 0) { toast('No hay ítems de árbol con precio para ajustar', 'err'); return; }

  S.surcharge = pct;
  renderItems(); updateTotalsBar(); updateSurchargeUI(); sched();
  toast(`+${pct}% aplicado a ${affected} ítem${affected>1?'s':''} de árbol`, 'ok');
}

function clearSurcharge() {
  activeItemsArr().forEach(item => {
    if (item.type === 'tree' && item._basePrice !== undefined) {
      item.price = item._basePrice;
      delete item._basePrice;
    }
  });
  S.surcharge = 0;
  sv('surcharge-pct', 0);
  renderItems(); updateTotalsBar(); updateSurchargeUI(); sched();
  toast('Ajuste eliminado — precios restaurados', 'info');
}

function updateSurchargeUI() {
  const clearBtn = document.getElementById('sp-clear-btn');
  const descEl   = document.getElementById('sp-desc-text');
  const panel    = document.getElementById('surcharge-panel');
  const statusEl = document.getElementById('sp-status');
  const hasSurch = S.surcharge > 0;
  if (clearBtn) clearBtn.style.display = hasSurch ? '' : 'none';
  if (panel) {
    panel.style.borderColor = hasSurch ? '#f59e0b' : '#fcd34d';
    panel.style.background  = hasSurch
      ? 'linear-gradient(135deg,#fef3c7,#fde68a)'
      : 'linear-gradient(135deg,#fffbeb,#fef3c7)';
  }
  if (descEl) {
    descEl.textContent = hasSurch
      ? `Recargo del ${S.surcharge}% activo — solo sobre trabajos de árbol. Servicios externos sin cambios.`
      : 'Aplicá un % extra sobre los trabajos de árbol. El cliente ve solo el precio final ajustado.';
  }
  // Pill compacto del panel colapsado: muestra el % activo o "0%"
  if (statusEl) {
    statusEl.textContent = hasSurch ? `+${S.surcharge}%` : '0%';
    statusEl.classList.toggle('active', hasSurch);
  }
  // Si hay surcharge activo, expandir el panel automáticamente (así el
  // usuario ve los controles disponibles para limpiar/cambiar el ajuste)
  if (hasSurch && panel && panel.classList.contains('surcharge-collapsed')) {
    toggleSurchargePanel(true);
  }
}

// Toggle del panel de surcharge. Si se pasa `forceOpen=true`, fuerza
// el estado expandido (usado cuando hay surcharge activo y queremos
// que el usuario lo vea).
function toggleSurchargePanel(forceOpen) {
  const panel = document.getElementById('surcharge-panel');
  const body  = document.getElementById('surcharge-body');
  const header = panel && panel.querySelector('.surcharge-header');
  if (!panel || !body) return;
  const willOpen = (forceOpen === true) ? true : panel.classList.contains('surcharge-collapsed');
  if (willOpen) {
    panel.classList.remove('surcharge-collapsed');
    body.style.display = '';
    if (header) header.setAttribute('aria-expanded', 'true');
  } else {
    panel.classList.add('surcharge-collapsed');
    body.style.display = 'none';
    if (header) header.setAttribute('aria-expanded', 'false');
  }
}

// ─── ESTIMATIVE ITEMS ────────────────────────
function addEstItem()    { S.estItems.push({id:Date.now(), type:'work',    desc:'', price:''}); renderEstItems(); sched(); }
function addEstService() { S.estItems.push({id:Date.now(), type:'service', desc:'', price:'', qty:1, showQty:false}); renderEstItems(); sched(); }
function addEstNote()    { S.estItems.push({id:Date.now(), type:'note',    desc:'', price:''}); renderEstItems(); sched(); }
function removeEstItem(idx) { S.estItems.splice(idx,1); renderEstItems(); sched(); }

function moveEstItem(idx, dir) {
  const next = idx + dir;
  if (next < 0 || next >= S.estItems.length) return;
  const [item] = S.estItems.splice(idx, 1);
  S.estItems.splice(next, 0, item);
  renderEstItems(); sched();
}

function dupEstItem(idx) {
  const c = JSON.parse(JSON.stringify(S.estItems[idx])); c.id = Date.now();
  S.estItems.splice(idx+1, 0, c); renderEstItems(); sched();
}

function setEstItemField(idx, f, v) { if(S.estItems[idx]) S.estItems[idx][f]=v; sched(); }

function renderEstItems() {
  const list = document.getElementById('est-items-list'); if(!list) return;
  const cnt  = document.getElementById('est-items-count');
  if (cnt) cnt.textContent = S.estItems.filter(i=>i.type==='work'||i.type==='service').length;
  list.innerHTML = '';

  S.estItems.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'icard';
    const photoRefs = itemPhotoRefs(item);

    if (item.type === 'work') {
      card.innerHTML = `
        <span class="drag-h" title="Arrastrar">⠿</span>
        <span class="ibadge ib-tree">${icon('tree')} Trabajo estimado</span>
        <div class="item-grid-2" style="margin-bottom:8px">
          <div>
            <div class="isub">Descripción del trabajo</div>
            <textarea class="ita est-desc-f" placeholder="Ej: Poda de eucalipto de aprox. 8m de altura...">${esc(item.desc||'')}</textarea>
          </div>
          <div>
            <div class="isub">Costo estimado</div>
            <input class="ii est-pr-f" type="number" min="0" placeholder="0" inputmode="decimal" value="${esc(String(item.price||''))}">
          </div>
        </div>
        <div class="iactions">
          <button class="btn btn-g btn-sm ia-up" ${idx===0?'disabled':''} title="Subir">↑</button>
          <button class="btn btn-g btn-sm ia-down" ${idx===S.estItems.length-1?'disabled':''} title="Bajar">↓</button>
          <button class="btn btn-g btn-sm ia-dup">⧉ Duplicar</button>
          ${photoBtnHTML(photoRefs)}
          <button class="btn btn-d btn-sm ia-del">✕ Eliminar</button>
        </div>
        ${photoGalleryHTML(photoRefs)}`;

    } else if (item.type === 'service') {
      const qtyRow = _servicioQtyRowHTML(item, 'est-');

      card.innerHTML = `
        <span class="drag-h" title="Arrastrar">⠿</span>
        <span class="ibadge ib-fixed">${icon('truck')} Servicio / Costo fijo</span>
        <div class="item-grid-2" style="margin-bottom:8px">
          <div>
            <div class="isub">Descripción del servicio</div>
            <input class="ii est-desc-f" type="text" placeholder="Servicio (ej: Camión - Viaje)..." value="${esc(item.desc||'')}">
          </div>
          <div>
            <div class="isub">Precio unitario</div>
            <input class="ii est-pr-f" type="number" min="0" placeholder="0" inputmode="decimal" value="${esc(String(item.price||''))}">
          </div>
        </div>
        ${qtyRow}
        <div class="iactions">
          <button class="btn btn-g btn-sm ia-up" ${idx===0?'disabled':''} title="Subir">↑</button>
          <button class="btn btn-g btn-sm ia-down" ${idx===S.estItems.length-1?'disabled':''} title="Bajar">↓</button>
          <button class="btn btn-g btn-sm ia-dup">⧉ Duplicar</button>
          ${photoBtnHTML(photoRefs)}
          <button class="btn btn-d btn-sm ia-del">✕ Eliminar</button>
        </div>
        ${photoGalleryHTML(photoRefs)}`;

    } else {
      card.innerHTML = `
        <span class="drag-h" title="Arrastrar">⠿</span>
        <span class="ibadge ib-note">Nota</span>
        <div class="isub">Texto de la nota</div>
        <textarea class="ita est-desc-f" placeholder="Nota informativa...">${esc(item.desc||'')}</textarea>
        <div class="iactions">
          <button class="btn btn-g btn-sm ia-up" ${idx===0?'disabled':''} title="Subir">↑</button>
          <button class="btn btn-g btn-sm ia-down" ${idx===S.estItems.length-1?'disabled':''} title="Bajar">↓</button>
          <button class="btn btn-d btn-sm ia-del">✕ Eliminar</button>
        </div>`;
    }

    // Punto amarillo (esquina sup. der.) cuando el ítem estimado tiene una
    // anotación interna. Indicador + acceso directo al panel de Notas.
    if (item.intNote && item.intNote.trim()) {
      const _nd = document.createElement('button');
      _nd.className = 'card-note-dot';
      _nd.title = 'Tiene una anotación interna — tocá para verla';
      _nd.setAttribute('aria-label', 'Anotación interna');
      card.appendChild(_nd);
    }

    const df = card.querySelector('.est-desc-f');
    if(df) {
      df.addEventListener('input', ()=>setEstItemField(idx,'desc',df.value));
      // Autocomplete con servicios (idem renderItems)
      if (item.type === 'service' && df.tagName === 'INPUT') {
        // idx + offset 'est-' para no colisionar con datalist ids de items normales
        attachServiceAutocomplete(df, 'est-' + idx);
      }
    }

    // Punto de anotación interna → abre el panel de Notas enfocado en el ítem.
    const noteDot = card.querySelector('.card-note-dot');
    if(noteDot) noteDot.addEventListener('click', (e)=>{ e.stopPropagation(); openNotesPanel(item); });

    const pf = card.querySelector('.est-pr-f');
    if(pf) pf.addEventListener('input', ()=>{
      setEstItemField(idx,'price',pf.value);
      updateTotalsBar();
      _refreshEstQtyPreview(card, idx);
    });

    _wireServicioQty(card, 'est-', (k, v) => setEstItemField(idx, k, v), () => _refreshEstQtyPreview(card, idx));

    const dupBtn = card.querySelector('.ia-dup');
    const delBtn = card.querySelector('.ia-del');
    const upBtn = card.querySelector('.ia-up');
    const downBtn = card.querySelector('.ia-down');
    if(upBtn) upBtn.addEventListener('click', ()=>moveEstItem(idx, -1));
    if(downBtn) downBtn.addEventListener('click', ()=>moveEstItem(idx, 1));
    if(dupBtn) dupBtn.addEventListener('click', ()=>dupEstItem(idx));
    if(delBtn) delBtn.addEventListener('click', ()=>removeEstItem(idx));

    const photoBtn = card.querySelector('.ia-photo');
    if (photoBtn) photoBtn.addEventListener('click', ()=>pickEstItemPhoto(idx));
    wireItemPhotoGallery(card, pi => removeItemPhotoRef(S.estItems[idx], pi), renderEstItems);

    card.draggable = true;
    card.addEventListener('dragstart', e=>{ dragSrc=idx; card.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
    card.addEventListener('dragend',   ()=>{ card.classList.remove('dragging'); document.querySelectorAll('.icard').forEach(c=>c.classList.remove('drag-over')); });
    card.addEventListener('dragover',  e=>{ e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', ()=> card.classList.remove('drag-over'));
    card.addEventListener('drop', e=>{
      e.preventDefault(); card.classList.remove('drag-over');
      if(dragSrc===null||dragSrc===idx) return;
      // Validar rango (ver renderItems para detalles).
      if(dragSrc<0 || dragSrc>=S.estItems.length){ dragSrc=null; return; }
      const mv = S.estItems.splice(dragSrc,1)[0]; S.estItems.splice(idx,0,mv);
      dragSrc = null; renderEstItems(); sched();
    });

    list.appendChild(card);
  });
  updateNotesButton();
}

function _refreshEstQtyPreview(card, idx) {
  const item = S.estItems[idx]; if(!item||item.type!=='service') return;
  const span = card.querySelector('.qty-preview');
  if(span) span.textContent = _servicioQtyTxt(item);
}


// ═══════════════════════════════════════════════════════════
// FOTO POR ÍTEM (árbol/servicio) — para el registro fotográfico del PDF
// ═══════════════════════════════════════════════════════════
// Abre el selector de imágenes del dispositivo, comprime la foto a un
// tamaño razonable para documento (máx 1000px lado mayor, JPEG calidad
// 0.7) y la guarda en IndexedDB vía savePhoto(), dejando en item.photo solo
// el ID (o el dataURL embebido si IDB no está disponible). La compresión
// evita que el almacenamiento del navegador se llene con fotos de varios MB.
// Núcleo: abre el selector múltiple de imágenes, comprime y guarda cada una
// (savePhoto → ref) y por cada ref llama getItem() para obtener el ítem
// destino y agregarle la foto. Al terminar, si agregó alguna, persiste y
// re-renderiza vía after(). Lo comparten los 3 modos (normal/est/riesgo).
function _pickItemPhotos(getItem, after) {
  _pickPhotos(ref => { const it = getItem(); if (!it) return false; addItemPhotoRef(it, ref); return true; },
              after, 'al ítem');
}

// Núcleo genérico: elegir varias imágenes, comprimirlas y guardarlas
// (savePhoto → ref). `addRef(ref)` decide dónde va cada una y devuelve si la
// pudo guardar; `after()` re-dibuja lo que corresponda. Lo usan las fotos de
// ítem (los 3 modos) y las del lugar de disposición de la leña.
function _pickPhotos(addRef, after, destino) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;   // se pueden elegir varias fotos por ítem
  input.onchange = async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    let added = 0;
    for (const file of files) {
      try {
        const dataUrl = await compressImage(file, 1000, 0.7);
        const ref = await savePhoto(dataUrl);
        if (addRef(ref)) added++;
      } catch(err){ console.error('Error al procesar la foto:', err); }
    }
    if (added) {
      sched();
      after();
      toast(`${added} foto${added>1?'s':''} agregada${added>1?'s':''} ${destino}`, 'ok', 1800);
    } else {
      toast('No se pudo procesar la foto', 'err');
    }
  };
  input.click();
}

// Foto(s) para un ítem normal (S.items / escenario B).
function pickItemPhoto(idx) {
  _pickItemPhotos(() => activeItemsArr()[idx], renderItems);
}

// Foto(s) para un ítem estimativo (S.estItems).
function pickEstItemPhoto(idx) {
  _pickItemPhotos(() => S.estItems[idx], renderEstItems);
}

// ═══════════════════════════════════════════════════════════
// LUGAR DE DISPOSICIÓN DE LA LEÑA / RESIDUOS
// ═══════════════════════════════════════════════════════════
// Las fotos van al presupuesto (S.dispoPhotos), no a un ítem: es UN lugar
// acordado para todo el trabajo.
function pickDispoPhoto() {
  _pickPhotos(ref => {
    if (!Array.isArray(S.dispoPhotos)) S.dispoPhotos = [];
    S.dispoPhotos.push(ref);
    return true;
  }, renderDispo, 'al lugar de disposición');
}

function removeDispoPhoto(pi) {
  if (!Array.isArray(S.dispoPhotos)) return;
  if (pi < 0 || pi >= S.dispoPhotos.length) return;
  S.dispoPhotos.splice(pi, 1);
}

// Dibuja la galería del lugar de disposición (misma UI que la de los ítems:
// miniatura con ✕ y tap para ampliar) y refresca el contador del botón.
function renderDispo() {
  const cont = document.getElementById('dispo-gallery');
  if (!cont) return;
  const refs = dispoPhotoRefs();
  cont.innerHTML = photoGalleryHTML(refs);
  wireItemPhotoGallery(cont, removeDispoPhoto, renderDispo);
  const btn = document.getElementById('dispo-photo-btn');
  if (btn) btn.innerHTML = refs.length
    ? `${icon('camera')} Fotos del lugar ✓ (${refs.length})`
    : `${icon('camera')} Foto del lugar`;
  if (typeof editorShellSync === 'function') editorShellSync();
}

// ═══════════════════════════════════════════════════════════
// BANDEJA DE FOTOS COMPARTIDAS — Web Share Target (solo Android)
// ═══════════════════════════════════════════════════════════
// Flujo: el usuario comparte N fotos a la app → el SW las stashea en
// IndexedDB y redirige a ?share=1 → core.js llama a processSharedPhotos().
// Cada foto se comprime y se guarda (savePhoto → ref p_...). Luego se abre
// una bandeja (modal) para que el usuario decida el destino de cada foto:
// crear un árbol nuevo (por defecto) o asignarla a un ítem existente.
// Las fotos viven en los ítems NORMALES (S.items); por eso forzamos modo
// normal al aplicar (el usuario puede pasar a estimativo después a mano).
const MAX_SHARED_PHOTOS = 12;   // tope para no reventar cuota/render
let _shareTrayRefs = [];        // refs de fotos pendientes de asignar

async function processSharedPhotos(){
  const blobs = await drainShareInbox();
  if (!blobs.length) return;
  const slice = blobs.slice(0, MAX_SHARED_PHOTOS);
  if (blobs.length > MAX_SHARED_PHOTOS) {
    toast(`Se recibieron muchas fotos; se procesan las primeras ${MAX_SHARED_PHOTOS}`, 'info', 3500);
  } else {
    toast('Procesando fotos compartidas…', 'info', 1500);
  }
  const refs = [];
  for (const blob of slice) {
    try {
      const dataUrl = await compressImage(blob, 1000, 0.7);
      const ref = await savePhoto(dataUrl);
      refs.push(ref);
    } catch(e){ console.warn('No se pudo procesar una foto compartida', e); }
  }
  if (!refs.length) { toast('No se pudieron procesar las fotos', 'err'); return; }
  openShareTray(refs);
}

// Muestra la bandeja con las miniaturas recibidas. Por cada foto, un <select>
// elige el destino: árbol nuevo (default), un ítem existente, o descartar.
function openShareTray(refs){
  _shareTrayRefs = refs.slice();
  const ov   = document.getElementById('share-overlay');
  const list = document.getElementById('share-tray-list');
  // Sin modal disponible (versión vieja en caché): fallback que auto-crea
  // un árbol por foto, sin perder las fotos recibidas.
  if (!ov || !list) { assignSharedToNewItems(refs); return; }

  const arr = activeItemsArr();
  const existingOpts = arr
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.type === 'tree' || it.type === 'service')
    .map(({ it, i }) => {
      const label = it.type === 'tree'
        ? (it.species || `Árbol ${i + 1}`)
        : (it.desc || `Servicio ${i + 1}`);
      return `<option value="${i}">Asignar a: ${esc(label)}</option>`;
    }).join('');

  list.innerHTML = refs.map((ref, idx) => {
    const src = safeImgSrc(getPhotoData(ref));
    return `
      <div class="share-row">
        <div class="share-thumb">${src ? `<img src="${src}" alt="Foto compartida">` : icon('camera')}</div>
        <select class="ii share-dest" data-idx="${idx}">
          <option value="new" selected>+ Crear árbol nuevo</option>
          ${existingOpts}
          <option value="skip">✕ Descartar</option>
        </select>
      </div>`;
  }).join('');

  const cnt = document.getElementById('share-tray-count');
  if (cnt) cnt.textContent = refs.length;
  ov.classList.add('open');
}

// Aplica las decisiones de la bandeja: crea árboles nuevos o asigna a ítems
// existentes según el <select> de cada foto. Fuerza modo normal para que los
// ítems con foto queden visibles en el editor.
function confirmShareTray(){
  const ov = document.getElementById('share-overlay');
  const arr = activeItemsArr();
  let assigned = 0;
  if (ov) {
    ov.querySelectorAll('.share-dest').forEach(sel => {
      const idx = parseInt(sel.dataset.idx, 10);
      const ref = _shareTrayRefs[idx];
      if (!ref) return;
      const dest = sel.value;
      if (dest === 'skip') return;
      if (dest === 'new') {
        arr.push({ id: Date.now() + idx, type: 'tree', species: '', desc: '', price: '', qty: 1, showQty: false, photos: [ref] });
        assigned++;
      } else {
        const di = parseInt(dest, 10);
        if (arr[di]) { addItemPhotoRef(arr[di], ref); assigned++; }
      }
    });
  }
  closeShareTray();
  if (assigned) {
    setMode('normal');           // las fotos viven en ítems normales (S.items)
    renderItems();
    switchTab('editor');
    sched();
    toast(`${assigned} foto${assigned > 1 ? 's' : ''} agregada${assigned > 1 ? 's' : ''} al presupuesto`, 'ok');
  } else {
    toast('No se agregó ninguna foto', 'info');
  }
}

// Fallback (sin modal): un árbol nuevo por cada foto recibida.
function assignSharedToNewItems(refs){
  const arr = activeItemsArr();
  refs.forEach((ref, i) => {
    arr.push({ id: Date.now() + i, type: 'tree', species: '', desc: '', price: '', qty: 1, showQty: false, photos: [ref] });
  });
  setMode('normal');
  renderItems();
  switchTab('editor');
  sched();
  toast(`${refs.length} foto${refs.length > 1 ? 's' : ''} agregada${refs.length > 1 ? 's' : ''}`, 'ok');
}

function closeShareTray(){
  const ov = document.getElementById('share-overlay');
  if (ov) ov.classList.remove('open');
  _shareTrayRefs = [];
}

// ─── VISOR DE FOTO A PANTALLA COMPLETA ────────────────────────────
// Para revisar la foto de un ítem durante la edición (evaluar el árbol,
// decidir el trabajo y el precio). Recibe un dataURL ya validado con
// safeImgSrc(); si viene vacío no abre nada.
function openPhotoViewer(src){
  if (!src) return;
  const ov  = document.getElementById('photo-viewer-overlay');
  const img = document.getElementById('photo-viewer-img');
  if (!ov || !img) return;
  _pvReset(false);
  img.src = src;
  ov.classList.add('open');
}

function closePhotoViewer(){
  const ov  = document.getElementById('photo-viewer-overlay');
  const img = document.getElementById('photo-viewer-img');
  if (ov)  ov.classList.remove('open');
  if (img) img.src = '';   // liberar el dataURL en memoria
  _pvReset(false);
}

// ─── Gestos del visor de fotos ───────────────────────────────────
// La foto del ítem es para evaluar el árbol (dónde está la rama seca, si toca
// el cable), y antes solo se podía mirar entera: tocarla la cerraba. Ahora:
//   · pellizcar acerca/aleja (hasta 5×) alrededor de los dedos;
//   · doble toque acerca 2,5× donde se tocó, y otro doble toque vuelve;
//   · con zoom, un dedo arrastra la foto (sin salirse de sus bordes);
//   · sin zoom, deslizar hacia arriba o abajo la cierra (como en la galería);
//   · sin zoom, un toque la cierra como siempre (después de esperar un posible
//     doble toque). El ✕ y "Atrás" siguen cerrando.
// Pointer events + touch-action:none en el overlay: el navegador no hace su
// propio zoom de página encima (que agrandaba toda la app y no la foto).
const PV = { z: 1, x: 0, y: 0, ptrs: new Map(), g: null, tapT: 0, tapX: 0, tapY: 0, tapTimer: null };
function _pvApply(animar) {
  const img = document.getElementById('photo-viewer-img');
  const ov  = document.getElementById('photo-viewer-overlay');
  if (!img) return;
  img.style.transition = animar ? 'transform .2s ease' : 'none';
  img.style.transform = (PV.z === 1 && !PV.x && !PV.y) ? '' :
    `translate(${PV.x}px, ${PV.y}px) scale(${PV.z})`;
  // Al arrastrar para cerrar, el fondo se aclara: se ve que se va a cerrar.
  if (ov) ov.style.background = (PV.z === 1 && PV.y) ?
    `rgba(0,0,0,${Math.max(0.35, 0.92 - Math.abs(PV.y) / 400)})` : '';
}
function _pvReset(animar) {
  PV.z = 1; PV.x = 0; PV.y = 0; PV.ptrs.clear(); PV.g = null;
  clearTimeout(PV.tapTimer); PV.tapTimer = null; PV.tapT = 0;
  _pvApply(animar);
}
// Que la foto agrandada no se pueda arrastrar fuera de la pantalla.
function _pvLimitar() {
  const img = document.getElementById('photo-viewer-img');
  if (!img) return;
  const mx = Math.max(0, (img.offsetWidth * PV.z - window.innerWidth) / 2);
  const my = Math.max(0, (img.offsetHeight * PV.z - window.innerHeight) / 2);
  PV.x = Math.min(mx, Math.max(-mx, PV.x));
  PV.y = Math.min(my, Math.max(-my, PV.y));
}
// Zoom a `z` dejando quieto el punto de pantalla (px,py) que estaba en (ax,ay)
// con el zoom z0 y el corrimiento (x0,y0). El centro de la foto es el centro
// de la pantalla (el overlay la centra con flex).
function _pvZoomEn(z, z0, x0, y0, ax, ay, px, py) {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  PV.z = z;
  PV.x = px - cx - z * (ax - cx - x0) / z0;
  PV.y = py - cy - z * (ay - cy - y0) / z0;
}
function _pvTap(e) {
  const now = Date.now();
  const doble = PV.tapT && now - PV.tapT < 300 &&
    Math.abs(e.clientX - PV.tapX) < 30 && Math.abs(e.clientY - PV.tapY) < 30;
  clearTimeout(PV.tapTimer); PV.tapTimer = null;
  if (doble) {
    PV.tapT = 0;
    if (PV.z > 1) { PV.z = 1; PV.x = 0; PV.y = 0; }
    else { _pvZoomEn(2.5, 1, 0, 0, e.clientX, e.clientY, e.clientX, e.clientY); _pvLimitar(); }
    _pvApply(true);
    return;
  }
  PV.tapT = now; PV.tapX = e.clientX; PV.tapY = e.clientY;
  if (PV.z === 1) PV.tapTimer = setTimeout(() => { PV.tapTimer = null; closePhotoViewer(); }, 300);
}
function pvGestosInit() {
  const ov = document.getElementById('photo-viewer-overlay');
  if (!ov) return;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  ov.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('#photo-viewer-close')) return;
    PV.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { ov.setPointerCapture(e.pointerId); } catch (_) {}
    const ps = [...PV.ptrs.values()];
    if (ps.length === 1) {
      PV.g = { tipo: 'uno', sx: e.clientX, sy: e.clientY, x0: PV.x, y0: PV.y, t: Date.now(), movio: false };
    } else if (ps.length === 2) {
      clearTimeout(PV.tapTimer); PV.tapTimer = null; PV.tapT = 0;
      PV.g = { tipo: 'pinza', d0: dist(ps[0], ps[1]) || 1, z0: PV.z, x0: PV.x, y0: PV.y,
        ax: (ps[0].x + ps[1].x) / 2, ay: (ps[0].y + ps[1].y) / 2 };
    }
  });
  ov.addEventListener('pointermove', (e) => {
    if (!PV.ptrs.has(e.pointerId) || !PV.g) return;
    PV.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = PV.g;
    if (g.tipo === 'pinza') {
      const ps = [...PV.ptrs.values()];
      if (ps.length < 2) return;
      const z = Math.min(5, Math.max(1, g.z0 * dist(ps[0], ps[1]) / g.d0));
      _pvZoomEn(z, g.z0, g.x0, g.y0, g.ax, g.ay, (ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2);
      _pvApply(false);
      return;
    }
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (!g.movio && Math.hypot(dx, dy) < 8) return;
    g.movio = true;
    if (PV.z > 1) { PV.x = g.x0 + dx; PV.y = g.y0 + dy; _pvLimitar(); }
    else { PV.x = 0; PV.y = dy; }       // sin zoom: arrastre vertical para cerrar
    _pvApply(false);
  });
  const fin = (e) => {
    if (!PV.ptrs.has(e.pointerId)) return;
    PV.ptrs.delete(e.pointerId);
    const g = PV.g;
    if (!g) return;
    if (g.tipo === 'pinza') {
      if (PV.ptrs.size) {                 // queda un dedo: sigue como arrastre
        const r = [...PV.ptrs.values()][0];
        PV.g = { tipo: 'uno', sx: r.x, sy: r.y, x0: PV.x, y0: PV.y, t: 0, movio: true };
        return;
      }
      PV.g = null;
      if (PV.z < 1.05) { PV.z = 1; PV.x = 0; PV.y = 0; } else _pvLimitar();
      _pvApply(true);
      return;
    }
    PV.g = null;
    if (e.type === 'pointercancel') { if (PV.z === 1) { PV.y = 0; _pvApply(true); } return; }
    if (!g.movio) { _pvTap(e); return; }
    if (PV.z === 1) {
      if (Math.abs(PV.y) > 110) { haptic(8); closePhotoViewer(); }
      else { PV.y = 0; _pvApply(true); }
    }
  };
  ov.addEventListener('pointerup', fin);
  ov.addEventListener('pointercancel', fin);
}

// Cerrar el visor con Escape (en desktop). En el celular se cierra tocando.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const ov = document.getElementById('photo-viewer-overlay');
  if (ov && ov.classList.contains('open')) closePhotoViewer();
});

// Comprime una imagen: la redimensiona para que el lado mayor no supere
// maxSide px y la re-codifica como JPEG con la calidad dada. Devuelve una
// promesa con el dataURL resultante.
function compressImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        // Imagen sin dimensiones válidas (corrupta o no soportada): evitamos
        // dividir por cero (que generaría NaN/Infinity y rompería el canvas).
        if (!width || !height) { reject(new Error('La imagen no es válida o está dañada.')); return; }
        if (width > height && width > maxSide) {
          height = Math.round(height * maxSide / width); width = maxSide;
        } else if (height > maxSide) {
          width = Math.round(width * maxSide / height); height = maxSide;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        // Fondo blanco por si la imagen tiene transparencia (PNG)
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
