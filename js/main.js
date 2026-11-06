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

applyUI();
initTooltips();
initPop();
initEvents();
initImport();
initSettings();
initSetupEvents();

// Ctrl/Cmd+S saves straight away; leaving the page saves anything pending.
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (app.store && app.store.busy()) app.store.flushNow(); else if (app.household) toast("Everything’s already saved. Changes save as you go.");
  }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && app.store && app.store.busy()) app.store.flushNow(); });
window.addEventListener("beforeunload", e => { if (app.store && app.store.hasUnsaved()) { e.preventDefault(); e.returnValue = ""; } });

const configured = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(SUPABASE_URL.trim()) && SUPABASE_ANON_KEY.trim().length > 30;
if (!configured || !window.supabase) showAuth("setup");
else initAuth(window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }));
