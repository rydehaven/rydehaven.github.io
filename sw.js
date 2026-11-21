// sw.js — makes Rydehaven installable and quick to start: the app's code is stored on install, and textures,
// models, the sky and the 3D engine are stored the first time they load. Bump VERSION whenever you upload changes.
const VERSION = 'rydehaven-v1';
const SHELL = ["./", "icons/favicon-32.png", "icons/icon-192.png", "index.html", "js/bike.js", "js/bikegen.js", "js/config.js", "js/devices.js", "js/finish.js", "js/home.js", "js/housegen.js", "js/houses.js", "js/main.js", "js/noise.js", "js/quality.js", "js/races.js", "js/rider.js", "js/riderpose.js", "js/settings.js", "js/terrainMaterial.js", "js/textures.js", "js/trainer.js", "js/trees.js", "js/walls.js", "js/world.js", "manifest.webmanifest", "maps/alpine.js", "maps/countryside.js", "maps/index.js", "maps/race.js"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url), own = url.origin === location.origin;
  const cdn = /(^|\.)(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (!own && !cdn) return;
  // pages and code: network first (so uploads show up), fall back to the stored copy when offline
  if (own && (req.mode === 'navigate' || /\.(js|html|webmanifest)$/.test(url.pathname))) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
    return;
  }
  // big files (textures, rider, sky) and the 3D engine: stored copy first, download once
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return r;
  })));
});
