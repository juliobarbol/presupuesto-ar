// ============================================================
//  sw.js - Service Worker - Presupuestos (Poda en Altura AR)
// ============================================================
//  Estrategia:
//   - App shell (index.html, manifest, iconos): cache-first con
//     refresco en segundo plano (stale-while-revalidate).
//   - Navegaciones: network-first con fallback al index cacheado
//     (permite abrir la app sin conexion).
//   - Recursos externos (fuentes de Google, CDNs): NUNCA se cachean
//     aca; el navegador maneja su propio cache.
//
//  Para forzar actualizacion tras un deploy: subir el CACHE_VERSION.
// ============================================================

const CACHE_VERSION = 'presupuesto-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon.png',
];

// -- Install: precachear el app shell -------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// -- Activate: limpiar caches viejos --------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// -- Fetch ----------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo manejamos GET del mismo origen. Todo lo externo
  // (fuentes Google, etc.) pasa directo a la red.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegaciones (abrir la app): network-first con fallback al cache.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Resto de recursos del mismo origen: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// -- Permitir actualizacion inmediata desde la pagina ---------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
