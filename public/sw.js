// Service worker: makes S-Trainer installable and lets it open offline.
// Network first, falling back to the last cached copy. Chat is never cached,
// and Vite's dev-server internals are left alone.
const CACHE = "s-trainer-v1";
const SHELL = ["./", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

const SKIP = [/^\/api\/chat/, /^\/@/, /^\/node_modules\//, /[?&](import|t=)/];

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (SKIP.some((re) => re.test(url.pathname + url.search))) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((hit) => hit || (event.request.mode === "navigate" ? caches.match("./") : undefined)),
      ),
  );
});
