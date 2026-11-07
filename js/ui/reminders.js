/* Gentle reminders: the bell 🔔 in the header, the inbox, and Reminder settings.
   Reminders are worked out each morning by the database and the send-reminders function (see
   supabase/migrations/..._reminders.sql); this file shows them and saves each person's switches.
   The rules and wording live in js/model/reminders.js. */
import { app, TAB_HASH } from "./ctx.js";
import { $, esc, toast } from "./dom.js";
import { openDrawer, setDrawerContent, closeDrawer, drawerOpen } from "./drawer.js";
import { remindersFor, REMINDER_TYPES, DEFAULT_PREFS, DUE_WEEKS } from "../model/reminders.js";
import { pushSupport, currentSubscription, enablePush, disablePush, myDevices, removeDevice, sendTest } from "./push.js";

export const REM_CACHE = "mb-rem-v1-";
const COLS = "id, kind, title, body, tab, created_at, read_at";
const friendly = e => app.friendly ? app.friendly(e) : (e && e.message) || "Something went wrong.";
const offline = () => !!app.offline || navigator.onLine === false;
const R = { view: null, prefs: null, device: null };

/* ---------- loading and the bell ---------- */
/** This person's reminders in the open household: the copy on this device first, then the latest. */
export async function loadReminders() {
  const hh = app.household; if (!hh || !app.sb) return;
  try { const c = JSON.parse(localStorage.getItem(REM_CACHE + hh.id) || "null"); if (c && !app.reminders) app.reminders = c; } catch (_) {}
  updateBell();
  if (offline()) return;
  const { data, error } = await app.sb.from("reminders").select(COLS).eq("household_id", hh.id).order("created_at", { ascending: false }).limit(50);
  if (!app.household || app.household.id !== hh.id || error) return;
  app.reminders = data || [];
  try { localStorage.setItem(REM_CACHE + hh.id, JSON.stringify(app.reminders)); } catch (_) {}
  updateBell();
  if (R.view === "inbox") drawInbox();
}
export function resetReminders() { app.reminders = null; R.prefs = null; updateBell(); }

export function updateBell() {
  const b = $("#bellBtn"); if (!b) return;
  b.hidden = !app.household;
  const unread = (app.reminders || []).filter(r => !r.read_at).length;
  const n = $("#bellCount"); n.hidden = !unread; // a small dot when something's unread (the number is in the label)
  b.setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
  b.dataset.tip = unread ? `${unread} new reminder${unread === 1 ? "" : "s"}` : "Reminders";
}

