/* The money maths. Everything is worked out PER YEAR, then shown in the household's
   chosen period with C.v(annual). Nothing here touches the page. */

import { n, blank, is100, parseDate, addDays, daysBetween } from "./util.js";
import { perYear, periodDays, addPeriods, WORDS } from "./periods.js";
import { money, m0, monthYear, possessive } from "./format.js";

/* ---------- goals: finished goals pass their share to the next unfinished goal ---------- */
/** goals: the goal list in priority order. base: what each goal gets before roll-over (null = no amount).
    Returns eff (what each goal really gets), where shares came from / went to, and anything spare. */
export function allocGoals(goals, base) {
  const eff = base.map(v => v === null ? null : v), from = goals.map(() => []), to = goals.map(() => null);
  let spare = 0;
  const finished = goals.map(g => !blank(g.name) && !blank(g.target) && Math.max(n(g.target) - n(g.saved), 0) === 0);
  const open = i => !blank(goals[i].name) && !finished[i];
  goals.forEach((g, i) => {
    if (!finished[i] || !base[i]) return;
    let j = -1;
    for (let k = i + 1; k < goals.length; k++) if (open(k)) { j = k; break; }
    if (j < 0) for (let k = i - 1; k >= 0; k--) if (open(k)) { j = k; break; }
    if (j >= 0) { eff[j] = n(eff[j]) + base[i]; from[j].push({ name: g.name, v: base[i] }); to[i] = goals[j].name; }
    else { spare += base[i]; to[i] = ""; }
    eff[i] = 0;
  });
  return { eff, from, to, spare, finished };
}

/* ---------- extra-pay years ---------- */
/** Years with an extra payday: 27 for fortnightly pay, 53 for weekly. Monthly pay never has one.
    Returns [{year, count}] for this year and the next `span` years, or null if there's no payday yet. */
export function extraPayYears(payday, freq, today, span = 20) {
  const d = parseDate(payday); if (!d) return null;
  if (freq === "monthly") return [];
  const step = freq === "weekly" ? 7 : 14, normal = freq === "weekly" ? 52 : 26;
  const y0 = today.getFullYear(), out = [];
  for (let Y = y0; Y <= y0 + span; Y++) {
    const k = Math.ceil(daysBetween(d, new Date(Y, 0, 1)) / step);
    let p = addDays(d, k * step), c = 0;
    while (p.getFullYear() === Y) { c++; p = addDays(p, step); }
    if (c > normal) out.push({ year: Y, count: c });
  }
  return out;
}

/* ---------- sinking funds (yearly bills with a due month) ---------- */
export function sinkInfo(s, today, view) {
  if (s.type !== "Sinking" || s.period !== "Year" || blank(s.due) || blank(s.name)) return null;
  const A = n(s.amount); if (A <= 0) return null;
  let next = new Date(today.getFullYear(), s.due - 1, 1);
  if (next <= today) next = new Date(today.getFullYear() + 1, s.due - 1, 1);
  const last = new Date(next.getFullYear() - 1, s.due - 1, 1);
  const frac = daysBetween(last, today) / daysBetween(last, next), expected = A * frac; // whole days, so daylight saving can't nudge it
  // Small tolerance so "4.01 months away" counts as 4, not 5.
  const periodsAway = Math.max(1, Math.ceil(daysBetween(today, next) / periodDays(view) - 0.05));
  const info = { next, periodsAway, expected, A };
  if (blank(s.aside)) { info.st = { t: `Should have ${m0(expected)} by now`, c: "info" }; return info; }
  const diff = n(s.aside) - expected, tol = Math.max(2, A * 0.02);
  if (n(s.aside) >= A) info.st = { t: "Ready to pay", c: "ok" };
  else if (Math.abs(diff) <= tol) info.st = { t: "On track", c: "ok" };
  else if (diff > 0) info.st = { t: `Ahead by ${m0(diff)}`, c: "ok" };
  else { info.behind = -diff; info.need = (A - n(s.aside)) / periodsAway; info.st = { t: `Behind by ${m0(-diff)}`, c: "bad" }; }
  return info;
}

