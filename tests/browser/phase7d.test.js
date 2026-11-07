/* Phase 7D quality pass: the fixes it made, and a cross-tab journey that checks one change flows
   through to every tab that depends on it. Uses the fake Supabase (no real data). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, open, fake, goTab, editPerson, editAccount, closeSheet, setField } from "./helpers.js";

setup();
const RICH = toStored(migrate(RICH_V3));
const PHONE = { device: { viewport: { width: 390, height: 760 } } };
const ALL_DONE = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(t => [t, "done"])) }) };
const locked = page => page.evaluate(() => document.documentElement.classList.contains("scroll-locked"));
const saved = page => fake(page, () => window.__fake.budget);

test("the browser's Back button never leaves a sheet or the menu open over another tab", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...PHONE, storage: ALL_DONE });
  await goTab(page, "networth"); await goTab(page, "budget");
  await editAccount(page, "js");
  assert.equal(await locked(page), true, "the page behind an editing sheet is held still too");
  await page.goBack();
  await page.waitForSelector('[data-tab="networth"][aria-selected="true"]');
  assert.equal(await page.evaluate(() => document.querySelector("#sheet").open), false, "sheet closed");
  assert.equal(await locked(page), false, "and the page isn't left locked");
  await page.click("#menuBtn"); await page.waitForSelector("#pop:not([hidden])");
  await page.goForward();
  await page.waitForSelector('[data-tab="budget"][aria-selected="true"]');
  await page.waitForSelector("#pop", { state: "hidden" });
  assert.equal(await locked(page), false);
  assert.deepEqual(errors, []); await ctx.close();
});

test("each tab remembers where you were; tapping the tab you're on goes back to its top", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...PHONE, storage: ALL_DONE });
  await page.evaluate(() => scrollTo(0, 600)); await page.waitForTimeout(50);
  const y = await page.evaluate(() => scrollY);
  assert.ok(y > 400);
  await goTab(page, "spending");
  assert.equal(await page.evaluate(() => scrollY), 0, "a tab you haven't scrolled starts at the top");
  await goTab(page, "budget");
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - y) < 2, "back where you were on Budget");
  await page.click('[data-tab="budget"]');
  await page.waitForFunction(() => scrollY === 0);
  assert.deepEqual(errors, []); await ctx.close();
});

test("an editing sheet holds the page still and gives you back the same place when it closes", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...PHONE, storage: ALL_DONE });
  await page.evaluate(() => scrollTo(0, 300)); await page.waitForTimeout(50);
  const y = await page.evaluate(() => scrollY);
  // tap as a finger does (Playwright's own click would scroll the page to the button first)
  await page.evaluate(() => document.querySelector('[data-edit-person="j"]').click());
  await page.waitForSelector("#sheet[open]");
  assert.equal(await locked(page), true);
  await page.mouse.move(195, 100); await page.mouse.wheel(0, 500); await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('#sheet [data-sheet="close"]').click());
  await page.waitForSelector("#sheet", { state: "hidden" });
  assert.equal(await locked(page), false);
  assert.equal(await page.evaluate(() => scrollY), y, "same place");
  assert.deepEqual(errors, []); await ctx.close();
});

test("money boxes only ever save real numbers (no Infinity), and the plan follows through every tab", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...PHONE, storage: ALL_DONE });
  await editPerson(page, "j");
  const pay = '#sheet [data-l="pp"][data-i="j"][data-f="pay"]';
  await setField(page, pay, "1e400");
  await page.waitForTimeout(400);
  const p = (await saved(page)).people.j.pay;
  assert.ok(p === null || Number.isFinite(p), `saved ${p}`);
  // the journey: Jarden's pay goes to $3,000 a fortnight → Spending's budget, Goals and Invest all follow
  await setField(page, pay, "3000");
  await closeSheet(page);
  await page.waitForFunction(() => document.querySelector("#saveText")?.textContent === "Saved");
  const b = await saved(page);
  assert.equal(b.people.j.pay, 3000);
  const { compute } = await import("../../js/model/calc.js");
  const { fromStored } = await import("../../js/model/schema.js");
  const C = compute(fromStored(b), new Date());
  const money = v => "$" + Math.round(v).toLocaleString("en-NZ");
  await goTab(page, "spending");
  assert.match(await page.textContent('[data-k="sp.pool"]'), new RegExp(money(C.v(C.pool.spending)).replace("$", "\\$")), "Spending's budget comes from the new pay");
  await goTab(page, "invest");
  assert.match(await page.textContent('[data-k="iv.per"]'), new RegExp(money(C.v(C.inv.annual)).replace("$", "\\$")), "Invest's contribution comes from the new pay");
  assert.match(await page.textContent('[data-k="iv.m30"]'), new RegExp(money(C.inv.years[30].bal).replace("$", "\\$")), "the 30-year figure is the model's");
  assert.deepEqual(errors, []); await ctx.close();
});
