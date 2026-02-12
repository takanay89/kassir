// =============================================
// SERVICE WORKER - PWA ПОДДЕРЖКА
// =============================================

const CACHE_NAME = 'kassir-pos-v5-race-fix';
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
// УСТАНОВКА
// =============================================
self.addEventListener('install', (event) => {
  console.log('📦 Service Worker устанавливается...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 Кеширование файлов приложения');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  
  self.skipWaiting();
});

// =============================================
// АКТИВАЦИЯ
// =============================================
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker активирован');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Удаление старого кеша:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  
  return self.clients.claim();
});

// =============================================
// FETCH - СТРАТЕГИЯ КЕШИРОВАНИЯ
// =============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Пропускаем запросы к Supabase API
  if (url.origin.includes('supabase.co')) {
    return;
  }
  
  // Пропускаем запросы к CDN
  if (url.origin.includes('cdn.jsdelivr.net')) {
    return;
  }
  
  // Network First для HTML (всегда пытаемся получить свежую версию)
  if (request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
    return;
  }
  
  // ✅ ИСПРАВЛЕНИЕ: Network First для JS и CSS — всегда берём свежие файлы
  // Cache First вызывал проблему: после обновления файлов браузер отдавал старые версии
  // и F5 не помогал — только Shift+F5 (полный сброс кеша)
  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache First для остальных ресурсов (картинки, шрифты и т.д.)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        
        const requestUrl = new URL(request.url);
        if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
          return response;
        }
        
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });
        
        return response;
      });
    })
  );
});

// =============================================
// SYNC EVENT (для фоновой синхронизации)
// =============================================
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-sales') {
    console.log('🔄 Фоновая синхронизация запущена');
    event.waitUntil(syncPendingSales());
  }
});

// Placeholder для синхронизации (основная логика в sync.js)
async function syncPendingSales() {
  console.log('🔄 Попытка синхронизации несохранённых продаж...');
  // Реальная синхронизация происходит в основном приложении
  return Promise.resolve();
}