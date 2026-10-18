'use strict';

// ═══════════════════════════════════════
// CLIENTS.JS — Base de clientes, especies, autocompletar
// ═══════════════════════════════════════

// ─── SPECIES DB ──────────────────────────────
const SPECIES_KEY = 'pq_species';

function getSpeciesDB() {
  try { return JSON.parse(localStorage.getItem(SPECIES_KEY)||'[]'); } catch(e){ return []; }
}

function saveSpeciesToDB(raw) {
  const names = raw.split(/[,;]+/).map(s=>s.trim()).filter(s=>s.length>1);
  if (!names.length) return;
  const db = getSpeciesDB();
  let changed = false;
  names.forEach(name => {
    const key = name.toLowerCase();
    if (!db.some(s=>s.toLowerCase()===key)) { db.push(name); changed=true; }
  });
  if (changed) {
    db.sort((a,b)=>a.localeCompare(b,'es'));
    safeSetLS(SPECIES_KEY, JSON.stringify(db));
  }
}

function getSpeciesSuggestions(query) {
  if (!query || query.length < 1) return [];
  const q = query.toLowerCase();
  return getSpeciesDB().filter(s => {
    const sl = s.toLowerCase();
    return sl.startsWith(q) || sl.split(/\s+/).some(w=>w.startsWith(q));
  }).slice(0, 8);
}

function attachSpeciesAutocomplete(input, idx) {
  const dlId = 'sp-dl-' + idx;
  let dl = document.getElementById(dlId);
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = dlId;
    document.body.appendChild(dl);
  }
  input.setAttribute('list', dlId);
  input.setAttribute('autocomplete', 'off');

  function refreshList() {
    const parts = input.value.split(/[,;]+/);
    const current = (parts[parts.length-1]||'').trim();
    const suggestions = getSpeciesSuggestions(current);
    dl.innerHTML = suggestions.map(s => `<option value="${esc(s)}">`).join('');
  }

  input.addEventListener('input', refreshList);
  input.addEventListener('focus', refreshList);
  input.addEventListener('blur', () => {
    if (input.value.trim()) saveSpeciesToDB(input.value);
  });
}

function deleteSpeciesFromDB(name) {
  const db = getSpeciesDB().filter(s=>s!==name);
  safeSetLS(SPECIES_KEY, JSON.stringify(db));
}

// Wrapper con confirmación para uso desde la UI. Evita borrados accidentales.
async function confirmDeleteSpecies(name) {
  const ok = await confirmDlg(
    'Eliminar especie',
    `¿Eliminar "${name}" de las especies guardadas? Esta acción no se puede deshacer.`,
    'Eliminar', 'btn-d'
  );
  if (!ok) return;
  deleteSpeciesFromDB(name);
  renderSpeciesManager();
  if (typeof updateCollapsibleCounts === 'function') updateCollapsibleCounts();
  toast(`Especie "${name}" eliminada`, 'info');
}

function renderSpeciesManager() {
  const el = document.getElementById('species-manager-list');
  if (!el) return;
  const db = getSpeciesDB();
  if (!db.length) {
    el.innerHTML='<div class="empty-h" style="padding:20px">No hay especies guardadas aún.</div>';
    return;
  }
  el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">`+
    db.map(sp=>`
      <span style="display:inline-flex;align-items:center;gap:5px;background:#f0f9f4;border:1px solid #a7f3d0;border-radius:20px;padding:4px 10px;font-size:12px;color:#065f46;font-weight:500">
        ${esc(sp)}
        <button class="chip-del-species" data-name="${esc(sp)}" style="background:none;border:none;cursor:pointer;color:#6b7280;font-size:14px;line-height:1;padding:0 0 0 2px">×</button>
      </span>`).join('')+`</div>`;
  // Listener delegado (ver renderQuickServices). El nombre va en
  // data-name para evitar romper con caracteres especiales.
  if (!el._speciesListener) {
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-del-species');
      if (!btn) return;
      const name = btn.dataset.name;
      if (name) confirmDeleteSpecies(name);
    });
    el._speciesListener = true;
  }
}

// ─── SERVICES DB ─────────────────────────────
// Sistema paralelo a species: lista de servicios sugeridos que aparecen
// como autocompletado al cargar un ítem tipo "service". El usuario puede
// agregar nuevos (se aprenden automáticamente del input) y eliminarlos
// desde la pestaña de configuración.
const SERVICES_KEY = 'pq_services';

