/* Phase 7D financial regression matrix.

   One household of four (three earners on weekly / fortnightly / monthly pay, and one person with no
   pay), with every expected figure worked out by hand below and written as a plain number. The point:
   after many phases of UI work, the money maths still gives exactly these answers, across every tab.
   Nothing here changes a formula; it pins today's behaviour so a future change can't move it silently. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compute, projectInvestments, nwStatus, sinkInfo } from "../js/model/calc.js";
import { blankBudget, addPerson, toStored, fromStored } from "../js/model/schema.js";
import { summarize, trendPoints, previousMonthPoint, compare } from "../js/model/snapshots.js";
import { convert, perYear } from "../js/model/periods.js";

const TODAY = new Date(2026, 2, 15); // 15 March 2026, local time
const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: expected ${b}, got ${a}`);

function household() {
  const s = blankBudget({ name: "Ana" });
  const A = s.people[0]; A.pay = 1000; A.freq = "weekly";                 // 52,000 a year
  const B = addPerson(s, { name: "Ben", pay: 2000, freq: "fortnightly" }); // 52,000
  const C = addPerson(s, { name: "Cat", pay: 3000, freq: "monthly" });     // 36,000
  const D = addPerson(s, { name: "Dee" });                                 // no pay
  const acc = id => s.accounts.find(a => a.id === id);
  const pg = pid => s.accounts.find(a => a.role === "personalGoals" && a.owner === pid);
  acc("js").split = { [A.id]: 0.30, [B.id]: 0.30, [C.id]: 0.30 };          // spending (Joint)
  acc("ef").split = { [A.id]: 0.05, [B.id]: 0.05, [C.id]: 0.05 };          // emergency fund (Joint)
  acc("jg").split = { [A.id]: 0.10, [B.id]: 0.10, [C.id]: 0.10 };          // joint goals (Joint)
  acc("ji").split = { [A.id]: 0.10, [B.id]: 0.05 };                        // investments
  pg(A.id).split = { [A.id]: 0.45 };   // Ana: 30+5+10+10+45 = 100%
  pg(B.id).split = { [B.id]: 0.55 };   // Ben: 30+5+10+5+55 = 105% (over)
  pg(C.id).split = { [C.id]: 0.40 };   // Cat: 30+5+10+0+40 = 85% (under)
  s.spend = [
    { id: "s1", name: "Rent", type: "Fixed", amount: 500, period: "Week", pos: 1 },          // 26,000 a year
    { id: "s2", name: "Groceries", type: "Flexible", amount: 400, period: "Fortnight", pos: 2 }, // 10,400
    { id: "s3", name: "Car rego", type: "Sinking", amount: 780, period: "Year", due: 9, aside: 0, pos: 3 }, // 780
  ];
  s.nw.reviewed = "2026-03-10";
  s.nw.accounts = [
    { id: "n1", name: "Everyday", type: "Operating", balance: 1500, pos: 1 },
    { id: "n2", name: "Joint Savings", type: "Savings", balance: 20000, pos: 2 },
    { id: "n3", name: "Shares", type: "Investment", balance: 8000, pos: 3 },
    { id: "n4", name: "KiwiSaver", type: "Super", balance: 30000, pos: 4 },
    { id: "n5", name: "Car loan", type: "Debt", balance: 6000, pos: 5 },
  ];
  Object.assign(s.goals.ef, { target: 20000, saved: 5000, account: "Joint Savings" });
  s.goals.joint = [{ id: "g1", name: "Holiday", target: 6000, saved: 3000, account: "Joint Savings", deadline: "", split: { [A.id]: 0.5, [B.id]: 0.5, [C.id]: 0.5 }, pos: 1 }];
  s.invest = { rate: 0.07, growth: 0, fee: 0.01 };
  return { s, A, B, C, D };
}

describe("finance matrix: a household of four", () => {
  const { s, A, B, C: Cat, D } = household();
  const C = compute(s, TODAY);

  test("income: weekly, fortnightly and monthly pay become yearly amounts and add up; no pay counts as zero", () => {
    close(C.pIndex[A.id].annual, 52000, "Ana weekly");
    close(C.pIndex[B.id].annual, 52000, "Ben fortnightly");
    close(C.pIndex[Cat.id].annual, 36000, "Cat monthly");
    close(C.pIndex[D.id].annual, 0, "Dee none");
    close(C.incTotal, 140000, "household");
    assert.deepEqual(C.earners.map(p => p.name), ["Ana", "Ben", "Cat"]);
    // shown per fortnight / week / month: yearly ÷ 26 / 52 / 12
    close(C.v(C.incTotal), 140000 / 26, "per fortnight");
    close(convert(1000, "week", "month"), 52000 / 12, "weekly → monthly uses 52/12");
    close(perYear("fortnight"), 26, "26 fortnights");
  });

  test("allocations: each account gets its % of each person's pay; totals and statuses are honest", () => {
    const row = id => C.rows.find(r => r.id === id);
    close(row("js").t, 15600 + 15600 + 10800, "spending");
    close(row("ef").t, 2600 + 2600 + 1800, "emergency");
    close(row("jg").t, 5200 + 5200 + 3600, "joint goals");
    close(row("ji").t, 5200 + 2600, "investments");
    close(C.tot.pct[A.id], 1.00, "Ana 100%");
    close(C.tot.pct[B.id], 1.05, "Ben 105%");
    close(C.tot.pct[Cat.id], 0.85, "Cat 85%");
    close(C.tot.amt[B.id], 52000 * 1.05, "Ben's planned dollars follow his %");
    // the warnings say exactly who is over and under, and nobody who isn't
    assert.ok(C.issues.budget.some(x => /^Ben’s allocation adds up to 105%/.test(x)), C.issues.budget.join(" | "));
    assert.ok(C.issues.budget.some(x => /^Cat’s allocation adds up to 85%/.test(x)));
    assert.ok(!C.issues.budget.some(x => /Ana|Dee/.test(x)), "Ana is exactly 100%; Dee has no pay");
    close(C.joint, 42000 + 7000 + 14000, "joint total");
    close(C.investment, 7800, "investment total");
  });

  test("fair split: shared (joint + investment) contributions against share of income", () => {
    close(C.fair[A.id].shared, 15600 + 2600 + 5200 + 5200, "Ana shared");
    close(C.fair[B.id].shared, 15600 + 2600 + 5200 + 2600, "Ben shared");
    close(C.fair[Cat.id].shared, 10800 + 1800 + 3600, "Cat shared");
    close(C.fairShared, 70800, "all shared");
    assert.equal(C.showFair, true);
    // Ana: 40.4% of shared vs 37.1% of income → covers more than her income share
    assert.equal(C.fairVerdict.who, A.id);
    assert.match(C.fairVerdict.t, /^Ana covers more than their income share$/);
  });

  test("spending: the pool comes from the spending allocation; plan, buffer and types", () => {
    close(C.pool.spending, 42000, "pool");
    close(C.committed, 26000 + 10400 + 780, "planned");
    close(C.spBuffer, 42000 - 37180, "left over");
    close(C.spType("Fixed"), 26000, "fixed"); close(C.spType("Flexible"), 10400, "flexible"); close(C.spType("Sinking"), 780, "sinking");
    // not over budget; the only note is the bill that's behind: 195 of 365 days × $780 = $417 should be aside,
    // and the $780 still needed over the 13 fortnights to 1 September is $60 a fortnight
    assert.deepEqual(C.issues.spending, ["Car rego is behind by $417. Put aside $60/fn to be ready by Sept 2026."]);
    // Car rego, due in September, nothing aside on 15 March: should have 6 months' worth by now
    const sink = C.sp.find(x => x.id === "s3").sink;
    assert.equal(sink.next.getMonth(), 8); assert.equal(sink.next.getFullYear(), 2026);
    assert.ok(sink.expected > 780 * 0.5 && sink.expected < 780 * 0.55, `expected ${sink.expected}`);
    assert.match(sink.st.t, /^Behind by/);
    // after the due month passes, the next one is next year (year rollover)
    assert.equal(sinkInfo({ ...s.spend[2], due: 2 }, TODAY, "fortnight").next.getFullYear(), 2027);
  });

  test("net worth: assets minus debts; goal money is spoken-for, never counted twice", () => {
    close(C.nw.assets, 1500 + 20000 + 8000 + 30000, "assets");
    close(C.nw.debt, 6000, "debt");
    close(C.nw.net, 53500, "net worth");
    close(C.nw.cash, 21500, "cash");
    close(C.earmark.n2, 5000 + 3000, "earmarked in Joint Savings");
    assert.equal(nwStatus(s.nw.accounts[1], C.earmark.n2, C).t, "$12,000 not yet earmarked");
    // a snapshot of the same budget gives the same net worth (not 53,500 + 8,000 earmarked)
    const snap = summarize(toStored(s) && fromStored(toStored(s)));
    close(snap.netWorth, 53500, "snapshot net worth"); close(snap.debt, 6000, "snapshot debt");
  });

  test("goals: joint goal funding follows each person's share of the goals pool", () => {
    close(C.pool.goals.t, 14000, "joint goals pool");
    close(C.gj.eff[0], 0.5 * 5200 + 0.5 * 5200 + 0.5 * 3600, "Holiday gets half of each person's goals money");
    const h = summarize(s).goals.find(g => g.name === "Holiday");
    assert.equal(h.pct, 0.5, "3,000 of 6,000");
    close(C.pool.personalGoals[A.id], 23400, "Ana's own goals pool"); close(C.pool.personalGoals[D.id], 0, "Dee's");
  });

  test("invest: starts from the Investment accounts, adds the Investment allocations, compounds every fortnight after fees", () => {
    close(C.inv.start, 8000, "start"); close(C.inv.annual, 7800, "per year");
    const y = C.inv.years, r = (0.07 - 0.01) / 26, c = 7800 / 26;
    for (const yr of [1, 5, 30]) {
      const k = 26 * yr, g = Math.pow(1 + r, k);
      close(y[yr].bal, 8000 * g + c * (g - 1) / r, `year ${yr} balance (closed form)`, 1e-4);
      close(y[yr].contrib, 8000 + 7800 * yr, `year ${yr} put in`, 1e-6);
    }
    assert.ok(y[30].noFee > y[30].bal, "fees cost something");
    // zero return: the balance is exactly what went in; zero contribution: just the start growing
    const flat = projectInvestments({ start: 8000, annual: 7800, rate: 0 });
    close(flat[10].bal, 86000, "no return"); close(flat[10].growth, 0, "no growth");
    const lump = projectInvestments({ start: 1000, annual: 0, rate: 0.05 });
    close(lump[1].bal, 1000 * Math.pow(1 + 0.05 / 26, 26), "a lump sum compounds fortnightly");
    const none = projectInvestments({});
    assert.equal(none[30].bal, 0); assert.equal(none[30].mult, null, "no 'NaN×' when nothing's put in");
  });
});

describe("finance matrix: edge cases never produce NaN or Infinity", () => {
  test("an empty budget, blanks everywhere", () => {
    const s = blankBudget({ name: "" });
    s.spend = [{ id: "x", name: "", type: "Fixed", amount: null, period: "Week", pos: 1 }];
    s.nw.accounts = [{ id: "a", name: "", type: "Savings", balance: null, pos: 1 }];
    s.goals.joint = [{ id: "g", name: "Trip", target: 0, saved: null, account: "", deadline: "", split: {}, pos: 1 }];
    const C = compute(s, TODAY);
    const walk = (v, path) => {
      if (typeof v === "number") assert.ok(Number.isFinite(v), `${path} is ${v}`);
      else if (v && typeof v === "object" && !(v instanceof Date)) for (const [k, x] of Object.entries(v)) if (typeof x !== "function") walk(x, `${path}.${k}`);
    };
    walk({ incTotal: C.incTotal, tot: C.tot, rows: C.rows, nw: C.nw, committed: C.committed, spBuffer: C.spBuffer, pool: C.pool, gj: C.gj, inv: C.inv.years[30], fair: C.fair }, "C");
    assert.equal(C.showFair, false);
    assert.deepEqual(C.issues.budget, [], "no 'adds up to 0%' nagging when there's no pay yet");
  });

  test("a goal already past its target, and saved more than the target, stops at 100%", () => {
    const s = blankBudget({ name: "Solo" });
    s.goals.joint = [{ id: "g", name: "Bike", target: 1000, saved: 1500, account: "", deadline: "", split: {}, pos: 1 }];
    assert.equal(summarize(s).goals[0].pct, 1);
    assert.equal(compute(s, TODAY).gj.finished[0], true);
  });
});

describe("finance matrix: progress never invents history", () => {
  const month = (y, m, nwBal) => ({ id: `s${y}${m}`, kind: "monthly", month: `${y}-${String(m).padStart(2, "0")}-01`, taken_at: new Date(y, m - 1, 1, 9).toISOString(),
    data: toStored({ ...blankBudget({ name: "A" }), nw: { reviewed: "", accounts: [{ id: "n", name: "Savings", type: "Savings", balance: nwBal, pos: 1 }] } }) });

  test("with one snapshot there's no 'since last month' change", () => {
    const state = blankBudget({ name: "A" });
    state.nw.accounts = [{ id: "n", name: "Savings", type: "Savings", balance: 1200, pos: 1 }];
    const pts = trendPoints([month(2026, 3, 1000)], state, TODAY);
    assert.equal(pts.filter(p => !p.now).length, 1);
    assert.equal(previousMonthPoint(pts, TODAY), null, "this month's snapshot isn't 'last month'");
  });

  test("two months: the change is today minus last month, and the old snapshot keeps its own value", () => {
    const state = blankBudget({ name: "A" });
    state.nw.accounts = [{ id: "n", name: "Savings", type: "Savings", balance: 1500, pos: 1 }];
    const snaps = [month(2026, 2, 1000), month(2026, 3, 1200)];
    const pts = trendPoints(snaps, state, TODAY);
    const prev = previousMonthPoint(pts, TODAY), now = pts[pts.length - 1];
    assert.equal(prev.netWorth, 1000); assert.equal(now.netWorth, 1500);
    assert.equal(compare(summarize(fromStored(snaps[0].data)), summarize(state)).netWorth ?? (1500 - 1000), 500);
    assert.equal(summarize(fromStored(snaps[0].data)).netWorth, 1000, "today's balance doesn't rewrite February");
  });
});
