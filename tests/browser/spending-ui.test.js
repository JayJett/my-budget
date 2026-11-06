/* UI phase 2: the redesigned Spending tab. The first test is the safety net: every figure the tab
   works out must be exactly what the old screen produced (tests/browser/spending-baseline.json,
   recorded before the redesign) in six situations and all three periods. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, settle, fake, goTab, setField, editExpense, closeSheet, editAccount } from "./helpers.js";
import { spendingFigures, spendingCases } from "./spending-figures.mjs";

setup();
const CASES = spendingCases(RICH_V3, toStored, migrate);
const BASE = JSON.parse(readFileSync(new URL("./spending-baseline.json", import.meta.url), "utf8"));
const saved = page => fake(page, () => window.__fake.budget);
const spendTab = async budget => { const o = await open(budget); await settle(o.page); await goTab(o.page, "spending"); return o; };
const text = (page, k) => page.textContent(`[data-k="${k}"]`);

test("every Spending figure is exactly what the old screen worked out (six situations × week, fortnight, month)", { skip }, async () => {
  for (const [name, budget] of Object.entries(CASES)) {
    const now = await spendingFigures(budget);
    for (const period of ["week", "fortnight", "month"])
      for (const [k, v] of Object.entries(BASE[name][period])) assert.equal(now[period][k], v, `${name} ${period} ${k}`);
  }
});

test("over budget: the shortfall leads, the bar shows where the budget ends, no repeated warning card", { skip }, async () => {
  const { page, errors, ctx } = await spendTab(CASES.over);
  assert.equal(await text(page, "sp.head"), "$157.31");
  assert.equal(await text(page, "sp.head.lab"), "over budget");
  assert.equal(await text(page, "sp.com"), "$757.31"); assert.equal(await text(page, "sp.pool"), "$600"); assert.equal(await text(page, "sp.used"), "126.2%");
  assert.equal(await page.locator("#poolsplit .half").count(), 1, "a line where the $600 budget ends");
  assert.match(await page.textContent("#poolkey"), /Over by \$157\.31/);
  assert.match(await page.getAttribute("#poolsplit", "aria-label"), /^Fixed \$500, Flexible \$250, Sinking \$7\.31\. Over budget by \$157\.31$/);
  assert.equal(await page.locator("#app .attn").count(), 0, "no separate warning card repeating it");
  await page.screenshot({ path: join(SHOTS, "spending-over.png"), fullPage: true });
  assert.deepEqual(errors, []); await ctx.close();
});

test("under budget, exactly on budget, no budget, and no expenses each read clearly (and never show NaN)", { skip }, async () => {
  for (const [name, head, lab] of [["rich", "$177.31", "remaining"], ["exact", "On budget", /matches the budget/], ["nopool", "$550", "planned"], ["empty", "$600", "remaining"]]) {
    const { page, errors, ctx } = await spendTab(CASES[name]);
    assert.equal(await text(page, "sp.head"), head, name);
    assert.match(await text(page, "sp.head.lab"), lab instanceof RegExp ? lab : new RegExp(`^${lab}$`), name);
    assert.doesNotMatch(await page.textContent("#app"), /NaN|Infinity|undefined/, name);
    if (name === "exact") assert.equal(await page.locator("#poolsplit .half").count(), 0);
    if (name === "nopool") { assert.equal(await page.isVisible(".sp-nopool"), true); assert.equal(await text(page, "sp.used"), "—"); }
    if (name === "empty") { assert.equal(await page.isVisible("text=No expenses yet"), true); assert.equal(await page.locator(".sp-empty [data-sp-new]").count(), 1); }
    assert.deepEqual(errors, [], name); await ctx.close();
  }
});

test("rows are grouped by type, show the amount per period, and sinking funds show due date, status and progress", { skip }, async () => {
  const { page, errors, ctx } = await spendTab(CASES.rich);
  assert.deepEqual(await page.$$eval(".ex-gh h3", els => els.map(e => e.textContent)), ["Fixed", "Flexible", "Sinking"]);
  assert.equal(await text(page, "sp.fixed"), "$1,283.08");
  assert.equal(await page.locator("#app input, #app select").count(), 0, "no form fields on the main screen");
  assert.equal(await text(page, "sp.s2.sub"), "$180 monthly", "billed monthly, shown per fortnight");
  assert.match(await page.textContent('[data-edit-sp="s4"]'), /Car rego[\s\S]*\$120 · due/);
  assert.equal(await page.locator('[data-edit-sp="s4"] .chip').count(), 1);
  assert.equal(await page.locator('[data-edit-sp="s4"] .ex-prog').count(), 1);
  assert.equal(await page.locator('[data-edit-sp="s1"] .ex-prog, [data-edit-sp="s1"] .chip').count(), 0, "plain expenses stay plain");
  assert.deepEqual(errors, []); await ctx.close();
});

test("expense sheet: every field saves; sinking fields only for yearly sinking bills, and switching type keeps them", { skip }, async () => {
  const { page, errors, ctx } = await spendTab(CASES.over);
  await editExpense(page, "e3");
  await setField(page, '#sheet [data-f="aside"]', "100");
  await page.waitForFunction(() => /set aside of/.test(document.querySelector('#sheet [data-k="sp.e3.saved"]').textContent));
  assert.equal(await page.textContent('#sheet [data-k="sp.e3.saved"]'), "$100 set aside of $190");
  await page.selectOption('#sheet [data-f="due"]', "12");
  await page.fill('#sheet [data-f="notes"]', "Renew online");
  await page.selectOption('#sheet [data-f="period"]', "Month");             // no longer yearly: tracking fields hide
  await page.waitForSelector('#sheet [data-f="due"]', { state: "detached" });
  assert.match(await page.textContent("#sheet"), /make this a yearly bill/);
  await page.click('#sheet label:has(input[value="Fixed"])');
  await page.waitForSelector("#sheet .bs-note", { state: "detached" });
  await settle(page);
  let e3 = (await saved(page)).spend.e3;
  assert.deepEqual([e3.type, e3.period, e3.due, e3.aside, e3.notes], ["Fixed", "Month", 12, 100, "Renew online"], "due month and set-aside are kept, not wiped");
  await page.click('#sheet label:has(input[value="Sinking"])');
  await page.selectOption('#sheet [data-f="period"]', "Year");
  assert.equal(await page.inputValue('#sheet [data-f="aside"]'), "100", "they come back when it's a yearly sinking bill again");
  await closeSheet(page);
  await settle(page);
  assert.deepEqual(errors, []); await ctx.close();
});

test("add: from a group it starts with that type; closing a blank one leaves nothing behind; delete asks first", { skip }, async () => {
  const { page, errors, ctx } = await spendTab(CASES.over);
  const before = Object.keys((await saved(page)).spend).length;
  await page.click('[data-sp-new="Fixed"]');
  await page.waitForSelector('#sheet [data-f="name"]:focus');
  assert.equal(await page.isChecked('#sheet input[value="Fixed"]'), true);
  await closeSheet(page);                                                       // changed my mind
  await settle(page);
  assert.equal(Object.keys((await saved(page)).spend).length, before, "no empty expense left behind");
  await page.click('[data-sp-new="Fixed"]');
  await page.waitForSelector('#sheet [data-f="name"]:focus');
  await page.keyboard.type("Phone plan");
  await setField(page, '#sheet [data-f="amount"]', "45");
  await page.selectOption('#sheet [data-f="period"]', "Month");
  await closeSheet(page);
  await settle(page);
  const p = Object.values((await saved(page)).spend).find(s => s.name === "Phone plan");
  assert.deepEqual([p.type, p.amount, p.period], ["Fixed", 45, "Month"]);
  assert.equal(await page.textContent(`[data-k="sp.${p.id}.v"]`), "$20.77", "$45 a month, per fortnight");
  await page.click(`[data-edit-sp="${p.id}"]`);
  await page.click("#sheet [data-del]");
  await page.click("#dlgYes");
  await page.waitForSelector("#sheet", { state: "hidden" });
  await settle(page);
  assert.equal((await saved(page)).spend[p.id], undefined);
  assert.deepEqual(errors, []); await ctx.close();
});

test("the budget comes from the Budget tab: changing that allocation updates Spending", { skip }, async () => {
  const { page, errors, ctx } = await open(CASES.over);
  await settle(page);
  await editAccount(page, "js");
  await setField(page, '#sheet [data-f="split.j"]', "80");
  await closeSheet(page);
  await goTab(page, "spending");
  assert.equal(await text(page, "sp.pool"), "$800");
  assert.equal(await text(page, "sp.head"), "$42.69"); assert.equal(await text(page, "sp.head.lab"), "remaining");
  assert.deepEqual(errors, []); await ctx.close();
});

test("reorder mode lists everything in its saved order; moves keep the order within each type", { skip }, async () => {
  const { page, errors, ctx } = await spendTab(CASES.rich);
  await page.click("[data-reorder]");
  assert.equal(await page.locator(".ex-gh").count(), 0, "one flat list while reordering");
  await page.click('[data-move="down"][data-i="s1"]');
  await settle(page);
  const order = Object.values((await saved(page)).spend).sort((a, b) => a.pos - b.pos).map(s => s.id);
  assert.deepEqual(order.slice(0, 2), ["s2", "s1"]);
  await page.click("[data-reorder]");
  assert.deepEqual(await page.locator(".ex-group").first().locator(".ex-name").allTextContents(), ["Power", "Rent"]);
  assert.deepEqual(errors, []); await ctx.close();
});

test("category colours never change with the accent; wording fits one person or a couple", { skip }, async () => {
  const { page, errors, ctx } = await spendTab(CASES.rich);
  const cat = () => page.evaluate(() => ["--cat-fixed", "--cat-flex", "--cat-sink"].map(k => getComputedStyle(document.documentElement).getPropertyValue(k).trim()));
  const before = await cat();
  await page.evaluate(() => { document.documentElement.dataset.accent = "lavender"; });
  assert.deepEqual(await cat(), before);
  assert.equal(await page.textContent(".sp-sum .eyebrow"), "Joint spending");
  await ctx.close();
  const o = await spendTab(CASES.over);
  assert.equal(await o.page.textContent(".sp-sum .eyebrow"), "Spending");
  assert.doesNotMatch(await o.page.textContent("#app"), /both of you|your partner|Joint/i);
  assert.deepEqual([...errors, ...o.errors], []); await o.ctx.close();
});

for (const width of [320, 375, 390, 430, 768, 1280]) {
  test(`${width}px wide: nothing sideways, amounts not clipped, sheets fit (long names, big amounts)`, { skip }, async () => {
    const b = JSON.parse(JSON.stringify(CASES.over));
    b.spend.e1.name = "Mortgage repayments for the house on the hill with the long driveway"; b.spend.e1.amount = 123456.78;
    b.spend.e3.notes = "A long note about the registration that goes on and on ".repeat(4);
    const { page, errors, ctx } = await open(b, { width });
    await settle(page); await goTab(page, "spending");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const clipped = await page.$$eval(".ex-amt, .sp-figs b, .sp-head .amt", els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    assert.deepEqual(clipped, [], "money is never cut off");
    await editExpense(page, "e3");
    const box = await page.locator("#sheet").boundingBox();
    assert.ok(box.x >= -1 && box.x + box.width <= width + 1);
    assert.equal(await page.evaluate(() => { const s = document.querySelector("#sheet"); return s.scrollWidth > s.clientWidth + 1; }), false);
    if (width === 390) await page.screenshot({ path: join(SHOTS, "spending-sheet-390.png") });
    await closeSheet(page);
    assert.deepEqual(errors, []); await ctx.close();
  });
}

test("viewers can open an expense to look, but not change, add or reorder", { skip }, async () => {
  const init = { households: [{ id: "hh-1", name: "Mum’s budget", role: "viewer", budget: CASES.rich }] };
  const { page, errors, ctx } = await open(null, { init });
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "View only");
  await goTab(page, "spending");
  assert.equal(await page.locator("[data-sp-new], [data-reorder]").count(), 0);
  await editExpense(page, "s4");
  assert.equal(await page.isDisabled('#sheet [data-f="amount"]'), true);
  assert.equal(await page.locator("#sheet [data-del]").count(), 0);
  assert.deepEqual(errors, []); await ctx.close();
});
