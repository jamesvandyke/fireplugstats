const CACHE = "fireplug-stats-v33";
const ASSETS = [
  "./",
  "./index.html",
  "./watch.html",
  "./summary.html",
  "./admin.html",
  "./styles.css?v=27",
  "./app.js?v=30",
  "./watch.js?v=18",
  "./summary.js?v=22",
  "./lineups.mjs?v=19",
  "./rosters.mjs?v=1",
  "./colors.mjs?v=1",
  "./voice.mjs?v=4",
  "./speech.mjs?v=5",
  "./admin.js?v=17",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
