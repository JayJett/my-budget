/* The service worker: keeps a copy of the app on the device so it opens without a connection.

   - Everything in FILES is downloaded when a new version installs, then served from the device.
   - Requests to other websites (the Supabase database, Google Fonts) are left alone: your budget
     data is cached by the app itself (js/sync/store.js), not here.
   - When FILES change, VERSION changes, the browser installs the new version in the background,
     and the app offers "A new version is ready. Tap to refresh".

   VERSION and FILES are filled in by:  node tools/sw-version.mjs
   (the tests fail if you forget, so an old copy can never be served by mistake). */

// --- generated: start ---
const VERSION = "c303e1613609";
const FILES = [ "./", "./css/app.css", "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon.svg", "./icons/maskable-512.png", "./index.html", "./js/config.js", "./js/main.js", "./js/model/calc.js", "./js/model/format.js", "./js/model/history.js", "./js/model/household.js", "./js/model/migrate.js", "./js/model/onboarding.js", "./js/model/periods.js", "./js/model/reminders.js", "./js/model/schema.js", "./js/model/snapshots.js", "./js/model/util.js", "./js/sync/ops.js", "./js/sync/store.js", "./js/ui/accent-list.js", "./js/ui/accent.js", "./js/ui/art.js", "./js/ui/auth.js", "./js/ui/budget-sheets.js", "./js/ui/charts.js", "./js/ui/ctx.js", "./js/ui/dom.js", "./js/ui/drawer.js", "./js/ui/events.js", "./js/ui/exports.js", "./js/ui/feedback.js", "./js/ui/hero-art.js", "./js/ui/history.js", "./js/ui/household-look.js", "./js/ui/household-mode.js", "./js/ui/icons.js", "./js/ui/inputs.js", "./js/ui/menu.js", "./js/ui/motion.js", "./js/ui/onboarding.js", "./js/ui/palette.js", "./js/ui/profile.js", "./js/ui/push.js", "./js/ui/reminders.js", "./js/ui/render.js", "./js/ui/settings.js", "./js/ui/tour.js", "./js/ui/views/budget.js", "./js/ui/views/goals.js", "./js/ui/views/invest.js", "./js/ui/views/labels.js", "./js/ui/views/networth.js", "./js/ui/views/progress.js", "./js/ui/views/spending.js", "./manifest.webmanifest", "./vendor/supabase-js-2.45.4/591.supabase.js", "./vendor/supabase-js-2.45.4/supabase.js" ];
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
    // Opening the app always gets the stored copy of index.html. Other pages (e.g. tools/) come from the network.
    if (req.mode === "navigate") {
      const root = new URL(self.registration.scope).pathname;
      const isApp = url.pathname === root || url.pathname === root + "index.html";
      const page = await cache.match("./index.html") || await cache.match("./");
      if (isApp && page) return page;
      if (!isApp) { try { return await fetch(req); } catch (_) { if (page) return page; } }
    }
    const hit = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
    if (hit) return hit;
    return fetch(req); // not stored (e.g. a splash image): use the network
  })());
});

/* ---------- reminders on your phone or computer (Part 4C) ----------
   The daily reminders function sends an encrypted message; this shows it as a notification.
   Tapping it opens the app on the right tab (or the reminders inbox, for several at once). */
self.addEventListener("push", event => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (_) { m = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(m.title || "Moni Money", {
    body: m.body || "", icon: "./icons/icon-192.png", badge: "./icons/icon-192.png",
    tag: m.tag || "mb-reminders", data: { url: m.url || "./" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find(w => w.url.startsWith(self.registration.scope));
    if (win) { win.postMessage({ type: "open", hash: target.hash }); return win.focus(); } // already open: just switch tab
    return self.clients.openWindow(target.href);
  })());
});
