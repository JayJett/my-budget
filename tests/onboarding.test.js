import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { suggestSplit, buildBudget, splitTotal, emergencyTarget, householdIncome } from "../js/model/onboarding.js";
import { compute } from "../js/model/calc.js";
import { toStored, fromStored } from "../js/model/schema.js";
import { TODAY } from "./fixtures.js";

const couple = (extra = {}) => ({
  purpose: "household",
  people: [{ name: "Ana", pay: 2000, freq: "fortnightly" }, { name: "Ben", pay: 4000, freq: "monthly" }],
  have: { savings: 5000, emergency: 2000, kiwisaver: 20000, investments: null, debts: [] },
  ...extra,
});
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe("suggested split", () => {
  for (const purpose of ["household", "solo", "saving", "debt", "family"]) {
    for (const emergency of [0, 1e6]) {
      test(`always adds up to 100% (${purpose}, emergency fund ${emergency ? "covered" : "empty"})`, () => {
        const s = suggestSplit(couple({ purpose, have: { emergency, debts: [{ name: "Card", balance: 3000 }] } }));
        assert.equal(splitTotal(s.buckets), 100);
        assert.ok(s.buckets.every(b => b.pct >= 0));
      });
    }
  }

  test("a household starts from 50 / 15 / 10 / 10 / 10 / 5", () => {
    const s = suggestSplit(couple());
    assert.deepEqual(Object.fromEntries(s.buckets.map(b => [b.key, b.pct])), { essentials: 50, fun: 15, emergency: 10, goals: 10, invest: 10, personalGoals: 5 });
  });

  test("paying off debt: investing pauses and that money goes to debt", () => {
    const s = suggestSplit(couple({ purpose: "debt", have: { debts: [{ name: "Car loan", balance: 8000 }] } }));
    const by = Object.fromEntries(s.buckets.map(b => [b.key, b.pct]));
    assert.equal(by.invest, 0); assert.equal(by.debt, 10);
    assert.equal(s.debtTotal, 8000);
  });

  test("'paying off debt' with no debts entered doesn't add a debt bucket", () => {
    const s = suggestSplit(couple({ purpose: "debt" }));
    assert.ok(!s.buckets.some(b => b.key === "debt"));
  });

  test("an emergency fund that already covers 3 months frees up its 10%", () => {
    // Income: 2000×26 + 4000×12 = $100,000 a year → essentials 50% → 3 months = $12,500
    assert.equal(emergencyTarget(couple().people, "household"), 12500);
    const s = suggestSplit(couple({ have: { emergency: 12500 } }));
    const by = Object.fromEntries(s.buckets.map(b => [b.key, b.pct]));
    assert.equal(by.emergency, 0); assert.equal(by.goals, 15); assert.equal(by.invest, 15);
    assert.ok(s.efCovered);
  });

  test("saving for something leans towards goals; families towards essentials", () => {
    assert.equal(suggestSplit(couple({ purpose: "saving" })).buckets.find(b => b.key === "goals").pct, 15);
    assert.equal(suggestSplit(couple({ purpose: "family" })).buckets.find(b => b.key === "essentials").pct, 55);
  });

  test("every suggestion comes with plain-language reasons", () => {
    assert.ok(suggestSplit(couple()).why.length >= 2);
  });
});

