/* The service worker: keeps a copy of the app on the device so it opens without a connection.

   - Everything in FILES is downloaded when a new version installs, then served from the device.
   - Requests to other websites (the Supabase database, Google Fonts) are left alone: your budget
     data is cached by the app itself (js/sync/store.js), not here.
   - When FILES change, VERSION changes, the browser installs the new version in the background,
     and the app offers "A new version is ready. Tap to refresh".

   VERSION and FILES are filled in by:  node tools/sw-version.mjs
   (the tests fail if you forget, so an old copy can never be served by mistake). */

// --- generated: start ---
const VERSION = "9f894ca3d165";
const FILES = [ "./", "./css/app.css", "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon.svg", "./icons/maskable-512.png", "./index.html", "./js/config.js", "./js/main.js", "./js/model/calc.js", "./js/model/format.js", "./js/model/history.js", "./js/model/migrate.js", "./js/model/onboarding.js", "./js/model/periods.js", "./js/model/schema.js", "./js/model/snapshots.js", "./js/model/util.js", "./js/sync/ops.js", "./js/sync/store.js", "./js/ui/auth.js", "./js/ui/charts.js", "./js/ui/ctx.js", "./js/ui/dom.js", "./js/ui/events.js", "./js/ui/exports.js", "./js/ui/history.js", "./js/ui/inputs.js", "./js/ui/menu.js", "./js/ui/onboarding.js", "./js/ui/render.js", "./js/ui/settings.js", "./js/ui/tour.js", "./js/ui/views/budget.js", "./js/ui/views/goals.js", "./js/ui/views/invest.js", "./js/ui/views/labels.js", "./js/ui/views/networth.js", "./js/ui/views/progress.js", "./js/ui/views/spending.js", "./manifest.webmanifest", "./vendor/supabase-js-2.45.4/591.supabase.js", "./vendor/supabase-js-2.45.4/supabase.js" ];
// --- generated: end ---

const CACHE = "mb-app-" + VERSION;

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("mb-app-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The page asks for this when you tap "refresh" on the update banner.
self.addEventListener("message", event => { if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // database, fonts: straight to the network
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Opening the app (or any page of it) always gets the stored copy of index.html.
    if (req.mode === "navigate") {
      const page = await cache.match("./index.html") || await cache.match("./");
      if (page) return page;
    }
    const hit = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
    if (hit) return hit;
    return fetch(req); // not stored (e.g. a splash image): use the network
  })());
});
