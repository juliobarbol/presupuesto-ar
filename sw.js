// ============================================================
//  sw.js - Service Worker - Presupuestos (Poda en Altura AR)
// ============================================================
//  Estrategia:
//   - App shell (index.html, manifest, iconos): cache-first.
//     El index cacheado se sirve al instante, sin esperar la red.
//     Esto evita que el splash quede colgado cuando no hay senal.
//     En segundo plano se busca una version nueva y se guarda para
//     la proxima apertura.
//   - Recursos externos (fuentes de Google, CDNs): NUNCA se cachean
//     aca; el navegador maneja su propio cache.
//
//  Para forzar actualizacion tras un deploy: subir el CACHE_VERSION.
// ============================================================

const CACHE_VERSION = 'presupuesto-v2';
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

  // Navegaciones (abrir la app): CACHE-FIRST.
  // Si el index esta cacheado, lo devolvemos al instante (sin esperar
  // la red), y refrescamos en segundo plano. Asi nunca se cuelga el
  // splash por falta de senal. Si no hay cache todavia, vamos a la red.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const fromNetwork = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put('./index.html', copy));
          }
          return res;
        }).catch(() => cached);
        // Cache primero; si no hay nada cacheado, esperamos la red.
        return cached || fromNetwork;
      })
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
