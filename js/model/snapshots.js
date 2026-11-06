/* Snapshots → totals, trends and plain-language notes for the Progress tab.
   No page code here, so it's tested on its own (tests/snapshots.test.js).

   A snapshot (from the budget_snapshots table) looks like
     { id, month: "2026-11-01", kind: "monthly" | "manual", taken_at, taken_by, data: { people, nw, goals } }
   where data is in the stored (keyed) shape. Totals are worked out here with the same rules as
   the Net worth tab, so "then" and "now" always compare like with like. */

import { fromStored } from "./schema.js";
import { n, blank, parseDate } from "./util.js";
import { money, m0, monthYear, possessive } from "./format.js";

/** Totals for one budget (in-memory shape): the numbers the Progress tab charts. */
export function summarize(state) {
  const nw = (state.nw && state.nw.accounts) || [];
  const sum = t => nw.filter(a => a.type === t).reduce((s, a) => s + n(a.balance), 0);
  const op = sum("Operating"), sav = sum("Savings"), inv = sum("Investment"), sup = sum("Super"), debt = sum("Debt");
  const names = Object.fromEntries((state.people || []).map(p => [p.id, p.name]));
  const goal = (g, group) => ({ id: g.id, name: g.name || "Unnamed goal", group, saved: n(g.saved), target: blank(g.target) ? null : n(g.target),
    pct: blank(g.target) || !n(g.target) ? null : Math.min(1, n(g.saved) / n(g.target)) });
  const goals = [];
  const G = state.goals || {};
  if (G.ef && (!blank(G.ef.target) || n(G.ef.saved))) goals.push(goal(G.ef, "Emergency fund"));
  (G.joint || []).filter(g => !blank(g.name)).forEach(g => goals.push(goal(g, (state.people || []).length > 1 ? "Joint" : "Goals")));
  Object.entries(G.personal || {}).forEach(([pid, L]) => (L || []).filter(g => !blank(g.name)).forEach(g => goals.push(goal(g, possessive(names[pid] || "Someone")))));
  return {
    cash: op + sav, investments: inv, super: sup, debt,
    assets: op + sav + inv + sup, netWorth: op + sav + inv + sup - debt,
    accounts: nw.filter(a => !blank(a.name)).map(a => ({ id: a.id, name: a.name, type: a.type, balance: n(a.balance) })),
    goals, reviewed: (state.nw && state.nw.reviewed) || "",
  };
}

/** Totals for a saved snapshot. */
export const summarizeSnapshot = snap => summarize(fromStored(snap.data || {}));

/** When a snapshot was taken, as a Date (taken_at), falling back to its month. */
const when = s => new Date(s.taken_at || s.month);
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** One point per month (the latest snapshot that month), oldest first, then "Now" from today's budget. */
export function trendPoints(snapshots, state, today = new Date()) {
  const byMonth = new Map();
  [...snapshots].sort((a, b) => when(a) - when(b)).forEach(s => byMonth.set(s.month ? s.month.slice(0, 7) : monthKey(when(s)), s));
  // The month a snapshot belongs to is the one the database recorded (NZ time), not the device's clock.
  const pts = [...byMonth.values()].map(s => { const m = monthOf(s); return { label: shortMonth(m), date: m, snap: s, ...summarizeSnapshot(s) }; });
  if (state) pts.push({ label: "Now", date: today, now: true, ...summarize(state) });
  return pts;
}
const shortMonth = d => d.toLocaleDateString("en-NZ", { month: "short", year: "2-digit" });
/** The first day of a snapshot's month, as a local date. */
export const monthOf = s => parseDate((s.month || "").slice(0, 10)) || new Date(when(s).getFullYear(), when(s).getMonth(), 1);

/** The snapshot to compare "now" with for "since last month": the latest one from an earlier month. */
export function previousMonthPoint(points, today = new Date()) {
  const thisMonth = monthKey(today);
  const past = points.filter(p => !p.now && p.snap && (p.snap.month || "").slice(0, 7) < thisMonth);
  return past[past.length - 1] || null;
}

