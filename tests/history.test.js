import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { changesBetween, invert, stateAt, describeChanges, describeEntries, groupByDay, dayLabel, whenText } from "../js/model/history.js";
import { toStored } from "../js/model/schema.js";
import { migrate } from "../js/model/migrate.js";
import { clone } from "../js/model/util.js";
import { RICH_V3 } from "./fixtures.js";

const NOW = toStored(migrate(RICH_V3));
const TZ = "Pacific/Auckland";
/** Describe what changed between the budget now and after `edit`. */
function words(edit) {
  const after = clone(NOW); edit(after);
  return describeChanges(changesBetween(NOW, after), NOW, after).map(d => d.text);
}

describe("stepping through versions", () => {
  test("invert undoes a list of changes exactly", () => {
    const b = clone(NOW); b.spend.s3.amount = 450; delete b.spend.s2; b.goals.joint.g9 = { id: "g9", name: "Boat" }; b.people.m.split = { x: 1 };
    assert.deepEqual(invert(b, changesBetween(NOW, b)), NOW);
  });
  test("stateAt steps back through every later entry, newest first", () => {
    const v1 = clone(NOW); v1.spend.s3.amount = 400;
    const v2 = clone(v1); v2.spend.s3.amount = 450; v2.note = "x";
    const v3 = clone(v2); delete v3.spend.s1;
    const entries = [{ id: 3, changes: changesBetween(v2, v3) }, { id: 1, changes: changesBetween(NOW, v1) }, { id: 2, changes: changesBetween(v1, v2) }];
    assert.deepEqual(stateAt(v3, entries, 1), v1);
    assert.deepEqual(stateAt(v3, entries, 2), v2);
    assert.deepEqual(stateAt(v3, entries, 3), v3);
  });
});

describe("plain-language changes", () => {
  test("amounts, balances and pay", () => {
    assert.deepEqual(words(s => { s.spend.s3.amount = 450; }), ["changed Groceries from $300 to $450"]);
    assert.deepEqual(words(s => { s.nw.accounts.n1.balance = 1820.5; }), ["changed the Everyday balance from $1,500 to $1,820.50"]);
    assert.deepEqual(words(s => { s.people.m.pay = 2000; }), ["changed Madi’s pay from $1,900 to $2,000"]);
    assert.deepEqual(words(s => { s.spend.s3.amount = null; }), ["cleared Groceries (was $300)"]);
    assert.deepEqual(words(s => { s.spend.s4.aside = 60; }), ["changed the amount set aside for Car rego from $30 to $60"]);
  });
  test("percentages", () => {
    assert.deepEqual(words(s => { s.accounts.js.split.m = 0.4; }), ["changed the share of Madi’s pay going to Joint Spending from 45% to 40%"]);
    assert.deepEqual(words(s => { s.accounts.js.split.m = 0.425; }), ["changed the share of Madi’s pay going to Joint Spending from 45% to 42.5%"]);
    assert.deepEqual(words(s => { delete s.accounts.ef.split.j; }), ["cleared the share of Jarden’s pay going to Emergency Fund (was 5%)"]);
    assert.deepEqual(words(s => { s.invest.rate = 0.06; }), ["changed the expected investment return from 7% to 6%"]);
    assert.deepEqual(words(s => { s.goals.joint.g2.split.m = 0.4; }), ["changed Madi’s share of the joint goals fund for New couch from 30% to 40%"]);
  });
  test("adding, removing and renaming", () => {
    assert.deepEqual(words(s => { s.spend.x1 = { id: "x1", name: "Netflix", amount: 20, pos: 9 }; }), ["added the spending category “Netflix”"]);
    assert.deepEqual(words(s => { delete s.spend.s2; }), ["removed the spending category “Power”"]);
    assert.deepEqual(words(s => { s.spend.s3.name = "Food"; }), ["renamed the spending category “Groceries” to “Food”"]);
    assert.deepEqual(words(s => { delete s.goals.personal.m.g6; }), ["removed Madi’s goal “Camera”"]);
    assert.deepEqual(words(s => { s.goals.joint.g7 = { id: "g7", name: "", pos: 7 }; }), ["added a joint goal"]);
    assert.deepEqual(words(s => { s.nw.accounts.n9 = { id: "n9", name: "Term deposit", balance: 5000 }; }), ["added the Net worth account “Term deposit”"]);
  });
  test("goals, dates and months", () => {
    assert.deepEqual(words(s => { s.goals.joint.g1.target = 3500; }), ["changed the Holiday target from $3,000 to $3,500"]);
    assert.deepEqual(words(s => { s.goals.ef.saved = 9500; }), ["changed the amount saved for the emergency fund from $9,000 to $9,500"]);
    assert.deepEqual(words(s => { s.goals.joint.g1.deadline = "2026-12-20"; }), ["set the Holiday deadline to 20 Dec 2026"]);
    assert.deepEqual(words(s => { s.spend.s4.due = 8; }), ["changed when Car rego is due from Jul to Aug"]);
    assert.deepEqual(words(s => { s.spend.s3.period = "Month"; }), ["changed Groceries from fortnightly to monthly"]);
    assert.deepEqual(words(s => { s.people.j.freq = "weekly"; }), ["changed Jarden from being paid fortnightly to weekly"]);
  });
  test("adding a person reads as one thing first, then the details", () => {
    const t = words(s => {
      s.people.p3 = { id: "p3", name: "Sam", colour: "coral", freq: "weekly", pay: 900, payday: "", pos: 3 };
      s.accounts.a3 = { id: "a3", name: "Sam — Personal Goals", type: "Personal", owner: "p3", role: "personalGoals", split: {}, pos: 9 };
      s.goals.personal.p3 = {};
    });
    assert.deepEqual(t, ["added Sam to the budget", "added the account “Sam — Personal Goals”"]);
  });
  test("reordering is said once, however many rows moved", () => {
    assert.deepEqual(words(s => { s.spend.s1.pos = 2; s.spend.s2.pos = 1; s.spend.s3.pos = 7; }), ["reordered the spending categories"]);
  });
  test("a whole box group set at once is broken down into each box", () => {
    const after = clone(NOW); after.accounts.xjs.split = { j: 0.2, m: 0.1 };
    const t = describeChanges([{ p: ["accounts", "xjs", "split"], o: NOW.accounts.xjs.split, n: after.accounts.xjs.split }], NOW, after).map(d => d.text);
    assert.deepEqual(t, ["changed the share of Jarden’s pay going to Jarden Spending from 25% to 20%", "set the share of Madi’s pay going to Jarden Spending to 10%"]);
  });
  test("anything unexpected still gets a clear general line", () => {
    assert.deepEqual(words(s => { s.spend.s3.colourful = "yes"; }), ["changed something on the Spending tab"]);
  });
});

