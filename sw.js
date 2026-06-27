//  sw.js - Service Worker - Presupuestos (Poda en Altura AR)
//  Estrategia (robusta ante actualizaciones):
//   - Navegaciones (abrir la app): NETWORK-FIRST con timeout y fallback
//     a cache. Al abrir, siempre intentamos traer la version nueva desde
//     la red; si no hay senal (o tarda), servimos la cacheada. Asi la app
//     instalada NUNCA queda pegada a una version vieja o rota (que era lo
//     que obligaba a desinstalar/reinstalar).
//   - Resto de recursos del mismo origen: cache-first + revalidacion en
//     segundo plano.
//   - Nunca cacheamos respuestas redirigidas ni != 200 (evita corromper
//     la cache).
//   - Recursos externos (fuentes de Google, CDNs): pasan directo a la red.
//
//  Para forzar actualizacion tras un deploy: subir el CACHE_VERSION.

const CACHE_VERSION = 'presupuesto-v71';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon.png',
  // Fuentes auto-hospedadas: sin esto el offline-first se rompe con "datos
  // prendidos pero sin saldo" (el navegador intenta la red y se cuelga).
  './fonts.css',
  './fonts/dm-sans-latin.woff2',
  './fonts/dm-sans-italic-latin.woff2',
  './fonts/dm-serif-display-latin.woff2',
  './fonts/dm-serif-display-italic-latin.woff2',
];

// -- Install: precachear el app shell (resiliente) ------------
// Si un recurso puntual falla (red intermitente durante el deploy), NO
// abortamos toda la instalacion: cacheamos lo que se pueda y seguimos.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

// -- Activate: limpiar caches viejos y tomar control ----------
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// -- Helper: cachear solo respuestas "sanas" ------------------
// 200, del mismo origen y NO redirigidas. Cachear una respuesta
// redirigida rompe las navegaciones futuras (no se pueden servir).
function cachePut(req, res) {
  if (res && res.status === 200 && !res.redirected) {
    const copy = res.clone();
    caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

// -- Helper: fetch con timeout --------------------------------
// Evita que la apertura quede colgada esperando una red lenta: si no
// responde a tiempo, caemos a la cache.
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// -- Helper: buscar el documento en cache (varios fallbacks) --
function matchAppShell(req) {
  return caches.match(req)
    .then((r) => r || caches.match('./index.html'))
    .then((r) => r || caches.match('./'))
    .then((r) => r || caches.match(new Request('index.html')));
}

// -- Fetch ----------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Share Target: POST a ./share-target con las fotos compartidas. Guardamos
  // los blobs en IndexedDB y redirigimos a la app (?share=1), que los lee y
  // vacia la bandeja. El redirect pierde el body, por eso hay que stashear.
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const files = form.getAll('photos').filter((f) => f && f.size);
        if (files.length) await stashSharedFiles(files);
      } catch (e) { /* si algo falla, igual abrimos la app sin fotos */ }
      return Response.redirect('./index.html?share=1', 303);
    })());
    return;
  }

  // Solo GET del mismo origen. Lo externo (fuentes Google, etc.) va directo.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegaciones: NETWORK-FIRST con timeout, fallback a cache.
  // Asi tras un deploy se carga SIEMPRE la version nueva si hay red, y
  // offline se usa la cacheada — nunca queda colgada ni rota.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetchWithTimeout(req, 3500);
        cachePut('./index.html', fresh);
        return fresh;
      } catch (e) {
        const cached = await matchAppShell(req);
        return cached || Response.error();
      }
    })());
    return;
  }

  // Resto del mismo origen: cache-first + revalidacion en segundo plano.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req)
      .then((res) => cachePut(req, res))
      .catch(() => cached);
    return cached || network;
  })());
});

// -- Share Target: recibir fotos compartidas desde el sistema -
// Android (Chrome/TWA) hace un POST multipart a ./share-target con las
// imagenes que el usuario eligio en "Compartir". Como el redirect que
// sigue PIERDE el body del POST, stasheamos los blobs en IndexedDB
// (pq_share_inbox) y la pagina los lee al abrir con ?share=1. La accion
// ./share-target NO es un archivo real: la resuelve este handler, por eso
// NO va en APP_SHELL. (La intercepcion del POST esta en el listener fetch.)
const SHARE_DB = 'pq_share_inbox';
const SHARE_STORE = 'inbox';

function openShareDB() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(SHARE_DB, 1); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function stashSharedFiles(files) {
  return openShareDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite');
    const store = tx.objectStore(SHARE_STORE);
    files.forEach((f) => store.add(f));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// -- Permitir actualizacion inmediata desde la pagina ---------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// -- Push: mostrar notificación de seguimiento ---
self.addEventListener('push', (event) => {
  let data = { title: 'Presupuesto AR', body: 'Tenés seguimientos pendientes.' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch(e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      lang: 'es-AR',
      // tag + renotify: si llega otro aviso, reemplaza al anterior pero vuelve
      // a sonar/vibrar (mejor que apilar o que quede silencioso).
      tag: 'presupuesto-aviso',
      renotify: true,
      // requireInteraction: en Android la deja fija hasta que la tocás, así no
      // se pierde si no estás mirando el teléfono en ese momento.
      requireInteraction: true,
      vibrate: [120, 60, 120],
      data: { go: data.go || '' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const go = event.notification.data?.go;
  const url = go ? `./?go=${go}` : './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      for (const w of wins) if ('focus' in w) return w.focus();
      return clients.openWindow(url);
    })
  );
});
