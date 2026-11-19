// Service worker: guarda o app inteiro no aparelho para funcionar offline.
// Ao mudar qualquer arquivo, aumente a VERSAO para os celulares baixarem a nova versão.
const VERSAO = 'italiano-v1.0.0';
const ARQUIVOS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/check.js', './js/course.js', './js/exercises.js', './js/srs.js', './js/stats.js', './js/store.js', './js/speech.js',
  './data/curso-a1.js', './vendor/ts-fsrs.mjs',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// cache primeiro; se não estiver no cache, busca na rede e guarda
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSAO).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
