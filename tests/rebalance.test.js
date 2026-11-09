/* Phase 9C: rebalancing proposals. The brief's tests 1–12, households, and the rule that a proposal
   changes nothing until it's applied. Built on the real compute() (model/calc.js). */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { propose, shareOut, fingerprint, whoOptions, shortfallFix, withSplits, canRebalance } from "../js/model/rebalance.js";
import { compute } from "../js/model/calc.js";
import { blankBudget, addPerson } from "../js/model/schema.js";
import { applyOps, diff } from "../js/sync/ops.js";
import { toStored, fromStored } from "../js/model/schema.js";

const T = new Date(2026, 10, 9);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const id = (S, role) => S.accounts.find(a => a.role === role).id;
const fn = x => Math.round(x / 26 * 100) / 100; // annual → $ a fortnight, to the cent
/** $2,000 a fortnight, shares by role, plus a personal "Spending money" allocation. */
function solo(shares = { spending: 0.5, emergency: 0.1, goals: 0.15, invest: 0.1, fun: 0.15 }, spend = []) {
  const S = blankBudget({ name: "Sam", mode: "solo" }), p = S.people[0];
  p.pay = 2000; p.freq = "fortnightly"; p.payday = "2026-11-05";
  S.accounts.forEach(a => { if (shares[a.role] != null) a.split[p.id] = shares[a.role]; });
  S.accounts.push({ id: "fun", name: "Fun money ✨", type: "Personal", owner: p.id, role: null, split: { [p.id]: shares.fun || 0 }, pos: 9, icon: "star", colour: "rose" });
  S.spend = spend.map((x, i) => ({ id: "e" + i, name: x[0], type: "Fixed", amount: x[1], period: x[2] || "Fortnight", notes: "", due: null, aside: null, pos: i + 1 }));
  return S;
}
/** Two earners: Jarden $2,900 a fortnight, Madi $1,200 a week (mixed frequencies). */
function couple() {
  const S = blankBudget({ name: "Jarden", mode: "shared" }); addPerson(S, { name: "Madi" });
  const [j, m] = S.people; j.pay = 2900; j.freq = "fortnightly"; m.pay = 1200; m.freq = "weekly";
  const set = (role, a, b) => { const acc = S.accounts.find(x => x.role === role && (role !== "personalGoals" || x.owner === (a == null ? m.id : j.id))); acc.split[j.id] = a; acc.split[m.id] = b; };
  set("spending", 0.4, 0.4); set("emergency", 0.1, 0.1); set("goals", 0.1, 0.2); set("invest", 0.2, 0.1);
  S.accounts.push({ id: "pj", name: "Jarden spending", type: "Personal", owner: j.id, role: null, split: { [j.id]: 0.2 }, pos: 20 });
  S.accounts.push({ id: "pm", name: "Madi spending", type: "Personal", owner: m.id, role: null, split: { [m.id]: 0.2 }, pos: 21 });
  S.accounts.filter(a => a.role === "personalGoals").forEach(a => { a.split = {}; });
  return S;
}
const pctOf = (C, pid) => C.tot.pct[pid];
const frozen = S => JSON.stringify(S);

