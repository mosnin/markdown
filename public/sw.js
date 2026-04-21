// Poggle service worker — minimal shell + offline fallback.
//
// V1 strategy:
//   * Cache the app shell on install (HTML, manifest, logo)
//   * Network-first for navigation requests; fall back to cached shell
//     when offline so the PWA still opens
//   * Pass-through for everything else (no aggressive caching of API
//     responses — those need fresh data and Supabase realtime)
//
// Increment CACHE_VERSION when shell assets change so old caches are
// purged on the next activate.

const CACHE_VERSION = "poggle-shell-v1";
const SHELL_ASSETS = [
  "/",
  "/capture",
  "/manifest.webmanifest",
  "/logo-symbol-light.png",
  "/logo-symbol-dark.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Best-effort cache: any single failure (e.g. 404 in dev) shouldn't
      // abort the whole install. addAll is all-or-nothing, so add each
      // one individually with .catch.
      Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("[sw] shell cache miss", url, err);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only intercept GETs. POSTs (mutations, server actions) must always
  // hit the network.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Pass-through for cross-origin and API requests
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/data/")) return;

  // Navigation: network-first with cache fallback
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/capture").then((res) => res || caches.match("/"))
      )
    );
    return;
  }

  // Static assets: cache-first, network-update
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          // Don't cache opaque responses or errors
          if (!res || res.status !== 200 || res.type !== "basic") return res;
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          return res;
        })
    )
  );
});
