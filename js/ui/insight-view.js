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
    case "planned": return { t: "Every dollar of pay has a plan", s: "That’s about the plan being complete, not whether it’s right for you", go: "budget" };
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
      <span class="in-ic" aria-hidden="true">${ICON[x.level]}</span><span class="in-t"><b>${esc(c.t)}</b><small>${esc(c.s)}</small></span>
      <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></li>`; }).join("")}</ul>`;
}

/* ---------- room to adjust (Budget, and a line on Home) ---------- */
export function roomHTML(S = app.state, C = app.C) {
  const R = breathingRoom(S, C); if (!R.known) return "";
  const P = R.parts, rows = [
    ["Pay with no plan yet", P.unallocated],
    [`${allocName(S)} not assigned to an expense`, P.unassigned],
    ["Allocations you marked adjustable", P.adjustable],
    ["Expenses you marked flexible", P.flexible],
  ].filter(r => r[1] > 0.004);
  const owners = R.adjustable.length && isShared(S) ? `<p class="in-note">Adjustable: ${R.adjustable.map(a => esc(a.name || "Unnamed") + (a.owner ? ` (${esc((S.people.find(p => p.id === a.owner) || {}).name || "")})` : "")).join(", ")}.</p>` : "";
  const deficit = R.shortfall + R.over;
  return `<div class="room" id="roomBox"><div class="room-h"><span>Room to adjust</span><b>${rows.length ? `up to ${per(C, R.total)}` : "—"}</b></div>
    ${rows.length ? `<ul class="room-rows">${rows.map(([l, v]) => `<li><span>${esc(l)}</span><b>${per(C, v)}</b></li>`).join("")}</ul>` : ""}
    ${deficit > 0.004 ? `<p class="in-note warn">${R.shortfall > 0.004 ? `Expenses are over budget by ${per(C, R.shortfall)}` : `The plan is over-allocated by ${per(C, R.over)}`}, which would need to come out of this first.</p>` : ""}
    ${owners}
    <p class="in-note">${R.marked ? "Based on what you’ve marked. It’s a plan, not money in your account." : "Mark allocations as adjustable, or expenses as flexible, to see more here. Nothing is assumed."}</p></div>`;
}

/* ---------- where pay goes (Budget): only when the parts truly add up to pay ---------- */
const PARTS = { essential: ["Essential expenses", "var(--cat-fixed)"], otherExpenses: ["Other expenses", "var(--cat-flex)"], unassigned: ["Bills budget not yet assigned", "var(--line-strong)"],
  saving: ["Saving & investing", "var(--invest)"], other: ["Other allocations", "var(--c-gold)"], unallocated: ["No plan yet", "var(--unalloc)"] };
export function breakdownHTML(S = app.state, C = app.C) {
  const B = incomeBreakdown(S, C); if (!B) return "";
  const shown = B.filter(p => p.v > 0.004), none = !commitments(S, C).count;
  const name = k => k === "unassigned" && none ? "Bills budget (no expenses entered yet)" : PARTS[k][0];
  const label = shown.map(p => `${name(p.key)} ${pct(p.share)}`).join(", ");
  return `<div class="ib"><div class="ib-bar" role="img" aria-label="Where planned pay goes: ${esc(label)}">${shown.map(p => `<span style="width:${(p.share * 100).toFixed(2)}%;background:${PARTS[p.key][1]}"></span>`).join("")}</div>
    <ul class="ib-key">${shown.map(p => `<li><i style="background:${PARTS[p.key][1]}" aria-hidden="true"></i><span>${esc(name(p.key))}</span><b>${per(C, p.v)}</b><small>${pct(p.share)}</small></li>`).join("")}</ul></div>`;
}

/** Budget: the plan check card (where pay goes, room to adjust, and what needs a look). */
export function planCheckHTML(S = app.state, C = app.C) {
  if (!(C.incTotal > 0)) return `<section class="card b-check" id="planCheck"><h2>Plan check</h2><p class="dim">Add your pay to see how your plan fits together.</p></section>`;
  const L = insights(S, C).filter(x => ["over", "short", "nobudget", "left", "unmarked", "bills"].includes(x.id));
  const good = insights(S, C).filter(x => x.level === "good" && ["planned", "covered"].includes(x.id));
  return `<section class="card b-check" id="planCheck" aria-labelledby="pcT"><h2 id="pcT">Plan check</h2>
    ${breakdownHTML(S, C)}${insightRows([...L.filter(x => x.level === "attention"), ...L.filter(x => x.level !== "attention"), ...good].slice(0, 4), S, C)}${roomHTML(S, C)}</section>`;
}
export function refreshPlanCheck() { const el = document.getElementById("planCheck"); if (el && app.C) el.outerHTML = planCheckHTML(); }

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
