/* Phase 9B: how the budget-intelligence facts (model/intelligence.js) look on screen. One set of words
   for every screen, so Home, Budget and Expenses always say the same thing about the same plan.

   - Plain facts, no scores or grades, no advice on how much to save.
   - Plans, not money: "planned", "budget", "not yet assigned", never "spare" or "spent".
   - Each finding links to where it can be fixed (and opens the item when there is one). */
import { app, readOnly } from "./ctx.js";
import { esc } from "./dom.js";
import { money, m0, pct } from "../model/format.js";
import { WORDS } from "../model/periods.js";
import { isShared } from "../model/schema.js";
import { commitments, coverage, essentialShare, breathingRoom, incomeBreakdown, insights } from "../model/intelligence.js";

const per = (C, x) => `${money(C.v(x))}${WORDS[app.state.viewAs].short}`;
const allocName = S => { const a = S.accounts.find(x => x.role === "spending"); return (a && a.name) || "your bills allocation"; };

/** Words for one finding: { t: title, s: detail, go: tab, click / person: what to open there }. */
export function insightCopy(x, S = app.state, C = app.C) {
  const many = S.people.length > 1;
  switch (x.id) {
    case "over": return { t: "Your plan is over-allocated", s: `${per(C, x.amount)} more is planned than comes in`, go: "budget" };
    case "short": return { t: "Planned expenses are over their budget", s: `By ${per(C, x.amount)}. Raise ${allocName(S)} or trim expenses`, go: "spending" };
    case "nobudget": return { t: "Your expenses have no budget yet", s: `Give ${allocName(S)} a share of pay`, go: "budget", click: x.id2 ? `[data-edit-acc="${x.id2}"]` : "" };
    case "pay": return { t: "Add your pay", s: "So your plan has something to work with", go: "budget", person: x.person };
    case "payday": return { t: x.name && many ? `Set ${x.name}’s payday` : "Set your payday", s: "See when your next pay is due", go: "budget", person: x.person };
    case "left": return { t: `${per(C, x.amount)} of pay has no plan yet`, s: "Give it a job on Budget", go: "budget" };
    case "accounts": return { t: "Add an account", s: "To see your net worth", go: "networth", click: "[data-nw-new]" };
    case "review": return { t: "Review your account balances", s: "It’s been over a month since they were checked", go: "networth" };
    case "goal": return { t: "Create a savings goal", s: "A trip, a car, a house deposit…", go: "goals", click: ".gl-first-btn, [data-goal-new]" };
    case "bills": return { t: "Add your regular expenses", s: "To see what your plan commits to", go: "spending", click: "[data-sp-new]" };
    case "unmarked": return { t: `${x.count === 1 ? "1 expense isn’t" : `${x.count} expenses aren’t`} marked essential or flexible`, s: "Mark them to see your essentials", go: "spending", click: x.item ? `[data-edit-sp="${x.item}"]` : "" };
    case "snapshot": return { t: "Save your first snapshot", s: "Start tracking your progress over time", go: "progress" };
    case "planned": return { t: "Every dollar of pay has a plan", s: "", go: "budget" };
    case "covered": return { t: "Your entered expenses fit their budget", s: x.amount > 0.004 ? `${per(C, x.amount)} of it isn’t assigned to an expense yet` : "Exactly, to the cent", go: "spending" };
    case "marked": return { t: "Every expense is marked", s: "Essential or flexible, your call", go: "spending" };
  }
  return { t: x.id, s: "", go: "home" };
}
const ICON = { attention: "!", review: "•", good: "✓" };
/** A short list of findings as rows that go somewhere. */
export function insightRows(list, S = app.state, C = app.C) {
  if (!list.length) return "";
  return `<ul class="in-list">${list.map(x => { const c = insightCopy(x, S, C);
    return `<li class="in-row ${x.level}"><button type="button" class="in-btn" data-home-go="${c.go}"${c.person ? ` data-home-person="${esc(c.person)}"` : ""}${c.click && !readOnly() ? ` data-home-click="${esc(c.click)}"` : ""} data-insight="${x.id}">
      <span class="in-ic" aria-hidden="true">${ICON[x.level]}</span><span class="in-t"><b>${esc(c.t)}</b>${c.s ? `<small>${esc(c.s)}</small>` : ""}</span>
      <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></li>`; }).join("")}</ul>`;
}

/* ---------- room to adjust (inside "View breakdown" on Budget) ----------
   Rows only, no paragraphs: each part, any shortfall that comes off first, and the total. */
