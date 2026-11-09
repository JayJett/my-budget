/* Start-up: connect to Supabase and wire up the page. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { app } from "./ui/ctx.js";
import { toast, initTooltips, initPop } from "./ui/dom.js";
import { applyUI } from "./ui/render.js";
import { initEvents } from "./ui/events.js";
import { initImport } from "./ui/exports.js";
import { initAuth, showAuth } from "./ui/auth.js";
import { initSettings } from "./ui/settings.js";
import { initSetupEvents } from "./ui/onboarding.js";
import "./ui/tour.js";
import { initProgress } from "./ui/views/progress.js";
import { initInvest } from "./ui/views/invest.js";
import { initGoals } from "./ui/views/goals.js";
import { initHistory } from "./ui/history.js";
import { initReminders } from "./ui/reminders.js";
import { initAccent } from "./ui/accent.js";
import { initBudgetSheets } from "./ui/budget-sheets.js";
import { initHouseholdMode } from "./ui/household-mode.js";
import { initHouseholdLook } from "./ui/household-look.js";
import { initFeedback } from "./ui/feedback.js";
import { initHome } from "./ui/views/home.js";
import { initHouseholdMenu } from "./ui/household-menu.js";

applyUI();
initTooltips();
initPop();
initEvents();
initImport();
initSettings();
initHouseholdMode();
initHouseholdLook();
initFeedback();
initHome();
initHouseholdMenu();
initSetupEvents();
initProgress();
initInvest();
initGoals();
initHistory();
initReminders();
initAccent();
initBudgetSheets();

// Ctrl/Cmd+S saves straight away; leaving the page saves anything pending.
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (app.store && app.store.busy()) app.store.flushNow(); else if (app.household) toast("Everything’s already saved. Changes save as you go.");
  }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && app.store && app.store.busy()) app.store.flushNow(); });
// Warn before leaving while a change is still on its way. Not when offline: those edits are kept on the device and sync later.
// "Offline" is the app's own view too (it loaded from this device, or its last save attempt found no
// connection): navigator.onLine alone can say "online" when there's no internet (common on iPhones).
const offlineNow = () => navigator.onLine === false || app.offline || app.saveStatus === "offline";
window.addEventListener("beforeunload", e => { if (!offlineNow() && app.store && app.store.hasUnsaved()) { e.preventDefault(); e.returnValue = ""; } });

const configured = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(SUPABASE_URL.trim()) && SUPABASE_ANON_KEY.trim().length > 30;
if (!configured || !window.supabase) showAuth("setup");
else initAuth(window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }));

/* ---------- installable app: keep a copy on the device, and offer updates ---------- */
function offerUpdate(worker) {
  if (document.getElementById("update")) return;
  const bar = document.createElement("div");
  bar.id = "update"; bar.className = "update-bar"; bar.setAttribute("role", "status");
  bar.innerHTML = `<span>A new version is ready.</span><button class="btn small primary" type="button">Tap to refresh</button>`;
  bar.querySelector("button").addEventListener("click", async () => {
    bar.querySelector("button").disabled = true;
    if (app.store) await app.store.flushNow();   // don't lose an edit that's on its way
    updating = true;
    worker.postMessage({ type: "SKIP_WAITING" }); // the page reloads once the new version takes over
  });
  document.body.appendChild(bar);
}
let updating = false;
const canUseSW = "serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname));
if (canUseSW) {
  navigator.serviceWorker.register("sw.js").then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w); });
    });
    // Check for a new version whenever the app comes back to the front.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => { /* not available (e.g. private browsing): the app still works online */ });
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (updating) location.reload(); });
  // Tapped a notification while the app was already open: go to the right place.
  navigator.serviceWorker.addEventListener("message", e => {
    const m = e.data || {}; if (m.type !== "open" || !m.hash) return;
    if (m.hash === "#reminders") { if (app.openInbox) app.openInbox(); } else location.hash = m.hash;
  });
}
