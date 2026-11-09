/* Phase 9A: what the Home screen shows. Nothing here works money out again: every figure comes
   from compute() (model/calc.js), the same numbers the other tabs show. This file only decides
   WHICH of them to show, the next payday, and which suggestions apply. No page code, so it's tested
   on its own (tests/home.test.js).

   Paydays are a plan, not money in the bank: Home says when pay is EXPECTED, from the "recent payday"
   each person entered and how often they're paid. Nobody's pay is ever added to anyone else's. With
   no payday entered there's no date: Home asks for one instead of guessing. */
import { n, blank, parseDate, addDays, daysBetween, ymd } from "./util.js";
import { insights, incomplete } from "./intelligence.js";

// (Phase 10: the payday maths moved to paydate.js, unchanged, so the daily reminders can use it too)
import { nextPayday } from "./paydate.js";
export { nextPayday };

/** Each person with pay: their own next payday (or null), their own pay per pay, in date order
    (people with no payday last). */
export function paydays(S, C, today) {
  return C.people.filter(p => n(p.pay) > 0).map(p => {
    const d = nextPayday(p.payday, p.freq, today);
    return { id: p.id, name: p.name || "", colour: p.colour, pay: n(p.pay), freq: p.freq, date: d ? ymd(d) : null, inDays: d ? daysBetween(today, d) : null,
      pct: C.tot.pct[p.id], annual: p.annual };
  }).sort((a, b) => (a.date === null) - (b.date === null) || (a.inDays ?? 0) - (b.inDays ?? 0));
}

/** How much of everyone's pay has a plan (the Budget tab's own totals). Says nothing about whether
    the plan is affordable: that's a different question (Phase 9B). */
export function planStatus(C) {
  const earning = C.people.filter(p => p.annual > 0);
  if (!earning.length) return { k: "none", left: 0, over: 0 };
  const left = earning.reduce((s, p) => s + Math.max(0, p.annual - C.tot.amt[p.id]), 0);
  const over = earning.reduce((s, p) => s + Math.max(0, C.tot.amt[p.id] - p.annual), 0);
  const all = earning.every(p => Math.round(C.tot.pct[p.id] * 1e4) === 1e4);
  return { k: all ? "ok" : over > 0.5 ? "over" : "left", left, over, pct: C.incTotal ? C.tot.t / C.incTotal : 0 };
}

/** Suggestions for Home, most useful first, only for things that are really missing or wrong. At most
    `max`. Phase 9B: these are the same facts every screen uses (model/intelligence.js insights), so
    Home, Budget and Expenses never disagree. ctx.snapshots: null while unknown (then nothing is said). */
export function homeActions(S, C, { snapshots = null, max = 3 } = {}) {
  const L = insights(S, C, { snapshots }).filter(x => x.level !== "good");
  return [...L.filter(x => x.level === "attention"), ...L.filter(x => x.level !== "attention")].map(x => ({ ...x, key: x.id })).slice(0, max);
}

/** The few figures Home shows, all per year from compute() (shown per period by the page), labelled
    for what they are: planned amounts are plans; balances are what was entered. */
export function homeFigures(S, C) {
  const pg = Object.values(C.pool.personalGoals || {}).reduce((s, v) => s + n(v), 0);
  const ef = S.goals.ef || {};
  return {
    hasAccounts: S.nw.accounts.length > 0,
    netWorth: C.nw.net,
    saving: C.pool.emergency + C.pool.goals.t + pg,          // planned each period to the emergency fund and goals
    investing: C.pool.invest,                                 // planned each period to investments
    committed: C.committed, spendingBudget: C.pool.spending,  // planned expenses vs the money set aside for them
    hasSpend: C.sp.some(s => s.annual !== null && !incomplete(s)), // (Phase 9C.1: an expense still waiting for its amount doesn't count)
    ef: blank(ef.target) || !n(ef.target) ? null : { saved: n(ef.saved), target: n(ef.target) },
  };
}
