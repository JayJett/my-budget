/* Reminders on this phone or computer ("push notifications"), one device at a time.

   Turning them on: the browser asks permission, then makes a "subscription" (an address at Apple's or
   Google's push service, plus keys only this device holds), which is saved with save_push_subscription.
   The daily reminders function sends there (see supabase/functions/send-reminders), and sw.js shows it.
   The public half of the app's signing key comes from that function, so there's nothing to configure here. */
import { app } from "./ctx.js";

const FN = "send-reminders";
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installed = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;

/** Can this device get notifications? { ok } or { ok: false, why: "ios-home" | "unsupported" | "denied" }. */
export function pushSupport() {
  const has = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIOS() && !installed()) return { ok: false, why: "ios-home" }; // iPhone/iPad: only from the Home Screen app
  if (!has) return { ok: false, why: "unsupported" };
  if (Notification.permission === "denied") return { ok: false, why: "denied" };
  return { ok: true };
}

/** A short name for this device, shown in the list of devices: "iPhone · Safari". */
export function deviceLabel(ua = navigator.userAgent) {
  const dev = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad"
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet") : /Macintosh/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows computer" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux computer" : "This device";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return (installed() ? `${dev} · app` : br ? `${dev} · ${br}` : dev).slice(0, 60);
}

const ready = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("The app isn’t fully installed on this device yet. Reload the page and try again.")), 8000))]);

/** This device's current subscription, if notifications are on here. */
export async function currentSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try { const reg = await ready(); return await reg.pushManager.getSubscription(); } catch (_) { return null; }
}

/** The function's message for a failed call ("Phone notifications aren't set up yet", "Wait a minute…"). */
async function fnError(error) {
  try { const b = await error.context.json(); if (b && b.error) return b.error; } catch (_) {}
  return /fetch|network/i.test((error && error.message) || "") ? "Can’t reach the server. Check your connection and try again." : "Something went wrong. Try again in a moment.";
}
const b64ToBytes = s => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(t + "=".repeat((4 - t.length % 4) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); };

/** Turn notifications on for this device. Throws a friendly message if it can't. */
export async function enablePush() {
  const s = pushSupport(); if (!s.ok) throw new Error(s.why === "denied" ? "Notifications are blocked for this app in your settings." : "This device can’t get notifications here.");
  const { data, error } = await app.sb.functions.invoke(FN, { body: { publicKey: true } });
  if (error || !data || !data.publicKey) throw new Error(error ? await fnError(error) : "Phone notifications aren’t set up yet.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications were blocked. To turn them on later, allow them for this app in your device or browser settings." : "Notifications weren’t allowed, so nothing changed.");
  const reg = await ready();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, data.publicKey)) { await sub.unsubscribe(); sub = null; } // made with an old key
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(data.publicKey) });
  const j = sub.toJSON();
  const { error: e2 } = await app.sb.rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_label: deviceLabel() });
  if (e2) throw new Error(app.friendly ? app.friendly(e2) : e2.message);
}
function sameKey(sub, publicKey) {
  try {
    const k = sub.options && sub.options.applicationServerKey; if (!k) return true;
    const a = new Uint8Array(k), b = b64ToBytes(publicKey);
    return a.length === b.length && a.every((x, i) => x === b[i]);
  } catch (_) { return true; }
}

/** Turn notifications off for this device (also used when signing out, so the next person doesn't get yours). */
export async function disablePush() {
  const sub = await currentSubscription(); if (!sub) return;
  try { if (app.sb && app.session && !app.session.offline) await app.sb.rpc("forget_push_subscription", { p_endpoint: sub.endpoint }); } catch (_) {}
  try { await sub.unsubscribe(); } catch (_) {}
}

/** Your devices with notifications on: [{ id, label, created_at, endpoint }]. */
export async function myDevices() {
  const { data, error } = await app.sb.from("push_subscriptions").select("id, label, created_at, endpoint").order("created_at");
  if (error) throw error;
  return data || [];
}
export async function removeDevice(id) {
  const { error } = await app.sb.from("push_subscriptions").delete().eq("id", id);
  if (error) throw error;
}

/** "Send a test" to your devices. Returns a sentence to show. */
export async function sendTest() {
  const { data, error } = await app.sb.functions.invoke(FN, { body: { test: true } });
  if (error) throw new Error(await fnError(error));
  if (!data.sent) return data.gone ? "That device is no longer reachable, so it was removed. Turn notifications on again." : "The test didn’t go through. Try again in a minute.";
  return `Test sent to ${data.sent === 1 ? "your device" : `${data.sent} devices`}. It should arrive in a few seconds.`;
}
