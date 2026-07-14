// Service worker — offline support for the BYOG processing pipeline.
// Strategy (issue #3):
//   - navigations:           network-first, fallback to cached index.html
//   - same-origin assets:    network-first with cache refresh — online
//                            users ALWAYS get the freshly deployed
//                            app.js/styles.css (no stale-JS footgun when
//                            a deploy forgets to bump VERSION); offline
//                            falls back to the precache
//   - worker config GETs:    stale-while-revalidate (phrases/campaigns/config)
//   - worker dynamic calls:  network-only (/generate, /generate-themes,
//                            /prompt, /quota) — offline they fail and the
//                            page degrades gracefully
//   - Google Fonts:          stale-while-revalidate (fallback = system font)
// VERSION only matters when the precache FILE LIST changes (add/remove
// files) — content updates flow through network-first automatically.
const VERSION = "v2"; // v2: + privacy.html
const PRECACHE = `lss-precache-${VERSION}`;
const RUNTIME = "lss-runtime";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./privacy.html",
  "./app.js",
  "./styles.css",
  "./vendor/jszip.min.js",
  "./manifest.json",
  "./favicon.ico",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable.png",
  "./apple-touch-icon.png",
  "./assets/sample-grid.jpg",
];

// Worker API paths that are safe to serve stale while revalidating.
const SWR_API_PATHS = ["/phrases", "/campaigns", "/config"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("lss-precache-") && k !== PRECACHE)
          .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

function staleWhileRevalidate(request) {
  return caches.open(RUNTIME).then((cache) =>
    cache.match(request, { ignoreSearch: false }).then((cached) => {
      const refresh = fetch(request)
        .then((resp) => {
          if (resp && resp.ok) cache.put(request, resp.clone());
          return resp;
        })
        .catch(() => cached);
      return cached || refresh;
    }),
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // POSTs (generate/prompt) go straight out

  const url = new URL(req.url);

  // Navigations: network-first so fresh deploys win; offline falls back.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("./index.html", { ignoreSearch: true })),
    );
    return;
  }

  // Same-origin static assets: network-first, refresh the precache copy
  // on success, fall back to cache when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(PRECACHE).then((cache) => cache.put(req, copy));
          }
          return resp;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true })),
    );
    return;
  }

  // Worker config endpoints: SWR (usable offline after first visit).
  if (url.hostname.endsWith("workers.dev") && SWR_API_PATHS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Google Fonts css + glyph shards: SWR (offline = system font fallback).
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Everything else (Turnstile, /quota, unknown): straight to network.
});
