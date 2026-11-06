import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allocGoals, extraPayYears, sinkInfo, goalStatus, projectInvestments, compute } from "../js/model/calc.js";
import { blankBudget, addPerson } from "../js/model/schema.js";
import { migrate } from "../js/model/migrate.js";
import { addDays } from "../js/model/util.js";
import { RICH_V3, LIVE_V3, TODAY } from "./fixtures.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

/* ---------------- goal roll-over ---------------- */
describe("goal roll-over", () => {
  const g = (name, target, saved) => ({ name, target, saved });

  test("a finished goal passes its share to the next unfinished goal below it", () => {
    const r = allocGoals([g("A", 100, 100), g("B", 500, 0), g("C", 900, 0)], [10, 20, 30]);
    assert.deepEqual(r.eff, [0, 30, 30]);
    assert.deepEqual(r.from[1], [{ name: "A", v: 10 }]);
    assert.equal(r.to[0], "B");
    assert.equal(r.spare, 0);
  });

  test("the last goal, when finished, passes its share up instead", () => {
    const r = allocGoals([g("A", 500, 0), g("B", 100, 150)], [10, 20]);
    assert.deepEqual(r.eff, [30, 0]);
    assert.equal(r.to[1], "A");
  });

  test("it skips other finished goals and unnamed rows", () => {
    const r = allocGoals([g("A", 1, 1), g("", 100, 0), g("B", 1, 1), g("C", 50, 0)], [5, null, 7, 1]);
    assert.deepEqual(r.eff, [0, null, 0, 13]);
    assert.deepEqual(r.from[3].map(x => x.name), ["A", "B"]);
  });

  test("when every goal is finished, the money is flagged as spare", () => {
    const r = allocGoals([g("A", 1, 1), g("B", 1, 1)], [10, 20]);
    assert.equal(r.spare, 30);
    assert.deepEqual(r.to, ["", ""]);
  });

  test("a goal with no target is never 'finished'", () => {
    const r = allocGoals([g("A", null, 100), g("B", 10, 0)], [10, 20]);
    assert.deepEqual(r.eff, [10, 20]);
  });
});

/* ---------------- 27-pay (and 53-pay) years ---------------- */
describe("extra-pay years", () => {
  /** Independent check: walk every payday one by one and count per year. */
  function bruteForce(payday, step, normal, from, to) {
    const [y, m, d] = payday.split("-").map(Number);
    let p = new Date(y, m - 1, d);
    while (p.getFullYear() >= from) p = addDays(p, -step);
    const counts = {};
    while (p.getFullYear() <= to) { counts[p.getFullYear()] = (counts[p.getFullYear()] || 0) + 1; p = addDays(p, step); }
    return Object.entries(counts).filter(([Y, c]) => +Y >= from && c > normal).map(([Y, c]) => ({ year: +Y, count: c }));
  }

  test("a fortnightly payday on 1 Jan 2026 gives 27 paydays in 2026", () => {
    const r = extraPayYears("2026-01-01", "fortnightly", TODAY);
    assert.deepEqual(r[0], { year: 2026, count: 27 });
  });

  test("fortnightly results match counting every payday by hand, for many start dates", () => {
    for (const pd of ["2026-01-01", "2025-12-25", "2026-06-17", "2027-05-01", "2024-02-29", "2030-12-31"]) {
      assert.deepEqual(extraPayYears(pd, "fortnightly", TODAY), bruteForce(pd, 14, 26, 2026, 2046), pd);
    }
  });

  test("weekly pay can have 53 paydays in a year", () => {
    const r = extraPayYears("2026-01-01", "weekly", TODAY); // 1 Jan 2026 is a Thursday: 53 Thursdays
    assert.deepEqual(r[0], { year: 2026, count: 53 });
    assert.deepEqual(r, bruteForce("2026-01-01", 7, 52, 2026, 2046));
  });

  test("monthly pay never has extra paydays, and no payday means 'unknown'", () => {
    assert.deepEqual(extraPayYears("2026-01-15", "monthly", TODAY), []);
    assert.equal(extraPayYears("", "fortnightly", TODAY), null);
  });

  test("about one year in eleven has 27 fortnightly paydays", () => {
    const r = extraPayYears("2026-01-08", "fortnightly", TODAY, 40);
    assert.ok(r.length >= 3 && r.length <= 5, `got ${r.length}`);
  });
});