// Servicios preformulados base (se ofrecen la primera vez si el LS está vacío)
const DEFAULT_SERVICES = [
  'Camión - Viaje',
  'Camión - Jornada/día',
  'Bobcat / Minicargadora - Jornada/día',
  'Volquete',
  'Retroexcavadora - Jornada/día',
  'Chipeadora',
];

function getServicesDB() {
  try {
    const raw = localStorage.getItem(SERVICES_KEY);
    if (raw === null) {
      // Primera vez: sembrar con los preformulados
      safeSetLS(SERVICES_KEY, JSON.stringify(DEFAULT_SERVICES));
      return DEFAULT_SERVICES.slice();
    }
    return JSON.parse(raw);
  } catch(e) { return DEFAULT_SERVICES.slice(); }
}

function saveServiceToDB(name) {
  name = (name||'').trim();
  if (name.length < 2) return;
  const db = getServicesDB();
  const key = name.toLowerCase();
  if (db.some(s => s.toLowerCase() === key)) return;  // ya existe
  db.push(name);
  db.sort((a,b) => a.localeCompare(b,'es'));
  safeSetLS(SERVICES_KEY, JSON.stringify(db));
}

function deleteServiceFromDB(name) {
  const db = getServicesDB().filter(s => s !== name);
  safeSetLS(SERVICES_KEY, JSON.stringify(db));
  // Si estaba pineado, también sacarlo de la lista de pineados
  setPinnedServices(getPinnedServices().filter(s => s !== name));
}

// ─── PINNED SERVICES (chips rápidos del editor) ───────────────────────
// Lista separada de servicios que aparecen como sugerencia rápida.
// Se guarda en una clave aparte (pq_services_pinned) para no romper
// compatibilidad con la DB principal de servicios (string[]).
// Si el usuario no pinea ninguno, fallback a los 4 primeros de la DB.
const SERVICES_PINNED_KEY = 'pq_services_pinned';
const MAX_PINNED_SERVICES = 5;

