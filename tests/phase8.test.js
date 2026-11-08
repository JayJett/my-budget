/* Phase 8: solo and shared plans, the saved household mode, and combining an old solo budget's two goal pots. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { suggestSplit, buildBudget, splitTotal } from "../js/model/onboarding.js";
import { compute } from "../js/model/calc.js";
import { toStored, fromStored, blankBudget, isShared, addPerson, normalise } from "../js/model/schema.js";
import { goalPotsToCombine, combineGoalPots, combinePreview } from "../js/model/household.js";
import { TODAY } from "./fixtures.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const me = (pay = 2000) => [{ name: "Jarden Jetly", pay, freq: "fortnightly" }];

describe("a solo plan ('Just me')", () => {
  const a = { purpose: "solo", mode: "solo", people: me(), have: {} };
  const split = suggestSplit(a), S = buildBudget(a, split, TODAY), pid = S.people[0].id, C = compute(S, TODAY);

  test("one Goals allocation (10% + 5% = 15%), no Personal Goals, adding to 100%", () => {
    const by = Object.fromEntries(split.buckets.map(b => [b.key, b.pct]));
    assert.deepEqual(by, { essentials: 50, fun: 15, emergency: 10, goals: 15, invest: 10 });
    assert.equal(splitTotal(split.buckets), 100);
    assert.equal(S.accounts.filter(x => x.role === "personalGoals").length, 0);
    assert.equal(S.accounts.filter(x => x.role === "goals").length, 1);
  });
  test("nothing is shared: no Joint allocations, every non-investment allocation is the person's own", () => {
    assert.equal(S.accounts.filter(x => x.type === "Joint").length, 0);
    S.accounts.filter(x => x.type !== "Investment").forEach(x => assert.equal(x.owner, pid, x.name));
  });
  test("plain names, without the person's name in front", () => {
    assert.deepEqual(S.accounts.map(x => x.name), ["Bills & essentials", "Spending money", "Emergency Fund", "Goals", "Investments"]);
  });
  test("the money still feeds the same places", () => {
    const yr = 2000 * 26;
    close(C.pool.spending, yr * 0.5); close(C.pool.emergency, yr * 0.1); close(C.pool.goals.t, yr * 0.15); close(C.pool.invest, yr * 0.1);
    close(C.tot.pct[pid], 1);
  });
  test("the mode is saved with the budget and survives a save and load", () => {
    assert.equal(S.mode, "solo");
    assert.deepEqual(fromStored(toStored(S)), S);
    assert.equal(isShared(S), false);
  });
  test("a solo plan never keeps more than one person", () => {
    const S2 = buildBudget({ mode: "solo", people: [...me(), { name: "Other", pay: 1 }] }, split, TODAY);
    assert.equal(S2.people.length, 1);
  });
  test("debt: a solo debt bucket is the person's own too", () => {
    const d = { purpose: "debt", mode: "solo", people: me(), have: { debts: [{ name: "Card", balance: 900 }] } };
    const S3 = buildBudget(d, suggestSplit(d), TODAY);
    assert.equal(S3.accounts.filter(x => x.type === "Joint").length, 0);
    assert.equal(splitTotal(suggestSplit(d).buckets), 100);
  });
});

describe("a shared plan ('With someone')", () => {
  test("with only your own pay so far it's still a shared plan, and stays shared", () => {
    const a = { purpose: "household", mode: "shared", people: me(), have: {} };
    const split = suggestSplit(a), S = buildBudget(a, split, TODAY), pid = S.people[0].id;
    assert.equal(split.mode, "shared");
    assert.equal(S.mode, "shared"); assert.equal(isShared(S), true);
    assert.equal(S.accounts.find(x => x.role === "spending").type, "Joint");
    assert.equal(S.accounts.find(x => x.role === "spending").owner, null);
    assert.ok(S.accounts.some(x => x.role === "personalGoals" && x.owner === pid));
    assert.equal(S.accounts.find(x => x.role === "goals").name, "Joint Goals");
    close(compute(S, TODAY).tot.pct[pid], 1);
  });
  test("two people: shared allocations, each person's own spending money and personal goals", () => {
    const a = { mode: "shared", people: [...me(), { name: "Madi", pay: 3000, freq: "monthly" }], have: {} };
    const S = buildBudget(a, suggestSplit(a), TODAY), C = compute(S, TODAY);
    S.people.forEach(p => {
      assert.equal(S.accounts.filter(x => x.role === "personalGoals" && x.owner === p.id).length, 1);
      assert.equal(S.accounts.filter(x => !x.role && x.type === "Personal" && x.owner === p.id).length, 1, "own spending money");
      close(C.tot.pct[p.id], 1);
    });
    assert.ok(C.fairShared > 0);
  });
  test("three or four people: everyone gets their own spending money and goals pot, and every pay adds to 100%", () => {
    for (const k of [3, 4]) {
      const people = Array.from({ length: k }, (_, i) => ({ name: `P${i + 1}`, pay: 1000 + i * 500, freq: ["weekly", "fortnightly", "monthly"][i % 3] }));
      const a = { mode: "shared", purpose: "family", people, have: {} }, S = buildBudget(a, suggestSplit(a), TODAY), C = compute(S, TODAY);
      assert.equal(S.people.length, k);
      S.people.forEach(p => { close(C.tot.pct[p.id], 1); assert.equal(S.accounts.filter(x => x.owner === p.id).length, 2); });
      assert.equal(new Set(S.people.map(p => p.colour)).size, k, "everyone starts with a different colour");
    }
  });
  test("no mode given: the old behaviour, decided by purpose", () => {
    assert.equal(suggestSplit({ purpose: "household", people: me() }).mode, "shared");
    assert.equal(suggestSplit({ purpose: "solo", people: me() }).mode, "solo");
  });
});

describe("existing budgets and the household mode", () => {
  test("an old budget gets no mode added, and is shown as before (by number of people)", () => {
    const old = blankBudget({ name: "Sam" });
    assert.equal(old.mode, undefined);
    assert.equal(normalise(old).mode, undefined);
    assert.equal(isShared(old), false);
    assert.equal(old.accounts.find(x => x.role === "spending").type, "Joint", "old shape unchanged");
  });
  test("an unknown mode is dropped, a valid one kept", () => {
    assert.equal(normalise({ ...blankBudget(), mode: "weird" }).mode, undefined);
    assert.equal(normalise({ ...blankBudget(), mode: "shared" }).mode, "shared");
  });
  test("blank budgets for 'set up later' follow the chosen mode", () => {
    const s = blankBudget({ name: "Sam", mode: "solo" }), sh = blankBudget({ name: "Sam", mode: "shared" });
    assert.equal(s.accounts.filter(x => x.type === "Joint").length, 0);
    assert.equal(s.accounts.filter(x => x.role === "personalGoals").length, 0);
    assert.equal(sh.accounts.filter(x => x.role === "personalGoals").length, 1);
    assert.equal(sh.mode, "shared");
  });
  test("solo → shared: adding a person moves no money and keeps every goal and balance", () => {
    const a = { mode: "solo", people: me(), have: { emergency: 500, savings: 900 } };
    const S = buildBudget(a, suggestSplit(a), TODAY), pid = S.people[0].id;
    S.goals.joint.push({ id: "g1", name: "Trip", target: 3000, saved: 400, account: "Savings", split: { [pid]: 1 }, deadline: "", pos: 1 });
    const before = JSON.parse(JSON.stringify(S)), C0 = compute(S, TODAY);
    const p = addPerson(S, { name: "Madi", pay: 3000 });
    assert.equal(isShared(S), true);
    before.accounts.forEach(x => assert.deepEqual(S.accounts.find(y => y.id === x.id), x, x.name));
    assert.deepEqual(S.goals.joint, before.goals.joint);
    assert.deepEqual(S.nw, before.nw);
    const C1 = compute(S, TODAY);
    close(C1.pool.goals.by[pid], C0.pool.goals.by[pid]); close(C1.gj.eff[0], C0.gj.eff[0]);
    assert.ok(S.accounts.some(x => x.role === "personalGoals" && x.owner === p.id), "the new person gets their own goals pot");
  });
});

describe("combining an old solo budget's two goal pots (only when asked)", () => {
  const old = () => {
    const S = blankBudget({ name: "Sam" }), pid = S.people[0].id;
    S.people[0].pay = 2000;
    const pg = S.accounts.find(x => x.role === "personalGoals");
    S.accounts.find(x => x.role === "goals").split[pid] = 0.1; pg.split[pid] = 0.05;
    S.accounts.find(x => x.role === "spending").split[pid] = 0.85;
    S.goals.joint.push({ id: "j1", name: "House", target: 50000, saved: 1000, account: "Savings", split: { [pid]: 0.6 }, deadline: "", pos: 1, icon: "home" },
                       { id: "j2", name: "Car", target: 9000, saved: 9000, account: "Savings", split: { [pid]: 0.4 }, deadline: "", pos: 2 });
    S.goals.personal[pid] = [{ id: "p1", name: "Guitar", target: 1500, saved: 200, account: "Savings", pct: 1, deadline: "2027-05-01", pos: 1 }];
    return S;
  };
  test("finds the two pots", () => {
    const c = goalPotsToCombine(old());
    assert.equal(c.a, 0.1); assert.equal(c.b, 0.05); assert.equal(c.moving, 1);
    assert.equal(goalPotsToCombine(combineGoalPots(old())), null);
    assert.equal(goalPotsToCombine(buildBudget({ mode: "solo", people: me() }, suggestSplit({ mode: "solo", people: me() }), TODAY)), null);
  });
  test("the original is untouched; the copy has one Goals allocation with both shares", () => {
    const S = old(), pid = S.people[0].id, snap = JSON.stringify(S);
    const T = combineGoalPots(S);
    assert.equal(JSON.stringify(S), snap);
    close(T.accounts.find(x => x.role === "goals").split[pid], 0.15);
    assert.equal(T.accounts.filter(x => x.role === "personalGoals").length, 0);
    assert.equal(T.mode, "solo");
  });
  test("every goal keeps its saved amount, target, deadline, account, icon, and the same money per year", () => {
    const S = old(), pid = S.people[0].id, C0 = compute(S, TODAY), T = combineGoalPots(S), C1 = compute(T, TODAY);
    close(C1.tot.pct[pid], C0.tot.pct[pid]);
    close(C1.pool.goals.t, C0.pool.goals.t + C0.pool.personalGoals[pid]);
    const was = { House: C0.gj.eff[0], Car: C0.gj.eff[1], Guitar: C0.gp[pid].eff[0] };
    T.goals.joint.forEach((g, i) => close(C1.gj.eff[i], was[g.name], 1e-6));
    const gu = T.goals.joint.find(g => g.id === "p1");
    assert.deepEqual({ ...gu, split: undefined, pos: undefined }, { id: "p1", name: "Guitar", target: 1500, saved: 200, account: "Savings", deadline: "2027-05-01", split: undefined, pos: undefined });
    assert.equal(T.goals.joint.find(g => g.id === "j1").icon, "home");
    close(C1.nw.net, C0.nw.net); close(C1.pool.spending, C0.pool.spending); close(C1.pool.emergency, C0.pool.emergency); close(C1.pool.invest, C0.pool.invest);
  });
  test("the preview lists every goal before and after, and says they match", () => {
    const P = combinePreview(old(), TODAY);
    assert.deepEqual(P.rows.map(r => r.name).sort(), ["Car", "Guitar", "House"]);
    assert.equal(P.same, true); close(P.poolBefore, P.poolAfter);
  });
  test("never offered for a household with two people", () => {
    const S = old(); addPerson(S, { name: "Madi" });
    assert.equal(goalPotsToCombine(S), null);
  });
});
