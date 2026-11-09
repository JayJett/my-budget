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
const DAYN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FREQ = { weekly: "Weekly pay", fortnightly: "Fortnightly pay", monthly: "Monthly pay" };
const $c = c => money(c / 100);
const isOpen = () => !!(PB && $("#sheet").open && $("#sheet .pb"));

/* ---------- who's who ---------- */
const me = () => (app.members || []).find(m => m.user_id === app.meId) || null;
/** The budget person you've said you are (null if you haven't, or they've since been removed). */
export function myPerson() { const m = me(), id = m && m.person_id; return id && app.state.people.some(p => p.id === id) ? id : null; }
const takenBy = pid => (app.members || []).find(m => m.person_id === pid && m.user_id !== app.meId) || null;
const linkReady = () => !!app.personLinks; // the database knows "which person is me" (Phase 10 migration)

/** Open the playbook. opts.pid: a person; opts.k: which payday (0 next, -1 previous). */
export function openPayday(opts = {}) {
  if (!app.household) return;
  const S = app.state, E = earners(S);
  if (!E.length) { toast("Add your pay on the Budget tab first."); return; }
  const mine = myPerson(), first = opts.pid && E.some(p => p.id === opts.pid) ? opts.pid : mine && E.some(p => p.id === mine) ? mine : soonest(E);
  PB = { hh: app.household.id, pid: first, k: opts.k || 0, check: { state: "idle", row: null, busy: new Set() } };
  draw(true); loadCheck();
}
function soonest(E) { const P = E.map(p => paydayPlan(app.state, p.id, app.today)).filter(x => x.date).sort((a, b) => a.inDays - b.inDays); return (P[0] || { person: E[0] }).person.id; }

/* ---------- the checklist (optional) ---------- */
const canTick = () => linkReady() && myPerson() === PB.pid && !app.offline; // (viewers too: ticking is personal, not a budget edit)
async function loadCheck() {
  const P = current(); PB.check = { state: canTick() && P.date ? "loading" : "off", row: null, busy: new Set() };
  if (PB.check.state === "off") return draw();
  const key = `${PB.hh}|${PB.pid}|${P.date}`;
  const { data, error } = await app.sb.rpc("payday_check_get", { p_household: PB.hh, p_person: PB.pid, p_payday: P.date });
  if (!isOpen() || `${PB.hh}|${PB.pid}|${current().date}` !== key) return;
  PB.check = { state: error ? "off" : "ready", row: error ? null : data || null, busy: new Set(), err: error ? "Couldn’t load your ticks. The plan below is still right." : null };
  draw();
}
async function tick(gkey, on) {
  const P = current(), snapView = shown(P), C = PB.check; if (C.state !== "ready" || C.busy.has(gkey)) return;
  const hh = PB.hh, pid = PB.pid, date = P.date;
  const prev = C.row ? { ...C.row, done: { ...C.row.done } } : null;
  C.row = C.row || { plan: snapView.snapshot, done: {} };
  if (on) C.row.done[gkey] = true; else delete C.row.done[gkey];
  C.busy.add(gkey); draw();
  const { data, error } = await app.sb.rpc("payday_check_mark", { p_household: hh, p_person: pid, p_payday: date, p_plan: snapView.snapshot, p_key: gkey, p_on: on });
  if (!PB || PB.hh !== hh || PB.pid !== pid || current().date !== date) return;
  C.busy.delete(gkey);
  if (error) { C.row = prev; toast("Couldn’t save that tick. Check your connection and try again."); }
  else C.row = data;
  draw();
}
async function replan() {
  const P = current(), C = PB.check; if (C.state !== "ready" || !C.row) return;
  const { data, error } = await app.sb.rpc("payday_check_replan", { p_household: PB.hh, p_person: PB.pid, p_payday: P.date, p_plan: planSnapshot(P) });
  if (!isOpen()) return;
  if (error) { toast("Couldn’t update it. Check your connection and try again."); return; }
  C.row = data; draw();
}
async function linkMe() {
  if (!linkReady() || takenBy(PB.pid)) return;
  const { error } = await app.sb.rpc("link_budget_person", { p_household: PB.hh, p_person: PB.pid });
  if (error) { toast(/someone else/i.test(error.message || "") ? "Someone else in this household has already said that’s them." : "Couldn’t save that. Check your connection and try again."); return; }
  const m = me(); if (m) m.person_id = PB.pid;
  toast("Got it. Your payday checklist is ready.");
  loadCheck();
}