/* ---------- goal status ---------- */
/** perYearAmt: money going to the goal each year. Messages use the household's view period. */
export function goalStatus(g, perYearAmt, isEF, today, view) {
  if (blank(g.name)) return { t: "", c: "" };
  if (blank(g.target)) return { t: "Needs a target", c: "warn" };
  const rem = Math.max(n(g.target) - n(g.saved), 0);
  if (rem === 0) return { t: "Done", c: "ok" };
  if (!perYearAmt) return { t: isEF ? "Needs an amount" : "Needs a %", c: "warn" };
  const per = perYearAmt / perYear(view);
  if (!g.deadline) return { t: "ETA " + monthYear(addPeriods(today, Math.ceil(rem / per), view)), c: "info" };
  const dl = parseDate(g.deadline);
  if (!dl || dl <= today) return { t: "Deadline passed", c: "bad" };
  const periods = daysBetween(today, dl) / periodDays(view);
  if (per * periods >= rem) return { t: "On track for " + monthYear(dl), c: "ok" };
  return { t: "Needs " + m0(Math.ceil(rem / periods - per)) + WORDS[view].short + " more", c: "bad" };
}

/* ---------- investments ---------- */
/** Compounds 26 times a year (as before), with contributions spread evenly through the year.
    growth: how much contributions rise each year. fee: yearly fee on the balance. */
export function projectInvestments({ start = 0, annual = 0, rate = 0, fee = 0, growth = 0, years = 30, steps = 26 }) {
  const r = (rate - fee) / steps, r0 = rate / steps;
  let bal = start, bal0 = start, contrib = start;
  const out = [{ y: 0, contrib: start, bal: start, growth: 0, mult: start ? 1 : null, noFee: start }];
  for (let y = 1; y <= years; y++) {
    const c = annual / steps * Math.pow(1 + growth, y - 1);
    for (let k = 0; k < steps; k++) { bal = bal * (1 + r) + c; bal0 = bal0 * (1 + r0) + c; contrib += c; }
    out.push({ y, contrib, bal, growth: bal - contrib, mult: contrib === 0 ? null : bal / contrib, noFee: bal0 });
  }
  return out;
}

export function nwStatus(a, em, C) {
  if (blank(a.name)) return { t: "", c: "" };
  if (C.dup.has(a.name.trim().toLowerCase())) return { t: "Duplicate name", c: "bad" };
  switch (a.type) {
    case "Operating": return { t: "Operating cash", c: "" };
    case "Investment": return { t: "Feeds Investments", c: "info" };
    case "Super": return { t: "Long-term wealth", c: "" };
    case "Debt": return { t: "Liability", c: "bad" };
    case "Savings": {
      const b = n(a.balance);
      if (b === 0) return { t: "Needs a balance", c: "warn" };
      if (em > b) return { t: "Over-earmarked by " + m0(em - b), c: "bad" };
      if (em < b) return { t: m0(b - em) + " not yet earmarked", c: "warn" };
      return { t: "Reconciled", c: "ok" };
    }
  }
  return { t: "", c: "" };
}

/* ---------- the whole model ---------- */
/** Works out every figure for a budget. All money values in C are per YEAR unless named otherwise;
    use C.v(x) to show one in the household's chosen period. */