/* ---------- the sheet ---------- */
function sheet(title, html) {
  const d = $("#sheet");
  d.innerHTML = `<div class="sheet-head"><h3>${esc(title)}</h3><button class="btn icon" type="button" data-sheet="close" aria-label="Close">✕</button></div><div class="sheet-body rem">${html}</div>`;
  if (!d.open) d.showModal();
}
const isOpen = () => $("#sheet").open && !!$("#sheet .rem");
const ago = iso => {
  const d = new Date(iso), days = Math.round((app.today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? `${days} days ago` : d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
};
const TAB_NAME = { budget: "Budget", networth: "Net worth", spending: "Joint spending", goals: "Goals", invest: "Investments", progress: "Progress" };

/* Phase 7D.2: the bell opens a notification centre, a drawer from the right with the same look as the
   menu. It shows your real reminders for this household (nothing made up): unread ones stand out, each
   can be marked read or take you to its tab, and "Reminder settings" is at the bottom. Reminders are
   per person and per household, as before (the database only lets you read your own). */
let inboxOpen = false;
export function openInbox() {
  R.view = "inbox"; inboxOpen = true;
  const sh = $("#sheet"); if (sh.open && sh.querySelector(".rem")) sh.close();
  openDrawer({ html: inboxHTML(), label: "Notifications", from: "right", trigger: $("#bellBtn"), onAction: remAct, className: "dr-inbox" });
  loadReminders();
}
function drawInbox() { if (inboxOpen && drawerOpen() && document.querySelector("#drawer.dr-inbox")) setDrawerContent(inboxHTML(), { focus: false }); }
function remAct(b) {
  const id = Number(b.dataset.id), act = b.dataset.rem; if (!act) return;
  if (act === "read") { markRead([id]); drawInbox(); }
  if (act === "readall") { markRead((app.reminders || []).filter(r => !r.read_at).map(r => r.id)); drawInbox(); }
  if (act === "settings") { inboxOpen = false; closeDrawer({ focus: false }); openReminderSettings(); }
  if (act === "go") {
    const r = (app.reminders || []).find(x => x.id === id); if (!r) return;
    if (!r.read_at) markRead([id]);
    inboxOpen = false; closeDrawer({ focus: false });
    if (TAB_HASH[r.tab]) location.hash = TAB_HASH[r.tab];
  }
}

function inboxHTML() {
  const list = app.reminders || [], unread = list.filter(r => !r.read_at).length;
  const items = list.map(r => `<li class="rem-item${r.read_at ? " read" : ""}">
      <div class="rem-top"><b>${esc(r.title)}</b><small>${esc(ago(r.created_at))}</small></div>
      ${r.body ? `<p>${esc(r.body)}</p>` : ""}
      <div class="rem-acts">${r.tab && TAB_NAME[r.tab] ? `<button class="btn small" type="button" data-rem="go" data-id="${r.id}">Take me to ${esc(TAB_NAME[r.tab])}</button>` : ""}
        ${r.read_at ? "" : `<button class="btn small" type="button" data-rem="read" data-id="${r.id}">Mark as read</button>`}</div></li>`).join("");
  return `<div class="dr-sub-h dr-inbox-h"><h2>Notifications</h2><button class="dr-x" type="button" data-dr-close aria-label="Close notifications"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>
    <div class="rem">${offline() ? `<p class="set-note">You’re offline: these are the reminders saved on this device.</p>` : ""}
    ${list.length ? `<div class="rem-bar"><span class="set-note">${unread ? `${unread} new` : "All caught up"}</span>${unread ? `<button class="btn small ghost" type="button" data-rem="readall">Mark all as read</button>` : ""}</div><ul class="rem-list">${items}</ul>`
      : `<div class="rem-empty"><span class="rem-bell" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg></span><b>You’re all caught up</b>
        <p class="set-note">Reminders you switch on show up here: a bill coming up, a goal reached, time to check your balances.</p></div>`}
    <div class="rem-foot"><button class="btn block${list.length ? "" : " primary"}" type="button" data-rem="settings">Reminder settings</button></div></div>`;
}

async function markRead(ids) {
  const now = new Date().toISOString();
  (app.reminders || []).forEach(r => { if (ids.includes(r.id) && !r.read_at) r.read_at = now; });
  updateBell();
  try { localStorage.setItem(REM_CACHE + app.household.id, JSON.stringify(app.reminders)); } catch (_) {}
  if (offline()) return;
  const { error } = await app.sb.from("reminders").update({ read_at: now }).in("id", ids);
  if (error) toast(friendly(error));
}

/* ---------- settings ---------- */
export async function openReminderSettings() {
  R.view = "settings";
  sheet("Reminder settings", `<p class="set-note">Loading…</p>`);
  if (offline()) { sheet("Reminder settings", `<p class="lead">Changing reminders needs a connection.</p>`); return; }
  const { data, error } = await app.sb.from("reminder_prefs").select("*").eq("household_id", app.household.id).eq("user_id", app.meId).maybeSingle();
  if (!isOpen() || R.view !== "settings") return;
  if (error) { sheet("Reminder settings", `<div class="msg err">${esc(friendly(error))}</div>`); return; }
  R.prefs = { ...DEFAULT_PREFS, ...(data || {}) };
  R.device = null;
  drawSettings();
  loadDevice();
}

/* ---------- this device: phone or computer notifications ---------- */
async function loadDevice() {
  let list = [], sub = null;
  try { [list, sub] = await Promise.all([myDevices(), currentSubscription()]); } catch (_) {}
  R.device = { list, endpoint: sub ? sub.endpoint : null, on: !!(sub && list.some(x => x.endpoint === sub.endpoint)), busy: false, msg: R.device && R.device.msg };
  if (isOpen() && R.view === "settings") drawSettings();
}

function deviceHTML() {
  const D = R.device, s = pushSupport();
  const anyOn = REMINDER_TYPES.some(t => R.prefs[t.pref]);
  let body;
  if (!D) body = `<p class="set-note">Checking this device…</p>`;
  else if (!s.ok) body = `<p class="set-note">${{
    "ios-home": "On iPhone and iPad, notifications only work in the installed app (iOS 16.4 or later). In Safari, tap the Share button, then <b>Add to Home Screen</b>. Open Moni Money from your Home Screen, then turn them on here.",
    unsupported: "This browser can’t show notifications. Try Chrome, Edge, Firefox or Safari, or the installed app.",
    denied: "Notifications are blocked for this app on this device. Allow them in your device or browser settings, then come back here.",
  }[s.why]}</p>`;
  else if (D.on) body = `<p class="push-on"><span class="chip ok">On for this device</span> Your new reminders arrive here as a notification, around 8:30am.</p>
    <div class="rem-acts"><button class="btn small" type="button" data-push="test"${D.busy ? " disabled" : ""}>Send a test</button><button class="btn small" type="button" data-push="off"${D.busy ? " disabled" : ""}>Turn off for this device</button></div>`;
  else body = `<p class="set-note">Get your reminders as a notification on this ${/iPhone|Android.*Mobile/.test(navigator.userAgent) ? "phone" : "device"} too, around 8:30am. Only the reminders you’ve switched on above are sent${anyOn ? "" : ", so switch one on first"}.</p>
    <div class="rem-acts"><button class="btn primary" type="button" data-push="on"${D.busy ? " disabled" : ""}>Turn on for this device</button></div>`;
  const others = D ? D.list.filter(x => x.endpoint !== D.endpoint) : [];
  const list = others.length ? `<p class="set-note" style="margin-top:12px">Also on:</p><ul class="push-devices">${others.map(x => `<li><span>${esc(x.label || "A device")}<small>since ${esc(new Date(x.created_at).toLocaleDateString("en-NZ", { day: "numeric", month: "short" }))}</small></span><button class="btn small" type="button" data-push="remove" data-id="${x.id}">Remove</button></li>`).join("")}</ul>` : "";
  const msg = D && D.msg ? `<div class="msg ${D.msg.kind}" style="margin-top:10px">${esc(D.msg.text)}</div>` : "";
  return `<section class="set push-set"><h4>Notifications on this device</h4>${body}${msg}${list}</section>`;
}

async function pushAction(act, id) {
  const D = R.device; if (!D || D.busy) return;
  D.busy = true; D.msg = null; drawSettings();
  try {
    if (act === "on") { await enablePush(); D.msg = { kind: "ok", text: "Notifications are on for this device. Try “Send a test” to check." }; }
    if (act === "off") { await disablePush(); D.msg = { kind: "info", text: "Notifications are off for this device. Reminders still appear under the bell." }; }
    if (act === "test") D.msg = { kind: "info", text: await sendTest() };
    if (act === "remove") await removeDevice(id);
  } catch (e) { D.msg = { kind: "err", text: (e && e.message) || "Something went wrong." }; }
  D.busy = false;
  await loadDevice();
}

function drawSettings() {
  const P = R.prefs, y = $("#sheet").scrollTop; // redraw without jumping back to the top
  const days = Array.from({ length: 28 }, (_, i) => i + 1).map(d => `<option value="${d}"${P.review_day === d ? " selected" : ""}>${d === 1 ? "1st" : d === 2 ? "2nd" : d === 3 ? "3rd" : d + (d === 21 ? "st" : d === 22 ? "nd" : d === 23 ? "rd" : "th")}</option>`).join("");
  const extra = {
    review: `<label class="rem-opt">Day of the month <select class="cell" data-pref-n="review_day" aria-label="Day of the month">${days}</select></label>`,
    sink_due: `<label class="rem-opt">Warn me <select class="cell" data-pref-n="due_weeks" aria-label="How many weeks ahead">${DUE_WEEKS.map(w => `<option value="${w}"${P.due_weeks === w ? " selected" : ""}>${w} weeks</option>`).join("")}</select> before</label>`,
  };
  sheet("Reminder settings", `<p class="set-note">Choose the reminders you’d like for <b>${esc(app.household.name)}</b>. They’re just for you: everyone in the household chooses their own. Each morning at about 8:30, new ones appear under the bell 🔔.</p>
    <ul class="rem-switches">${REMINDER_TYPES.map(t => `<li><label class="switch-row"><span><b>${esc(t.title)}</b><small>${esc(t.help)}</small></span>
      <input type="checkbox" role="switch" data-pref="${t.pref}"${P[t.pref] ? " checked" : ""}></label>${P[t.pref] && extra[t.pref] ? extra[t.pref] : ""}</li>`).join("")}</ul>
    <div class="msg" id="mRem"></div>
    <section class="set rem-preview"><h4>With your budget today, you’d get</h4>${previewHTML()}</section>
    ${deviceHTML()}
    <p class="set-note">Email reminders aren’t available yet.</p>
    <div class="rem-foot"><button class="btn" type="button" data-rem="inbox">Back to reminders</button></div>`);
  $("#sheet").scrollTop = y;
}

function previewHTML() {
  const any = REMINDER_TYPES.some(t => R.prefs[t.pref]);
  if (!any) return `<p class="set-note">Nothing: every reminder is off.</p>`;
  const list = remindersFor(app.state, R.prefs, app.today);
  return list.length ? `<ul class="rem-lines">${list.map(r => `<li><b>${esc(r.title)}</b> <span class="dim">${esc(r.body)}</span></li>`).join("")}</ul>`
    : `<p class="set-note">Nothing right now: all good. You’ll hear when something comes up.</p>`;
}

let saving = Promise.resolve();
async function savePref(key, value) {
  R.prefs[key] = value;
  drawSettings();
  const row = { user_id: app.meId, household_id: app.household.id, updated_at: new Date().toISOString() };
  for (const k of Object.keys(DEFAULT_PREFS)) row[k] = R.prefs[k];
  saving = saving.then(async () => {
    const { error } = await app.sb.from("reminder_prefs").upsert(row);
    const m = $("#mRem");
    if (error) { if (m) { m.className = "msg err"; m.textContent = friendly(error); } }
    else toast("Reminder settings saved");
  });
}

/* ---------- clicks ---------- */
export function initReminders() {
  const d = $("#sheet");
  d.addEventListener("click", e => {
    const b = e.target.closest("[data-rem]"); if (!b || b.disabled) return;
    const id = Number(b.dataset.id), act = b.dataset.rem;
    if (act === "read") { markRead([id]); drawInbox(); }
    if (act === "readall") { markRead((app.reminders || []).filter(r => !r.read_at).map(r => r.id)); drawInbox(); }
    if (act === "settings") openReminderSettings();
    if (act === "inbox") { d.close(); openInbox(); }
    if (act === "go") {
      const r = (app.reminders || []).find(x => x.id === id); if (!r) return;
      if (!r.read_at) markRead([id]);
      d.close();
      if (TAB_HASH[r.tab]) location.hash = TAB_HASH[r.tab];
    }
  });
  d.addEventListener("click", e => { const b = e.target.closest("[data-push]"); if (b && !b.disabled) pushAction(b.dataset.push, Number(b.dataset.id)); });
  d.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.pref) savePref(t.dataset.pref, t.checked);
    if (t.dataset.prefN) savePref(t.dataset.prefN, Number(t.value));
  });
  document.addEventListener("click", e => { if (e.target.closest("#bellBtn")) openInbox(); });
  // Back to the app after a while (e.g. the next morning): fetch any new reminders.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && app.household) loadReminders(); });
  // A notification for several reminders opens the app at #reminders: show the inbox.
  window.addEventListener("hashchange", openFromHash);
  app.openInbox = openInbox;
}
export function openFromHash() {
  if (location.hash !== "#reminders" || !app.household) return;
  history.replaceState(null, "", "#" + (TAB_HASH[app.tab] || "budget"));
  openInbox();
}
