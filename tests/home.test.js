/* Phase 9A: the Home screen's choices. Every figure must be the same number the other tabs show. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextPayday, paydays, planStatus, homeActions, homeFigures } from "../js/model/home.js";
import { compute } from "../js/model/calc.js";
import { blankBudget, addPerson } from "../js/model/schema.js";
import { buildBudget, suggestSplit } from "../js/model/onboarding.js";
import { ymd } from "../js/model/util.js";

const D = (y, m, d) => new Date(y, m - 1, d);
const at = (p, f, t) => { const r = nextPayday(p, f, t); return r && ymd(r); };

describe("next payday", () => {
  test("fortnightly and weekly step forward from any past payday; today counts", () => {
    assert.equal(at("2026-11-05", "fortnightly", D(2026, 11, 8)), "2026-11-19");
    assert.equal(at("2026-11-08", "fortnightly", D(2026, 11, 8)), "2026-11-08");
    assert.equal(at("2026-01-01", "weekly", D(2026, 11, 8)), "2026-11-12");
    assert.equal(at("2026-12-01", "fortnightly", D(2026, 11, 8)), "2026-12-01", "a future payday stays as it is");
  });
  test("monthly keeps the day of the month, and the 31st becomes the month's last day", () => {
    assert.equal(at("2026-01-15", "monthly", D(2026, 11, 8)), "2026-11-15");
    assert.equal(at("2026-01-05", "monthly", D(2026, 11, 8)), "2026-12-05");
    assert.equal(at("2026-01-31", "monthly", D(2027, 2, 3)), "2027-02-28");
  });
  test("no payday: no date (never guessed)", () => {
    assert.equal(nextPayday("", "fortnightly", D(2026, 11, 8)), null);
    assert.equal(nextPayday(null, "monthly", D(2026, 11, 8)), null);
  });
  test("each person keeps their own payday and pay: nothing is added together", () => {
    const S = blankBudget({ name: "Ana", mode: "shared" }); const a = S.people[0];
    a.pay = 2000; a.freq = "fortnightly"; a.payday = "2026-11-05";
    const b = addPerson(S, { name: "Ben", pay: 4000, freq: "monthly", payday: "2026-10-10" });
    const c = addPerson(S, { name: "Cat", pay: 900, freq: "weekly" });
    const L = paydays(S, compute(S, D(2026, 11, 8)), D(2026, 11, 8));
    assert.deepEqual(L.map(x => [x.name, x.pay, x.date]), [["Ben", 4000, "2026-11-10"], ["Ana", 2000, "2026-11-19"], ["Cat", 900, null]]);
    assert.equal(L[0].inDays, 2);
  });
});

describe("plan status (the Budget tab's own totals)", () => {
  const plan = mode => { const a = { mode, people: [{ name: "Sam", pay: 2000, freq: "fortnightly" }], have: {} }; return buildBudget(a, suggestSplit(a), D(2026, 11, 8)); };
  test("fully planned, some left, over", () => {
    const S = plan("solo"), T = D(2026, 11, 8), pid = S.people[0].id;
    assert.equal(planStatus(compute(S, T)).k, "ok");
    S.accounts.find(x => x.role === "spending").split[pid] = 0.4;
    let st = planStatus(compute(S, T)); assert.equal(st.k, "left"); assert.ok(Math.abs(st.left - 2000 * 26 * 0.1) < 0.01);
    S.accounts.find(x => x.role === "spending").split[pid] = 0.6;
    st = planStatus(compute(S, T)); assert.equal(st.k, "over"); assert.ok(Math.abs(st.over - 2000 * 26 * 0.1) < 0.01);
  });
  test("no pay yet", () => assert.equal(planStatus(compute(blankBudget({ name: "x" }), D(2026, 11, 8))).k, "none"));
});

describe("suggestions only for what's really missing", () => {
  const T = D(2026, 11, 8);
  test("a brand-new empty budget: add your pay first; at most three", () => {
    const S = blankBudget({ name: "Sam", mode: "solo" }), A = homeActions(S, compute(S, T));
    assert.equal(A[0].key, "pay"); assert.ok(A.length <= 3);
    assert.ok(!A.some(a => a.key === "payday" || a.key === "left" || a.key === "bills"), "nothing about pay that isn't there");
  });
  test("a fresh plan with pay: payday, accounts, goals (no warning about allocation: it's 100%)", () => {
    const a = { mode: "solo", people: [{ name: "Sam", pay: 2000, freq: "fortnightly" }], have: {} }, S = buildBudget(a, suggestSplit(a), T);
    assert.deepEqual(homeActions(S, compute(S, T)).map(x => x.key), ["payday", "accounts", "goal"]);
  });
  test("everything set up: nothing to suggest", () => {
    const a = { mode: "solo", people: [{ name: "Sam", pay: 2000, freq: "fortnightly", payday: "2026-11-05" }], have: {} }, S = buildBudget(a, suggestSplit(a), T);
    S.nw.accounts.push({ id: "n1", name: "Savings", type: "Savings", balance: 100, pos: 1 }); S.nw.reviewed = "2026-11-01";
    S.goals.joint.push({ id: "g", name: "Trip", target: 1, saved: 0, account: "", split: {}, deadline: "", pos: 1 });
    S.spend.push({ id: "s", name: "Rent", type: "Fixed", amount: 1, period: "Week", pos: 1 });
    assert.deepEqual(homeActions(S, compute(S, T), { snapshots: [{ id: 1 }] }), []);
    assert.deepEqual(homeActions(S, compute(S, T), { snapshots: [] }).map(x => x.key), ["snapshot"]);
    assert.deepEqual(homeActions(S, compute(S, T), { snapshots: null }), [], "snapshots not loaded yet: says nothing");
    S.nw.reviewed = "2026-08-01";
    assert.deepEqual(homeActions(S, compute(S, T), { snapshots: [{}] }).map(x => x.key), ["review"], "only when the app's own 30-day rule says so");
  });
});

test("Home's figures are exactly the other tabs' figures", () => {
  const T = D(2026, 11, 8), a = { mode: "shared", people: [{ name: "A", pay: 2000, freq: "fortnightly" }, { name: "B", pay: 3000, freq: "monthly" }], have: {} };
  const S = buildBudget(a, suggestSplit(a), T);
  S.nw.accounts.push({ id: "n1", name: "Savings", type: "Savings", balance: 10000, pos: 1 }, { id: "n2", name: "Card", type: "Debt", balance: 600, pos: 2 });
  S.goals.ef.target = 5000; S.goals.ef.saved = 1000; S.goals.ef.account = "Savings";
  const C = compute(S, T), F = homeFigures(S, C);
  assert.equal(F.netWorth, C.nw.net); assert.equal(F.netWorth, 9400, "a debt is taken off; the emergency fund isn't counted again");
  assert.equal(F.investing, C.pool.invest);
  assert.ok(Math.abs(F.saving - (C.pool.emergency + C.pool.goals.t + Object.values(C.pool.personalGoals).reduce((s, v) => s + v, 0))) < 1e-9);
  assert.equal(F.committed, C.committed); assert.equal(F.spendingBudget, C.pool.spending);
  assert.deepEqual(F.ef, { saved: 1000, target: 5000 });
});
