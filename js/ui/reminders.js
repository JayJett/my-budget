/* Gentle reminders: the bell 🔔 in the header, the inbox, and Reminder settings.
   Reminders are worked out each morning by the database and the send-reminders function (see
   supabase/migrations/..._reminders.sql); this file shows them and saves each person's switches.
   The rules and wording live in js/model/reminders.js. */
import { app, TAB_HASH } from "./ctx.js";
import { $, esc, toast } from "./dom.js";
import { remindersFor, REMINDER_TYPES, DEFAULT_PREFS, DUE_WEEKS } from "../model/reminders.js";

export const REM_CACHE = "mb-rem-v1-";
const COLS = "id, kind, title, body, tab, created_at, read_at";
const friendly = e => app.friendly ? app.friendly(e) : (e && e.message) || "Something went wrong.";
const offline = () => !!app.offline || navigator.onLine === false;
const R = { view: null, prefs: null };

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
  if (R.view === "inbox" && isOpen()) drawInbox();
}
export function resetReminders() { app.reminders = null; R.prefs = null; updateBell(); }

export function updateBell() {
  const b = $("#bellBtn"); if (!b) return;
  b.hidden = !app.household;
  const unread = (app.reminders || []).filter(r => !r.read_at).length;
  const n = $("#bellCount"); n.textContent = unread > 9 ? "9+" : String(unread); n.hidden = !unread;
  b.setAttribute("aria-label", unread ? `Reminders, ${unread} unread` : "Reminders");
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

export function openInbox() { R.view = "inbox"; drawInbox(); loadReminders(); }

function drawInbox() {
  const list = app.reminders || [], unread = list.filter(r => !r.read_at).length;
  const items = list.map(r => `<li class="rem-item${r.read_at ? " read" : ""}">
      <div class="rem-top"><b>${esc(r.title)}</b><small>${esc(ago(r.created_at))}</small></div>
      ${r.body ? `<p>${esc(r.body)}</p>` : ""}
      <div class="rem-acts">${r.tab && TAB_NAME[r.tab] ? `<button class="btn small" type="button" data-rem="go" data-id="${r.id}">Take me to ${esc(TAB_NAME[r.tab])}</button>` : ""}
        ${r.read_at ? "" : `<button class="btn small" type="button" data-rem="read" data-id="${r.id}">Mark as read</button>`}</div></li>`).join("");
  sheet("Reminders", `${offline() ? `<p class="set-note">You’re offline: these are the reminders saved on this device.</p>` : ""}
    ${list.length ? `<div class="rem-bar"><span class="set-note">${unread ? `${unread} new` : "All caught up"}</span>${unread ? `<button class="btn small" type="button" data-rem="readall">Mark all as read</button>` : ""}</div><ul class="rem-list">${items}</ul>`
      : `<div class="rem-empty"><div class="rem-bell" aria-hidden="true">🔔</div><b>No reminders yet</b>
        <p class="set-note">Gentle reminders show up here: a yearly bill coming up, a goal reached, time to update your balances. They’re all off until you choose which ones you’d like.</p></div>`}
    <div class="rem-foot"><button class="btn${list.length ? "" : " primary"}" type="button" data-rem="settings">Reminder settings</button></div>`);
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
  drawSettings();
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
    if (act === "inbox") openInbox();
    if (act === "go") {
      const r = (app.reminders || []).find(x => x.id === id); if (!r) return;
      if (!r.read_at) markRead([id]);
      d.close();
      if (TAB_HASH[r.tab]) location.hash = TAB_HASH[r.tab];
    }
  });
  d.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.pref) savePref(t.dataset.pref, t.checked);
    if (t.dataset.prefN) savePref(t.dataset.prefN, Number(t.value));
  });
  document.addEventListener("click", e => { if (e.target.closest("#bellBtn")) openInbox(); });
  // Back to the app after a while (e.g. the next morning): fetch any new reminders.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && app.household) loadReminders(); });
}
