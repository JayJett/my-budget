/* Guided tours, one per tab (Phase 7C). Before this there was one tour, of the Budget tab only.

   How it works
   - Each tab has its own short tour: a spotlight moves around that tab with a friendly explanation at
     each stop. Tours only point things out: they never type, tap, save or change anything.
   - The first time you properly open a tab (it has finished loading, and you're not in the middle of
     something), a small invitation offers its tour: "Take a quick tour" or "Not now". Never more than
     one at a time, never during setup, sign-in, an open sheet or menu, another tour, a save, or while
     you're typing. Each tab is offered once: once you've seen its invitation it isn't shown again.
   - Any tour can be replayed from the ⋯ menu → Guided tours. Replaying doesn't reset anything else.

   Where your tour progress is kept
   - On your login (Supabase Auth user_metadata, "tours"), the same place your name and colour live:
     it's yours alone (not the household's), and it follows you to your other devices. No new table.
   - A copy on this device under your user id ("mb-tours-<id>"), so it works straight away and offline.
     Anything changed offline is sent when you're back online, like your colour.
   - The old Budget tour's "done" flag on this device ("mb-tour-done-<id>") still counts, so nobody who
     finished it is asked again.
   For each tab one word is kept: offered (invitation seen), dismissed ("Not now"), started, or done. */
import { app, TAB_HASH } from "./ctx.js";
import { $, esc, lockScroll, unlockScroll } from "./dom.js";
import { TABS } from "./views/labels.js";

/* ---------- the tours ----------
   Each stop names what to point at (the first of these that's on screen) and what to say. A stop
   whose target isn't there (an empty list, a section that only appears later) is skipped. Words can
   depend on what's on screen, e.g. an empty list gets "add your first one" instead. */