export function compute(S, today) {
  const view = S.viewAs || "fortnight", per = perYear(view);
  const C = { view, per, today, v: annual => annual / per };

  // people and income
  C.people = S.people.map(p => ({ ...p, annual: n(p.pay) * perYear(p.freq) }));
  C.pIndex = Object.fromEntries(C.people.map(p => [p.id, p]));
  C.earners = C.people.filter(p => p.annual > 0);
  C.incTotal = C.people.reduce((s, p) => s + p.annual, 0);
  C.multi = S.people.length > 1;

  // allocation: each account gets a % of each person's pay
  C.rows = S.accounts.map(a => {
    const by = {}; let t = 0;
    C.people.forEach(p => { const v = n(a.split[p.id]) * p.annual; by[p.id] = v; t += v; });
    return { ...a, by, t };
  });
  C.tot = { pct: {}, amt: {}, t: C.rows.reduce((s, r) => s + r.t, 0) };
  C.people.forEach(p => {
    C.tot.pct[p.id] = S.accounts.reduce((s, a) => s + n(a.split[p.id]), 0);
    C.tot.amt[p.id] = C.rows.reduce((s, r) => s + r.by[p.id], 0);
  });
  const byType = t => C.rows.filter(r => r.type === t).reduce((s, r) => s + r.t, 0);
  C.joint = byType("Joint"); C.personal = byType("Personal"); C.investment = byType("Investment");
  C.cash = C.rows.filter(r => ["emergency", "goals", "personalGoals"].includes(r.role) || /saving|buffer|goal|emergency/i.test(r.name || ""))
                 .filter(r => r.type !== "Investment").reduce((s, r) => s + r.t, 0);
  const roleRow = role => C.rows.find(r => r.role === role) || { by: {}, t: 0 };
  C.pool = {
    spending: roleRow("spending").t,
    emergency: roleRow("emergency").t,
    goals: roleRow("goals"),
    invest: C.investment,
    personalGoals: Object.fromEntries(C.people.map(p => [p.id, C.rows.filter(r => r.role === "personalGoals" && r.owner === p.id).reduce((s, r) => s + r.t, 0)])),
  };

  // fair split: who puts what into shared accounts (Joint + Investment)
  C.fair = Object.fromEntries(C.people.map(p => {
    const sum = f => C.rows.filter(f).reduce((s, r) => s + r.by[p.id], 0);
    return [p.id, { shared: sum(r => r.type === "Joint" || r.type === "Investment"),
      personal: sum(r => r.type === "Personal"), spend: sum(r => r.type === "Personal" && /spend/i.test(r.name || "")) }];
  }));
  C.fairShared = C.people.reduce((s, p) => s + C.fair[p.id].shared, 0);
  C.showFair = C.earners.length >= 2;
  C.fairVerdict = fairVerdict(C);

  // net worth
  const nw = S.nw.accounts, sumNW = t => nw.filter(a => a.type === t).reduce((s, a) => s + n(a.balance), 0);
  C.nw = { op: sumNW("Operating"), sav: sumNW("Savings"), inv: sumNW("Investment"), sup: sumNW("Super"), debt: sumNW("Debt") };
  C.nw.assets = C.nw.op + C.nw.sav + C.nw.inv + C.nw.sup; C.nw.net = C.nw.assets - C.nw.debt; C.nw.cash = C.nw.op + C.nw.sav;
  const allGoals = [S.goals.ef, ...S.goals.joint, ...Object.values(S.goals.personal).flat()];
  C.earmark = {};
  nw.forEach(a => { C.earmark[a.id] = allGoals.filter(g => g.account === a.name && !blank(a.name)).reduce((s, g) => s + n(g.saved), 0); });
  const counts = {}; nw.forEach(a => { const k = (a.name || "").trim().toLowerCase(); if (k) counts[k] = (counts[k] || 0) + 1; });
  C.dup = new Set(Object.keys(counts).filter(k => counts[k] > 1));
  C.savingsNames = nw.filter(a => a.type === "Savings" && !blank(a.name)).map(a => a.name);
  const rev = parseDate(S.nw.reviewed);
  C.reviewDue = !rev || daysBetween(rev, today) > 30;

  // joint spending (amounts per year)
  C.sp = S.spend.map(s => ({ ...s, annual: blank(s.name) ? null : n(s.amount) * perYear(s.period || "Fortnight") }));
  C.sp.forEach(s => { s.sink = sinkInfo(s, today, view); });
  C.committed = C.sp.reduce((s, r) => s + n(r.annual), 0);
  C.spBuffer = C.pool.spending - C.committed;
  C.spType = t => C.sp.filter(r => r.type === t).reduce((s, r) => s + n(r.annual), 0);
  C.mCommitted = C.committed / 12;

  // goals (amounts per year)
  const jg = C.pool.goals;
  C.gj = allocGoals(S.goals.joint, S.goals.joint.map(g => blank(g.name) ? null : C.people.reduce((s, p) => s + n(g.split[p.id]) * n(jg.by[p.id]), 0)));
  C.gp = Object.fromEntries(C.people.map(p => {
    const L = S.goals.personal[p.id] || [];
    return [p.id, allocGoals(L, L.map(g => blank(g.name) ? null : n(g.pct) * C.pool.personalGoals[p.id]))];
  }));

  // investments
  const I = S.invest;
  C.inv = { start: C.nw.inv, annual: C.pool.invest, rate: n(I.rate), fee: n(I.fee), g: n(I.growth) };
  C.inv.years = projectInvestments({ start: C.inv.start, annual: C.inv.annual, rate: C.inv.rate, fee: C.inv.fee, growth: C.inv.g });

  C.extraPay = Object.fromEntries(C.people.map(p => [p.id, extraPayYears(p.payday, p.freq, today)]));
  C.issues = issues(S, C);
  return C;
}

