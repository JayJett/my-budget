/* Phase 9C.1: suggested expenses. Only what's picked is added; a blank amount is "not yet", never $0,
   and it changes no total, coverage, essentials or rebalancing figure. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SUGGESTIONS, ALL, buildExpenses, readAmount, alreadyHas } from "../js/model/suggestions.js";
import { commitments, coverage, insights, breathingRoom } from "../js/model/intelligence.js";
import { propose } from "../js/model/rebalance.js";
import { homeFigures } from "../js/model/home.js";
import { compute } from "../js/model/calc.js";
import { blankBudget } from "../js/model/schema.js";
import { readFileSync } from "node:fs";
import { BILL_PERIODS } from "../js/model/periods.js";

const T = new Date(2026, 10, 9);
let n = 0; const ids = () => "x" + (++n);
function solo() {
  const S = blankBudget({ name: "Sam", mode: "solo" }), p = S.people[0]; p.pay = 2000; p.payday = "2026-11-05";
  const sh = { spending: 0.5, emergency: 0.1, goals: 0.2, invest: 0.2 };
  S.accounts.forEach(a => { if (sh[a.role] != null) a.split[p.id] = sh[a.role]; });
  return S;
}

test("the library: unique keys, real icons, known types and periods", () => {
  const keys = ALL.map(x => x.key); assert.equal(new Set(keys).size, keys.length);
  const icons = new Set([...readFileSync(new URL("../js/ui/icons.js", import.meta.url), "utf8").matchAll(/\{ key: "([a-z]+)", cat:/g)].map(m => m[1]));
  ALL.forEach(x => { assert.ok(icons.has(x.icon), x.icon); assert.ok(["Fixed", "Flexible", "Sinking"].includes(x.type)); assert.ok(BILL_PERIODS.includes(x.period)); assert.equal(x.need, undefined, "essential is never guessed"); });
  assert.ok(SUGGESTIONS.length >= 6);
});

test("amounts: blank is 'not yet' (null), never 0; nonsense is refused", () => {
  assert.deepEqual(readAmount(""), { ok: true, value: null });
  assert.deepEqual(readAmount("  "), { ok: true, value: null });
  assert.deepEqual(readAmount("$1,200.505"), { ok: true, value: 1200.51 });
  ["0", "-5", "abc", "Infinity"].forEach(x => assert.equal(readAmount(x).ok, false, x));
});

test("A–C: name-only, with an amount, and mixed: only complete ones count", () => {
  const S = solo();
  const B = buildExpenses(S, [{ key: "internet", amount: "" }, { key: "groceries", amount: "200", period: "Week" }, { key: "rego", amount: "" }], ids);
  assert.equal(B.ok, true);
  assert.deepEqual(B.items.map(e => [e.name, e.amount, e.period]), [["Internet", null, "Month"], ["Groceries", 200, "Week"], ["Car rego", null, "Year"]]);
  S.spend.push(...B.items);
  const C = compute(S, T), cm = commitments(S, C);
  assert.equal(cm.count, 1); assert.equal(cm.incompleteIds.length, 2);
  assert.ok(Math.abs(C.committed - 200 * 52) < 1e-9, "only groceries is planned");
  assert.equal(coverage(S, C).state, "covered");
  assert.equal(insights(S, C).find(x => x.id === "amounts").count, 2);
  assert.equal(cm.unmarkedCount, 1, "incomplete ones aren't asked to be marked");
});

test("name-only alone: no made-up coverage, no 'add your expenses', Home doesn't show a $0 Expenses tile", () => {
  const S = solo(), S0 = JSON.parse(JSON.stringify(S)); S.spend.push(...buildExpenses(S, [{ key: "rent" }, { key: "power" }], ids).items);
  const C = compute(S, T);
  assert.equal(coverage(S, C).state, "none");
  const I = insights(S, C).map(x => x.id);
  assert.ok(I.includes("amounts")); assert.ok(!I.includes("bills")); assert.ok(!I.includes("covered"));
  assert.equal(homeFigures(S, C).hasSpend, false);
  const before = breathingRoom(S0, compute(S0, T)), after = breathingRoom(S, C);
  assert.equal(after.total, before.total, "room to adjust is unchanged");
  const P = propose(S, C, { target: S.accounts[0].id, amount: 1100, from: [S.accounts[1].id] });
  const P0 = propose(S0, compute(S0, T), { target: S.accounts[0].id, amount: 1100, from: [S.accounts[1].id] });
  assert.equal(P.ok, true); assert.deepEqual(P.splits, P0.splits, "rebalancing is unchanged");
});

test("H: a bad amount adds nothing; I: ids are fixed so saving twice can't double up", () => {
  const S = solo();
  const B = buildExpenses(S, [{ key: "rent", amount: "-1" }, { key: "gym", amount: "20" }], ids);
  assert.equal(B.ok, false); assert.ok(B.errors.rent);
  const picks = [{ key: "gym", amount: "20", id: "fixed-1" }];
  assert.equal(buildExpenses(S, picks, ids).items[0].id, buildExpenses(S, picks, ids).items[0].id);
  assert.equal(buildExpenses(S, [], ids).ok, false, "nothing picked: nothing to add");
});

test("E/F: existing expenses are spotted by name; positions follow on", () => {
  const S = solo(); S.spend.push({ id: "e1", name: " rent ", type: "Fixed", amount: 500, period: "Week", pos: 7 });
  assert.equal(alreadyHas(S, "Rent"), true); assert.equal(alreadyHas(S, "Gym"), false);
  assert.equal(buildExpenses(S, [{ key: "gym" }], ids).items[0].pos, 8);
});
