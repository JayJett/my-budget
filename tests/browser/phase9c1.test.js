/* Phase 9C.1: suggested expenses (setup step 4 and Expenses), name-only expenses that count for
   nothing until they have an amount, the small doughnuts, and the calmer Home. Uses the fake Supabase
   (no real accounts or data). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored, blankBudget } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, fake } from "./helpers.js";

setup();
const ALL_DONE = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(t => [t, "done"])) }) };
const phone = (w = 390, h = 844) => ({ device: { viewport: { width: w, height: h }, hasTouch: true, isMobile: true } });
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `p9c1-${name}.png`) });
const budgetOf = page => fake(page, () => window.__fake.budget);
const changesOf = page => fake(page, () => window.__fake.hh("hh-1").changes.length);
const tab = (page, t) => page.evaluate(t => document.querySelector(`#tabs [data-tab="${t}"]`).click(), t);
function solo(spend = []) {
  const S = blankBudget({ name: "Jarden", mode: "solo" }), p = S.people[0]; p.pay = 2000; p.payday = "2026-11-05";
  const sh = { spending: 0.5, emergency: 0.1, goals: 0.2, invest: 0.2 };
  S.accounts.forEach(a => { if (sh[a.role] != null) a.split[p.id] = sh[a.role]; });
  S.spend = spend;
  return toStored(S);
}
const pick = (page, k) => page.click(`#sheet [data-xp-pick="${k}"]`);

test("Expenses: pick, give one an amount, leave two blank; only the complete one counts", { skip }, async () => {
  const { page, errors, ctx } = await open(solo(), { ...phone(), storage: ALL_DONE, hash: "expenses", waitFor: "#app .sp-empty" });
  const before = await budgetOf(page), ch0 = await changesOf(page);
  await page.click("#app .sp-empty [data-xp-open]"); await page.waitForSelector("#sheet .xp");
  assert.equal(await page.isDisabled('#sheet [data-xp="next"]'), true, "nothing chosen yet");
  await pick(page, "rent"); await pick(page, "internet"); await pick(page, "groceries");
  assert.match(await page.textContent('#sheet [data-xp="next"]'), /Next · 3 chosen/);
  assert.equal(await page.getAttribute('#sheet [data-xp-pick="rent"]', "aria-pressed"), "true");
  await shot(page, "pick");
  await page.click('#sheet [data-xp="next"]'); await page.waitForSelector("#sheet [data-xp-amount]");
  await page.fill('#sheet [data-xp-amount="groceries"]', "200");
  assert.equal(await page.inputValue('#sheet [data-xp-period="groceries"]'), "Week");
  assert.deepEqual(await budgetOf(page), before, "nothing added before confirming");
  await shot(page, "amounts");
  await page.click('#sheet [data-xp="save"]'); await page.waitForSelector("#sheet .xp", { state: "hidden" });
  const b = await budgetOf(page), L = Object.values(b.spend);
  assert.deepEqual(L.map(e => [e.name, e.amount, e.period]).sort(), [["Groceries", 200, "Week"], ["Internet", null, "Month"], ["Rent", null, "Week"]]);
  assert.ok(L.every(e => e.need === undefined), "essential is never guessed");
  assert.equal(await changesOf(page), ch0 + 1, "one save, one Undo");
  assert.deepEqual(b.accounts, before.accounts, "allocations untouched"); assert.deepEqual(b.nw, before.nw, "balances untouched");
  await page.waitForSelector("#app .ex-row");
  assert.match(await page.textContent("#app .sp-list"), /Rent\s*Needs an amount/);
  assert.match(await page.textContent("#app .sp-sum"), /Planned\s*\$400/, "only groceries ($200 a week) is planned");
  await tab(page, "home"); await page.waitForSelector("#app .home");
  assert.match(await page.textContent(".ho-next"), /2 expenses need an amount/);
  await page.click('.ho-next [data-home-act="amounts"]');
  await page.waitForSelector('#sheet [data-l="sp"][data-f="amount"]');
  assert.deepEqual(errors, []); await ctx.close();
});

test("again later: what you have is marked; adding another is on purpose; closing asks first; bad amounts and failed saves add nothing", { skip }, async () => {
  const { page, errors, ctx } = await open(solo([{ id: "e1", name: "Rent", type: "Fixed", amount: 500, period: "Week", notes: "", due: null, aside: null, pos: 1 }]), { ...phone(), storage: ALL_DONE, hash: "expenses", waitFor: "#app .ex-row" });
  const before = await budgetOf(page);
  await page.click("#app [data-xp-open]"); await page.waitForSelector("#sheet .xp");
  assert.match(await page.textContent('#sheet [data-xp-pick="rent"]'), /Added/);
  await pick(page, "rent"); await pick(page, "gym");
  await page.click('#sheet [data-xp="close"]'); await page.waitForSelector("#dlg[open]"); await page.click("#dlgNo");
  await page.click('#sheet [data-xp="next"]');
  assert.match(await page.textContent("#sheet .xp-rows"), /Rent\s*You already have one/);
  await page.fill('#sheet [data-xp-amount="gym"]', "-5");
  await page.click('#sheet [data-xp="save"]');
  assert.match(await page.textContent("#sheet .xp-rows"), /Enter an amount above \$0, or leave it blank/);
  assert.deepEqual(await budgetOf(page), before);
  await page.fill('#sheet [data-xp-amount="gym"]', "25");
  await fake(page, () => { window.__fake.failNext = 1; });
  await page.click('#sheet [data-xp="save"]'); await page.waitForSelector("#sheet .rb-msg.bad");
  assert.deepEqual(await budgetOf(page), before, "a failed save adds nothing");
  await page.click('#sheet [data-xp="save"]'); await page.waitForSelector("#sheet .xp", { state: "hidden" });
  const L = Object.values((await budgetOf(page)).spend);
  assert.equal(L.length, 3, "the old Rent, another Rent, and Gym: no doubles from the retry");
  assert.equal(L.filter(e => e.name === "Rent").length, 2);
  assert.equal((await budgetOf(page)).spend.e1.amount, 500, "the existing one is untouched");
  assert.deepEqual(errors, []); await ctx.close();
});

test("setup step 4: optional; skipping adds nothing; choosing adds only what's picked, outside Undo", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { ...phone(), storage: ALL_DONE, hash: "", waitFor: ".ob" });
  await page.fill('[data-ob="people.0.pay"]', "2000"); await page.click('[data-obact="next"]'); await page.click('[data-obact="next"]');
  await page.waitForSelector('[data-obact="acc-exp"]');
  assert.equal(await page.locator('.ob [data-obact="acc-add"].primary').count(), 1, "adding an account is still the main button");
  await shot(page, "step4");
  await page.click('[data-obact="acc-exp"]'); await page.waitForSelector("#sheet .xp");
  await pick(page, "rent"); await pick(page, "power");
  await page.click('#sheet [data-xp="next"]'); await page.fill('#sheet [data-xp-amount="rent"]', "450");
  await page.click('#sheet [data-xp="save"]'); await page.waitForSelector(".ob-exp-done");
  assert.match(await page.textContent(".ob-exp-done"), /2 regular expenses added/);
  assert.match(await page.textContent('[data-obact="acc-skip"]'), /Done for now/);
  await page.click('[data-obact="acc-skip"]'); await page.waitForSelector(".ob-done");
  await page.click('[data-obact="finish"]'); await page.waitForSelector("#app .home");
  const L = Object.values((await budgetOf(page)).spend);
  assert.deepEqual(L.map(e => [e.name, e.amount]).sort(), [["Electricity", null], ["Rent", 450]]);
  assert.equal(await page.isVisible("#undoBtn"), false, "setting up isn't something Undo takes away");
  assert.deepEqual(errors, []); await ctx.close();
});

test("setup step 4: skipping everything adds no expenses", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { ...phone(), storage: ALL_DONE, hash: "", waitFor: ".ob" });
  await page.fill('[data-ob="people.0.pay"]', "2000"); await page.click('[data-obact="next"]'); await page.click('[data-obact="next"]');
  await page.click('[data-obact="acc-skip"]'); await page.waitForSelector(".ob-done");
  await page.click('[data-obact="finish"]'); await page.waitForSelector("#app .home");
  assert.equal(Object.keys((await budgetOf(page)).spend || {}).length, 0);
  assert.deepEqual(errors, []); await ctx.close();
});

test("doughnuts: honest parts with a text equivalent; Home is calmer; payday card has room", { skip }, async () => {
  const { page, errors, ctx } = await open(toStored(migrate(RICH_V3)), { ...phone(), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
  assert.equal(await page.locator(".ho-pay .ho-dot").count(), 0, "names, no dots");
  assert.doesNotMatch(await page.textContent("#app .home"), /every dollar given a job|From the balances you’ve entered|Planned each pay/);
  const pad = await page.$eval(".ho-pay", e => parseFloat(getComputedStyle(e).paddingLeft)); assert.ok(pad >= 22, `padding ${pad}`);
  await shot(page, "home");
  await tab(page, "budget"); await page.waitForSelector("#incDonut svg");
  const inc = await page.getAttribute("#incDonut svg", "aria-label");
  assert.match(inc, /^Share of household pay: Jarden \d+%, Madi \d+%$/);
  assert.equal([...inc.matchAll(/(\d+)%/g)].reduce((s, m) => s + Number(m[1]), 0), 100);
  assert.equal(await page.locator(".alloc .a-part").first().evaluate(e => getComputedStyle(e, "::before").display), "none", "no member dots on allocation rows");
  await shot(page, "budget");
  await page.evaluate(() => { location.hash = "#wealth/accounts"; }); await page.waitForSelector("#nwBar svg");
  const nw = await page.getAttribute("#nwBar svg", "aria-label");
  assert.match(nw, /^What you own: /); assert.doesNotMatch(nw, /Debt|owed/i, "what's owed is never a slice");
  await shot(page, "wealth");
  await tab(page, "spending"); await page.waitForSelector("#spEss svg");
  assert.match(await page.getAttribute("#spEss svg", "aria-label"), /^Planned expenses: /);
  assert.deepEqual(errors, []); await ctx.close();
});

test("320–430px: picker, doughnuts and payday card fit with nothing sideways", { skip }, async () => {
  for (const w of [320, 375, 390, 430]) {
    const { page, errors, ctx } = await open(toStored(migrate(RICH_V3)), { ...phone(w, 760), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
    for (const t of ["home", "budget", "spending"]) {
      await tab(page, t); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1), false, `${w} ${t}`);
    }
    await page.click("#app [data-xp-open]"); await page.waitForSelector("#sheet .xp");
    await pick(page, "mortgage"); await pick(page, "bodycorp"); await page.click('#sheet [data-xp="next"]');
    const r = await page.evaluate(() => { const d = document.querySelector("#sheet"); return d.scrollWidth > d.clientWidth + 1; });
    assert.equal(r, false, `${w} picker`);
    if (w === 320) await shot(page, "amounts-320");
    assert.deepEqual(errors, [], `${w}`); await ctx.close();
  }
});