/* ---------------- sinking funds ---------------- */
describe("sinking funds", () => {
  const item = (fields) => ({ name: "Rego", type: "Sinking", period: "Year", amount: 1200, due: 7, aside: 300, ...fields });

  test("works out what you should have saved by now, and what's needed to catch up", () => {
    const s = sinkInfo(item(), TODAY, "fortnight");
    // From 1 Jul 2025 to 1 Mar 2026 is 243 of 365 days.
    close(s.expected, 1200 * 243 / 365, 1e-3);
    assert.equal(s.next.getMonth(), 6); assert.equal(s.next.getFullYear(), 2026);
    assert.equal(s.periodsAway, 9);              // 122 days ÷ 14 = 8.7 → 9 fortnights
    close(s.need, (1200 - 300) / 9);              // $100 a fortnight
    assert.equal(s.st.c, "bad");
  });

  test("the catch-up amount follows the household's view period", () => {
    assert.equal(sinkInfo(item(), TODAY, "month").periodsAway, 4);   // Mar→Jul is 4 months, not 5
    close(sinkInfo(item(), TODAY, "month").need, 900 / 4);
    assert.equal(sinkInfo(item(), TODAY, "week").periodsAway, 18);   // 122 ÷ 7 = 17.4 → 18
  });

  test("on track, ahead, and ready to pay", () => {
    assert.equal(sinkInfo(item({ aside: 800 }), TODAY, "fortnight").st.t, "On track");
    assert.match(sinkInfo(item({ aside: 1000 }), TODAY, "fortnight").st.t, /^Ahead by/);
    assert.equal(sinkInfo(item({ aside: 1200 }), TODAY, "fortnight").st.t, "Ready to pay");
  });

  test("a bill due this month (already passed the 1st) is next due in a year", () => {
    const s = sinkInfo(item({ due: 3 }), TODAY, "fortnight");
    assert.equal(s.next.getFullYear(), 2027);
  });

  test("only yearly Sinking items with a due month and amount are tracked", () => {
    assert.equal(sinkInfo(item({ period: "Month" }), TODAY, "fortnight"), null);
    assert.equal(sinkInfo(item({ type: "Fixed" }), TODAY, "fortnight"), null);
    assert.equal(sinkInfo(item({ due: null }), TODAY, "fortnight"), null);
    assert.equal(sinkInfo(item({ amount: 0 }), TODAY, "fortnight"), null);
  });
});

/* ---------------- goal status ---------------- */
describe("goal status", () => {
  const goal = (f) => ({ name: "Trip", target: 1000, saved: 0, deadline: "", ...f });

  test("no deadline: estimated finish date", () => {
    // $100 a fortnight → 10 fortnights → 19 Jul 2026
    assert.equal(goalStatus(goal(), 2600, false, TODAY, "fortnight").t, "ETA Jul 2026");
  });
  test("deadline that's achievable", () => {
    assert.equal(goalStatus(goal({ deadline: "2026-08-01" }), 2600, false, TODAY, "fortnight").t, "On track for Aug 2026");
  });
  test("deadline that needs more, in the household's period", () => {
    // 84 days = 6 fortnights; needs $166.67/fn, has $100 → $67 more
    assert.equal(goalStatus(goal({ deadline: "2026-05-24" }), 2600, false, TODAY, "fortnight").t, "Needs $67/fn more");
    // Same goal per week: 12 weeks, needs $83.33/wk, has $50 → $34 more
    assert.equal(goalStatus(goal({ deadline: "2026-05-24" }), 2600, false, TODAY, "week").t, "Needs $34/wk more");
  });
  test("done, missing target, missing amount, passed", () => {
    assert.equal(goalStatus(goal({ saved: 1000 }), 0, false, TODAY, "fortnight").t, "Done");
    assert.equal(goalStatus(goal({ target: null }), 0, false, TODAY, "fortnight").t, "Needs a target");
    assert.equal(goalStatus(goal(), 0, false, TODAY, "fortnight").t, "Needs a %");
    assert.equal(goalStatus(goal(), 0, true, TODAY, "fortnight").t, "Needs an amount");
    assert.equal(goalStatus(goal({ deadline: "2026-01-01" }), 2600, false, TODAY, "fortnight").t, "Deadline passed");
  });
});

