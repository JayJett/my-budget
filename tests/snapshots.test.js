import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { summarize, summarizeSnapshot, trendPoints, previousMonthPoint, progressNotes, goalNote, compare, changeWords, diffText, isGood } from "../js/model/snapshots.js";
import { toStored, fromStored } from "../js/model/schema.js";
import { migrate } from "../js/model/migrate.js";
import { compute } from "../js/model/calc.js";
import { clone } from "../js/model/util.js";
import { RICH_V3, TODAY } from "./fixtures.js";

const NOW = migrate(RICH_V3);                    // today's budget
/** A snapshot as the database would store it, with some balances changed. */
function snap(month, changes = {}, kind = "monthly") {
  const s = clone(NOW);
  for (const [id, bal] of Object.entries(changes.nw || {})) s.nw.accounts.find(a => a.id === id).balance = bal;
  for (const [id, saved] of Object.entries(changes.goals || {})) {
    const all = [s.goals.ef, ...s.goals.joint, ...Object.values(s.goals.personal).flat()];
    all.find(g => g.id === id).saved = saved;
  }
  const d = toStored(s);
  return { id: Math.random(), month, kind, taken_at: `${month}T01:00:00+13:00`, data: { version: 4, people: d.people, nw: d.nw, goals: d.goals } };
}

describe("totals", () => {
  test("match the Net worth tab exactly", () => {
    const s = summarize(NOW), C = compute(NOW, TODAY);
    assert.equal(s.netWorth, C.nw.net); assert.equal(s.cash, C.nw.cash);
    assert.equal(s.investments, C.nw.inv); assert.equal(s.super, C.nw.sup); assert.equal(s.debt, C.nw.debt);
  });
  test("a stored snapshot gives the same totals as the budget it came from", () => {
    assert.deepEqual(summarizeSnapshot(snap("2026-02-01")), summarize(NOW));
  });
  test("goals: emergency fund, joint and each person's, with progress", () => {
    const g = summarize(NOW).goals;
    assert.deepEqual(g.map(x => [x.name, x.group]), [["Emergency Fund", "Emergency fund"], ["Holiday", "Joint"], ["New couch", "Joint"], ["House deposit", "Joint"], ["Bike", "Jarden’s"], ["Course", "Madi’s"], ["Camera", "Madi’s"]]);
    assert.equal(g.find(x => x.name === "Holiday").pct, 1);
    assert.equal(g.find(x => x.name === "New couch").pct, 0.1);
  });
  test("an empty or half-filled snapshot doesn't break anything", () => {
    const s = summarizeSnapshot({ data: { people: {}, nw: {}, goals: {} } });
    assert.equal(s.netWorth, 0); assert.deepEqual(s.goals, []); assert.deepEqual(s.accounts, []);
  });
});

describe("trends", () => {
  const snaps = [
    snap("2025-12-01", { nw: { n2: 10000, n5: 7000 } }),
    snap("2026-01-01", { nw: { n2: 11000, n5: 6500 }, goals: { g2: 0 } }),
    snap("2026-01-01", { nw: { n2: 11500, n5: 6500 } }, "manual"),     // later in January: replaces the monthly one on the chart
    snap("2026-02-01", { nw: { n2: 11760, n5: 6200 }, goals: { g2: 100 } }),
  ];
  snaps[2].taken_at = "2026-01-20T09:00:00+13:00";

  test("one point per month (the latest that month), oldest first, then Now", () => {
    const p = trendPoints(snaps, NOW, TODAY);
    assert.deepEqual(p.map(x => x.label), ["Dec 25", "Jan 26", "Feb 26", "Now"]);
    assert.equal(p[1].snap.kind, "manual");
    assert.equal(p[3].now, true);
  });

  test("'since last month' compares now with the latest snapshot from an earlier month", () => {
    const p = trendPoints(snaps, NOW, TODAY);       // TODAY is 1 March 2026
    assert.equal(previousMonthPoint(p, TODAY).label, "Feb 26");
  });

  test("plain-language notes", () => {
    const p = trendPoints(snaps, NOW, TODAY);
    // Now: Joint Savings 12,000 and car loan 6,000. February: 11,760 and 6,200. Net worth +240 +200 = +440.
    const notes = progressNotes(p, TODAY);
    assert.equal(notes[0], "Net worth is up $440 since Feb 2026.");
    assert.match(notes[1], /^Since Dec 2025, it’s up \$3,000\.$/);       // +2,000 savings, −1,000 debt
    assert.equal(notes[2], "You’ve paid $200 off your debts since Feb 2026.");
  });

  test("with only a starting point, the note says so", () => {
    const p = trendPoints([snap("2026-03-01")], NOW, TODAY);
    assert.match(progressNotes(p, TODAY)[0], /starting point/);
    assert.deepEqual(progressNotes(trendPoints([], NOW, TODAY), TODAY), [], "no snapshots: no notes (the empty state explains)");
  });

  test("goal notes: how far there, and the change this month", () => {
    const p = trendPoints(snaps, NOW, TODAY), now = p[p.length - 1];
    assert.equal(goalNote(now.goals.find(g => g.id === "g2"), p, TODAY), "10% there, up $100 this month");
    assert.equal(goalNote(now.goals.find(g => g.id === "g1"), p, TODAY), "Done! No change this month.");
  });

  test("changes in words", () => {
    assert.equal(changeWords(1240), "up $1,240"); assert.equal(changeWords(-300.4), "down $300"); assert.equal(changeWords(0.2), "unchanged");
  });
});

describe("compare a snapshot with today", () => {
  test("totals, each savings account and each goal, with the difference", () => {
    const then = summarizeSnapshot(snap("2026-01-01", { nw: { n2: 11000, n5: 6500 }, goals: { g2: 0 } })), now = summarize(NOW);
    const rows = compare(then, now);
    const r = l => rows.find(x => x.label === l);
    assert.equal(r("Net worth").diff, 1000 + 500);
    assert.equal(r("Debt").diff, -500); assert.equal(isGood(r("Debt").diff, "debt"), true, "less debt is good news");
    assert.equal(r("Joint Savings").kind, "account"); assert.equal(r("Joint Savings").diff, 1000);
    assert.equal(r("New couch").kind, "goal"); assert.equal(r("New couch").diff, 200); assert.equal(r("New couch").targetNow, 2000);
    assert.equal(diffText(1000), "+$1,000"); assert.equal(diffText(-80.5), "−$80.50"); assert.equal(diffText(0), "no change");
  });

  test("accounts or goals added or removed since then still show", () => {
    const old = clone(NOW); old.nw.accounts = old.nw.accounts.filter(a => a.id !== "n2"); old.goals.joint = [];
    const rows = compare(summarize(old), summarize(NOW));
    assert.equal(rows.find(x => x.label === "Joint Savings").then, null);
    assert.equal(rows.find(x => x.label === "Holiday").then, null);
  });
});
