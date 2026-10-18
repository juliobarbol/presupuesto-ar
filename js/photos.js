'use strict';

// ═══════════════════════════════════════
// PHOTOS.JS — Almacén de fotos en IndexedDB
// ═══════════════════════════════════════
// Las fotos del registro fotográfico ya NO viven embebidas (base64) dentro de
// S.items[].photo en localStorage: con pocas fotos eso llenaba la cuota de
// ~5 MB y rompía el guardado (cada entrada del historial clonaba sus fotos).
// Ahora item.photo guarda solo un ID corto ("p_...") y el binario vive en
// IndexedDB (cientos de MB) — que además funciona offline.
//
// item.photo puede ser:
//   • un ID "p_..."           → el dataURL se busca en el caché (hidratado de IDB)
//   • un dataURL "data:image/" → foto legada embebida, o respaldo si IDB falla
//                                 (se usa tal cual; getPhotoData la devuelve directo)
//
// Diseño SINCRÓNICO de lectura: al iniciar se hidrata todo el caché de fotos
// en memoria (son pocos MB), así renderItems()/buildDoc() siguen siendo
// sincrónicos y no hay que reescribir el flujo de impresión/PDF.

const PHOTO_DB = 'pq_photos';
const PHOTO_STORE = 'photos';
const photoCache = new Map();   // id -> dataURL (hidratado de IndexedDB)
let _photoDBPromise = null;

function photoIsId(ref){ return typeof ref === 'string' && ref.indexOf('p_') === 0; }
function newPhotoId(){ return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

function openPhotoDB(){
  if (_photoDBPromise) return _photoDBPromise;
  _photoDBPromise = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(PHOTO_DB, 1); }
    catch(e){ reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _photoDBPromise;
}

// Carga todas las fotos de IndexedDB al caché en memoria. Se llama una vez al
// iniciar la app, ANTES del primer render. Nunca rechaza: si IDB no está
// disponible (modo privado, navegador viejo), deja el caché vacío y sigue.
async function hydratePhotoCache(){
  try {
    const db = await openPhotoDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readonly');
      const cur = tx.objectStore(PHOTO_STORE).openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c){ photoCache.set(c.key, c.value); c.continue(); }
        else resolve();
      };
      cur.onerror = () => reject(cur.error);
    });
  } catch(e){ console.warn('No se pudo hidratar el caché de fotos (IndexedDB)', e); }
}

// Guarda un dataURL en IndexedDB + caché y devuelve su ID. Si IDB falla
// (no disponible / cuota), cae al comportamiento viejo: devuelve el propio
// dataURL para embeberlo en el ítem (la app sigue funcionando).
async function savePhoto(dataUrl){
  const id = newPhotoId();
  try {
    const db = await openPhotoDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).put(dataUrl, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    photoCache.set(id, dataUrl);
    return id;
  } catch(e){
    console.warn('IndexedDB no disponible; la foto se guarda embebida como respaldo', e);
    return dataUrl;   // fallback: comportamiento previo (foto embebida)
  }
}

// Devuelve el dataURL de una referencia de foto (ID o dataURL legado), o ''.
// Validá SIEMPRE el resultado con safeImgSrc() antes de meterlo en innerHTML.
function getPhotoData(ref){
  if (!ref) return '';
  if (typeof ref === 'string' && ref.indexOf('data:') === 0) return ref;  // legado/embebida
  if (photoIsId(ref)) return photoCache.get(ref) || '';
  return '';
}

// ¿La referencia apunta a una foto que NO tenemos localmente? (ID sin caché).
// Pasa en un equipo nuevo que todavía no restauró el backup: mostramos un
// placeholder "foto no disponible" en vez de una imagen rota.
function photoMissing(ref){ return photoIsId(ref) && !photoCache.has(ref); }

