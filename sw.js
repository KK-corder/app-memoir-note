const CACHE = 'memoir-note-shell-v1';
const ROOT = new URL('./', self.location.href);
const SHELL = [
  'index.html', 'styles.css', 'config.js', 'manifest.webmanifest',
  'js/main.mjs', 'js/app.mjs', 'js/core.mjs', 'js/login.mjs', 'js/storage.mjs', 'js/drive.mjs', 'js/entries.mjs', 'js/photos.mjs',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'demo/memoir.json', 'demo/photos/scene-1.svg', 'demo/photos/scene-2.svg', 'demo/photos/scene-3.svg', 'demo/photos/scene-4.svg', 'demo/photos/scene-5.svg',
].map(path => new URL(path, ROOT).href);

function shellURL(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin) return null;
  if (url.pathname === ROOT.pathname || url.pathname === new URL('index.html', ROOT).pathname) return new URL('index.html', ROOT).href;
  if (url.search || !SHELL.includes(url.href)) return null;
  return url.href;
}

self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('memoir-note-shell-') && name !== CACHE).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = shellURL(event.request);
  if (!url) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(url, response.clone());
      return response;
    } catch (error) {
      const saved = await cache.match(url);
      if (saved) return saved;
      throw error;
    }
  })());
});
