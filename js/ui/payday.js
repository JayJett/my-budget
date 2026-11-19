/* Phase 10: the Payday Playbook. "Where does my pay go?" for one person and one payday, opened from
   Home's payday card, the Budget tab, or a payday reminder.

   - The instructions come from model/payday.js: each allocation's share of that payday's pay, grouped
     by where it goes ("Keep in", "Transfer to", or "Set aside" when no place is chosen yet).
   - The checklist is optional and personal. Only the member who has said "this is me" for that budget
     person can tick it, and only they can see their ticks (the database enforces both). A tick is just
     a note to yourself: it moves no money and changes no balance, goal, budget or Undo history.
   - The first tick keeps a copy of that payday's instructions, so a later budget change doesn't rewrite
     a checklist already started. If the budget changes, you can switch to the new instructions.
   - Before the database part is set up (or offline), it still shows the plan; just no ticking. */
import { app, readOnly } from "./ctx.js";
import { $, esc, toast } from "./dom.js";
import { money } from "../model/format.js";
import { paydayPlan, planSnapshot, sameAsSnapshot, tickable, earners } from "../model/payday.js";
import { parseDate } from "../model/util.js";
import { accIcon } from "./views/budget.js";

let PB = null; // { hh, pid, k, check: { state: "idle"|"loading"|"ready"|"off", row, busy:Set } }
const DATE = new Intl.DateTimeFormat("en-NZ", { weekday: "long", day: "numeric", month: "long" });
const FREQ = { weekly: "Weekly pay", fortnightly: "Fortnightly pay", monthly: "Monthly pay" };
const $c = c => money(c / 100);
const payAmount = c => c % 100 ? $c(c) : $c(c) + ".00";
const isCurrent = () => !!(PB && PB.store === app.store && PB.store?.isActive());
const isOpen = () => !!(isCurrent() && $("#sheet").open && $("#sheet .pb"));

/* ---------- who's who ---------- */
const me = () => (app.members || []).find(m => m.user_id === app.meId) || null;
/** The budget person you've said you are (null if you haven't, or they've since been removed). */
export function myPerson() { const m = me(), id = m && m.person_id; return id && app.state.people.some(p => p.id === id) ? id : null; }
const takenBy = pid => (app.members || []).find(m => m.person_id === pid && m.user_id !== app.meId) || null;
const linkReady = () => !!app.personLinks; // the database knows "which person is me" (Phase 10 migration)

/** Open the playbook. opts.pid: a person; opts.k: which payday (0 next, -1 previous). */
export function openPayday(opts = {}) {
  if (!app.household || !app.store?.isActive()) return;
  const S = app.state, E = earners(S);
  if (!E.length) { toast("Add your pay on the Budget tab first."); return; }
  const mine = myPerson(), first = opts.pid && E.some(p => p.id === opts.pid) ? opts.pid : mine && E.some(p => p.id === mine) ? mine : soonest(E);
  PB = { store: app.store, pid: first, k: opts.k || 0, check: { state: "idle", row: null, busy: new Set() } };
  draw(true); loadCheck();
}
function soonest(E) { const P = E.map(p => paydayPlan(app.state, p.id, app.today)).filter(x => x.date).sort((a, b) => a.inDays - b.inDays); return (P[0] || { person: E[0] }).person.id; }