/* ---------- drawing ---------- */
const current = () => paydayPlan(app.state, PB.pid, app.today, PB.k);
/** What to show: the kept copy once a checklist is started (unless it still matches), else the plan now. */
function shown(P) {
  const row = PB.check.row, snap = row && row.plan && row.plan.groups ? row.plan : null;
  if (snap && !sameAsSnapshot(P, snap)) return { groups: snap.groups, left: snap.left, pay: snap.pay, kept: true, snapshot: snap };
  return { groups: P.groups, left: P.leftC, pay: P.payC, kept: false, snapshot: planSnapshot(P) };
}
function dateLine(ymd) { const d = parseDate(ymd); return `${DAYN[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; }
function whenLine(days) { return days === 0 ? "Today" : days === 1 ? "Tomorrow" : days > 1 ? `In ${days} days` : days === -1 ? "Yesterday" : `${-days} days ago`; }
const VERB = { keep: "Keep in", move: "Transfer to", aside: "Set aside" };
const iconFor = (parts) => { const a = app.state.accounts.find(x => x.id === parts[0].id); return a ? accIcon(a) : ""; };

function rowHTML(g, done, busy, ticking, choose) {
  const multi = g.parts.length > 1, title = g.kind === "aside" ? `${g.name}` : g.name;
  const sub = g.kind === "aside" ? "Not linked to an account yet" : multi ? g.parts.map(x => x.name).join(" + ") : g.parts[0].name !== g.name ? g.parts[0].name : "";
  const check = ticking && tickable(g) ? `<button type="button" class="pb-check" role="checkbox" aria-checked="${done}" data-pb-tick="${esc(g.key)}"${busy ? " aria-busy=\"true\"" : ""} aria-label="${esc(`${VERB[g.kind]} ${g.name}: ${$c(g.cents)}`)}${done ? ", marked done" : ""}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : "";
  return `<li class="pb-row ${g.kind}${done ? " done" : ""}">
    ${check || `<span class="a-ic sm" aria-hidden="true">${iconFor(g.parts)}</span>`}
    <span class="pb-t"><small class="pb-verb">${VERB[g.kind]}</small><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}
      ${g.kind === "aside" && choose && !readOnly() ? `<button class="linkish pb-choose" type="button" data-home-go="budget" data-home-click='[data-edit-acc="${esc(g.parts[0].id)}"]'>Choose where it goes</button>` : ""}
      ${multi ? `<details class="pb-parts"><summary>${g.parts.length} parts</summary><ul>${g.parts.map(x => `<li><span>${esc(x.name)}</span><b>${$c(x.cents)}</b></li>`).join("")}</ul></details>` : ""}</span>
    <b class="pb-amt">${$c(g.cents)}</b></li>`;
}

