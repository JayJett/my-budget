/* Phase 9B: budget intelligence. The deterministic matrix from the brief (A–L), households, and the
   rule that nothing here ever changes the budget. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { commitments, coverage, essentialShare, breathingRoom, extraCost, incomeBreakdown, insights } from "../js/model/intelligence.js";
import { compute } from "../js/model/calc.js";
import { blankBudget, addPerson } from "../js/model/schema.js";
import { buildBudget, suggestSplit } from "../js/model/onboarding.js";

const T = new Date(2026, 10, 9);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
/** A solo budget: $2,000 a fortnight, the given shares (fractions) by role, and expenses. */
function solo(shares = { spending: 0.5, emergency: 0.1, goals: 0.15, invest: 0.1 }, spend = [], extra = {}) {
  const S = blankBudget({ name: "Sam", mode: "solo" }), p = S.people[0];
  p.pay = 2000; p.freq = "fortnightly"; p.payday = "2026-11-05";
  S.accounts.forEach(a => { if (shares[a.role] != null) a.split[p.id] = shares[a.role]; });
  if (shares.fun != null) S.accounts.push({ id: "fun", name: "Spending money", type: "Personal", owner: p.id, role: null, split: { [p.id]: shares.fun }, pos: 9, ...(extra.funAdj ? { adjustable: true } : {}) });
  S.spend = spend.map((x, i) => ({ id: "e" + i, name: x[0], type: x[1] || "Fixed", amount: x[2], period: x[3] || "Fortnight", notes: "", due: null, aside: null, pos: i + 1, ...(x[4] ? { need: x[4] } : {}) }));
  return S;
}
const fn = (C, annual) => annual / 26;

describe("A–C: allocation (what's planned)", () => {
  test("A: fully allocated: nothing unallocated, but adjustable parts still count", () => {
    const S = solo({ spending: 0.5, emergency: 0.1, goals: 0.1, invest: 0.1, fun: 0.2 }, [["Rent", "Fixed", 1000, "Fortnight", "essential"]], { funAdj: true });
    const C = compute(S, T), R = breathingRoom(S, C);
    close(R.parts.unallocated, 0);
    close(fn(C, R.parts.adjustable), 400, 1e-6);
    close(fn(C, R.total), 400, 1e-6);
  });
  test("B: under-allocated: the gap is unallocated pay, not called spendable", () => {
    const S = solo({ spending: 0.5, emergency: 0.1, goals: 0.1, invest: 0.1 }, [["Rent", "Fixed", 1000, "Fortnight", "essential"]]);
    const C = compute(S, T), R = breathingRoom(S, C), I = insights(S, C);
    close(fn(C, R.parts.unallocated), 400);
    assert.equal(I.find(x => x.id === "left").level, "review");
    close(fn(C, I.find(x => x.id === "left").amount), 400);
  });
  test("C: over-allocated: a problem, by how much, and no breakdown bar", () => {
    const S = solo({ spending: 0.7, emergency: 0.2, goals: 0.2, invest: 0.1 });
    const C = compute(S, T), I = insights(S, C);
    const o = I.find(x => x.id === "over"); assert.equal(o.level, "attention"); close(fn(C, o.amount), 400);
    assert.equal(incomeBreakdown(S, C), null);
    assert.ok(!I.some(x => x.id === "planned"));
  });
});

describe("D–G: expenses and their budget", () => {
  test("D: covered: the budget minus the planned expenses, called 'not yet assigned', not spare", () => {
    const S = solo(undefined, [["Rent", "Fixed", 800, "Fortnight", "essential"], ["Food", "Flexible", 120, "Fortnight", "essential"]]);
    const C = compute(S, T), cv = coverage(S, C);
    assert.equal(cv.state, "covered"); close(fn(C, cv.unassigned), 80); assert.equal(cv.allocation.id, "js");
    assert.equal(insights(S, C).find(x => x.id === "covered").level, "good");
  });
  test("E: short: planned expenses more than their budget", () => {
    const S = solo(undefined, [["Rent", "Fixed", 1120, "Fortnight", "essential"]]);
    const C = compute(S, T), cv = coverage(S, C);
    assert.equal(cv.state, "short"); close(fn(C, cv.short), 120);
    const i = insights(S, C).find(x => x.id === "short"); assert.equal(i.level, "attention"); close(fn(C, i.amount), 120);
    assert.equal(incomeBreakdown(S, C), null, "no combined bar when the parts can't add up honestly");
  });
  test("F: no expenses entered: coverage is unknown, not 'covered'", () => {
    const S = solo(), C = compute(S, T), cv = coverage(S, C);
    assert.equal(cv.state, "none");
    assert.equal(breathingRoom(S, C).parts.unassigned, 0, "the whole bills budget isn't counted as room when nothing's entered");
    assert.ok(insights(S, C).some(x => x.id === "bills"));
    assert.ok(!insights(S, C).some(x => x.id === "covered"));
  });
  test("F2: expenses but nothing allocated to them: that's said, not a made-up figure", () => {
    const S = solo({ spending: 0, emergency: 0.5, goals: 0.25, invest: 0.25 }, [["Rent", "Fixed", 500, "Fortnight"]]);
    const C = compute(S, T);
    assert.equal(coverage(S, C).state, "nobudget");
    assert.ok(insights(S, C).some(x => x.id === "nobudget" && x.level === "attention"));
  });
  test("G: unmarked expenses stay unmarked and are counted as such", () => {
    const S = solo(undefined, [["Rent", "Fixed", 800, "Fortnight", "essential"], ["Phone", "Fixed", 50, "Fortnight"], ["Fun", "Flexible", 100, "Fortnight", "flexible"]]);
    const C = compute(S, T), cm = commitments(S, C);
    close(fn(C, cm.essential), 800); close(fn(C, cm.flexible), 100); close(fn(C, cm.unmarked), 50);
    assert.equal(cm.unmarkedCount, 1); assert.deepEqual(cm.unmarkedIds, ["e1"]);
    assert.equal(S.spend[1].need, undefined, "nothing written back");
    const u = insights(S, C).find(x => x.id === "unmarked"); assert.equal(u.item, "e1");
    close(essentialShare(C, cm), 800 / 2000);
  });
});

