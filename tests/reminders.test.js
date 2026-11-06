import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { remindersFor, isoWeek, nzToday, DEFAULT_PREFS, REMINDER_TYPES } from "../js/model/reminders.js";
import { migrate } from "../js/model/migrate.js";
import { clone } from "../js/model/util.js";
import { RICH_V3, TODAY } from "./fixtures.js";

const S0 = migrate(RICH_V3); // today is 1 March 2026
const on = k => ({ [k]: true });
const keys = list => list.map(r => r.key);
const titles = list => list.map(r => r.title);

describe("everything is off unless switched on", () => {
  test("default settings give no reminders, however much needs attention", () => {
    assert.deepEqual(remindersFor(S0, DEFAULT_PREFS, TODAY), []);
    assert.deepEqual(remindersFor(S0, null, TODAY), []);
    assert.ok(Object.entries(DEFAULT_PREFS).every(([k, v]) => typeof v !== "boolean" || v === false));
  });
  test("every switch in settings has a plain-language explanation", () => {
    assert.equal(REMINDER_TYPES.length, 6);
    REMINDER_TYPES.forEach(t => { assert.ok(t.pref in DEFAULT_PREFS); assert.ok(t.help.length > 40); });
  });
  test("an empty budget gives nothing (and doesn't break)", () => {
    assert.deepEqual(remindersFor({ people: [] }, { review: true }, TODAY), []);
  });
});

describe("monthly balance review", () => {
  test("on the chosen day, once a month, pointing at Net worth", () => {
    const [r] = remindersFor(S0, on("review"), TODAY);
    assert.equal(r.key, "review:2026-03"); assert.equal(r.tab, "networth");
    assert.match(r.body, /last reviewed on 20 February/);
  });
  test("not before the chosen day; a missed day is caught up after it", () => {
    assert.deepEqual(remindersFor(S0, { review: true, review_day: 15 }, TODAY), []);
    assert.equal(remindersFor(S0, { review: true, review_day: 15 }, new Date(2026, 2, 17)).length, 1);
  });
  test("not if the balances were reviewed in the last week", () => {
    const S = clone(S0); S.nw.reviewed = "2026-02-27";
    assert.deepEqual(remindersFor(S, on("review"), TODAY), []);
  });
});

describe("yearly bills", () => {
  test("due soon: within the chosen number of weeks, once per due date", () => {
    const oct1 = new Date(2026, 9, 1); // Insurance is due 1 November: 31 days away
    const [r] = remindersFor(S0, { sink_due: true, due_weeks: 6 }, oct1);
    assert.equal(r.title, "Insurance is due in November");
    assert.equal(r.body, "That’s in about 4 weeks. It’s $1,300, and $900 is set aside so far.");
    assert.equal(r.key, "sink-due:s5:2026-11-01");
    assert.deepEqual(remindersFor(S0, { sink_due: true, due_weeks: 2 }, oct1), [], "2 weeks' warning: not yet");
  });
  test("behind: how much, and what to put aside to catch up", () => {
    const [r] = remindersFor(S0, on("sink_behind"), TODAY);
    assert.equal(r.title, "Car rego is behind by $50");
    assert.equal(r.body, "Put aside $10 a fortnight to be ready by Jul 2026.");
    assert.equal(r.key, "sink-behind:s4:2026-W09");
  });
  test("behind repeats at most weekly: same key all week, a new one next week", () => {
    const key = d => keys(remindersFor(S0, on("sink_behind"), d))[0];
    assert.equal(key(new Date(2026, 2, 2)), key(new Date(2026, 2, 8)));
    assert.notEqual(key(new Date(2026, 2, 8)), key(new Date(2026, 2, 9)));
  });
  test("once it's caught up, the reminder stops", () => {
    const S = clone(S0); S.spend.find(s => s.id === "s4").aside = 80;
    assert.deepEqual(remindersFor(S, on("sink_behind"), TODAY), []);
  });
});

describe("goals", () => {
  test("goal reached: once per goal, celebrating", () => {
    const r = remindersFor(S0, on("goal_done"), TODAY);
    assert.deepEqual(titles(r), ["🎉 Holiday is fully funded!", "🎉 Course is fully funded!"]);
    assert.equal(r[0].body, "Holiday has reached its target of $3,000. Nice work.");
    assert.equal(r[1].body, "Madi’s goal “Course” has reached its target of $900. Nice work.");
    assert.deepEqual(keys(r), ["goal-done:g1:3000", "goal-done:g5:900"]);
  });
  test("deadline at risk: how much more it needs, in the household's period", () => {
    const S = clone(S0); S.goals.joint.find(g => g.id === "g2").deadline = "2026-04-01";
    const [r] = remindersFor(S, on("goal_risk"), TODAY);
    assert.equal(r.title, "New couch might miss its deadline");
    assert.match(r.body, /^At the current rate it won’t reach \$2,000 by Apr 2026\. It needs \$[\d,]+ a fortnight more to get there\.$/);
    assert.equal(r.tab, "goals");
  });
  test("a passed deadline says so", () => {
    const S = clone(S0); S.goals.joint.find(g => g.id === "g2").deadline = "2026-02-01";
    assert.match(remindersFor(S, on("goal_risk"), TODAY)[0].body, /^The deadline \(1 Feb 2026\) has passed, and it’s \$1,800 short/);
  });
  test("goals on track, or without a deadline, give nothing", () => {
    assert.deepEqual(remindersFor(S0, on("goal_risk"), TODAY), []);
  });
});

describe("allocation", () => {
  test("someone's pay not adding up to 100%", () => {
    const S = clone(S0); S.accounts.find(a => a.id === "js").split.m = 0.4;
    const [r] = remindersFor(S, on("allocation"), TODAY);
    assert.equal(r.title, "Madi’s pay is 95% allocated");
    assert.match(r.body, /^5% of each pay has no job yet/);
    S.accounts.find(a => a.id === "js").split.j = 0.5;
    assert.match(remindersFor(S, on("allocation"), TODAY).find(x => x.key.startsWith("alloc:j")).body, /^That’s 10% more than the pay itself/);
  });
  test("100% each: nothing", () => {
    assert.deepEqual(remindersFor(S0, on("allocation"), TODAY), []);
  });
});

describe("dates", () => {
  test("ISO weeks", () => {
    assert.equal(isoWeek(new Date(2026, 0, 1)), "2026-W01");
    assert.equal(isoWeek(new Date(2027, 0, 1)), "2026-W53");
    assert.equal(isoWeek(new Date(2026, 10, 9)), "2026-W46");
  });
  test("NZ date: 1pm UTC on 31 October is already 1 November in Auckland", () => {
    const d = nzToday(new Date("2026-10-31T13:00:00Z"));
    assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], [2026, 11, 1]);
  });
});

test("the daily function's copy of the app's maths is up to date (run: node tools/sync-function.mjs)", async () => {
  const { stale } = await import("../tools/sync-function.mjs");
  assert.deepEqual(stale(), []);
});