function draw(first) {
  if (!PB) return;
  const d = $("#sheet"), S = app.state, E = earners(S), P = current(), y = d.scrollTop;
  const many = E.length > 1, mine = myPerson();
  const view = shown(P), ticking = PB.check.state === "ready", done = (PB.check.row && PB.check.row.done) || {};
  const tickables = view.groups.filter(tickable), doneN = tickables.filter(g => done[g.key]).length;
  const chips = many ? `<div class="pb-people" role="tablist" aria-label="Whose payday">${E.map(p => `<button type="button" role="tab" class="pb-chip${p.id === PB.pid ? " on" : ""}" aria-selected="${p.id === PB.pid}" data-pb-person="${esc(p.id)}">${esc(p.name || "Unnamed")}${p.id === mine ? " (you)" : ""}</button>`).join("")}</div>` : "";
  const hero = `<div class="pb-hero">
      ${P.date ? `<p class="pb-when">${whenLine(P.inDays)}</p><h4 class="pb-date">${dateLine(P.date)}</h4>` : `<h4 class="pb-date">No payday set</h4>`}
      <p class="pb-pay"><b>${$c(P.payC)}</b><span>${FREQ[P.person.freq] || "Pay"}${P.src ? ` · into ${esc(P.src.name)}` : ""}</span></p>
      ${P.date ? `<div class="pb-nav"><button class="linkish" type="button" data-pb-k="-1" aria-label="Previous payday">‹ Previous</button><button class="linkish" type="button" data-pb-k="1" aria-label="Next payday"${PB.k >= 6 ? " disabled" : ""}>Next ›</button></div>` : ""}</div>`;
  let body;
  if (P.status === "over") {
    body = `<div class="pb-warn" role="alert"><b>This plan is ${Math.round(P.overPct * 1000) / 10}% over the pay</b><p>There’s nothing to follow until it adds up to 100%.</p>
      <div class="pb-acts"><button class="btn primary small" type="button" data-home-go="budget">Fix it in Budget</button>${!readOnly() ? `<button class="btn small" type="button" data-pb-rebalance>Rebalance</button>` : ""}</div></div>`;
  } else {
    const anyDest = view.groups.some(g => g.kind !== "aside");
    body = `${view.kept ? `<div class="pb-changed" role="status"><span>Your budget changed after you started this checklist.</span><button class="linkish" type="button" data-pb-replan>Use the new plan</button></div>` : ""}
      ${ticking && tickables.length ? `<p class="pb-progress" aria-live="polite"><span class="pb-prog-bar"><i style="width:${(doneN / tickables.length * 100).toFixed(1)}%"></i></span>${doneN} of ${tickables.length} marked done</p>` : ""}
      ${!anyDest && !readOnly() ? `<button class="btn primary block pb-setup" type="button" data-home-go="budget">Choose where your money goes</button>` : ""}
      <ul class="pb-list">${view.groups.map(g => rowHTML(g, !!done[g.key], PB.check.busy.has(g.key), ticking, anyDest)).join("")}</ul>
      ${view.left > 0 ? `<p class="pb-left">${$c(view.left)} not allocated yet</p>` : ""}
      ${!P.date ? `<p class="pb-left">Add when ${P.person.id === mine || !many ? "you were" : "they were"} last paid to see the date. <button class="linkish" type="button" data-home-go="budget" data-home-person="${esc(P.person.id)}">Add payday</button></p>` : ""}`;
  }
  const identity = !linkReady() || app.offline ? "" : !mine && !takenBy(PB.pid) ? `<p class="pb-me">Is this your pay? <button class="linkish" type="button" data-pb-link>Yes, this is me</button></p>`
    : mine && mine !== PB.pid ? `<p class="pb-me dim">${esc(P.person.name || "They")} can tick these off on their own phone.</p>` : "";
  d.innerHTML = `<div class="sheet-head"><h3 tabindex="-1" autofocus>${many ? `${esc(P.person.name || "Their")}’s payday` : "Your payday"}</h3><button class="btn icon" type="button" data-sheet="close" aria-label="Close">✕</button></div>
    <div class="sheet-body pb">${chips}${hero}${body}
      ${PB.check.err ? `<p class="pb-left">${esc(PB.check.err)}</p>` : ""}
      ${identity}
      <div class="pb-foot"><button class="linkish" type="button" data-home-go="budget">Review budget</button></div></div>`;
  if (!d.open) d.showModal();
  if (first) { const h = d.querySelector("h3"); if (h) h.focus({ preventScroll: true }); }
  d.scrollTop = first ? 0 : y;
}

export function initPayday() {
  const d = $("#sheet");
  d.addEventListener("click", e => {
    if (!isOpen()) return;
    const t = e.target.closest("button"); if (!t || t.disabled) return;
    if (t.dataset.pbTick) { const on = t.getAttribute("aria-checked") !== "true"; tick(t.dataset.pbTick, on); return; }
    if (t.dataset.pbPerson) { PB.pid = t.dataset.pbPerson; PB.k = 0; draw(); loadCheck(); return; }
    if (t.dataset.pbK) { PB.k = Math.max(-6, Math.min(6, PB.k + Number(t.dataset.pbK))); draw(); loadCheck(); return; }
    if (t.hasAttribute("data-pb-replan")) { replan(); return; }
    if (t.hasAttribute("data-pb-link")) { linkMe(); return; }
    if (t.hasAttribute("data-pb-rebalance")) { d.close(); import("./rebalance.js").then(m => m.openRebalance()); return; }
    if (t.dataset.homeGo || t.dataset.sheet === "close") { PB = null; if (d.open) d.close(); }
  });
  d.addEventListener("close", () => { if (PB && !$("#sheet .pb")) PB = null; });
  // the budget changed (here or by someone else) while it's open: redraw from the new numbers
  const prev = app.beforeRefresh;
  app.beforeRefresh = () => { if (prev) prev(); if (isOpen()) draw(); };
  document.addEventListener("click", e => { const o = e.target.closest && e.target.closest("[data-pb-open]"); if (o && !o.disabled) { e.preventDefault(); openPayday({ pid: o.dataset.pbOpen || undefined }); } });
  // a payday reminder opens it (…/#payday)
  const fromHash = () => { if (location.hash !== "#payday" || !app.household) return; history.replaceState(null, "", "#home"); openPayday(); };
  window.addEventListener("hashchange", fromHash);
  app.openPaydayFromHash = fromHash;
}