export function roomHTML(S = app.state, C = app.C) {
  const R = breathingRoom(S, C); if (!R.known) return "";
  const P = R.parts, names = R.adjustable.map(a => (a.name || "Unnamed") + (a.owner && isShared(S) ? ` (${(S.people.find(p => p.id === a.owner) || {}).name || ""})` : ""));
  const rows = [
    ["Pay with no plan yet", P.unallocated],
    [`${allocName(S)} not assigned to an expense`, P.unassigned],
    [names.length ? `Marked adjustable: ${names.join(", ")}` : "Marked adjustable", P.adjustable],
    ["Expenses marked flexible", P.flexible],
  ].filter(r => r[1] > 0.004);
  const deficit = R.shortfall + R.over;
  const minus = deficit > 0.004 ? `<li class="neg"><span>${R.shortfall > 0.004 ? "Less expenses over budget" : "Less over-allocation"}</span><b>−${per(C, deficit)}</b></li>` : "";
  return `<div class="room" id="roomBox"><div class="room-h"><span>Room to adjust</span><b>${rows.length ? `up to ${per(C, R.total)}` : "—"}</b></div>
    ${rows.length || minus ? `<ul class="room-rows">${rows.map(([l, v]) => `<li><span>${esc(l)}</span><b>${per(C, v)}</b></li>`).join("")}${minus}</ul>` : ""}
    ${R.marked ? "" : `<p class="in-note">Mark allocations adjustable or expenses flexible to add them here.</p>`}</div>`;
}

/* ---------- where pay goes: only when the parts truly add up to pay ---------- */
const PARTS = { essential: ["Essential expenses", "var(--cat-fixed)"], otherExpenses: ["Other expenses", "var(--cat-flex)"], unassigned: ["Bills budget not yet assigned", "var(--line-strong)"],
  saving: ["Saving & investing", "var(--invest)"], other: ["Other allocations", "var(--c-gold)"], unallocated: ["No plan yet", "var(--unalloc)"] };
export function breakdownHTML(S = app.state, C = app.C) {
  const B = incomeBreakdown(S, C); if (!B) return "";
  const shown = B.filter(p => p.v > 0.004), none = !commitments(S, C).count;
  const name = k => k === "unassigned" && none ? "Bills budget (no expenses entered yet)" : PARTS[k][0];
  const label = shown.map(p => `${name(p.key)} ${pct(p.share)}`).join(", ");
  return `<div class="ib"><h3 class="pc-sub">Where pay goes</h3><div class="ib-bar" role="img" aria-label="Where planned pay goes: ${esc(label)}">${shown.map(p => `<span style="width:${(p.share * 100).toFixed(2)}%;background:${PARTS[p.key][1]}"></span>`).join("")}</div>
    <ul class="ib-key">${shown.map(p => `<li><i style="background:${PARTS[p.key][1]}" aria-hidden="true"></i><span>${esc(name(p.key))}</span><b>${per(C, p.v)}</b><small>${pct(p.share)}</small></li>`).join("")}</ul></div>`;
}

/* ---------- Budget: one finding about the expenses, details on request (Phase 9B.1) ----------
   The card shows the single most important fact about whether the entered expenses are funded: a
   shortfall first, then "no budget", then covered. Whether every dollar has a plan is already the
   Budget status card's job, so it isn't repeated here. Everything else from Phase 9B (where pay goes,
   room to adjust, unmarked expenses) sits behind "View breakdown". */