/** "up $1,240" / "down $300" / "unchanged". */
export function changeWords(diff) {
  if (Math.abs(diff) < 0.5) return "unchanged";
  return `${diff > 0 ? "up" : "down"} ${m0(Math.abs(diff))}`;
}

/** Plain-language notes for the top of the Progress tab. */
export function progressNotes(points, today = new Date()) {
  const now = points.find(p => p.now), first = points.find(p => !p.now);
  if (!now || !first) return [];
  const prev = previousMonthPoint(points, today);
  const notes = [];
  if (prev) {
    const d = now.netWorth - prev.netWorth;
    notes.push(Math.abs(d) < 0.5 ? `Net worth is unchanged since ${monthYear(prev.date)}.` : `Net worth is ${changeWords(d)} since ${monthYear(prev.date)}.`);
  } else notes.push(`Your first snapshot is your starting point. Next month you’ll see how things have changed.`);
  if (first !== prev && points.filter(p => !p.now).length > 1) {
    const d = now.netWorth - first.netWorth;
    notes.push(`Since ${monthYear(first.date)}, it’s ${changeWords(d)}.`);
  }
  if (prev && Math.abs(now.debt - prev.debt) >= 0.5 && now.debt < prev.debt) notes.push(`You’ve paid ${m0(prev.debt - now.debt)} off your debts since ${monthYear(prev.date)}.`);
  return notes;
}

/** A goal's story over time: [{label, saved, target}] plus a one-line note. */
export function goalHistory(points, goalId) {
  const series = points.map(p => { const g = p.goals.find(x => x.id === goalId); return { label: p.label, now: !!p.now, saved: g ? g.saved : null, target: g ? g.target : null }; });
  return series;
}
export function goalNote(goal, points, today = new Date()) {
  const prev = previousMonthPoint(points, today);
  const before = prev && prev.goals.find(g => g.id === goal.id);
  const pct = goal.pct === null ? "" : goal.pct >= 1 ? "Done!" : `${Math.round(goal.pct * 100)}% there`;
  const moved = before ? goal.saved - before.saved : null;
  const change = moved === null ? "" : Math.abs(moved) < 0.5 ? "no change this month" : `${moved > 0 ? "up" : "down"} ${m0(Math.abs(moved))} this month`;
  if (pct === "Done!") return change ? `Done! ${change[0].toUpperCase()}${change.slice(1)}.` : "Done!";
  return [pct, change].filter(Boolean).join(", ");
}

/** Then vs now, row by row, for the compare view. */
export function compare(then, now) {
  const row = (label, a, b, kind = "total") => ({ label, then: a, now: b, diff: (b ?? 0) - (a ?? 0), kind });
  const rows = [
    row("Net worth", then.netWorth, now.netWorth, "big"),
    row("Cash (everyday + savings)", then.cash, now.cash),
    row("Investments", then.investments, now.investments),
    row("KiwiSaver / super", then.super, now.super),
    row("Debt", then.debt, now.debt, "debt"),
  ];
  const accIds = [...new Set([...then.accounts, ...now.accounts].filter(a => a.type === "Savings").map(a => a.id))];
  accIds.forEach(id => {
    const a = then.accounts.find(x => x.id === id), b = now.accounts.find(x => x.id === id);
    rows.push(row((b || a).name, a ? a.balance : null, b ? b.balance : null, "account"));
  });
  const goalIds = [...new Set([...then.goals, ...now.goals].map(g => g.id))];
  goalIds.forEach(id => {
    const a = then.goals.find(x => x.id === id), b = now.goals.find(x => x.id === id);
    const g = b || a;
    rows.push({ ...row(g.name, a ? a.saved : null, b ? b.saved : null, "goal"), group: g.group, targetThen: a ? a.target : null, targetNow: b ? b.target : null });
  });
  return rows;
}

/** "+$420" / "−$80" / "no change" for the compare view. */
export const diffText = (d, kind) => Math.abs(d) < 0.5 ? "no change" : (d > 0 ? "+" : "−") + money(Math.abs(d)).replace("−", "");
/** Is a change good news? Debt going down is good; everything else going up is good. */
export const isGood = (d, kind) => kind === "debt" ? d < 0 : d > 0;
