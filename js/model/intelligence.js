/* Phase 9B: budget intelligence. What the plan commits to, whether that's covered, and how much room
   there is to adjust, worked out from compute() (model/calc.js) so every number matches the other
   screens. No page code here (tested in tests/intelligence.test.js). Nothing here changes the budget.

   Words, used the same way everywhere:
   - Planned income: everyone's take-home pay, per year (C.incTotal), shown per period.
   - Allocated: pay given a job on the Budget tab. Unallocated: pay with no job yet. Neither is
     "money to spend" or money in an account.
   - Planned expenses (commitments): what's entered on the Expenses tab, each turned into a yearly
     amount (yearly bills once, spread across the year, never twice). Plans, not purchases.
   - The expenses budget: the allocation whose role is "spending" (the one that "Feeds the Spending
     tab"). That's the app's own, single link between Budget and Expenses: every entered expense is
     paid from it. Nothing is matched by name.
   - Coverage: that budget minus the planned expenses. Positive is budget not yet assigned to an
     entered expense (not "spare cash": some costs may not be entered); negative is a shortfall.
   - Essential / flexible: the person's own choice on each expense (field "need"). Unmarked expenses
     stay "not marked"; nothing is guessed.
   - Adjustable: the person's own choice on an allocation (field "adjustable"). Nothing is assumed
     adjustable, not even savings or investing.
   - Room to adjust: a breakdown of parts that don't overlap (unallocated pay, budget not assigned to
     expenses, allocations marked adjustable, expenses marked flexible). A plan, not a balance.
   Averages over the year say nothing about the cash on a particular day: a yearly bill spread across
   the year can still land before enough has been put aside. */
import { n, blank } from "./util.js";
import { toAnnual } from "./periods.js";
import { planStatus } from "./home.js";

export const NEEDS = ["essential", "flexible"];
const need = s => NEEDS.includes(s.need) ? s.need : "";
/** A named expense still waiting for its amount (blank, not $0). */
export const incomplete = s => !blank(s.name) && blank(s.amount);
const SAVING_ROLES = ["emergency", "goals", "personalGoals", "invest"];

/** Planned expenses, per year: in total, and split by essential / flexible / not marked. */
export function commitments(S, C) {
  const out = { total: 0, essential: 0, flexible: 0, unmarked: 0, count: 0, unmarkedCount: 0, unmarkedIds: [], incompleteIds: [] };
  C.sp.forEach(s => {
    if (s.annual === null) return; // an unnamed row isn't counted anywhere in the app
    // Phase 9C.1: a named expense with no amount yet (e.g. picked from the suggestions) is a to-do,
    // not a $0 commitment: it doesn't count towards expenses, coverage or essentials.
    if (incomplete(s)) { out.incompleteIds.push(s.id); return; }
    const a = n(s.annual), k = need(s);
    out.total += a; out.count++;
    if (k === "essential") out.essential += a; else if (k === "flexible") out.flexible += a;
    else { out.unmarked += a; out.unmarkedCount++; out.unmarkedIds.push(s.id); }
  });
  return out;
}

/** The expenses budget against the planned expenses. state: "none" (no expenses entered),
    "nobudget" (expenses, but nothing allocated to them), "short", "even" or "covered". */
export function coverage(S, C) {
  const alloc = S.accounts.find(a => a.role === "spending") || null;
  const budget = C.pool.spending, planned = C.committed, diff = budget - planned;
  const count = C.sp.filter(s => s.annual !== null && !incomplete(s)).length;
  const state = !count ? "none" : !(budget > 0.004) ? "nobudget" : Math.abs(diff) < 0.005 ? "even" : diff < 0 ? "short" : "covered";
  return { state, budget, planned, diff, short: diff < 0 ? -diff : 0, unassigned: diff > 0 ? diff : 0, allocation: alloc ? { id: alloc.id, name: alloc.name || "" } : null, sinking: C.spType("Sinking") };
}

/** Essential expenses as a share of planned income (null when there's no income to compare with). */
export const essentialShare = (C, cm) => C.incTotal > 0 ? cm.essential / C.incTotal : null;

/** Room to adjust: four parts that never overlap, each a plan per year. Shortfalls are kept apart.
    known: whether there's anything to go on (pay entered). marked: whether the person has marked any
    allocation adjustable or any expense flexible (without that, only the first two parts can show). */
export function breathingRoom(S, C) {
  const st = planStatus(C), cv = coverage(S, C), cm = commitments(S, C);
  const adj = C.rows.filter(r => (r.adjustable === true || r.adjustable === "yes") && r.role !== "spending" && r.t > 0)
    .map(r => ({ id: r.id, name: r.name || "", owner: r.owner || null, amount: r.t }));
  const parts = {
    unallocated: st.k === "none" ? 0 : st.left,
    unassigned: cv.state === "covered" ? cv.unassigned : 0,
    adjustable: adj.reduce((s, a) => s + a.amount, 0),
    flexible: cm.flexible,
  };
  const total = parts.unallocated + parts.unassigned + parts.adjustable + parts.flexible;
  return { known: st.k !== "none", marked: adj.length > 0 || cm.flexible > 0, parts, adjustable: adj, total,
    shortfall: cv.short, over: st.k === "over" ? st.over : 0 };
}