/* ---------------- investments ---------------- */
describe("investment projections", () => {
  test("with no return, the balance is just what you put in", () => {
    const Y = projectInvestments({ start: 1000, annual: 2600, rate: 0 });
    close(Y[1].bal, 3600); close(Y[30].bal, 1000 + 2600 * 30); close(Y[30].growth, 0);
  });

  test("matches the standard compound-interest formula", () => {
    const start = 5000, c = 200, rate = 0.07, r = rate / 26;
    const Y = projectInvestments({ start, annual: c * 26, rate });
    for (const y of [1, 5, 10, 30]) {
      const k = 26 * y, expected = start * (1 + r) ** k + c * ((1 + r) ** k - 1) / r;
      close(Y[y].bal, expected, 1e-4);
      close(Y[y].contrib, start + c * k, 1e-6);
    }
  });

  test("fees reduce the balance, and noFee shows what you'd have without them", () => {
    const withFee = projectInvestments({ annual: 5200, rate: 0.07, fee: 0.01 });
    const noFee = projectInvestments({ annual: 5200, rate: 0.07 });
    close(withFee[30].noFee, noFee[30].bal, 1e-4);
    assert.ok(withFee[30].bal < noFee[30].bal);
    close(withFee[30].bal, projectInvestments({ annual: 5200, rate: 0.06 })[30].bal, 1e-4);
  });

  test("contributions can grow each year", () => {
    const Y = projectInvestments({ annual: 2600, rate: 0, growth: 0.1 });
    close(Y[1].contrib, 2600); close(Y[2].contrib - Y[1].contrib, 2860); close(Y[3].contrib - Y[2].contrib, 3146);
  });

  test("multiplier is blank when nothing was put in", () => {
    assert.equal(projectInvestments({})[5].mult, null);
  });
});

/* ---------------- the whole model ---------------- */
describe("compute", () => {
  test("people paid on different schedules are combined fairly", () => {
    const s = blankBudget({ name: "Ana" });
    s.people[0].freq = "weekly"; s.people[0].pay = 1000;          // $52,000 a year
    const b = addPerson(s, { name: "Ben", freq: "monthly", pay: 4000 }); // $48,000 a year
    const js = s.accounts.find(a => a.role === "spending");
    js.split[s.people[0].id] = 0.1; js.split[b.id] = 0.25;
    const C = compute(s, TODAY);
    close(C.incTotal, 100000);
    close(C.rows.find(r => r.id === "js").t, 5200 + 12000);
    s.viewAs = "fortnight"; close(compute(s, TODAY).v(17200), 661.5384615, 1e-6);
    s.viewAs = "month";     close(compute(s, TODAY).v(17200), 1433.3333333, 1e-6);
    s.viewAs = "week";      close(compute(s, TODAY).v(17200), 330.7692308, 1e-6);
  });

  test("changing the view period never changes the yearly figures", () => {
    const s = migrate(RICH_V3);
    const base = compute(s, TODAY);
    for (const v of ["week", "month"]) {
      s.viewAs = v; const C = compute(s, TODAY);
      close(C.incTotal, base.incTotal); close(C.committed, base.committed);
      close(C.inv.years[30].bal, base.inv.years[30].bal);
      assert.deepEqual(C.gj.eff, base.gj.eff);
    }
  });

  test("the fair-split check only appears with two or more earners", () => {
    const s = blankBudget({ name: "Solo" }); s.people[0].pay = 2000;
    assert.equal(compute(s, TODAY).showFair, false);
    const b = addPerson(s, { name: "Partner" });
    assert.equal(compute(s, TODAY).showFair, false, "a second person with no pay isn't an earner");
    b.pay = 1000;
    assert.equal(compute(s, TODAY).showFair, true);
  });

  test("fair-split verdicts: proportional, equal, and who covers more", () => {
    const s = blankBudget({ name: "A" }); const a = s.people[0]; a.pay = 6000; a.freq = "monthly";
    const b = addPerson(s, { name: "B", pay: 4000, freq: "monthly" });
    const js = s.accounts.find(x => x.id === "js");
    js.split = { [a.id]: 0.3, [b.id]: 0.3 };
    assert.equal(compute(s, TODAY).fairVerdict.t, "You’re splitting in proportion to income");
    js.split = { [a.id]: 0.3, [b.id]: 0.45 };
    assert.equal(compute(s, TODAY).fairVerdict.t, "You’re splitting 50/50");
    js.split = { [a.id]: 0.1, [b.id]: 0.45 };
    assert.equal(compute(s, TODAY).fairVerdict.who, b.id);
  });

  test("works for 1 to 4 people", () => {
    const s = blankBudget({ name: "One" });
    for (let k = 2; k <= 4; k++) addPerson(s, { name: "P" + k, pay: 1000 });
    assert.throws(() => addPerson(s, { name: "Five" }));
    const C = compute(s, TODAY);
    assert.equal(C.people.length, 4);
    assert.equal(Object.keys(C.gp).length, 4);
  });

  test("your live budget: 50% of Jarden's $1,000 goes to investments", () => {
    const C = compute(migrate(LIVE_V3), TODAY);
    close(C.v(C.inv.annual), 500);
    close(C.nw.net, 200000 + 50000 - 50000);
    assert.ok(C.issues.budget.some(x => x.includes("Jarden’s allocation adds up to 50%")));
  });
});

