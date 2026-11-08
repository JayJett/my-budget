/* Solo budgets made before Phase 8 have two goal pots: "Goals" (the goals role) and
   "<name> — Personal Goals". For one person that's the same thing twice. This offers to combine them,
   but only when the person asks and confirms (see ui/views/goals.js): nothing here runs by itself.

   Combining keeps every goal, with its saved amount, target, deadline, account, icon and colour, and
   keeps the money each goal gets: the Goals allocation takes both percentages (e.g. 10% + 5% = 15%),
   and each goal's share is rescaled so that it still receives the same dollars as before. */
import { clone, n, blank } from "./util.js";
import { compute } from "./calc.js";

const round = x => Math.round(x * 1e10) / 1e10;

/** What combining would involve, or null when there's nothing to combine. */
export function goalPotsToCombine(S) {
  if (!S || (S.people || []).length !== 1) return null;
  const me = S.people[0];
  const goals = S.accounts.find(a => a.role === "goals");
  const pots = S.accounts.filter(a => a.role === "personalGoals" && a.owner === me.id);
  if (!goals || !pots.length) return null;
  const a = n(goals.split[me.id]), b = pots.reduce((s, x) => s + n(x.split[me.id]), 0);
  return { me, goals, pots, a, b, moving: (S.goals.personal[me.id] || []).length };
}

/** A copy of the budget with the two pots combined. The original is left untouched. */
export function combineGoalPots(S0) {
  const S = clone(S0), c = goalPotsToCombine(S);
  if (!c) return S;
  const { me, goals, pots, a, b } = c, t = a + b;
  goals.split[me.id] = round(t);
  // each joint goal keeps its dollars: it had s × a of pay, now s' × (a + b)
  S.goals.joint.forEach(g => { if (t > 0 && g.split && g.split[me.id] != null) g.split[me.id] = round(n(g.split[me.id]) * a / t); });
  // each personal goal moves across: it had pct × b, now pct' × (a + b). They go in front of the
  // existing goals (in their own order), so a finished goal's share still passes to the same goal it did.
  const L = S.goals.personal[me.id] || [], first = S.goals.joint.reduce((m, g) => Math.min(m, typeof g.pos === "number" ? g.pos : 1), 1);
  S.goals.joint.unshift(...L.map((g, i) => {
    const { pct, ...rest } = g;
    return { ...rest, split: { [me.id]: t > 0 ? round(n(pct) * b / t) : n(pct) }, pos: first - L.length + i };
  }));
  S.goals.personal[me.id] = [];
  const gone = new Set(pots.map(x => x.id));
  S.accounts = S.accounts.filter(x => !gone.has(x.id));
  S.mode = "solo";
  return S;
}

/** Before and after, per goal, in dollars a year, so the person can see nothing is lost. */
export function combinePreview(S, today) {
  const c = goalPotsToCombine(S); if (!c) return null;
  const T = combineGoalPots(S), C0 = compute(S, today), C1 = compute(T, today), pid = c.me.id;
  const before = {};
  S.goals.joint.forEach((g, i) => { before[g.id] = n(C0.gj.eff[i]); });
  (S.goals.personal[pid] || []).forEach((g, i) => { before[g.id] = n(C0.gp[pid].eff[i]); });
  const rows = T.goals.joint.filter(g => !blank(g.name)).map(g => ({ id: g.id, name: g.name, before: before[g.id] || 0, after: n(C1.gj.eff[T.goals.joint.indexOf(g)]) }));
  return { ...c, next: T, rows, same: rows.every(r => Math.abs(r.before - r.after) < 0.005),
    poolBefore: C0.pool.goals.t + C0.pool.personalGoals[pid], poolAfter: C1.pool.goals.t };
}
