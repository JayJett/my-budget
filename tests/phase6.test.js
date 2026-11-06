/* Phase 6 audit: wording that assumed two people, and warnings before there's anything to warn about. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compute } from "../js/model/calc.js";
import { blankBudget } from "../js/model/schema.js";
import { migrate } from "../js/model/migrate.js";
import { RICH_V3, TODAY } from "./fixtures.js";

test("one person: warnings don't say 'joint'; a couple's still do", () => {
  const solo = blankBudget({ name: "Sam" });
  solo.people[0].pay = 1000; solo.accounts.find(a => a.role === "spending").split[solo.people[0].id] = 0.2;
  solo.spend = [{ id: "s1", name: "Rent", type: "Fixed", amount: 500, period: "Fortnight", notes: "", due: null, aside: null, pos: 1 }];
  solo.goals.ef.saved = 100;
  const I = compute(solo, TODAY).issues;
  assert.deepEqual(I.spending, ["Spending is $300 a fortnight over budget."]);
  assert.match(I.goals.join(" "), /less than 3 months of committed costs/);
  assert.doesNotMatch(JSON.stringify(I), /[Jj]oint/);
  const couple = migrate(RICH_V3); couple.spend[0].amount = 99999;
  assert.match(compute(couple, TODAY).issues.spending[0], /^Joint spending is .* over budget\.$/);
});

test("no 'review your balances' warning before there are any accounts", () => {
  const b = blankBudget({ name: "Sam" });
  assert.deepEqual(compute(b, TODAY).issues.networth, []);
  b.nw.accounts = [{ id: "a1", name: "Everyday", type: "Operating", balance: 100, pos: 1 }];
  assert.deepEqual(compute(b, TODAY).issues.networth, ["Balances haven’t been reviewed in over 30 days."]);
});

test("a new one-person budget's starting accounts aren't called 'Joint …' (existing budgets keep their names)", () => {
  assert.deepEqual(blankBudget({ name: "Sam" }).accounts.map(a => a.name), ["Spending", "Emergency Fund", "Goals", "Investments", "Sam — Personal Goals"]);
  assert.equal(migrate(RICH_V3).accounts[0].name, "Joint Spending");
});