// ─── MÚLTIPLES FOTOS POR ÍTEM ─────────────────────────────────────
// Un ítem puede tener varias fotos en `item.photos` (array de refs). El
// formato legado guardaba una sola en `item.photo`; estos helpers normalizan
// los dos para que el resto del código trate siempre con un array.
//
// Devuelve el array de refs de foto de un ítem (normaliza el formato legado).
function itemPhotoRefs(item){
  if (!item) return [];
  if (Array.isArray(item.photos)) return item.photos.filter(Boolean);
  if (item.photo) return [item.photo];
  return [];
}
// Agrega una ref al ítem, migrando el formato legado (item.photo) a array.
function addItemPhotoRef(item, ref){
  if (!item || !ref) return;
  const refs = itemPhotoRefs(item);
  refs.push(ref);
  item.photos = refs;
  if ('photo' in item) delete item.photo;
}
// Quita la foto en la posición `pi` del ítem.
function removeItemPhotoRef(item, pi){
  if (!item) return;
  const refs = itemPhotoRefs(item);
  if (pi < 0 || pi >= refs.length) return;
  refs.splice(pi, 1);
  item.photos = refs;
  if ('photo' in item) delete item.photo;
}

// ─── FOTOS DEL LUGAR DE DISPOSICIÓN (leña / residuos) ─────────────
// No cuelgan de un ítem sino del presupuesto entero (S.dispoPhotos): es UN
// lugar acordado con el cliente, no una foto por árbol. Mismo formato de ref
// y mismo almacén que las de los ítems.
function dispoPhotoRefs(state){
  const st = state || (typeof S !== 'undefined' ? S : null);
  return (st && Array.isArray(st.dispoPhotos)) ? st.dispoPhotos.filter(Boolean) : [];
}

// ─── FOTOS DE LOS DEFECTOS DEL INFORME DE RIESGO (v243) ─────────────
// Cuelgan de cada defecto (riskData.defects[i].photos): la foto de la cavidad o
// la grieta tomada en altura va pegada a SU defecto en el documento. Mismo
// formato de ref y mismo almacén que las de los ítems; por eso collectPhotoIds
// y migrateInlinePhotosToIDB las recorren aparte (si no, el backup viaja sin
// ellas y en el equipo nuevo quedan rotas).
function riskDefectList(state){
  const rd = state && state.riskData;
  return (rd && Array.isArray(rd.defects)) ? rd.defects.filter(d => d && typeof d === 'object') : [];
}
function riskDefectPhotoRefs(state){
  const out = [];
  riskDefectList(state).forEach(d => { if (Array.isArray(d.photos)) d.photos.forEach(r => { if (r) out.push(r); }); });
  return out;
}

// ─── UI COMPARTIDA DE FOTOS (normal / estimativo / riesgo) ─────────
// HTML del botón "📷 Foto/s ✓ (N)" para la barra de acciones de un ítem.
function photoBtnHTML(refs){
  return `<button class="btn btn-g btn-sm ia-photo">${refs.length?`${icon('camera')} Fotos ✓ (${refs.length})`:`${icon('camera')} Foto`}</button>`;
}
// HTML de la galería de miniaturas (cada una con su botón de quitar). Las
// fotos no disponibles localmente (ID sin caché) muestran un placeholder.
function photoGalleryHTML(refs){
  if (!refs.length) return '';
  return `<div class="item-photos-gallery">${refs.map((ref, pi) => {
    const src = safeImgSrc(getPhotoData(ref));
    return src
      ? `<div class="item-photo-preview"><img src="${src}" alt="Foto" title="Tocar para ampliar" data-pi="${pi}"><button type="button" class="item-photo-remove" data-pi="${pi}" title="Quitar foto">✕</button></div>`
      : `<div class="item-photo-preview item-photo-missing">${icon('camera')} Foto no disponible<br><span>Restaurá tu backup en este dispositivo</span><button type="button" class="item-photo-remove" data-pi="${pi}" title="Quitar foto">✕</button></div>`;
  }).join('')}</div>`;
}
// Conecta los listeners de la galería de un card: quitar foto (por posición)
// y tocar miniatura para abrir el visor. removeFn(pi) saca la foto pi del
// ítem; reRender() re-dibuja la lista del modo correspondiente.
function wireItemPhotoGallery(card, removeFn, reRender){
  card.querySelectorAll('.item-photo-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFn(parseInt(btn.dataset.pi, 10));
      sched();
      reRender();
    });
  });
  card.querySelectorAll('.item-photo-preview img').forEach(img => {
    img.addEventListener('click', () => openPhotoViewer(img.src));
  });
}