/* ---------- the checklist (optional) ---------- */
const canTick = () => linkReady() && myPerson() === PB.pid && !app.offline; // (viewers too: ticking is personal, not a budget edit)
async function loadCheck() {
  const P = current(); PB.check = { state: canTick() && P.date ? "loading" : "off", row: null, busy: new Set() };
  draw();
  if (PB.check.state === "off") return;
  const store = app.store, operation = PB, check = PB.check;
  const { data, error } = await store.householdRpc("payday_check_get", { p_person: PB.pid, p_payday: P.date });
  if (!store.isActive() || !isOpen() || PB !== operation || PB.check !== check) return;
  PB.check = { state: error ? "off" : "ready", row: error ? null : data || null, busy: new Set(), err: error ? "Couldn’t load your ticks. The plan below is still right." : null };
  draw();
}
async function tick(gkey, on) {
  const P = current(), snapView = shown(P), C = PB.check; if (!canTick() || C.state !== "ready" || C.busy.has(gkey)) return;
  const store = app.store, operation = PB, pid = PB.pid, date = P.date;
  const prev = C.row ? { ...C.row, done: { ...C.row.done } } : null;
  C.row = C.row || { plan: snapView.snapshot, done: {} };
  if (on) C.row.done[gkey] = true; else delete C.row.done[gkey];
  C.busy.add(gkey); draw();
  const { data, error } = await store.householdRpc("payday_check_mark", { p_person: pid, p_payday: date, p_plan: snapView.snapshot, p_key: gkey, p_on: on });
  if (!store.isActive() || !isOpen() || PB !== operation || PB.check !== C) return;
  C.busy.delete(gkey);
  if (error) { C.row = prev; toast("Couldn’t save that tick. Check your connection and try again."); }
  else C.row = data;
  draw();
}
async function replan() {
  const P = current(), C = PB.check; if (!canTick() || C.state !== "ready" || !C.row) return;
  const store = app.store, operation = PB;
  const { data, error } = await store.householdRpc("payday_check_replan", { p_person: PB.pid, p_payday: P.date, p_plan: planSnapshot(P) });
  if (!store.isActive() || !isOpen() || PB !== operation || PB.check !== C) return;
  if (error) { toast("Couldn’t update it. Check your connection and try again."); return; }
  C.row = data; draw();
}
async function linkMe() {
  if (!linkReady() || takenBy(PB.pid)) return;
  const store = app.store, operation = PB, personId = PB.pid;
  const { error } = await store.householdRpc("link_budget_person", { p_person: personId });
  if (!store.isActive() || !isOpen() || PB !== operation || PB.pid !== personId) return;
  if (error) { toast(/someone else/i.test(error.message || "") ? "Someone else in this household has already said that’s them." : "Couldn’t save that. Check your connection and try again."); return; }
  const m = me(); if (m) m.person_id = PB.pid;
  toast("Got it. Your payday checklist is ready.");
  loadCheck();
}

/* ---------- drawing ---------- */
const current = () => paydayPlan(app.state, PB.pid, app.today, PB.k);
/** What to show: the kept copy once a checklist is started (unless it still matches), else the plan now. */
function shown(P) {
  const row = canTick() ? PB.check.row : null, snap = row && row.plan && row.plan.groups ? row.plan : null;
  if (snap && !sameAsSnapshot(P, snap)) return { groups: snap.groups, left: snap.left, pay: snap.pay, kept: true, snapshot: snap };
  return { groups: P.groups, left: P.leftC, pay: P.payC, kept: false, snapshot: planSnapshot(P) };
}
function dateLine(ymd) { return DATE.format(parseDate(ymd)); }
function whenLine(days) { return days === 0 ? "Today" : days === 1 ? "Tomorrow" : days > 1 ? `In ${days} days` : days === -1 ? "Yesterday" : `${-days} days ago`; }
const VERB = { keep: "Keep in", move: "Transfer to", aside: "Set aside" };
const iconFor = (parts) => { const a = app.state.accounts.find(x => x.id === parts[0].id); return a ? accIcon(a) : ""; };

function rowHTML(g, done, busy, ticking, choose) {
  const multi = g.parts.length > 1;
  const sub = g.kind === "aside" ? "No destination yet" : "";
  const check = ticking && tickable(g) ? `<button type="button" class="pb-check" role="checkbox" aria-checked="${done}" data-pb-tick="${esc(g.key)}"${busy ? ' aria-busy="true" aria-disabled="true"' : ""} aria-label="${esc(`${VERB[g.kind]} ${g.name}: ${$c(g.cents)}`)}"><span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>` : "";
  return `<li class="pb-row ${g.kind}${done ? " done" : ""}">
    ${check || `<span class="pb-static ind-row-icon ind-pastel" aria-hidden="true">${iconFor(g.parts)}</span>`}
    <div class="pb-t"><b>${esc(g.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}
      ${g.kind === "aside" && choose && !readOnly() ? `<button class="linkish pb-choose" type="button" data-home-go="budget" data-home-click="${esc(`[data-edit-acc="${CSS.escape(g.parts[0].id)}"]`)}">Choose where it goes</button>` : ""}
      ${multi ? `<details class="pb-parts" data-pb-parts="${esc(g.key)}"><summary>${g.parts.length} allocations <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></summary><ul>${g.parts.map(x => `<li><span>${esc(x.name)}</span><b>${$c(x.cents)}</b></li>`).join("")}</ul></details>` : ""}</div>
    <b class="pb-amt">${payAmount(g.cents)}</b></li>`;
}