function fairVerdict(C) {
  if (!C.showFair) return null;
  const sh = C.fairShared; if (!sh) return { t: "Nothing shared yet", who: null };
  const E = C.earners, inc = C.incTotal;
  const diffs = E.map(p => ({ p, shareOfShared: C.fair[p.id].shared / sh, shareOfIncome: p.annual / inc }));
  if (diffs.every(d => Math.abs(d.shareOfShared - d.shareOfIncome) < 0.02)) return { t: "You’re splitting in proportion to income", who: null };
  if (diffs.every(d => Math.abs(d.shareOfShared - 1 / E.length) < 0.02)) return { t: E.length === 2 ? "You’re splitting 50/50" : "You’re splitting equally", who: null };
  const top = diffs.reduce((a, b) => (b.shareOfShared - b.shareOfIncome > a.shareOfShared - a.shareOfIncome ? b : a));
  return { t: `${top.p.name || "One person"} covers more than their income share`, who: top.p.id };
}

/* ---------- things to look at, per tab ---------- */
export function issues(S, C) {
  const I = { budget: [], networth: [], spending: [], goals: [], invest: [] };
  const w = WORDS[C.view];
  C.people.forEach(p => {
    const t = C.tot.pct[p.id];
    if (p.annual > 0 && !is100(t)) I.budget.push(`${possessive(p.name || "Someone")} allocation adds up to ${(t * 100).toFixed(1).replace(/\.0$/, "")}%, not 100%.`);
  });
  if (C.reviewDue && S.nw.accounts.length) I.networth.push("Balances haven’t been reviewed in over 30 days."); // (phase 6) not before there are any accounts
  [...C.dup].forEach(k => { const a = S.nw.accounts.find(x => (x.name || "").trim().toLowerCase() === k); I.networth.push(`“${a.name}” is used for more than one account, so goals tagged to it count twice.`); });
  S.nw.accounts.forEach(a => { if (a.type === "Savings" && C.earmark[a.id] > n(a.balance) && n(a.balance) > 0) I.networth.push(`${a.name} is over-earmarked by ${m0(C.earmark[a.id] - n(a.balance))}.`); });
  if (C.spBuffer < -0.01) I.spending.push(`${C.multi ? "Joint spending" : "Spending"} is ${money(C.v(-C.spBuffer))} ${w.per.replace("per ", "a ")} over budget.`); // wording only (phase 6): "Joint" only when it is
  C.sp.forEach(s => { if (s.sink && s.sink.behind) I.spending.push(`${s.name} is behind by ${m0(s.sink.behind)}. Put aside ${money(s.sink.need)}${w.short} to be ready by ${monthYear(s.sink.next)}.`); });
  if (n(S.goals.ef.saved) > 0 && C.mCommitted > 0 && n(S.goals.ef.saved) / C.mCommitted < 3) I.goals.push(`The emergency fund covers less than 3 months of committed ${C.multi ? "joint " : ""}costs.`);
  const chk = (list, A, label) => {
    list.forEach((g, i) => {
      const st = goalStatus(g, A.eff[i], false, C.today, C.view);
      if (st.c === "bad") I.goals.push(`${g.name}: ${st.t.toLowerCase()}.`);
      if (!blank(g.name) && !blank(g.account) && !C.savingsNames.includes(g.account)) I.goals.push(`${g.name} is tagged to “${g.account}”, which isn’t a savings account.`);
    });
    if (A.spare > 0.01) I.goals.push(`${money(C.v(A.spare))}${w.short} of ${label} isn’t going to any goal, because every goal is finished.`);
  };
  chk(S.goals.joint, C.gj, C.multi ? "the joint goals fund" : "the goals fund");
  C.people.forEach(p => chk(S.goals.personal[p.id] || [], C.gp[p.id], `${possessive(p.name || "Someone")} goals pool`));
  const efSt = goalStatus(S.goals.ef, C.pool.emergency, true, C.today, C.view);
  if (efSt.c === "bad") I.goals.push(`Emergency fund: ${efSt.t.toLowerCase()}.`);
  return I;
}
