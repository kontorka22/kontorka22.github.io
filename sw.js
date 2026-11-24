// Кеш оболочки приложения: открывается без сети. Курс ЦБ и синхронизация — всегда из сети.
const VERSION = 'v26';
const SHELL = ['./', 'index.html', 'style.css?v=15', 'app.js?v=24', 'calc.js?v=24', 'cbr.js?v=24', 'store.js?v=24', 'config.js?v=24',
  'manifest.webmanifest', 'icons/icon-192.png?v=2', 'icons/icon-512.png?v=2', 'icons/icon-180.png?v=2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // ЦБ, Supabase — мимо кеша
  // сначала сеть (чтобы обновления приходили сразу), без сети — кеш
  e.respondWith(
    // no-cache: всегда сверяемся с сервером, иначе браузер может отдать старую версию из своего кеша
    fetch(e.request.url, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: false }).then(r => r || caches.match('index.html')))
  );
});