const has = sel => !!document.querySelector(sel);
export const TOURS = {
  budget: {
    invite: "See how your pay is planned, dollar by dollar.",
    stops: [
      { sel: ["#app .viewas"], title: "Pick your period", text: "Every amount can be shown per week, fortnight or month. It doesn’t change the plan, just how you see it." },
      { sel: ["#app .b-income"], title: "Income", text: "Everyone’s take-home pay, added up. Tap a person to change their pay, how often it arrives, or their colour." },
      { sel: ["#allocStatus"], title: "Every dollar has a job", text: "How much of each person’s pay is planned. Aim for 100%, and use Fill to top up the last bit." },
      { sel: ["#app .b-allocs", "#app .alloc-list"], title: "Your allocations", text: "Where the pay goes, account by account. Tap one to change its share of each person’s pay." },
      { sel: ["#tabs"], title: "The other tabs", text: "Net worth is what you own and owe. Spending is where the bills money goes. Goals and Investments show what your saving adds up to." },
      { sel: ["#menuBtn"], title: "Tap your initial for settings", text: "Your account, household members and roles, switching households, appearance, downloads, and a guided tour for every tab." },
    ],
  },
  networth: {
    invite: "See how to track what you own and owe.",
    stops: [
      { sel: ["#nwHead", "#app .nw-hero"], title: "Your net worth", text: "Everything you own minus everything you owe, worked out from the balances you enter here. Nothing comes from your bank automatically." },
      { sel: ["#app .nw-main .sp-list", "#app .sp-empty"], title: () => has("#app .sp-empty") ? "Start with an account" : "Your accounts",
        text: () => has("#app .sp-empty") ? "Add your first account here: everyday or savings, investments, KiwiSaver, or a debt such as a loan." : "Grouped by type: savings, investments, KiwiSaver and debts. Tap an account to update its balance." },
      { sel: ["#app .nw-review"], title: "Keeping it current", text: "Balances only change when you change them. Every so often, check them against your bank and tap Reviewed today." },
    ],
  },
  spending: {
    invite: "See how your planned expenses fit within your budget.",
    stops: [
      { sel: ["#spHead", "#app .sp-sum"], title: "Your spending budget", text: "The money the Budget tab sets aside for bills and spending. It’s a plan for what’s coming up, not a list of what you’ve bought." },
      { sel: ["#app .sp-figs"], title: "Planned and budget", text: "Planned is what your expenses add up to; Budget is what’s set aside for them. The bar shows how much is used, and warns if it’s not enough." },
      { sel: ["#app .sp-page .sp-list", "#app .sp-empty"], title: () => has("#app .sp-empty") ? "Add your first expense" : "Your expenses",
        text: () => has("#app .sp-empty") ? "Add what this budget pays for: rent, groceries, the yearly car rego. Each one is fixed, flexible or sinking." : "Fixed bills, flexible spending, and sinking costs (a yearly bill, saved for a little each pay). Tap one to change it." },
    ],
  },
  goals: {
    invite: "See how saving for goals works here.",
    stops: [
      { sel: ["#app .gl-sum .sp-head", "#app .gl-sum"], title: "Your goals at a glance", text: "What’s saved so far across your goals, and how much the Budget tab sends to goals each pay." },
      { sel: ["#app .gl-group.ef"], title: "Emergency fund", text: "A safety net for surprises. Set a target, and update Saved as you put money aside." },
      { sel: ["#app .gl-group.joint"], title: () => (app.state.people.length > 1 ? "Joint goals" : "Your goals"),
        text: () => has("#app .gl-group.joint .gl-none") ? "Create your first goal here: a holiday, a car, a house deposit. Each goal gets a share of the money going to goals." : "Each goal gets a share of the money going to goals, and shows how close it is. Higher in the list is funded first." },
      { sel: ["#app .gl-group:not(.ef):not(.joint)"], title: "Personal goals", text: "Each person’s own goals, funded from their own share of pay." },
      { sel: ["#app .gl-main > .add-row"], title: "Adding a goal", text: "Saved is money you’ve already put aside. Choosing which account it’s in doesn’t move any money, and it’s never counted twice." },
    ],
  },
  invest: {
    invite: "See how the forecast is worked out.",
    stops: [
      { sel: ['#app .iv-src-i[data-tab="networth"]'], title: "Starting balance", text: "Comes from your Investment accounts on the Net worth tab." },
      { sel: ['#app .iv-src-i[data-tab="budget"]'], title: "What goes in", text: "Your Investment allocations on the Budget tab. Change them there and this updates." },
      { sel: ["#app .iv-as"], title: "Your assumptions", text: "The yearly return, how much contributions grow, and fees. They’re your own estimates, not a recommendation. Tap Adjust to change them." },
      { sel: ["#ivChart", "#app .iv-hero"], title: "The forecast", text: "An illustration of how it could grow over 5 to 30 years. Real returns go up and down, so it’s not a guarantee or advice." },
    ],
  },
  progress: {
    invite: "See how your snapshots show change over time.",
    stops: [
      { sel: ["#app .pg-start"], title: "Your journey starts here", text: "A snapshot saves today’s balances and goals. One is saved automatically on the 1st of each month, and you can save one any time." },
      { sel: ["#app .pg-hero:not(.pg-start) .sp-head", "#app .pg-hero:not(.pg-start)"], title: "Net worth over time", text: "Today’s net worth, and how it’s changed since your last monthly snapshot." },
      { sel: ["#app .pg-hist"], title: "Your history", text: () => has("#app .pg-sparse") ? "The chart starts with your second monthly snapshot. Nothing is made up in between, so it grows more useful each month." : "Each solid dot is a saved snapshot; the hollow one is today. Tap the chart to see a month." },
      { sel: ["#app .pg-ad"], title: "Assets and debt", text: "Cash, investments, KiwiSaver and debt, and how each has changed." },
      { sel: ["#app .pg-gl"], title: "Goal progress", text: "How each savings goal is moving towards its target." },
    ],
  },
};
export const TOUR_TABS = Object.keys(TOURS);
const label = k => (TABS(app.state).find(t => t[0] === k) || [k, k])[1];

/* ---------- your tour progress ---------- */
const RANK = { offered: 1, dismissed: 2, started: 3, done: 4 };
const uid = () => (app.session && app.session.user && app.session.user.id) || app.meId || null;
const LKEY = id => `mb-tours-${id}`;
const readLocal = id => { try { return JSON.parse(localStorage.getItem(LKEY(id)) || "null") || {}; } catch (_) { return {}; } };
const writeLocal = (id, v) => { try { localStorage.setItem(LKEY(id), JSON.stringify(v)); } catch (_) {} };
const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => TOURS[k] && RANK[v]));
/** The furthest of two answers wins, so two devices never undo each other's progress. */
const merge = (...all) => all.reduce((out, o) => { Object.entries(clean(o)).forEach(([k, v]) => { if (!out[k] || RANK[v] > RANK[out[k]]) out[k] = v; }); return out; }, {});