describe("entries", () => {
  const now = new Date("2026-11-06T03:00:00Z"); // 4pm Friday 6 Nov in NZ
  const v1 = clone(NOW); v1.spend.s3.amount = 450;
  const v2 = clone(v1); v2.people.m.pay = 2000; v2.spend.s1.amount = 1250;
  const entries = [
    { id: 10, kind: "edit", changed_by: "u-madi", changed_at: "2026-11-05T01:14:00Z", changes: changesBetween(NOW, v1) },
    { id: 11, kind: "edit", changed_by: "u-me", changed_at: "2026-11-06T01:14:00Z", changes: changesBetween(v1, v2) },
    { id: 12, kind: "restore", changed_by: "u-me", changed_at: "2026-11-06T02:30:00Z", ref_at: "2026-11-05T01:14:00Z", changes: changesBetween(v2, v1) },
  ];
  const whoName = id => ({ "u-me": "You", "u-madi": "Madi" }[id] || "Someone");
  const list = describeEntries(v1, entries, { whoName, now, tz: TZ });

  test("headlines name the person, in plain language, newest first", () => {
    assert.deepEqual(list.map(e => e.headline), [
      "You restored the version from 5 Nov, 2:14pm",
      "You changed Madi’s pay from $1,900 to $2,000, and 1 other change",
      "Madi changed Groceries from $300 to $450",
    ]);
    assert.equal(list[2].time, "2:14pm");
    assert.equal(list[0].lines.length, 2, "a restore lists what it changed back");
  });
  test("grouped by day: Today, Yesterday, then dates", () => {
    assert.deepEqual(groupByDay(list).map(g => [g.day, g.entries.length]), [["Today", 2], ["Yesterday", 1]]);
    assert.equal(dayLabel("2026-11-02T01:00:00Z", now, TZ), "Mon 2 Nov");
    assert.equal(dayLabel("2025-12-24T01:00:00Z", now, TZ), "Wed 24 Dec 2025");
    assert.equal(whenText("2025-12-24T01:00:00Z", now, TZ), "24 Dec 2025, 2:00pm");
  });
  test("NZ time decides the day: 11:30pm UTC on the 5th is already the 6th in Auckland", () => {
    assert.equal(dayLabel("2026-11-05T23:30:00Z", now, TZ), "Today");
  });
  test("upgrades and imports are described simply", () => {
    const [e] = describeEntries(NOW, [{ id: 1, kind: "replace", reason: "Imported a file", changed_by: "u-madi", changed_at: now.toISOString(), changes: [] }], { whoName, now, tz: TZ });
    assert.equal(e.headline, "Madi imported a saved file");
  });
});

test("history: choosing an icon reads as a plain change to how an item looks", () => {
  const NOW = toStored(migrate(RICH_V3)), after = clone(NOW);
  after.goals.joint.g1.icon = "sun"; after.spend.s3.icon = "basket";
  const texts = describeChanges(changesBetween(NOW, after), NOW, after).map(d => d.text).join(" | ");
  assert.match(texts, /icon for Holiday/);
  assert.match(texts, /icon for Groceries/);
});