export function primaryFinding(S = app.state, C = app.C) {
  const cv = coverage(S, C);
  if (!(C.incTotal > 0)) return { id: "pay", level: "review", t: "Add your pay to check your expenses", s: "", act: { label: "Add pay", go: "budget", person: (C.people[0] || {}).id } };
  if (cv.state === "short") return { id: "short", level: "attention", t: "Expenses are over budget", s: `${per(C, cv.short)} short`, act: { label: "Review expenses", go: "spending" } };
  if (cv.state === "nobudget") return { id: "nobudget", level: "attention", t: "Your expenses have no budget yet", s: `Give ${allocName(S)} a share of pay`, act: { label: "Set a budget", go: "budget", click: cv.allocation ? `[data-edit-acc="${cv.allocation.id}"]` : "" } };
  if (cv.state === "covered") return { id: "covered", level: "good", t: "Your expenses are covered", s: `${per(C, cv.unassigned)} not yet assigned to an expense`, act: null };
  if (cv.state === "even") return { id: "covered", level: "good", t: "Your expenses are covered", s: "Exactly, to the cent", act: null };
  return { id: "bills", level: "review", t: "Add expenses to check they’re covered", s: "", act: { label: "Add expenses", go: "spending", click: "[data-sp-new]" } };
}
let pcOpen = false;
const ACT_ATTRS = a => `data-home-go="${a.go}"${a.person ? ` data-home-person="${esc(a.person)}"` : ""}${a.click && !readOnly() ? ` data-home-click="${esc(a.click)}"` : ""}`;
/** Budget: the compact expense check, under the income card. No visible title: the finding says it. */
export function planCheckHTML(S = app.state, C = app.C) {
  const F = primaryFinding(S, C);
  const unmarked = insights(S, C).filter(x => x.id === "unmarked");
  const body = C.incTotal > 0 ? `${breakdownHTML(S, C)}${roomHTML(S, C)}${insightRows(unmarked, S, C)}` : "";
  return `<section class="card b-check" id="planCheck" aria-label="Expense check">
    <div class="pc-main ${F.level}" data-insight="${F.id}"><span class="pc-ic" aria-hidden="true">${ICON[F.level]}</span>
      <div class="pc-t"><p class="pc-h">${esc(F.t)}</p>${F.s ? `<p class="pc-s">${esc(F.s)}</p>` : ""}</div></div>
    ${F.act || body ? `<div class="pc-acts">${F.act ? `<button type="button" class="pc-act" ${ACT_ATTRS(F.act)}>${esc(F.act.label)}</button>` : ""}
      ${body ? `<button type="button" class="pc-more" data-pc-toggle aria-expanded="${pcOpen}" aria-controls="pcBody">${pcOpen ? "Hide breakdown" : "View breakdown"}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ""}</div>` : ""}
    ${body ? `<div class="pc-body" id="pcBody"${pcOpen ? "" : " hidden"}>${body}</div>` : ""}</section>`;
}
export function refreshPlanCheck() { const el = document.getElementById("planCheck"); if (el && app.C) el.outerHTML = planCheckHTML(); }
if (typeof document !== "undefined") document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("[data-pc-toggle]"); if (!b) return;
  pcOpen = b.getAttribute("aria-expanded") !== "true";
  const body = document.getElementById("pcBody"); if (!body) return;
  b.setAttribute("aria-expanded", String(pcOpen)); b.firstChild.textContent = pcOpen ? "Hide breakdown" : "View breakdown";
  body.hidden = !pcOpen;
});

/** Expenses: what's essential, flexible or not marked, and how that compares with pay. */
export function essentialsHTML(S = app.state, C = app.C) {
  const cm = commitments(S, C); if (!cm.count) return "";
  const share = essentialShare(C, cm), seg = [["Essential", cm.essential, "var(--cat-fixed)"], ["Flexible", cm.flexible, "var(--cat-flex)"], ["Not marked", cm.unmarked, "var(--unalloc)"]].filter(x => Math.abs(x[1]) > 0.004);
  const tot = Math.max(cm.total, 0.0001);
  return `<section class="card sp-ess" id="spEss" aria-labelledby="essT"><div class="b-row"><h2 id="essT">Essentials</h2>${share !== null && cm.essential > 0 ? `<span class="chip">${pct(share)} of pay</span>` : ""}</div>
    <div class="ib-bar" role="img" aria-label="${esc(seg.map(x => `${x[0]} ${money(C.v(x[1]))}`).join(", "))}">${seg.map(x => `<span style="width:${Math.max(0, x[1] / tot * 100).toFixed(2)}%;background:${x[2]}"></span>`).join("")}</div>
    <ul class="ib-key">${seg.map(x => `<li><i style="background:${x[2]}" aria-hidden="true"></i><span>${x[0]}</span><b>${per(C, x[1])}</b></li>`).join("")}</ul>
    ${cm.unmarkedCount ? `<p class="in-note">${cm.unmarkedCount === 1 ? "1 expense isn’t" : `${cm.unmarkedCount} expenses aren’t`} marked yet, so essentials ${cm.essential > 0 ? "may be higher" : "aren’t known yet"}.${readOnly() ? "" : ` <button class="linkish" type="button" data-home-go="spending" data-home-click="[data-edit-sp=&quot;${esc(cm.unmarkedIds[0])}&quot;]">Mark ${cm.unmarkedCount === 1 ? "it" : "them"}</button>`}</p>` : ""}</section>`;
}
export function refreshEssentials() { const el = document.getElementById("spEss"); if (el && app.C) el.outerHTML = essentialsHTML(); }

/** Home: a line or two inside the plan card (essentials, expenses fit or not, room to adjust). */
export function homePlanLines(S = app.state, C = app.C) {
  const cm = commitments(S, C), cv = coverage(S, C), R = breathingRoom(S, C), share = essentialShare(C, cm), L = [];
  const w = x => `${m0(C.v(x))}${WORDS[app.state.viewAs].short}`; // whole dollars: Home is the quick look
  if (cm.essential > 0 && share !== null) L.push([cm.unmarkedCount ? "Essentials so far" : "Essentials", `${w(cm.essential)} · ${pct(share)} of pay`]);
  if (cv.state === "short") L.push(["Expenses", `Over budget by ${w(cv.short)}`, "bad"]);
  else if (cv.state === "covered" || cv.state === "even") L.push(["Expenses", "Fit their budget"]);
  else if (cv.state === "nobudget") L.push(["Expenses", "No budget yet", "bad"]);
  if (R.known && R.total > 0.004 && R.marked) L.push(["Room to adjust", `Up to ${w(R.total)}`]);
  return L;
}
