/* Three Plates service worker.
 * Network first for the app's own files (so updates show up right away),
 * falling back to the cached copy when offline. Google Fonts are cached for offline use.
 * Requests to AI providers, the sync API (/api) and sign-in (/.auth) are never touched or cached.
 */
const APP_CACHE = "three-plates-app-v2";
const FONT_CACHE = "three-plates-fonts-v1";
const SHELL = [
  "/", "/index.html", "/css/app.css", "/js/store.js", "/js/sync.js", "/js/ai.js", "/js/app.js",
  "/manifest.webmanifest", "/icons/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png",
  "/icons/maskable-512.png", "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && /^\/(api|\.auth)\//.test(url.pathname)) return;

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(req.mode === "navigate" ? "/index.html" : req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req.mode === "navigate" ? "/index.html" : req).then((hit) => hit || caches.match("/index.html")))
    );
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    );
  }
  // Everything else (AI provider APIs, Walmart links) goes straight to the network.
});
