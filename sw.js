// ============================================================
//  sw.js - Service Worker - Presupuestos (Poda en Altura AR)
// ============================================================
//  Estrategia:
//   - App shell (index.html, manifest, iconos): cache-first.
//     El index cacheado se sirve al instante, sin esperar la red.
//     Esto evita que el splash quede colgado cuando no hay senal,
//     y evita la pantalla de error cuando el Worker esta
//     redesplegando tras un cambio en GitHub.
//   - Recursos externos (fuentes de Google, CDNs): NUNCA se cachean
//     aca; el navegador maneja su propio cache.
//
//  Para forzar actualizacion tras un deploy: subir el CACHE_VERSION.
// ============================================================

const CACHE_VERSION = 'presupuesto-v13';
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

// -- Helper: buscar en cache con varios fallbacks -------------
// Intenta el request exacto; si no, prueba index.html; si no, la raiz.
// Esto cubre el caso donde el navegador pide /index.html pero en cache
// quedo guardado como './' (o viceversa).
function matchAppShell(req) {
  return caches.match(req)
    .then((r) => r || caches.match('./index.html'))
    .then((r) => r || caches.match('./'))
    .then((r) => r || caches.match(new Request('index.html')));
}

// -- Fetch ----------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo manejamos GET del mismo origen. Todo lo externo
  // (fuentes Google, etc.) pasa directo a la red.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegaciones (abrir la app): CACHE-FIRST con red en 2do plano.
  // Si hay algo en cache lo servimos YA (sin esperar la red), asi nunca
  // se cuelga ni muestra error mientras el Worker redespliega. Si no hay
  // nada cacheado todavia, vamos a la red; y si la red tambien falla,
  // intentamos cualquier cosa del app shell antes de rendirnos.
  if (req.mode === 'navigate') {
    event.respondWith(
      matchAppShell(req).then((cached) => {
        const fromNetwork = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put('./index.html', copy));
          }
          return res;
        }).catch(() => cached || matchAppShell(req));
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