const controlAttrs = ["data-pb-person", "data-pb-k", "data-pb-tick", "data-pb-replan", "data-pb-link", "data-sheet"];
function planContent(P, view, ticking, mine, many) {
  if (P.status === "nopay") return '<p class="pb-left">No regular pay is set for this person.</p>';
  if (P.status === "over") return `<div class="pb-warn" role="alert"><b>This plan is ${Math.round(P.overPct * 1000) / 10}% over the pay</b><p>Bring it back to 100% before following the plan.</p>
    <div class="pb-acts"><button class="btn primary small" type="button" data-home-go="budget">Fix it in Budget</button>${!readOnly() ? `<button class="btn small" type="button" data-pb-rebalance>Rebalance</button>` : ""}</div></div>`;
  const done = PB.check.row?.done || {};
  const anyDest = view.groups.some(g => g.kind !== "aside");
  const groups = Object.entries(VERB).map(([kind, verb]) => {
    const rows = view.groups.filter(g => g.kind === kind);
    return rows.length ? `<section class="pb-group" aria-label="${verb}"><h4>${verb}</h4><ul class="ind-card pb-list">${rows.map(g => rowHTML(g, !!done[g.key], PB.check.busy.has(g.key), ticking, anyDest)).join("")}</ul></section>` : "";
  }).join("");
  return `${view.kept ? `<div class="pb-changed" role="status"><span>Your budget changed after you started this checklist.</span><button class="linkish" type="button" data-pb-replan>Use the new plan</button></div>` : ""}
    ${!anyDest && !readOnly() ? `<button class="ind-primary pb-setup" type="button" data-home-go="budget">Choose where your money goes</button>` : ""}${groups}
    ${view.left > 0 ? `<p class="pb-left">${$c(view.left)} not allocated yet</p>` : ""}
    ${!P.date ? `<p class="pb-left">Add when ${PB.pid === mine || !many ? "you were" : "they were"} last paid to see the date. ${readOnly() ? "" : `<button class="linkish" type="button" data-home-go="budget" data-home-person="${esc(PB.pid)}">Add payday</button>`}</p>` : ""}`;
}