// Construye el bloque "Registro Fotográfico" del PDF a partir de un array de
// ítems (recorre TODAS las fotos de cada uno). Cada foto se etiqueta con la
// especie (árbol) o la descripción (trabajo/servicio). Las que no estén
// disponibles localmente se omiten. Devuelve '' si no hay ninguna.
function buildPhotoRegistroHTML(items){
  const flat = [];
  (items || []).forEach(it => {
    if (!it) return;
    const etiqueta = (it.type === 'tree')
      ? (it.species || 'Árbol')
      : (it.desc || (it.type === 'work' ? 'Trabajo' : 'Servicio'));
    itemPhotoRefs(it).forEach(ref => {
      const src = safeImgSrc(getPhotoData(ref));
      if (src) flat.push({ src, etiqueta });
    });
  });
  if (!flat.length) return '';
  return `
    <div class="pphotos">
      <div class="pphotos-t">Registro Fotográfico</div>
      <div class="pphotos-grid">
        ${flat.map(({ src, etiqueta }) => `<figure class="pphoto">
            <img src="${src}" alt="${esc(etiqueta)}">
            <figcaption>${esc(etiqueta)}</figcaption>
          </figure>`).join('')}
      </div>
    </div>`;
}

// Recolecta en `set` los IDs de foto referenciados por un estado/snapshot
// (ítems normales, escenario B y estimativos). Lo usa el backup para incluir
// solo las fotos que hagan falta.
function collectPhotoIds(obj, set){
  if (!obj) return;
  [obj.items, obj.itemsB, obj.estItems].forEach(arr => {
    if (!Array.isArray(arr)) return;
    arr.forEach(it => { itemPhotoRefs(it).forEach(ref => { if (photoIsId(ref)) set.add(ref); }); });
  });
  // Las del lugar de disposición no cuelgan de ningún ítem: si no se suman
  // acá, el backup viaja sin ellas y en el equipo nuevo quedan rotas.
  dispoPhotoRefs(obj).forEach(ref => { if (photoIsId(ref)) set.add(ref); });
  riskDefectPhotoRefs(obj).forEach(ref => { if (photoIsId(ref)) set.add(ref); });
}

// Construye el mapa {id: dataURL} de las fotos referenciadas por los estados
// dados (estado actual y/o snapshots del historial). Se adjunta a cualquier
// export (presupuesto individual, historial, backup) para que las fotos
// viajen junto al JSON y no se pierdan al abrirlo en otro dispositivo.
function buildPhotoMap(){
  const ids = new Set();
  for (const s of arguments) collectPhotoIds(s, ids);
  const map = {};
  ids.forEach(id => { const d = getPhotoData(id); if (d) map[id] = d; });
  return map;
}