/* ---------------- same answers as version 3 ---------------- */
describe("same answers as the old version 3 maths (viewed per fortnight)", async () => {
  const { legacyCompute } = await import("./legacy-v3.js");
  for (const [label, v3] of [["rich budget", RICH_V3], ["live budget", LIVE_V3]]) {
    test(label, () => {
      const old = legacyCompute(structuredClone(v3), TODAY);
      const C = compute(migrate(v3), TODAY);
      const fn = x => C.v(x);
      old.rows.forEach(r => {
        const nr = C.rows.find(x => x.id === r.id);
        close(fn(nr.by.j), r.je); close(fn(nr.by.m), r.me); close(fn(nr.t), r.t);
      });
      close(C.tot.pct.j, old.tot.jp); close(C.tot.pct.m, old.tot.mp); close(fn(C.tot.t), old.tot.t);
      close(fn(C.joint), old.joint); close(fn(C.personal), old.personal); close(fn(C.investment), old.investment);
      close(fn(C.cash), old.cash);
      close(fn(C.pool.spending), old.pool.js); close(fn(C.pool.emergency), old.pool.ef);
      close(fn(C.pool.personalGoals.j), old.pool.jpg); close(fn(C.pool.personalGoals.m), old.pool.mpg);
      close(fn(C.committed), old.committed); close(fn(C.spBuffer), old.spBuffer); close(C.mCommitted, old.mCommitted);
      const eq = (a, b) => a.forEach((v, i) => v === null ? assert.equal(b[i], null) : close(fn(v), b[i]));
      eq(C.gj.eff, old.gj.eff); eq(C.gp.j.eff, old.gja.eff); eq(C.gp.m.eff, old.gm.eff);
      for (const y of [1, 10, 30]) close(C.inv.years[y].bal, old.inv.years[y].bal, 1e-4);
      close(C.nw.net, old.nw.net);
      const yearsOnly = r => r === null ? null : r.map(x => x.year);
      assert.deepEqual(yearsOnly(C.extraPay.j), old.p27.j);
      assert.deepEqual(yearsOnly(C.extraPay.m), old.p27.m);
      // Sinking funds: the old code measured time in milliseconds, so daylight saving could move
      // its answer by a dollar. The new code counts whole days. Same status, within $1.
      C.sp.forEach((s, i) => { const o = old.sp[i].sink; if (o) { close(s.sink.need || 0, o.need || 0, 1); assert.equal(s.sink.st.c, o.st.c); close(s.sink.expected, o.expected, 1); } });
    });
  }
});