describe("building the budget from the answers", () => {
  test("people, pay frequencies and a split that reaches 100% for everyone", () => {
    const a = couple();
    const s = buildBudget(a, suggestSplit(a), TODAY);
    assert.deepEqual(s.people.map(p => [p.name, p.pay, p.freq]), [["Ana", 2000, "fortnightly"], ["Ben", 4000, "monthly"]]);
    const C = compute(s, TODAY);
    s.people.forEach(p => close(C.tot.pct[p.id], 1));
    close(C.incTotal, householdIncome(a.people));
    assert.equal(C.issues.budget.length, 0, "nothing to fix straight after setup");
  });

  test("the split is in proportion to income", () => {
    const a = couple(), s = buildBudget(a, suggestSplit(a), TODAY), C = compute(s, TODAY);
    assert.equal(C.fairVerdict.t, "You’re splitting in proportion to income");
  });

  test("the built-in accounts the other tabs rely on all exist", () => {
    const a = couple(), s = buildBudget(a, suggestSplit(a), TODAY);
    for (const role of ["spending", "emergency", "goals", "invest"]) assert.equal(s.accounts.filter(x => x.role === role).length, 1, role);
    s.people.forEach(p => {
      assert.equal(s.accounts.filter(x => x.role === "personalGoals" && x.owner === p.id).length, 1);
      assert.ok(s.accounts.some(x => x.owner === p.id && /Spending money/.test(x.name)));
    });
  });

  test("what you already have becomes Net worth", () => {
    const a = couple({ have: { savings: 5000, emergency: 2000, kiwisaver: 20000, investments: 3000, debts: [{ name: "Student loan", balance: 15000 }, { name: "", balance: null }] } });
    const s = buildBudget(a, suggestSplit(a), TODAY);
    assert.deepEqual(s.nw.accounts.map(x => [x.name, x.type, x.balance]),
      [["Savings", "Savings", 5000], ["Emergency Fund", "Savings", 2000], ["KiwiSaver", "Super", 20000], ["Investments", "Investment", 3000], ["Student loan", "Debt", 15000]]);
    assert.equal(s.nw.reviewed, "2026-03-01");
    close(compute(s, TODAY).nw.net, 5000 + 2000 + 20000 + 3000 - 15000);
  });

  test("the emergency fund goal targets 3 months of essentials", () => {
    const a = couple(), s = buildBudget(a, suggestSplit(a), TODAY);
    assert.equal(s.goals.ef.target, 12500);
    assert.equal(s.goals.ef.saved, 2000);
    assert.equal(s.goals.ef.account, "Emergency Fund");
  });

  test("saving for something creates the goal, funded by everyone", () => {
    const a = couple({ purpose: "saving", goal: { name: "House deposit", target: 60000, deadline: "2029-01-01" } });
    const s = buildBudget(a, suggestSplit(a), TODAY);
    assert.equal(s.goals.joint.length, 1);
    const g = s.goals.joint[0];
    assert.equal(g.name, "House deposit"); assert.equal(g.target, 60000); assert.equal(g.account, "Savings");
    s.people.forEach(p => assert.equal(g.split[p.id], 1));
    const C = compute(s, TODAY);
    assert.ok(C.gj.eff[0] > 0, "money flows to the goal");
  });

  test("just me: one person, shown in their own pay period", () => {
    const a = { purpose: "solo", people: [{ name: "Sol", pay: 1200, freq: "weekly" }], have: {} };
    const s = buildBudget(a, suggestSplit(a), TODAY);
    assert.equal(s.people.length, 1);
    assert.equal(s.viewAs, "week");
    close(compute(s, TODAY).tot.pct[s.people[0].id], 1);
  });

  test("tweaked percentages are used as given", () => {
    const a = couple(), split = suggestSplit(a);
    split.buckets.find(b => b.key === "essentials").pct = 45;
    split.buckets.find(b => b.key === "invest").pct = 15;
    const s = buildBudget(a, split, TODAY);
    assert.equal(s.accounts.find(x => x.role === "spending").split[s.people[0].id], 0.45);
    assert.equal(s.accounts.find(x => x.role === "invest").split[s.people[1].id], 0.15);
  });

  test("the result saves and loads cleanly", () => {
    const a = couple({ purpose: "debt", have: { debts: [{ name: "Card", balance: 900 }] } });
    const s = buildBudget(a, suggestSplit(a), TODAY);
    assert.deepEqual(fromStored(toStored(s)), s);
  });

  test("blank people are ignored, and at most 4 are kept", () => {
    const a = { purpose: "family", people: [{ name: "A", pay: 1 }, { name: "", pay: null }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }], have: {} };
    const s = buildBudget(a, suggestSplit(a), TODAY);
    assert.deepEqual(s.people.map(p => p.name), ["A", "B", "C", "D"]);
    assert.equal(new Set(s.people.map(p => p.colour)).size, 4, "everyone gets their own colour");
  });
});
