// Service worker — offline support for the BYOG processing pipeline.
// Strategy (issue #3):
//   - navigations:           network-first, fallback to cached index.html
//   - same-origin assets:    cache-first (precached below)
//   - worker config GETs:    stale-while-revalidate (phrases/campaigns/config)
//   - worker dynamic calls:  network-only (/generate, /generate-themes,
//                            /prompt, /quota) — offline they fail and the
//                            page degrades gracefully
//   - Google Fonts:          stale-while-revalidate (fallback = system font)
// Bump VERSION on every deploy that changes precached files.
const VERSION = "v1";
const PRECACHE = `lss-precache-${VERSION}`;
const RUNTIME = "lss-runtime";

const PRECACHE_URLS = [
  "./",
  "./index.html",
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

  // Same-origin static assets: cache-first against the precache.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true })
        .then((cached) => cached || fetch(req)),
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
