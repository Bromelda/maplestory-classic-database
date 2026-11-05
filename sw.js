// Keeps the site usable with a weak signal. Pages and data try the network first, so updates show right away.
// Images rarely change, so they come from the saved copy first. Other sites (like prices) aren't touched.
const PAGES = "msdb-pages-v1";
const IMAGES = "msdb-images-v1";
const MAX_IMAGES = 500;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.addAll(["./", "manifest.webmanifest"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== PAGES && k !== IMAGES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim() {
  const cache = await caches.open(IMAGES);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_IMAGES)).map((k) => cache.delete(k)));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/assets/")) {
    e.respondWith(caches.open(IMAGES).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { await cache.put(req, res.clone()); trim(); }
      return res;
    }));
    return;
  }
  e.respondWith(fetch(req).then(async (res) => {
    if (res.ok) (await caches.open(PAGES)).put(req, res.clone());
    return res;
  }).catch(async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") return caches.match("./");
    return Response.error();
  }));
});