describe("H–I: frequencies and yearly bills (the app's own conversions)", () => {
  test("H: weekly, fortnightly, monthly and yearly all become the same yearly basis", () => {
    const S = solo(undefined, [["A", "Fixed", 100, "Week", "essential"], ["B", "Fixed", 100, "Fortnight", "essential"], ["C", "Fixed", 100, "Month", "essential"], ["D", "Sinking", 1200, "Year", "essential"]]);
    const C = compute(S, T), cm = commitments(S, C);
    close(cm.essential, 100 * 52 + 100 * 26 + 100 * 12 + 1200);
    close(cm.total, C.committed, 1e-9);
  });
  test("I: a yearly bill counts once (its share each period), however much is set aside", () => {
    const S = solo(undefined, [["Rego", "Sinking", 780, "Year", "essential"]]);
    S.spend[0].due = 3; S.spend[0].aside = 500;
    const C = compute(S, T), cm = commitments(S, C), cv = coverage(S, C);
    close(cm.total, 780); close(cv.planned, 780); close(cv.sinking, 780);
  });
  test("mixed household pay: each person's own frequency, one yearly total", () => {
    const S = blankBudget({ name: "Ana", mode: "shared" }), a = S.people[0]; a.pay = 2000; a.freq = "fortnightly";
    const b = addPerson(S, { name: "Ben", pay: 4000, freq: "monthly" }), c = addPerson(S, { name: "Cat", pay: 600, freq: "weekly" });
    S.accounts.find(x => x.role === "spending").split = { [a.id]: 0.5, [b.id]: 0.5, [c.id]: 0.5 };
    S.spend = [{ id: "r", name: "Rent", type: "Fixed", amount: 2000, period: "Month", pos: 1, need: "essential" }];
    const C = compute(S, T), cv = coverage(S, C);
    close(cv.budget, 0.5 * (2000 * 26 + 4000 * 12 + 600 * 52));
    close(essentialShare(C, commitments(S, C)), 24000 / (52000 + 48000 + 31200));
  });
});

describe("J–L: missing, zero and odd values", () => {
  test("J/K: no pay: nothing divided by zero, no figures invented", () => {
    const S = blankBudget({ name: "Sam", mode: "solo" }); S.spend = [{ id: "r", name: "Rent", type: "Fixed", amount: 500, period: "Week", pos: 1 }];
    const C = compute(S, T), R = breathingRoom(S, C);
    assert.equal(essentialShare(C, commitments(S, C)), null);
    assert.equal(R.known, false); assert.equal(incomeBreakdown(S, C), null);
    assert.ok(Number.isFinite(R.total));
    assert.equal(insights(S, C)[0].id, "pay", "add your pay first");
  });
  test("L: blank or odd amounts count as nothing (the app's own rule), never NaN", () => {
    const S = solo(undefined, [["Blank", "Fixed", null], ["Text", "Fixed", "abc"], ["Neg", "Fixed", -50, "Fortnight", "essential"]]);
    const C = compute(S, T), cm = commitments(S, C);
    assert.ok([cm.total, cm.essential, cm.unmarked].every(Number.isFinite));
    close(cm.total, C.committed, 1e-9, "same total as the Expenses tab");
  });
});

