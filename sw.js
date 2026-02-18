// =============================================
// SERVICE WORKER - SAFE PRODUCTION VERSION
// =============================================

const CACHE_NAME = 'kassir-pos-v6-safe-cache';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/style.css',
  '/script.js',
  '/db.js',
  '/sync.js'
];

// =============================================
// INSTALL
// =============================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// =============================================
// ACTIVATE
// =============================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// =============================================
// SAFE CACHE PUT
// =============================================
async function safeCachePut(request, response) {
  try {
    const url = new URL(request.url);

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
  } catch (_) {
    // Никогда не ломаем SW из-за ошибки кеширования
  }
}

// =============================================
// FETCH HANDLER
// =============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;

  const url = new URL(request.url);

  // Пропускаем Supabase API
  if (url.origin.includes('supabase.co')) {
    return;
  }

  // Пропускаем CDN
  if (url.origin.includes('cdn.jsdelivr.net')) {
    return;
  }

  // Пропускаем нестандартные схемы
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // -------------------------------------------
  // NETWORK FIRST — HTML
  // -------------------------------------------
  if (request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response && response.status === 200) {
            await safeCachePut(request, response);
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // -------------------------------------------
  // NETWORK FIRST — JS & CSS
  // -------------------------------------------
  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response && response.status === 200) {
            await safeCachePut(request, response);
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // -------------------------------------------
  // CACHE FIRST — Остальные ресурсы
  // -------------------------------------------
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then(async (response) => {
          if (!response || response.status !== 200) {
            return response;
          }

          await safeCachePut(request, response);
          return response;
        })
        .catch(() => {
          return cachedResponse;
        });
    })
  );
});

// =============================================
// BACKGROUND SYNC
// =============================================
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-sales') {
    event.waitUntil(Promise.resolve());
  }
});