function getPinnedServices() {
  try {
    const raw = localStorage.getItem(SERVICES_PINNED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch(e) { return []; }
}

function setPinnedServices(arr) {
  // Filtrar contra la DB actual para evitar pineados huérfanos
  const dbSet = new Set(getServicesDB().map(s => s.toLowerCase()));
  const clean = (arr || [])
    .filter(s => s && dbSet.has(s.toLowerCase()))
    .slice(0, MAX_PINNED_SERVICES);
  safeSetLS(SERVICES_PINNED_KEY, JSON.stringify(clean));
}

function isServicePinned(name) {
  if (!name) return false;
  const pinned = getPinnedServices().map(s => s.toLowerCase());
  return pinned.includes(name.toLowerCase());
}

// Toggle del estado pineado de un servicio. Si está pineado, lo
// despinea. Si no, intenta pinearlo (respetando el máximo).
function toggleServicePinned(name) {
  const pinned = getPinnedServices();
  const idx = pinned.findIndex(s => s.toLowerCase() === name.toLowerCase());
  if (idx >= 0) {
    pinned.splice(idx, 1);
    setPinnedServices(pinned);
    if (typeof renderServicesManager === 'function') renderServicesManager();
    if (typeof renderQuickServices === 'function') renderQuickServices();
    return;
  }
  if (pinned.length >= MAX_PINNED_SERVICES) {
    toast(`Máximo ${MAX_PINNED_SERVICES} servicios rápidos. Desfijá uno antes.`, 'err', 3500);
    return;
  }
  pinned.push(name);
  setPinnedServices(pinned);
  if (typeof renderServicesManager === 'function') renderServicesManager();
  if (typeof renderQuickServices === 'function') renderQuickServices();
}

async function confirmDeleteService(name) {
  const ok = await confirmDlg(
    'Eliminar servicio',
    `¿Eliminar "${name}" de los servicios guardados? Esta acción no se puede deshacer.`,
    'Eliminar', 'btn-d'
  );
  if (!ok) return;
  deleteServiceFromDB(name);
  renderServicesManager();
  if (typeof renderQuickServices === 'function') renderQuickServices();
  if (typeof updateCollapsibleCounts === 'function') updateCollapsibleCounts();
  toast(`Servicio "${name}" eliminado`, 'info');
}

function getServicesSuggestions(query) {
  const db = getServicesDB();
  if (!query) return db.slice(0, 12);
  const q = query.toLowerCase();
  return db.filter(s => {
    const sl = s.toLowerCase();
    return sl.startsWith(q) || sl.includes(q);
  }).slice(0, 12);
}

function attachServiceAutocomplete(input, idx) {
  const dlId = 'sv-dl-' + idx;
  let dl = document.getElementById(dlId);
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = dlId;
    document.body.appendChild(dl);
  }
  input.setAttribute('list', dlId);
  input.setAttribute('autocomplete', 'off');

  function refreshList() {
    const suggestions = getServicesSuggestions(input.value.trim());
    dl.innerHTML = suggestions.map(s => `<option value="${esc(s)}">`).join('');
  }

  input.addEventListener('input', refreshList);
  input.addEventListener('focus', refreshList);
  input.addEventListener('blur', () => {
    const v = input.value.trim();
    if (v.length >= 2) {
      saveServiceToDB(v);
      // Si era un servicio nuevo, refrescar los chips del editor
      if (typeof renderQuickServices === 'function') renderQuickServices();
    }
  });
}

function renderServicesManager() {
  const el = document.getElementById('services-manager-list');
  if (!el) return;
  const db = getServicesDB();
  if (!db.length) {
    el.innerHTML='<div class="empty-h" style="padding:20px">No hay servicios guardados aún.</div>';
    return;
  }
  const pinned = getPinnedServices();
  const pinnedCount = pinned.length;
  const pinnedSet = new Set(pinned.map(s => s.toLowerCase()));

  // Ordenar: primero los pineados (en su orden de pineado), después
  // el resto alfabético — así el usuario ve sus favoritos arriba.
  const pinnedItems = pinned.filter(p => db.some(d => d.toLowerCase() === p.toLowerCase()));
  const restItems = db
    .filter(s => !pinnedSet.has(s.toLowerCase()))
    .sort((a,b) => a.localeCompare(b,'es'));
  const ordered = [...pinnedItems, ...restItems];

  el.innerHTML = `
    <div class="svc-pinned-header">
      <span class="svc-pinned-info">${icon('zap')} <strong>${pinnedCount}</strong> ${pinnedCount === 1 ? 'servicio fijado' : 'servicios fijados'} como rápido</span>
      <span class="svc-pinned-limit">Máx. ${MAX_PINNED_SERVICES}</span>
    </div>
    <div class="svc-list">` +
    ordered.map(sv => {
      const isPinned = pinnedSet.has(sv.toLowerCase());
      return `
      <div class="svc-row ${isPinned ? 'is-pinned' : ''}">
        <button class="svc-pin-btn ${isPinned ? 'active' : ''}" data-name="${esc(sv)}" title="${isPinned ? 'Quitar de servicios rápidos' : 'Fijar como servicio rápido'}" aria-label="Pin">
          ${isPinned ? icon('star','ic-fill') : icon('star')}
        </button>
        <span class="svc-name">${esc(sv)}</span>
        <button class="btn-icon-del chip-del-service" data-name="${esc(sv)}" title="Eliminar servicio" aria-label="Eliminar">${icon('trash')}</button>
      </div>`;
    }).join('') +
    `</div>`;

  // Listener delegado: distingue entre pin y delete según la clase
  // del botón clickeado (ver renderQuickServices para el patrón).
  if (!el._serviceListener) {
    el.addEventListener('click', (e) => {
      const pinBtn = e.target.closest('.svc-pin-btn');
      if (pinBtn) {
        const name = pinBtn.dataset.name;
        if (name) toggleServicePinned(name);
        return;
      }
      const delBtn = e.target.closest('.chip-del-service');
      if (delBtn) {
        const name = delBtn.dataset.name;
        if (name) confirmDeleteService(name);
      }
    });
    el._serviceListener = true;
  }
}

// ─── MIS SERVICIOS (tarifas propias) ──────────────────────────────────
// Lo que el usuario COBRA cuando el trabajo es suyo y el cliente es un colega:
// una jornada de trepador, una hora de motosierra, un trabajo puntual. No es
// la DB de servicios de arriba —esa son los costos de terceros que se cargan
// DENTRO de un presupuesto (un camión, un volquete)— sino su propia tarifa.
//
// Guarda el precio porque el alta tiene que ser de un toque: el precio se
// pre-carga y se corrige en el diálogo si ese día se cobró distinto. La tarifa
// guardada NO se pisa sola al corregirla (ver colabGuardar): que un trabajo
// puntual cambie la tarifa base es un efecto que el usuario no pidió.
const MISSVC_KEY = 'pq_mis_servicios';
const MISSVC_UNIDAD_LABEL = { jornada:'jornada', hora:'hora', trabajo:'trabajo' };
const MISSVC_UNIDAD_PLURAL = { jornada:'jornadas', hora:'horas', trabajo:'trabajos' };

// "2 jornadas" / "1 jornada". El singular importa: el texto va a la factura.
function misSvcCantTxt(cant, unidad) {
  const n = Number(cant) || 1;
  const u = MISSVC_UNIDADES.indexOf(unidad) >= 0 ? unidad : 'jornada';
  const label = n === 1 ? MISSVC_UNIDAD_LABEL[u] : MISSVC_UNIDAD_PLURAL[u];
  return `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} ${label}`;
}

function getMisServicios() {
  try { return sanitizeMisServicios(JSON.parse(localStorage.getItem(MISSVC_KEY) || '[]')); }
  catch (e) { return []; }
}

function setMisServicios(arr) {
  safeSetLS(MISSVC_KEY, JSON.stringify(sanitizeMisServicios(arr)));
}

// Alta/edición de una tarifa. Sin id crea una nueva; con id pisa la existente.
function saveMiServicio({ id, nombre, precio, unidad }) {
  nombre = (nombre || '').trim();
  if (nombre.length < 2) return null;
  const db = getMisServicios();
  const t = {
    id: id || ('ms_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    nombre,
    precio: Math.max(0, roundMoney(precio)),
    unidad: MISSVC_UNIDADES.indexOf(unidad) >= 0 ? unidad : 'jornada',
  };
  const idx = db.findIndex(x => x.id === t.id);
  if (idx >= 0) db.splice(idx, 1, t); else db.push(t);
  setMisServicios(db);
  return t;
}

function deleteMiServicio(id) {
  setMisServicios(getMisServicios().filter(t => t.id !== id));
}

async function confirmDeleteMiServicio(id) {
  const t = getMisServicios().find(x => x.id === id);
  if (!t) return;
  const ok = await confirmDlg(
    'Eliminar tarifa',
    `¿Eliminar "${t.nombre}" de tus servicios? Los trabajos ya registrados no se tocan.`,
    'Eliminar', 'btn-d'
  );
  if (!ok) return;
  deleteMiServicio(id);
  renderMisServiciosManager();
  if (typeof updateCollapsibleCounts === 'function') updateCollapsibleCounts();
  toast('Tarifa eliminada', 'info');
}

// Alta desde la sección de Empresa. Los tres campos viven en el markup;
// el precio puede quedar en 0 (tarifa a definir en cada trabajo).
function addMiServicioFromUI() {
  const nEl = document.getElementById('missvc-nombre');
  const pEl = document.getElementById('missvc-precio');
  const uEl = document.getElementById('missvc-unidad');
  const nombre = (nEl?.value || '').trim();
  if (nombre.length < 2) { toast('Escribí el nombre del servicio', 'err'); return; }
  saveMiServicio({ nombre, precio: pEl?.value, unidad: uEl?.value });
  if (nEl) nEl.value = '';
  if (pEl) pEl.value = '';
  renderMisServiciosManager();
  if (typeof updateCollapsibleCounts === 'function') updateCollapsibleCounts();
  toast(`Tarifa "${nombre}" guardada`, 'ok');
}

// Edición en línea del precio: es el campo que se mueve con la inflación y
// el único que se corrige seguido. Se guarda al salir del campo.
function setMiServicioPrecio(id, valor) {
  const t = getMisServicios().find(x => x.id === id);
  if (!t) return;
  const nuevo = Math.max(0, roundMoney(valor));
  if (nuevo === t.precio) return;
  saveMiServicio({ id: t.id, nombre: t.nombre, precio: nuevo, unidad: t.unidad });
  renderMisServiciosManager();
  toast('Tarifa actualizada', 'ok', 1500);
}

function renderMisServiciosManager() {
  const el = document.getElementById('missvc-manager-list');
  if (!el) return;
  const db = getMisServicios();
  el.innerHTML = !db.length
    ? '<div class="empty-h" style="padding:16px">Todavía no cargaste ninguna tarifa propia.</div>'
    : '<div class="svc-list">' + db.map(t => `
        <div class="svc-row missvc-row">
          <span class="svc-name">${esc(t.nombre)}<span class="missvc-unidad">por ${esc(MISSVC_UNIDAD_LABEL[t.unidad] || t.unidad)}</span></span>
          <input class="missvc-precio" type="number" min="0" step="1000" inputmode="decimal"
                 value="${t.precio || ''}" placeholder="0" aria-label="Precio de ${esc(t.nombre)}"
                 data-id="${esc(t.id)}" onchange="setMiServicioPrecio(this.dataset.id, this.value)">
          <button class="btn-icon-del missvc-del" data-id="${esc(t.id)}" title="Eliminar tarifa" aria-label="Eliminar">${icon('trash')}</button>
        </div>`).join('') + '</div>';
  // Listener delegado, como el resto de los managers: el id va en data-id y
  // nunca dentro de un onclick interpolado.
  if (!el._missvcListener) {
    el.addEventListener('click', (ev) => {
      const del = ev.target.closest('.missvc-del');
      if (del && del.dataset.id) confirmDeleteMiServicio(del.dataset.id);
    });
    el._missvcListener = true;
  }
}

// ─── CLIENT DB ───────────────────────────────
const CLIENT_KEY = 'pq_clients';

function getClientDB() {
  try {
    const raw = JSON.parse(localStorage.getItem(CLIENT_KEY)||'[]');
    return raw.map(e => typeof e === 'string' ? {name:e,contact:'',address:'',maplink:''} : e);
  } catch(e){ return []; }
}

function saveClientToDB(name, contact, address, mapLink) {
  name = (name||'').trim();
  if (name.length < 2) return;
  contact = (contact||'').trim();
  address = (address||'').trim();
  mapLink = (mapLink||'').trim();
  const db = getClientDB();
  const key = name.toLowerCase();
  const idx = db.findIndex(e=>e.name.toLowerCase()===key);
  if (idx >= 0) {
    if (contact) db[idx].contact = contact;
    if (address) db[idx].address = address;
    if (mapLink) db[idx].maplink = mapLink;
  } else {
    db.push({name, contact, address, maplink: mapLink});
    db.sort((a,b)=>a.name.localeCompare(b.name,'es'));
  }
  safeSetLS(CLIENT_KEY, JSON.stringify(db));
}

function deleteClientFromDB(name) {
  const db = getClientDB().filter(e=>e.name!==name);
  safeSetLS(CLIENT_KEY, JSON.stringify(db));
}

// Guarda o enriquece un cliente en la DB a partir de lo anotado en una nota o
// visita de la Agenda: nombre + teléfono + ubicación (la ubicación de la nota se
// guarda como el `maplink` del cliente — misma semántica: dónde queda el
// trabajo, y así al hacerle el presupuesto ya viene cargada). Si el cliente no
// existe, lo crea; si ya existe, completa SOLO los campos vacíos (nunca pisa un
// teléfono o una ubicación que ya tenías guardados). Sirve tanto para un cliente
// tipeado a mano como para uno importado de los contactos del teléfono.
function saveNoteClientToDB(cliente, tel, ubic) {
  cliente = (cliente || '').trim();
  tel = (tel || '').trim();
  ubic = (ubic || '').trim();
  if (!cliente || (!tel && !ubic) || typeof saveClientToDB !== 'function') return;
  const existente = getClientDB().find(x => ((x.name || '') + '').trim().toLowerCase() === cliente.toLowerCase());
  if (!existente) {
    saveClientToDB(cliente, tel, '', ubic);
  } else {
    const nuevoTel  = existente.contact ? '' : tel;
    const nuevaUbic = existente.maplink ? '' : ubic;
    if (nuevoTel || nuevaUbic) saveClientToDB(cliente, nuevoTel, '', nuevaUbic);
  }
}

async function confirmDeleteClient(name) {
  const ok = await confirmDlg(
    'Eliminar cliente',
    `¿Eliminar "${name}" de los clientes guardados? Esta acción no se puede deshacer.`,
    'Eliminar', 'btn-d'
  );
  if (!ok) return;
  deleteClientFromDB(name);
  renderClientManager();
  if (typeof updateCollapsibleCounts === 'function') updateCollapsibleCounts();
  toast(`Cliente "${name}" eliminado`, 'info');
}

function attachClientAutocomplete() {
  const nameInput    = document.getElementById('client-name');
  const contactInput = document.getElementById('client-contact');
  const addressInput = document.getElementById('work-address');
  const mapInput     = document.getElementById('work-maplink');
  if (!nameInput) return;

  let dropdown = document.getElementById('client-dropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'client-dropdown';
    dropdown.style.cssText = `
      position:absolute;z-index:9999;background:#fff;border:1px solid var(--border);
      border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);
      max-height:220px;overflow-y:auto;overscroll-behavior:contain;width:100%;display:none;
      font-family:'DM Sans',sans-serif;top:100%;left:0;margin-top:2px;
    `;
    nameInput.parentElement.style.position = 'relative';
    nameInput.parentElement.appendChild(dropdown);
  }

  function showDropdown(items) {
    if (!items.length) { dropdown.style.display='none'; return; }
    dropdown.innerHTML = items.map(e=>`
      <div class="cl-opt" data-name="${esc(e.name)}" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f1f5f4;">
        <div style="font-size:13px;font-weight:500;color:var(--text)">${esc(e.name)}</div>
        ${e.contact||e.address?`<div style="font-size:12.5px;color:var(--muted);margin-top:1px">${[e.contact,e.address].filter(Boolean).map(v=>esc(v)).join(' · ')}</div>`:''}
      </div>`).join('');
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.cl-opt').forEach(el=>{
      const selectClient = (ev) => {
        ev.preventDefault();
        const rec = items.find(e=>e.name===el.dataset.name);
        if (!rec) return;
        nameInput.value = rec.name;
        if (contactInput && rec.contact) contactInput.value = rec.contact;
        if (addressInput && rec.address) addressInput.value = rec.address;
        if (mapInput && rec.maplink) {
          mapInput.value = rec.maplink;
          const det = document.getElementById('maplink-details');
          if (det) det.open = true;
        }
        S.clientName    = rec.name;
        S.clientContact = rec.contact || S.clientContact;
        S.workAddress   = rec.address || S.workAddress;
        S.workMapLink   = rec.maplink || S.workMapLink;
        dropdown.style.display = 'none';
        sched();
      };
      el.addEventListener('mousedown', selectClient);
      el.addEventListener('touchend',  selectClient);
    });
  }

  function refreshDropdown() {
    const q = nameInput.value.toLowerCase().trim();
    const all = getClientDB();
    const matches = q
      ? all.filter(e=>e.name.toLowerCase().startsWith(q)||e.name.toLowerCase().split(/\s+/).some(w=>w.startsWith(q))).slice(0,10)
      : all.slice(0,10);
    showDropdown(matches);
  }

  nameInput.addEventListener('input',  refreshDropdown);
  nameInput.addEventListener('focus',  refreshDropdown);
  nameInput.addEventListener('blur', ()=>{
    setTimeout(()=>{ dropdown.style.display='none'; }, 180);
    const n = nameInput.value.trim();
    if (n) saveClientToDB(n, contactInput?contactInput.value:'', addressInput?addressInput.value:'', mapInput?mapInput.value:'');
  });
  if(contactInput) contactInput.addEventListener('blur', ()=>{
    const n = nameInput.value.trim();
    if(n) saveClientToDB(n, contactInput.value, addressInput?addressInput.value:'', mapInput?mapInput.value:'');
  });
  if(addressInput) addressInput.addEventListener('blur', ()=>{
    const n = nameInput.value.trim();
    if(n) saveClientToDB(n, contactInput?contactInput.value:'', addressInput.value, mapInput?mapInput.value:'');
  });
  if(mapInput) mapInput.addEventListener('blur', ()=>{
    const n = nameInput.value.trim();
    if(n) saveClientToDB(n, contactInput?contactInput.value:'', addressInput?addressInput.value:'', mapInput.value);
  });
}