/** This person's tour progress: their login's, this device's, and the old Budget tour flag, combined. */
export function tourState(id = uid()) {
  if (!id) return {};
  const local = readLocal(id), remote = (app.session && app.session.user && app.session.user.user_metadata && app.session.user.user_metadata.tours) || {};
  let legacy = {}; try { if (localStorage.getItem(`mb-tour-done-${id}`) === "1") legacy = { budget: "done" }; } catch (_) {}
  return merge(remote, local.tabs, local.dirty, legacy);
}
let saveTimer = null;
function record(tab, status) {
  const id = uid(); if (!id || !TOURS[tab] || !RANK[status]) return;
  const before = tourState(id)[tab];
  if (before && RANK[before] >= RANK[status]) return; // never backwards: replaying a finished tour keeps "done"
  const local = readLocal(id);
  writeLocal(id, { tabs: { ...clean(local.tabs), [tab]: status }, dirty: { ...clean(local.dirty), [tab]: status } });
  clearTimeout(saveTimer); saveTimer = setTimeout(() => send(id), 800);
}
async function send(id) {
  if (!app.sb || !app.session || app.session.offline || navigator.onLine === false || uid() !== id) return;
  const local = readLocal(id), dirty = clean(local.dirty); if (!Object.keys(dirty).length) return;
  const tours = tourState(id);
  const { error } = await app.sb.auth.updateUser({ data: { tours } });
  if (error) return; // kept as "not sent yet"; tried again when back online or next time
  const now = readLocal(id), left = clean(now.dirty);
  Object.keys(dirty).forEach(k => { if (left[k] === dirty[k]) delete left[k]; });
  writeLocal(id, { tabs: merge(now.tabs, tours), dirty: left });
}
window.addEventListener("online", () => { const id = uid(); if (id && Object.keys(clean(readLocal(id).dirty)).length) send(id); });
/** Called by onboarding: "Open my budget" means the Budget tour was offered (as "Show me around"). */
export const markTour = (tab, status) => record(tab, status);
export const tourDone = (tab = "budget") => tourState()[tab] === "done";

/* ---------- the spotlight tour ---------- */
let el = null, cur = null, i = 0, stops = [], opener = null, raf = 0;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const val = v => typeof v === "function" ? v() : v;
const visible = t => { if (!t) return false; const r = t.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(t).visibility !== "hidden"; };
const find = s => { for (const q of s.sel) { const t = document.querySelector(q); if (visible(t)) return t; } return null; };
export const tourActive = () => !!cur;