function draw(first) {
  if (!isCurrent()) return;
  const d = $("#sheet"), E = earners(app.state), P = current(), y = d.scrollTop;
  const active = d.contains(document.activeElement) ? document.activeElement : null;
  const attr = controlAttrs.find(a => active?.hasAttribute(a));
  const key = PB.pid + "|" + PB.k;
  const expanded = !first && PB.drawn === key ? new Set([...d.querySelectorAll(".pb-parts[open]")].map(el => el.dataset.pbParts)) : new Set();
  PB.drawn = key;
  const many = E.length > 1, mine = myPerson();
  const view = shown(P), ticking = canTick() && PB.check.state === "ready";
  const tickables = view.groups.filter(tickable), doneN = tickables.filter(g => PB.check.row?.done?.[g.key]).length;
  const chips = many ? `<div class="pb-people" role="group" aria-label="Whose payday">${E.map(p => `<button type="button" class="pb-chip" aria-pressed="${p.id === PB.pid}" data-pb-person="${esc(p.id)}">${esc(p.name || "Unnamed")}${p.id === mine ? " · You" : ""}</button>`).join("")}</div>` : "";
  const day = P.date ? `<div class="pb-day">
    <button class="pb-step" type="button" data-pb-k="-1" aria-label="Previous payday"${PB.k <= -6 ? " disabled" : ""}>‹</button>
    <div><p class="pb-date"><time datetime="${esc(P.date)}">${esc(dateLine(P.date))}</time></p><p class="pb-when">${whenLine(P.inDays)}</p></div>
    <button class="pb-step" type="button" data-pb-k="1" aria-label="Next payday"${PB.k >= 6 ? " disabled" : ""}>›</button></div>` :
    `<p class="pb-date">No payday set</p>`;
  const src = view.kept ? view.snapshot.src : P.src?.name;
  const showTicks = ticking && tickables.length && P.status !== "over";
  const progressText = showTicks ? `${doneN} of ${tickables.length} marked done` :
    app.offline ? "Checklist unavailable offline" : PB.check.state === "loading" ? "Loading checklist…" :
    mine && mine !== PB.pid ? "This person’s checklist is private." : "";
  const progressBar = showTicks ? `<span class="pb-prog-bar" aria-hidden="true"><i style="width:${doneN / tickables.length * 100}%"></i></span>` : "";
  const progress = progressText ? `<p class="pb-progress"><span>${progressText}</span>${progressBar}</p>` : "";
  const summary = `<div class="ind-card pb-hero">${day}<p class="pb-pay">${P.status === "nopay" ? "" : `<b class="ind-amount">${payAmount(view.pay)}</b>`}<span>${FREQ[P.person?.freq] || "Take-home pay"}${src ? ` · into ${esc(src)}` : ""}</span></p>${progress}</div>`;
  const identity = !linkReady() || app.offline || mine || takenBy(PB.pid) ? "" : `<p class="pb-me">Is this your pay? <button class="linkish" type="button" data-pb-link>Yes, this is me</button></p>`;
  d.setAttribute("aria-labelledby", "pb-title");
  const content = `<div class="sheet-head pb-head"><button class="btn icon" type="button" data-sheet="close" aria-label="Close">‹</button><h3 id="pb-title" tabindex="-1" autofocus>Payday Playbook</h3><span aria-hidden="true"></span></div>
    <div class="sheet-body pb">${chips || `<p class="pb-earner">${esc(P.person?.name || "Your pay")}</p>`}${summary}${planContent(P, view, ticking, mine, many)}
      ${PB.check.err ? `<p class="pb-left" role="status">${esc(PB.check.err)}</p>` : ""}${identity}
      <p class="pb-note">Checklist only. Make any transfers in your bank.</p>
      <div class="pb-foot"><button class="linkish" type="button" data-home-go="budget">Review budget</button></div></div>`;
  const frame = d.querySelector(".pb-frame");
  if (frame) frame.innerHTML = content;
  else d.innerHTML = `<div class="pb-frame">${content}</div><span class="pb-live" role="status" aria-live="polite"></span>`;
  if (!d.open) d.showModal();
  const live = d.querySelector(".pb-live");
  if (live.textContent !== progressText) live.textContent = progressText;
  d.querySelectorAll(".pb-parts").forEach(el => { el.open = expanded.has(el.dataset.pbParts); });
  const target = attr ? [...d.querySelectorAll(`[${attr}]`)].find(el => !el.disabled && el.getAttribute(attr) === active.getAttribute(attr)) :
    active?.matches("summary") ? [...d.querySelectorAll(".pb-parts")].find(el => el.dataset.pbParts === active.parentElement.dataset.pbParts)?.querySelector("summary") : null;
  if (first || active) (target || d.querySelector("h3")).focus({ preventScroll: true });
  d.scrollTop = first ? 0 : y;
}


export function initPayday() {
  const d = $("#sheet");
  d.addEventListener("click", e => {
    if (!isOpen()) return;
    const t = e.target.closest("button"); if (!t || t.disabled) return;
    if (t.dataset.pbTick) { const on = t.getAttribute("aria-checked") !== "true"; tick(t.dataset.pbTick, on); return; }
    if (t.dataset.pbPerson) { PB.pid = t.dataset.pbPerson; PB.k = 0; loadCheck(); return; }
    if (t.dataset.pbK) { PB.k = Math.max(-6, Math.min(6, PB.k + Number(t.dataset.pbK))); loadCheck(); return; }
    if (t.hasAttribute("data-pb-replan")) { replan(); return; }
    if (t.hasAttribute("data-pb-link")) { linkMe(); return; }
    if (t.hasAttribute("data-pb-rebalance")) {
      const store = app.store;
      d.close();
      import("./rebalance.js").then(m => { if (store?.isActive() && app.store === store && !readOnly()) m.openRebalance(); });
      return;
    }
    if (t.dataset.homeGo || t.dataset.sheet === "close") { PB = null; if (d.open) d.close(); }
  });
  d.addEventListener("close", () => {
    if (!isOpen()) { PB = null; d.removeAttribute("aria-labelledby"); }
  });
  // the budget changed (here or by someone else) while it's open: redraw from the new numbers
  const prev = app.beforeRefresh;
  app.beforeRefresh = () => { if (prev) prev(); if (isOpen()) draw(); };
  document.addEventListener("click", e => { const o = e.target.closest && e.target.closest("[data-pb-open]"); if (o && !o.disabled) { e.preventDefault(); openPayday({ pid: o.dataset.pbOpen || undefined }); } });
  // a payday reminder opens it (…/#payday)
  const fromHash = () => { if (location.hash !== "#payday" || !app.household) return; history.replaceState(null, "", "#home"); openPayday(); };
  window.addEventListener("hashchange", fromHash);
  app.openPaydayFromHash = fromHash;
}