/** A new recurring cost (e.g. $100 a week), per year and per the shown period, against the room to
    adjust. Pure arithmetic for later planning tools: it changes nothing and isn't a promise. */
export function extraCost(amount, period, S, C) {
  const annual = Math.max(0, toAnnual(n(amount), period));
  const room = breathingRoom(S, C);
  const free = Math.max(0, room.total - room.shortfall - room.over);
  return { annual, perPeriod: C.v(annual), room: free, fits: room.known && annual <= free + 0.005, gap: Math.max(0, annual - free) };
}

/** How planned income divides up, as parts that don't overlap and add up to income, or null when they
    can't (no income, over-allocated, or expenses over their budget): then a combined bar would mislead. */
export function incomeBreakdown(S, C) {
  const st = planStatus(C), cv = coverage(S, C), cm = commitments(S, C);
  if (!(C.incTotal > 0) || st.k === "over" || cv.state === "short" || cv.state === "nobudget") return null;
  const saving = C.rows.filter(r => r.role !== "spending" && (SAVING_ROLES.includes(r.role) || r.type === "Investment")).reduce((s, r) => s + r.t, 0);
  const other = C.rows.filter(r => r.role !== "spending" && !(SAVING_ROLES.includes(r.role) || r.type === "Investment")).reduce((s, r) => s + r.t, 0);
  const parts = [
    { key: "essential", v: cm.essential },
    { key: "otherExpenses", v: cm.flexible + cm.unmarked },
    { key: "unassigned", v: C.pool.spending - cm.total },
    { key: "saving", v: saving },
    { key: "other", v: other },
    { key: "unallocated", v: Math.max(0, C.incTotal - C.tot.t) },
  ];
  const sum = parts.reduce((s, p) => s + p.v, 0);
  if (parts.some(p => p.v < -0.005) || Math.abs(sum - C.incTotal) > 0.01) return null; // not a clean split: don't draw it
  return parts.map(p => ({ ...p, v: Math.max(0, p.v), share: p.v / C.incTotal }));
}

/* ---------- insights: facts about the plan, in one place for every screen ----------
   Each has a stable id, a level ("attention": a real problem with the plan; "review": worth a look;
   "good": a plain fact that's done), the numbers it came from, and where to go. No scores or grades,
   no advice about how much to save. The page turns each into words. */
const size = x => Array.isArray(x) ? x.length : Object.keys(x || {}).length;
export function insights(S, C, { snapshots = null } = {}) {
  const out = [], add = (id, level, data = {}) => out.push({ id, level, ...data });
  const st = planStatus(C), cv = coverage(S, C), cm = commitments(S, C);
  const earners = C.people.filter(p => p.annual > 0);
  if (st.k === "over") add("over", "attention", { amount: st.over, to: "budget" });
  if (cv.state === "short") add("short", "attention", { amount: cv.short, to: "spending" });
  if (cv.state === "nobudget" && earners.length) add("nobudget", "attention", { amount: cv.planned, to: "budget", id2: cv.allocation && cv.allocation.id });
  if (!earners.length) add("pay", "review", { to: "person", person: (C.people[0] || {}).id });
  const noDay = earners.find(p => blank(p.payday));
  if (noDay) add("payday", "review", { to: "person", person: noDay.id, name: noDay.name || "" });
  if (st.k === "left") add("left", "review", { amount: st.left, to: "budget" });
  if (!S.nw.accounts.length) add("accounts", "review", { to: "networth" });
  else if (C.reviewDue) add("review", "review", { to: "networth" });
  if (!size(S.goals.joint) && !Object.values(S.goals.personal || {}).some(L => size(L))) add("goal", "review", { to: "goals" });
  if (!cm.count && !cm.incompleteIds.length && earners.length) add("bills", "review", { to: "spending" });
  if (cm.incompleteIds.length) add("amounts", "review", { count: cm.incompleteIds.length, to: "spending", item: cm.incompleteIds[0] });
  if (cm.unmarkedCount) add("unmarked", "review", { count: cm.unmarkedCount, amount: cm.unmarked, to: "spending", item: cm.unmarkedIds[0] });
  if (Array.isArray(snapshots) && !snapshots.length && S.nw.accounts.length) add("snapshot", "review", { to: "progress" });
  if (st.k === "ok") add("planned", "good", { to: "budget" });
  if (cv.state === "covered" || cv.state === "even") add("covered", "good", { amount: cv.unassigned, to: "spending" });
  if (cm.count && !cm.unmarkedCount) add("marked", "good", { to: "spending" });
  return out;
}