function renderClientManager() {
  const el = document.getElementById('client-manager-list');
  if (!el) return;
  const db = getClientDB();
  if (!db.length) {
    el.innerHTML='<div class="empty-h" style="padding:20px">No hay clientes guardados aún.</div>';
    return;
  }
  el.innerHTML = db.map(e => {
    const phone = (e.contact||'').trim();
    const addr  = (e.address||'').trim();
    // Detectar si "contact" es un número de teléfono (heurística: tiene
    // ≥6 dígitos). Si no, lo tratamos como email/otro y NO mostramos
    // el botón WhatsApp.
    const digits = phone.replace(/\D/g,'');
    const isPhone = digits.length >= 6;
    const waNum = isPhone ? digits.replace(/^0+/,'') : '';
    const waUrl = waNum ? `https://wa.me/${waNum}` : '';
    const mapLink = (e.maplink||'').trim();
    const mapsUrl = mapsUrlFor(mapLink, addr);

    const quickActions = [];
    if (isPhone) quickActions.push(
      `<a class="client-qa" href="${waUrl}" target="_blank" rel="noopener" title="Abrir WhatsApp"
          onclick="event.stopPropagation()">${icon('message')} <span>WhatsApp</span></a>`
    );
    if (mapsUrl) quickActions.push(
      `<a class="client-qa" href="${mapsUrl}" target="_blank" rel="noopener" title="Ver en Maps"
          onclick="event.stopPropagation()">${icon('pin')} <span>Maps</span></a>`
    );

    return `
    <div class="hitem client-card">
      <div class="hinfo">
        <div class="hclient">${esc(e.name)}</div>
        <div class="hmeta">${[e.contact,e.address].filter(Boolean).map(v=>esc(v)).join(' · ')||'<em style="opacity:.6">Sin datos adicionales</em>'}</div>
        ${quickActions.length ? `<div class="client-qa-row">${quickActions.join('')}</div>` : ''}
      </div>
      <div class="hacts">
        <button class="btn-icon-del client-del-btn" data-name="${esc(e.name)}" title="Eliminar cliente" aria-label="Eliminar cliente">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('');
  // Listener delegado (ver renderQuickServices).
  if (!el._clientListener) {
    el.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.client-del-btn');
      if (!btn) return;
      const name = btn.dataset.name;
      if (name) confirmDeleteClient(name);
    });
    el._clientListener = true;
  }
}

// ═══════════════════════════════════════════════════════════
// IMPORTAR CLIENTE DESDE LOS CONTACTOS DEL TELÉFONO
// ═══════════════════════════════════════════════════════════
// Usa la Contact Picker API (Chrome Android sobre HTTPS). El acceso es
// bajo demanda: cada vez abre el selector nativo y el usuario elige UN
// contacto. La app nunca lee la agenda completa.
//
// Importante para el flujo de trabajo: el nombre y teléfono se cargan en
// los campos pero quedan TOTALMENTE EDITABLES. Como se suelen agendar nombres
// largos con notas ("Martín álamo Bialet Massé"), después puede recortar
// el nombre a lo que va en el presupuesto sin afectar su agenda.

// Detección de soporte. Muestra el botón solo si el dispositivo puede.
function initContactPicker() {
  const btn = document.getElementById('btn-import-contact');
  if (!btn) return;
  const supported = ('contacts' in navigator) && ('ContactsManager' in window);
  btn.style.display = supported ? 'inline-flex' : 'none';
}

async function importFromContacts() {
  if (!(('contacts' in navigator) && ('ContactsManager' in window))) {
    toast('Tu dispositivo no permite importar contactos. Cargá los datos a mano.', 'info', 3500);
    return;
  }
  try {
    // Pedimos nombre y teléfono (los que existan en el dispositivo).
    let props = ['name', 'tel'];
    if (typeof navigator.contacts.getProperties === 'function') {
      try {
        const avail = await navigator.contacts.getProperties();
        props = ['name', 'tel'].filter(p => avail.includes(p));
        if (!props.length) props = ['name'];
      } catch (e) { /* usar props por defecto */ }
    }
    const contacts = await navigator.contacts.select(props, { multiple: false });
    if (!contacts || !contacts.length) return; // el usuario canceló

    const c = contacts[0];
    const nombre = (c.name && c.name.length) ? c.name[0] : '';
    const tel    = (c.tel && c.tel.length)   ? c.tel[0]  : '';

    const nameInput    = document.getElementById('client-name');
    const contactInput = document.getElementById('client-contact');

    if (nombre && nameInput) {
      nameInput.value = nombre;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (tel && contactInput) {
      contactInput.value = tel;
      contactInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Sincronizar al estado y guardar
    if (typeof syncFromUI === 'function') syncFromUI();
    if (typeof sched === 'function') sched();

    // Recordatorio amable de que puede editar el nombre
    toast('Cliente importado. Podés editar el nombre antes de enviar.', 'ok', 3500);
    // Llevar el foco al nombre para que lo recorte si hace falta
    if (nameInput) { nameInput.focus(); }
  } catch (err) {
    // AbortError = el usuario cerró el selector; no es un error real
    if (err && err.name === 'AbortError') return;
    console.error('Contact Picker error:', err);
    toast('No se pudo importar el contacto. Probá de nuevo o cargalo a mano.', 'err', 3500);
  }
}

// ¿El dispositivo puede abrir el selector de contactos del teléfono?
function contactPickerSupported() {
  return ('contacts' in navigator) && ('ContactsManager' in window);
}

// Versión genérica del importador: vuelca nombre + teléfono del contacto elegido
// en los dos inputs que se le pasen. La usan el alta de nota y el modal de
// edición (los campos quedan editables, igual que en el editor).
async function importContactToFields(nameInput, telInput) {
  if (!contactPickerSupported()) {
    toast('Tu dispositivo no permite importar contactos. Cargá los datos a mano.', 'info', 3500);
    return;
  }
  try {
    let props = ['name', 'tel'];
    if (typeof navigator.contacts.getProperties === 'function') {
      try {
        const avail = await navigator.contacts.getProperties();
        props = ['name', 'tel'].filter(p => avail.includes(p));
        if (!props.length) props = ['name'];
      } catch (e) { /* usar props por defecto */ }
    }
    const contacts = await navigator.contacts.select(props, { multiple: false });
    if (!contacts || !contacts.length) return; // el usuario canceló
    const c = contacts[0];
    const nombre = (c.name && c.name.length) ? c.name[0] : '';
    const tel    = (c.tel && c.tel.length)   ? c.tel[0]  : '';
    if (nombre && nameInput) nameInput.value = nombre;
    if (tel && telInput) telInput.value = tel;
    toast('Contacto importado. Podés editarlo antes de guardar.', 'ok', 3000);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error('Contact Picker error:', err);
    toast('No se pudo importar el contacto. Probá de nuevo o cargalo a mano.', 'err', 3500);
  }
}

// Autocompletar de clientes con un dropdown NATIVO (panel propio anclado bajo el
// input), en vez de un <datalist> (que en Android aparece como sugerencias sobre
// el teclado). Al elegir un cliente completa el nombre y el teléfono. Genérico:
// se le pasa el input de nombre y el de teléfono. Idempotente por input.
function attachClientDropdown(nameInput, telInput) {
  if (!nameInput || nameInput._clDropAttached) return;
  nameInput._clDropAttached = true;
  const host = nameInput.closest('.agc-cli-wrap') || nameInput.parentElement;
  if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const dd = document.createElement('div');
  dd.className = 'agc-cli-dd';
  dd.style.display = 'none';
  (host || nameInput.parentElement).appendChild(dd);

  function render() {
    const q = (nameInput.value || '').toLowerCase().trim();
    const all = (typeof getClientDB === 'function') ? getClientDB() : [];
    const list = (q
      ? all.filter(e => e.name && (e.name.toLowerCase().includes(q)))
      : all).slice(0, 8);
    if (!list.length) { dd.style.display = 'none'; return; }
    dd.innerHTML = list.map(e => `<div class="agc-cli-opt" data-name="${esc(e.name)}">
        <span class="agc-cli-opt-n">${esc(e.name)}</span>
        ${e.contact ? `<span class="agc-cli-opt-t">${esc(e.contact)}</span>` : ''}
      </div>`).join('');
    dd.style.display = 'block';
    dd.querySelectorAll('.agc-cli-opt').forEach(el => {
      const pick = (ev) => {
        ev.preventDefault();
        const rec = list.find(x => x.name === el.dataset.name);
        if (!rec) return;
        nameInput.value = rec.name;
        if (telInput && rec.contact) telInput.value = rec.contact;
        dd.style.display = 'none';
      };
      el.addEventListener('mousedown', pick);
      el.addEventListener('touchend', pick);
    });
  }
  nameInput.addEventListener('input', render);
  nameInput.addEventListener('focus', render);
  nameInput.addEventListener('blur', () => setTimeout(() => { dd.style.display = 'none'; }, 180));
}