describe("room to adjust: conservative, no double-counting", () => {
  test("parts don't overlap; nothing is adjustable unless marked; savings aren't assumed spare", () => {
    const S = solo({ spending: 0.5, emergency: 0.1, goals: 0.1, invest: 0.1 }, [["Rent", "Fixed", 900, "Fortnight", "essential"], ["Takeaways", "Flexible", 50, "Fortnight", "flexible"]]);
    let C = compute(S, T), R = breathingRoom(S, C);
    assert.equal(R.marked, true, "a flexible expense counts as marked");
    close(fn(C, R.parts.unallocated), 400); close(fn(C, R.parts.unassigned), 50); close(fn(C, R.parts.adjustable), 0); close(fn(C, R.parts.flexible), 50);
    close(fn(C, R.total), 500);
    S.accounts.find(a => a.role === "invest").adjustable = true;
    C = compute(S, T); R = breathingRoom(S, C);
    close(fn(C, R.parts.adjustable), 200); close(fn(C, R.total), 700);
    S.accounts.find(a => a.role === "spending").adjustable = true;
    close(fn(C, breathingRoom(S, compute(S, T)).total), 700, 1e-6, "the expenses budget is never counted as adjustable on top of its expenses");
  });
  test("the parts plus everything else add up to income exactly (the breakdown bar)", () => {
    const S = solo({ spending: 0.5, emergency: 0.1, goals: 0.1, invest: 0.1, fun: 0.1 }, [["Rent", "Fixed", 700, "Fortnight", "essential"], ["Food", "Flexible", 200, "Fortnight"]]);
    const C = compute(S, T), B = incomeBreakdown(S, C);
    close(B.reduce((s, p) => s + p.v, 0), C.incTotal, 1e-6);
    const by = Object.fromEntries(B.map(p => [p.key, fn(C, p.v)]));
    close(by.essential, 700); close(by.otherExpenses, 200); close(by.unassigned, 100); close(by.saving, 600); close(by.other, 200); close(by.unallocated, 200);
  });
  test("a new $100-a-week cost: per year, per fortnight, and whether it fits the room (changes nothing)", () => {
    const S = solo({ spending: 0.5, emergency: 0.1, goals: 0.1, invest: 0.1 }, [["Rent", "Fixed", 1000, "Fortnight", "essential"]]);
    const before = JSON.stringify(S), C = compute(S, T);
    const x = extraCost(100, "Week", S, C);
    close(x.annual, 5200); close(x.perPeriod, 200); close(fn(C, x.room), 400); assert.equal(x.fits, true);
    const y = extraCost(250, "Week", S, C); assert.equal(y.fits, false); close(fn(C, y.gap), 100);
    assert.equal(JSON.stringify(S), before, "nothing in the budget changed");
  });
  test("a shortfall is taken off before anything 'fits'", () => {
    const S = solo({ spending: 0.5, emergency: 0.1, goals: 0.1, invest: 0.1 }, [["Rent", "Fixed", 1100, "Fortnight", "essential"]]);
    const C = compute(S, T), x = extraCost(50, "Fortnight", S, C);
    close(fn(C, x.room), 300, 1e-6, "400 unallocated − 100 short");
  });
});

describe("households", () => {
  test("solo: built from one person's pay; no shared wording needed", () => {
    const a = { mode: "solo", people: [{ name: "Sam", pay: 2000, freq: "fortnightly" }], have: {} };
    const S = buildBudget(a, suggestSplit(a), T), C = compute(S, T);
    assert.equal(coverage(S, C).state, "none"); assert.equal(breathingRoom(S, C).parts.unallocated, 0);
  });
  test("shared: only the shared expenses budget covers expenses; personal money isn't counted towards them", () => {
    const a = { mode: "shared", people: [{ name: "A", pay: 2000, freq: "fortnightly" }, { name: "B", pay: 3000, freq: "monthly" }], have: {} };
    const S = buildBudget(a, suggestSplit(a), T);
    S.spend = [{ id: "r", name: "Rent", type: "Fixed", amount: 3000, period: "Month", pos: 1, need: "essential" }];
    const C = compute(S, T), cv = coverage(S, C);
    close(cv.budget, C.pool.spending);
    const personal = C.rows.filter(r => r.owner).reduce((s, r) => s + r.t, 0);
    assert.ok(personal > 0);
    close(cv.diff, C.pool.spending - 36000, 1e-6, "personal allocations play no part");
    const R = breathingRoom(S, C); close(R.parts.adjustable, 0, 1e-9, "nobody's personal money is assumed adjustable");
  });
  test("insights never change the budget, and are the same each time", () => {
    const S = solo(undefined, [["Rent", "Fixed", 800, "Fortnight"]]), before = JSON.stringify(S), C = compute(S, T);
    const a = JSON.stringify(insights(S, C)), b = JSON.stringify(insights(S, C));
    assert.equal(a, b); assert.equal(JSON.stringify(S), before);
  });
});