// Mueve a IndexedDB las fotos embebidas (base64) que tenga el estado dado,
// reemplazándolas in-place por su ID. Alivia la cuota de localStorage cuando
// se carga un presupuesto viejo (o el estado guardado) que aún traía fotos
// embebidas. El caché se actualiza sincrónicamente (render inmediato) y la
// escritura a IDB va en segundo plano. Devuelve cuántas migró.
function migrateInlinePhotosToIDB(state){
  if (!state) return 0;
  const toWrite = [];
  [state.items, state.itemsB, state.estItems].forEach(arr => {
    if (!Array.isArray(arr)) return;
    arr.forEach(it => {
      if (!it) return;
      const refs = itemPhotoRefs(it);
      let changed = false;
      const mapped = refs.map(ref => {
        if (typeof ref === 'string' && ref.indexOf('data:image/') === 0) {
          const id = newPhotoId();
          photoCache.set(id, ref);
          toWrite.push([id, ref]);
          changed = true;
          return id;
        }
        return ref;
      });
      if (changed) { it.photos = mapped; if ('photo' in it) delete it.photo; }
    });
  });
  // Las del lugar de disposición viven en el estado, no en un ítem: mismo
  // tratamiento (una foto embebida ahí pesa igual en la cuota).
  if (Array.isArray(state.dispoPhotos)) {
    state.dispoPhotos = state.dispoPhotos.map(ref => {
      if (typeof ref === 'string' && ref.indexOf('data:image/') === 0) {
        const id = newPhotoId();
        photoCache.set(id, ref);
        toWrite.push([id, ref]);
        return id;
      }
      return ref;
    });
  }
  // Las de los defectos del informe de riesgo: mismo tratamiento.
  riskDefectList(state).forEach(d => {
    if (!Array.isArray(d.photos)) return;
    d.photos = d.photos.map(ref => {
      if (typeof ref === 'string' && ref.indexOf('data:image/') === 0) {
        const id = newPhotoId();
        photoCache.set(id, ref);
        toWrite.push([id, ref]);
        return id;
      }
      return ref;
    });
  });
  if (toWrite.length) {
    openPhotoDB().then(db => {
      const tx = db.transaction(PHOTO_STORE, 'readwrite');
      const store = tx.objectStore(PHOTO_STORE);
      toWrite.forEach(([id, v]) => store.put(v, id));
    }).catch(e => {
      // Si IDB falla, revertimos a embebido para no perder la foto.
      console.warn('No se pudieron migrar fotos a IndexedDB; quedan embebidas', e);
      toWrite.forEach(([id, v]) => {
        photoCache.delete(id);
        [state.items, state.itemsB, state.estItems].forEach(arr => {
          if (!Array.isArray(arr)) return;
          arr.forEach(it => {
            if (it && Array.isArray(it.photos)) {
              const pi = it.photos.indexOf(id);
              if (pi >= 0) it.photos[pi] = v;
            }
          });
        });
        if (Array.isArray(state.dispoPhotos)) {
          const di = state.dispoPhotos.indexOf(id);
          if (di >= 0) state.dispoPhotos[di] = v;
        }
        riskDefectList(state).forEach(d => {
          if (!Array.isArray(d.photos)) return;
          const fi = d.photos.indexOf(id);
          if (fi >= 0) d.photos[fi] = v;
        });
      });
    });
  }
  return toWrite.length;
}

// Restaura las fotos que vienen dentro de un backup ({id: dataURL}). Setea el
// caché sincrónicamente (para que el render posterior las muestre) y persiste
// a IndexedDB en segundo plano. Valida que el valor sea un dataURL de imagen
// (los backups se intercambian entre colegas → no confiar a ciegas).
function restorePhotosFromBackup(map){
  if (!map || typeof map !== 'object') return;
  const entries = Object.entries(map).filter(([id, v]) =>
    photoIsId(id) && typeof v === 'string' && /^data:image\//i.test(v));
  if (!entries.length) return;
  entries.forEach(([id, v]) => photoCache.set(id, v));
  openPhotoDB().then(db => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const store = tx.objectStore(PHOTO_STORE);
    entries.forEach(([id, v]) => store.put(v, id));
  }).catch(e => console.error('No se pudieron persistir las fotos del backup en IndexedDB', e));
}

// ─── BANDEJA DE FOTOS COMPARTIDAS (Web Share Target) ──────────────
// El Service Worker stashea aquí los blobs de las fotos que el usuario
// compartió a la app desde la galería/cámara (el redirect del POST pierde
// el body). La página los lee al abrir con ?share=1 y vacía la bandeja.
// Ver sw.js (handler del POST) y core.js (detección de ?share=1).
// IMPORTANTE: el nombre de DB/store debe coincidir con el del SW.
const SHARE_INBOX_DB = 'pq_share_inbox';
const SHARE_INBOX_STORE = 'inbox';

function openShareInboxDB(){
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(SHARE_INBOX_DB, 1); }
    catch(e){ reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_INBOX_STORE)) {
        db.createObjectStore(SHARE_INBOX_STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Lee todos los blobs de la bandeja y la vacía en la misma transacción.
// Devuelve [] si no hay nada o si IndexedDB no está disponible (nunca rechaza).
async function drainShareInbox(){
  try {
    const db = await openShareInboxDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_INBOX_STORE, 'readwrite');
      const store = tx.objectStore(SHARE_INBOX_STORE);
      const getAll = store.getAll();
      getAll.onsuccess = () => { store.clear(); resolve(getAll.result || []); };
      getAll.onerror = () => reject(getAll.error);
    });
  } catch(e){
    console.warn('No se pudo leer la bandeja de fotos compartidas', e);
    return [];
  }
}