describe("calculation tests 1–12", () => {
  test("1: fully allocated solo: +$100 to bills, −$100 from Fun money; still 100%", () => {
    const S = solo(), C = compute(S, T), was = frozen(S);
    const P = propose(S, C, { target: id(S, "spending"), amount: 1100, from: ["fun"] });
    assert.equal(P.ok, true, JSON.stringify(P.errors));
    assert.equal(frozen(S), was, "the budget itself isn't touched");
    close(fn(P.C2.rows.find(r => r.role === "spending").t), 1100);
    close(fn(P.C2.rows.find(r => r.id === "fun").t), 200);
    close(pctOf(P.C2, S.people[0].id), 1);
    assert.equal(P.after.plan.k, "ok");
    assert.deepEqual(P.changes.map(c => c.id), [id(S, "spending"), "fun"], "target first, only what changed");
  });
  test("2: under-allocated: the increase uses pay with no plan yet, and the rest is still unplanned", () => {
    const S = solo({ spending: 0.5, emergency: 0.1, goals: 0.1, invest: 0.1, fun: 0 }), C = compute(S, T); // $400 unplanned
    const P = propose(S, C, { target: id(S, "spending"), amount: 1150 });
    assert.equal(P.ok, true);
    assert.equal(P.people[0].fromFree, 15000, "$150.00 from unplanned pay (cents)");
    close(fn(P.after.plan.left), 250);
    assert.equal(Object.keys(P.splits).length, 1, "nothing else changes");
  });
  test("3: over-allocated: lowering an allocation reduces the over-allocation; the status says so", () => {
    const S = solo({ spending: 0.6, emergency: 0.2, goals: 0.2, invest: 0.1, fun: 0 }), C = compute(S, T); // 110%
    assert.equal(propose(S, C, { target: id(S, "invest"), amount: 100 }).after.plan.k, "over", "half the fix: still over");
    const P = propose(S, C, { target: id(S, "invest"), amount: 0 });
    assert.equal(P.ok, true); assert.equal(P.before.plan.k, "over"); assert.equal(P.after.plan.k, "ok");
    assert.equal(P.splits[id(S, "invest")][S.people[0].id], 0, "exactly 0%");
    // an increase can't make an over-allocated plan worse
    const Q = propose(S, C, { target: id(S, "spending"), amount: 1300 });
    assert.equal(Q.ok, false); assert.ok(Q.errors.some(e => e.k === "unfunded"));
  });
  test("4: shared: a joint increase is shared as people pay in now, each found in their own plan", () => {
    const S = couple(), C = compute(S, T), [j, m] = S.people, sp = id(S, "spending");
    const row = C.rows.find(r => r.id === sp), now = fn(row.t);
    const P = propose(S, C, { target: sp, amount: now + 200, from: ["pj", "pm"] });
    assert.equal(P.ok, true, JSON.stringify(P.errors));
    const pj = P.people.find(p => p.id === j.id).change, pm = P.people.find(p => p.id === m.id).change;
    assert.equal(pj + pm, 20000);
    close(pj / 20000, row.by[j.id] / row.t, 1e-3); // as now: by what each pays in
    close(fn(P.C2.rows.find(r => r.id === "pj").t), fn(C.rows.find(r => r.id === "pj").t) - pj / 100, 0.011);
    close(fn(P.C2.rows.find(r => r.id === "pm").t), fn(C.rows.find(r => r.id === "pm").t) - pm / 100, 0.011);
    close(pctOf(P.C2, j.id), 1, 1e-9); close(pctOf(P.C2, m.id), 1, 1e-9);
    // Madi's personal allocation never pays for Jarden's part, and the other way round
    assert.equal(P.splits.pm[j.id], undefined); assert.equal(P.splits.pj[m.id], undefined);
    // "Jarden only": Madi's plan isn't touched at all
    const Q = propose(S, C, { target: sp, amount: now + 200, who: j.id, from: ["pj", "pm"] });
    assert.equal(Q.ok, true); assert.equal(Object.values(Q.splits).some(s => s[m.id] != null), false);
    assert.deepEqual(whoOptions(S, C, sp).map(o => o.k), ["asNow", "byPay", "equal", j.id, m.id]);
    assert.deepEqual(whoOptions(S, C, "pj"), [], "a personal allocation is only its owner's");
  });
  test("5: mixed pay frequencies: weekly pay is converted, and shares stay fractions of each person's own pay", () => {
    const S = couple(), C = compute(S, T), [, m] = S.people, sp = id(S, "spending");
    const P = propose(S, C, { target: sp, amount: fn(C.rows.find(r => r.id === sp).t) + 100, who: m.id, from: ["pm"] });
    assert.equal(P.ok, true);
    const madiAnnual = 1200 * 52;
    close(P.splits[sp][m.id], 0.4 + 100 * 26 / madiAnnual, 1e-9);
    close(P.splits.pm[m.id], 0.2 - 100 * 26 / madiAnnual, 1e-9);
    // the same proposal viewed weekly gives the same shares
    const W = { ...S, viewAs: "week" }, CW = compute(W, T);
    const PW = propose(W, CW, { target: sp, amount: CW.rows.find(r => r.id === sp).t / 52 + 50, who: m.id, from: ["pm"] });
    close(PW.splits[sp][m.id], P.splits[sp][m.id], 1e-9);
  });
  test("6: protected (not chosen) allocations are never touched", () => {
    const S = solo(), C = compute(S, T);
    const P = propose(S, C, { target: id(S, "spending"), amount: 1200, from: ["fun", id(S, "goals")] });
    assert.equal(P.ok, true);
    [id(S, "invest"), id(S, "emergency")].forEach(k => assert.equal(P.splits[k], undefined));
  });
  test("7: exact amounts across two chosen allocations add up exactly", () => {
    const S = solo(), C = compute(S, T);
    const P = propose(S, C, { target: id(S, "spending"), amount: 1123.45, from: ["fun", id(S, "goals")], manual: { fun: 100.45 } });
    assert.equal(P.ok, true);
    close(fn(P.C2.rows.find(r => r.id === "fun").t), 199.55);
    close(fn(P.C2.rows.find(r => r.role === "goals").t), 300 - 23);
    close(pctOf(P.C2, S.people[0].id), 1);
  });
  test("8: proportional: shared by what each gives now, cents by largest remainder, deterministic", () => {
    assert.deepEqual(shareOut(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(shareOut(1001, [3, 0, 7]), [300, 0, 701]);
    assert.deepEqual(shareOut(5, [0, 0]), [3, 2], "no weights: evenly");
    const S = solo(), C = compute(S, T);
    const a = propose(S, C, { target: id(S, "spending"), amount: 1100.01, from: ["fun", id(S, "goals"), id(S, "invest")] });
    const b = propose(S, C, { target: id(S, "spending"), amount: 1100.01, from: ["fun", id(S, "goals"), id(S, "invest")] });
    assert.deepEqual(a.splits, b.splits);
    const cut = k => Math.round((C.rows.find(r => r.id === k).t - a.C2.rows.find(r => r.id === k).t) / 26 * 100);
    assert.equal(cut("fun") + cut(id(S, "goals")) + cut(id(S, "invest")), 10001, "every cent found once");
    assert.ok(cut("fun") === cut(id(S, "goals")) + 0 || Math.abs(cut("fun") - cut(id(S, "goals"))) <= 1, "fun and goals give the same now, so ±1 cent");
  });
  test("9: not enough in the chosen allocations: no proposal is made up", () => {
    const S = solo(), C = compute(S, T);
    const P = propose(S, C, { target: id(S, "spending"), amount: 1500, from: ["fun"] }); // fun only has $300
    assert.equal(P.ok, false);
    const e = P.errors.find(x => x.k === "unfunded"); assert.equal(e.cents, 20000, "$200 still to find");
    assert.equal(P.splits.fun[S.people[0].id], 0, "the preview shows fun at $0");
    assert.equal(propose(S, C, { target: id(S, "spending"), amount: 1100 }).ok, false, "nothing chosen, nothing unplanned: not balanced");
  });
  test("10: no pay or zero pay: nothing to rebalance, and no NaN or Infinity", () => {
    const S = solo(); S.people[0].pay = 0; const C = compute(S, T);
    assert.equal(canRebalance(S, C).ok, false);
    const P = propose(S, C, { target: id(S, "spending"), amount: 100 });
    assert.equal(P.ok, false); assert.equal(P.errors[0].k, "unavailable");
    // two people, one without pay: only the earner can pay in
    const D = couple(); D.people[1].pay = 0; const CD = compute(D, T);
    const Q = propose(D, CD, { target: id(D, "spending"), amount: fn(CD.rows.find(r => r.role === "spending").t) + 100, from: ["pj"] });
    assert.equal(Q.ok, true); assert.equal(Object.values(Q.splits).some(s => s[D.people[1].id] != null), false);
    Object.values(Q.splits).forEach(s => Object.values(s).forEach(v => assert.ok(isFinite(v) && v >= 0)));
    ["abc", -5, Infinity, NaN, ""].forEach(x => assert.equal(propose(S, compute(solo(), T), { target: id(S, "spending"), amount: x }).ok, false, String(x)));
  });
  test("11: cents: what you type is what you get, and before/after reconcile to the cent", () => {
    const S = solo(), C = compute(S, T);
    const P = propose(S, C, { target: id(S, "spending"), amount: 1033.33, from: ["fun", id(S, "invest")] });
    assert.equal(P.ok, true);
    const t = P.changes.reduce((s, c) => s + Math.round(c.delta / 26 * 100), 0);
    assert.equal(t, 0, "the changes cancel out exactly");
    close(fn(P.C2.rows.find(r => r.role === "spending").t), 1033.33);
  });
  test("12: renamed and customised allocations work by id; looks are untouched", () => {
    const S = solo(), C = compute(S, T);
    const P = propose(S, C, { target: "fun", amount: 350, from: [id(S, "goals")] });
    assert.equal(P.ok, true); assert.equal(P.target.name, "Fun money ✨");
    assert.ok(P.ops.every(o => o.path[0] === "accounts" && o.path[2] === "split"), "only shares are saved");
    const a = P.next.accounts.find(x => x.id === "fun"); assert.equal(a.icon, "star"); assert.equal(a.colour, "rose"); assert.equal(a.pos, 9);
  });
});

describe("safety", () => {
  test("the ops do exactly what the preview shows, and nothing else in the budget changes", () => {
    const S = solo(), C = compute(S, T);
    const P = propose(S, C, { target: id(S, "spending"), amount: 1100, from: ["fun"] });
    const stored = toStored(S), after = applyOps(stored, P.ops);
    assert.deepEqual(fromStored(after), fromStored(toStored(P.next)));
    assert.ok(diff(stored, after).every(o => o.path[0] === "accounts" && o.path[2] === "split"));
  });
  test("lowering: freed money stays unplanned unless you choose where it goes", () => {
    const S = solo(), C = compute(S, T);
    const P = propose(S, C, { target: id(S, "invest"), amount: 100 });
    assert.equal(P.ok, true); close(fn(P.after.plan.left), 100); assert.equal(P.after.plan.k, "left");
    const Q = propose(S, C, { target: id(S, "invest"), amount: 100, from: [id(S, "goals")] });
    assert.equal(Q.ok, true); close(fn(Q.C2.rows.find(r => r.role === "goals").t), 400); assert.equal(Q.after.plan.k, "ok");
  });
  test("the expense shortfall fix: the bills allocation, and exactly enough", () => {
    const S = solo(undefined, [["Rent", 1215.31]]), C = compute(S, T);
    const f = shortfallFix(S, C); assert.equal(f.target, id(S, "spending")); assert.equal(f.amount, 1215.31);
    const P = propose(S, C, { target: f.target, amount: f.amount, from: ["fun"] });
    assert.equal(P.ok, true); assert.equal(P.before.cover.state, "short"); assert.ok(["even", "covered"].includes(P.after.cover.state));
    assert.equal(shortfallFix(solo(), compute(solo(), T)), null, "no shortfall, no fix");
  });
  test("a proposal knows what it was based on", () => {
    const S = solo(); const f = fingerprint(S);
    assert.equal(fingerprint(JSON.parse(JSON.stringify(S))), f);
    const S2 = withSplits(S, { fun: { [S.people[0].id]: 0.1 } }); assert.notEqual(fingerprint(S2), f);
    const S3 = JSON.parse(JSON.stringify(S)); S3.accounts[0].name = "Renamed"; S3.accounts[0].colour = "blue"; assert.equal(fingerprint(S3), f, "looks don't matter");
    const S4 = JSON.parse(JSON.stringify(S)); S4.people[0].pay = 2100; assert.notEqual(fingerprint(S4), f);
  });
  test("no change, or a missing allocation: nothing to apply", () => {
    const S = solo(), C = compute(S, T);
    assert.equal(propose(S, C, { target: id(S, "spending"), amount: 1000 }).ok, false);
    assert.equal(propose(S, C, { target: "nope", amount: 5 }).errors[0].k, "noTarget");
  });
});