function build() {
  el = document.createElement("div");
  el.className = "tour"; el.hidden = true;
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "tourT"); el.setAttribute("aria-describedby", "tourP");
  el.innerHTML = `<div class="tour-spot" aria-hidden="true"></div><div class="tour-card"><div class="tour-top"><span class="tour-n" aria-live="polite"></span><button class="tour-x" type="button" data-tour="end" aria-label="Close the tour"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>
    <h3 id="tourT"></h3><p id="tourP" aria-live="polite"></p><div class="tour-dots" aria-hidden="true"></div>
    <div class="tour-acts"><button class="linkish" type="button" data-tour="end">Skip tour</button><span><button class="btn small" type="button" data-tour="back">Back</button> <button class="btn small primary" type="button" data-tour="next">Next</button></span></div></div>`;
  document.body.appendChild(el);
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-tour]"); if (!b || b.disabled) return;
    const a = b.dataset.tour;
    if (a === "end") end(false); if (a === "back") go(i - 1, -1); if (a === "next") (i === stops.length - 1 ? end(true) : go(i + 1, 1));
  });
  document.addEventListener("keydown", e => {
    if (!cur) return;
    if (e.key === "Escape") { e.preventDefault(); end(false); }
    if (e.key === "ArrowRight") go(Math.min(i + 1, stops.length - 1), 1);
    if (e.key === "ArrowLeft") go(i - 1, -1);
    if (e.key === "Tab") { // keep keyboard focus inside the tour card while it's open
      const f = [...el.querySelectorAll("button:not([disabled])")]; if (!f.length) return;
      const k = f.indexOf(document.activeElement);
      if (e.shiftKey && k <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && k === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });
  const again = () => { if (!cur) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
  window.addEventListener("resize", again);
  window.addEventListener("scroll", again, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", again);
}

/** Start a tab's tour. If you're on another tab, that tab opens first; the tour waits for it to be
    ready (up to a few seconds, e.g. while Progress loads its snapshots), then begins. */
export async function startTour(tab = app.tab || "budget") {
  if (!TOURS[tab] || app.setup) return;
  hideInvite();
  if (cur) end(false, { quiet: true });
  if (app.tab !== tab) { app.tab = tab; history.replaceState(null, "", "#" + TAB_HASH[tab]); app.render(); }
  window.scrollTo({ top: 0 });
  const ready = () => TOURS[tab].stops.some(s => find(s));
  for (let k = 0; k < 40 && !ready(); k++) { await new Promise(r => setTimeout(r, 100)); if (app.tab !== tab) return; }
  stops = TOURS[tab].stops.filter(s => find(s));
  if (!stops.length || app.tab !== tab) return;
  if (!el) build();
  cur = tab; i = 0; opener = document.activeElement;
  record(tab, "started");
  el.hidden = false; el.classList.toggle("calm", calm());
  lockScroll();
  go(0, 1);
}

function go(k, d = 1) {
  if (!cur || k < 0 || k >= stops.length) return;
  // a stop whose target has gone (the list changed): move on to the next one in the same direction
  if (!find(stops[k])) { const n = k + d; if (n >= 0 && n < stops.length) return go(n, d); if (d > 0) return end(true); return; }
  i = k;
  const s = stops[i], t = find(s);
  bring(t);
  el.querySelector(".tour-n").textContent = `${label(cur)} · ${i + 1} of ${stops.length}`;
  el.querySelector("h3").textContent = val(s.title);
  el.querySelector("p").textContent = val(s.text);
  el.querySelector(".tour-dots").innerHTML = stops.map((_, j) => `<i class="${j === i ? "on" : ""}"></i>`).join("");
  el.querySelector('[data-tour="back"]').disabled = i === 0;
  el.querySelector('[data-tour="next"]').textContent = i === stops.length - 1 ? "Done" : "Next";
  requestAnimationFrame(place);
  el.querySelector('[data-tour="next"]').focus({ preventScroll: true });
}

/** The space between the sticky header and the phone's bottom tab bar. */
function room() {
  const top = $(".top"), tabs = $("#tabs");
  let a = 0, b = window.innerHeight;
  if (top) a = Math.max(0, top.getBoundingClientRect().bottom);
  if (tabs && getComputedStyle(tabs).position === "fixed") b = Math.min(b, tabs.getBoundingClientRect().top);
  return { a, b };
}
/** Scroll just enough to show the stop below the header and above the tab bar (nothing moves for
    things that are always on screen, like the tab bar or the menu button). */
function bring(t) {
  if (t.closest(".top") || t.closest("#tabs") || getComputedStyle(t).position === "fixed") return;
  const { a, b } = room(), r = t.getBoundingClientRect(), h = b - a;
  let dy = 0;
  if (r.height > h - 24) dy = r.top - a - 12; // taller than the room: line its top up under the header
  else if (r.top < a + 12 || r.bottom > b - 12) dy = r.top - a - (h - r.height) / 2;
  if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: calm() ? "auto" : "smooth" });
}

function place() {
  if (!cur) return;
  const t = find(stops[i]);
  if (!t) return; // gone mid-stop: the next tap moves on
  const r = t.getBoundingClientRect(), pad = 6, spot = el.querySelector(".tour-spot"), card = el.querySelector(".tour-card");
  const vw = window.innerWidth, vh = window.innerHeight;
  const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
  const h = Math.max(0, Math.min(r.bottom + pad, vh - 4) - top), w = Math.min(r.width + pad * 2, vw - left - 4);
  Object.assign(spot.style, { top: top + "px", left: left + "px", width: w + "px", height: h + "px" });
  const cw = card.offsetWidth, ch = card.offsetHeight, { a, b } = room();
  // below the spotlight if it fits, else above it, else at the bottom of the screen (over the target's lower part)
  let y = top + h + 12;
  if (y + ch > Math.max(b, vh * 0.6) - 8) y = top - ch - 12;
  if (y < Math.min(a, top) + 4 && y < 8) y = Math.max(8, Math.min(vh, b) - ch - 12);
  y = Math.max(8, Math.min(y, vh - ch - 8));
  const x = Math.min(vw - cw - 8, Math.max(8, r.left + r.width / 2 - cw / 2));
  Object.assign(card.style, { top: y + "px", left: x + "px" });
}

function end(finished, { quiet = false } = {}) {
  if (!cur) return;
  const tab = cur; cur = null;
  if (el) el.hidden = true;
  unlockScroll();
  if (finished) record(tab, "done");
  if (!quiet && opener && opener.isConnected && !opener.closest("[inert]")) opener.focus({ preventScroll: true });
  opener = null;
  scheduleInvite();
}

/* ---------- the first-visit invitation ---------- */
let inv = null, invTab = null, invTimer = null;
/** Is now a good moment? Only on a settled, ready tab, with nothing else going on. */
function quietMoment() {
  if (!app.session) return false;
  if (!app.household || !app.loaded || app.setup || cur) return false;
  if (document.body.classList.contains("signed-out")) return false;
  if (document.querySelector("dialog[open]") || !$("#pop").hidden || document.querySelector("#drawer:not([hidden])") || document.querySelector(".update-bar:not([hidden])")) return false;
  if (app.saveStatus === "saving") return false;
  const a = document.activeElement; if (a && a.matches && a.matches("input, textarea, select, [contenteditable]")) return false;
  if (app.tab === "progress" && !app.snapshots) return false; // still loading
  return !!$("#app").firstElementChild;
}
export function scheduleInvite() {
  clearTimeout(invTimer);
  if (inv && invTab !== app.tab) hideInvite(); // moved to another tab: this one's invitation goes
  invTimer = setTimeout(maybeInvite, 1200);
}
function maybeInvite() {
  const tab = app.tab;
  if (!TOURS[tab] || inv || !quietMoment()) return;
  if (tourState()[tab]) return; // offered before, said no, started or done: never asked again
  if (!TOURS[tab].stops.some(s => find(s))) return;
  showInvite(tab);
}
function showInvite(tab) {
  invTab = tab;
  inv = document.createElement("aside");
  inv.className = "tinv"; inv.setAttribute("role", "dialog"); inv.setAttribute("aria-modal", "false"); inv.setAttribute("aria-labelledby", "tinvT"); inv.setAttribute("aria-describedby", "tinvP");
  inv.innerHTML = `<span class="tinv-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg></span>
    <div class="tinv-t"><b id="tinvT">New to ${esc(label(tab))}?</b><p id="tinvP">${esc(TOURS[tab].invite)}</p>
    <div class="tinv-acts"><button class="btn small primary" type="button" data-tinv="go">Take a quick tour</button><button class="btn small ghost" type="button" data-tinv="no">Not now</button></div></div>`;
  document.body.appendChild(inv);
  if (!calm()) { inv.classList.add("in"); requestAnimationFrame(() => requestAnimationFrame(() => inv && inv.classList.remove("in"))); }
  record(tab, "offered");
  inv.addEventListener("click", e => {
    const b = e.target.closest("[data-tinv]"); if (!b) return;
    if (b.dataset.tinv === "go") startTour(tab);
    else { record(tab, "dismissed"); hideInvite(); }
  });
}
export function hideInvite() {
  clearTimeout(invTimer);
  if (!inv) return;
  const x = inv; inv = null; invTab = null;
  if (calm()) x.remove(); else { x.classList.add("out"); setTimeout(() => x.remove(), 220); }
}

/** After every redraw: keep a running tour honest, and look for a quiet moment to invite. */
app.afterRender = () => {
  if (cur && (app.tab !== cur || app.setup || !app.household)) end(false, { quiet: true });
  else if (cur) requestAnimationFrame(place);
  if (app.setup || !app.household) hideInvite();
  scheduleInvite();
};
// a sheet, dialog or menu just closed, or you finished typing: maybe now's a good moment
document.addEventListener("close", () => scheduleInvite(), true);
document.addEventListener("focusout", () => { if (!cur) scheduleInvite(); });

/** "Guided tours" in the ⋯ menu: every tab, with how far you've got. */
export function toursMenu() {
  const st = tourState();
  const word = { done: "Done", started: "Started" };
  return `<div class="pop-h">Guided tours</div>${TOUR_TABS.map(k => `<button class="item" type="button" data-tour-replay="${k}">${esc(label(k))}<small>${word[st[k]] ? `${word[st[k]]} · take it again` : "A short look around this tab"}</small></button>`).join("")}
    <hr><button class="item" type="button" data-act="menu-back">Back</button>`;
}

app.startTour = startTour;
