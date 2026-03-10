// Chunks AI — Service Worker
// Strategy: Cache-first for static assets, Network-first for API calls

const CACHE_NAME = 'chunks-ai-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/public/favicon.svg',
  '/public/favicon-32x32.png',
  '/public/manifest.json'
];

// Install: pre-cache critical static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: smart routing
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache API calls or Supabase
  if (url.hostname.includes('railway.app') ||
      url.hostname.includes('supabase.co') ||
      url.hostname.includes('openrouter.ai')) {
    return; // Pass through to network
  }

  // Cache-first for static assets (images, fonts, CSS, JS)
  if (event.request.method === 'GET' &&
      (url.pathname.startsWith('/public/') ||
       url.pathname.endsWith('.css') ||
       url.pathname.endsWith('.js') ||
       url.pathname.endsWith('.woff2') ||
       url.pathname.endsWith('.png') ||
       url.pathname.endsWith('.svg'))) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached); // Fallback to cache if offline
      })
    );
    return;
  }

  // Network-first for HTML (always get fresh index.html)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/index.html')
      )
    );
    return;
  }
});
