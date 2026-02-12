const CACHE_NAME = 'audio-pulse-v12';
const ASSETS = [
  './',
  './index.html',
  './index.css',
  './index.tsx',
  './App.tsx',
  './types.ts',
  './services/audioEngine.ts',
  './services/haService.ts',
  './components/Visualizer.tsx',
  './public/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 逐个添加，避免其中一个 404 导致全部失败
      return Promise.allSettled(
        ASSETS.map(url => cache.add(url).catch(err => console.warn(`缓存跳过: ${url}`, err)))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  // 只处理同源请求，避免干扰 CDN
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});