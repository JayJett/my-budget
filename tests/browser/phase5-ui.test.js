/* UI phase 5: your look (colour, light/dark, spacing) saved per person, item icons saved on the item,
   and a little cheer only for real progress you just made. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, settle, fake, goTab, setField, closeSheet, editGoal, editExpense } from "./helpers.js";

setup();
const RICH = toStored(migrate(RICH_V3));
const saved = page => fake(page, () => window.__fake.budget);
const look = page => page.evaluate(() => ({ theme: document.documentElement.dataset.theme || "auto", compact: document.body.classList.contains("compact"), accent: document.documentElement.dataset.accent || "mint" }));
const appearance = async page => { await page.click("#menuBtn"); await page.click('[data-act="appearance"]'); await page.waitForSelector(".acc-picker"); };
const updates = page => fake(page, () => window.__fake.authCalls.filter(c => c.name === "updateUser").map(c => c.data));

test("appearance: colour, light/dark and spacing in one sheet, saved to your login, kept after reload, reset on sign-out", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { width: 390 });
  await settle(page);
  await appearance(page);
  await page.screenshot({ path: join(SHOTS, "appearance-390.png") });
  await page.click('[data-look="theme"][data-v="dark"]');
  await page.click('[data-look="density"][data-v="compact"]');
  await page.click('[data-accent-pick="amber"]');
  assert.deepEqual(await look(page), { theme: "dark", compact: true, accent: "amber" }, "changes straight away");
  assert.equal(await page.getAttribute('[data-look="theme"][data-v="dark"]', "aria-checked"), "true");
  await page.waitForFunction(() => window.__fake.authCalls.some(c => c.name === "updateUser"));
  assert.deepEqual(await updates(page), [{ theme: "dark", density: "compact", accent: "amber" }], "one save for all three");
  assert.equal((await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops").length)), 0, "nothing about the household's budget changed");
  await closeSheet(page);
  await page.reload(); await settle(page);
  assert.deepEqual(await look(page), { theme: "dark", compact: true, accent: "amber" }, "kept after reload");
  await page.click("#menuBtn"); await page.click('[data-act="signout"]');
  await page.waitForSelector("#fSignin");
  assert.deepEqual(await look(page), { theme: "auto", compact: false, accent: "mint" }, "the sign-in screen is back to the defaults");
  assert.deepEqual(errors, []); await ctx.close();
});

test("appearance: your login's look wins; another person's look on this device is never used; an old device setting carries over once", { skip }, async () => {
  let o = await open(null, { init: { budget: RICH, meta: { theme: "light", density: "compact" } }, storage: { "mb-accent-u-other": JSON.stringify({ accent: "coral", theme: "dark" }) } });
  await settle(o.page);
  assert.deepEqual(await look(o.page), { theme: "light", compact: true, accent: "mint" });
  assert.deepEqual(await updates(o.page), [], "nothing to send");
  await o.ctx.close();
  // someone who chose Dark on this device before looks were saved per person keeps it, and it's saved to their login
  o = await open(null, { init: { budget: RICH }, storage: { "jm-budget-prefs": JSON.stringify({ theme: "dark", density: "comfortable" }) } });
  await settle(o.page);
  assert.equal((await look(o.page)).theme, "dark");
  await o.page.waitForFunction(() => window.__fake.authCalls.some(c => c.name === "updateUser"));
  assert.deepEqual(await updates(o.page), [{ theme: "dark" }]);
  assert.deepEqual(o.errors, []); await o.ctx.close();
});

test("goal icons: chosen in the goal sheet, saved on the goal for the household, back to default any time", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { width: 390 });
  await settle(page); await goTab(page, "goals");
  const card = () => page.$eval('[data-edit-goal="gj"][data-i="g2"]', el => [".gl-name", ".gl-amt", ".gl-foot", ".gl-pc"].map(s => el.querySelector(s).textContent));
  const figures = await card();
  await editGoal(page, "gj", "g2");
  await page.click("#sheet .ico-box summary");
  await page.click('#sheet [data-icon="home"]');
  await settle(page);
  assert.equal((await saved(page)).goals.joint.g2.icon, "home");
  assert.equal(await page.getAttribute('#sheet [data-icon="home"]', "aria-checked"), "true");
  await page.screenshot({ path: join(SHOTS, "goal-icon-390.png") });
  await closeSheet(page);
  assert.equal(await page.locator('[data-edit-goal="gj"][data-i="g2"] .gl-ic svg').count(), 1, "the card shows the icon");
  assert.deepEqual(await card(), figures, "and every figure is the same");

  await editGoal(page, "gj", "g2");
  await page.click("#sheet .ico-box summary");
  await page.click('#sheet [data-icon=""]');
  await settle(page);
  assert.equal((await saved(page)).goals.joint.g2.icon, undefined, "Default removes it");
  await closeSheet(page);
  assert.equal((await page.textContent('[data-edit-goal="gj"][data-i="g2"] .gl-ic')).trim(), "N", "back to its first letter");
  assert.deepEqual(errors, []); await ctx.close();
});

test("expense icons: only how it looks; the type, amount and every figure stay the same", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH);
  await settle(page); await goTab(page, "spending");
  const before = await page.textContent(".sp-page");
  await editExpense(page, "s3");
  await page.click("#sheet .ico-box summary");
  await page.click('#sheet [data-icon="basket"]');
  await settle(page); await closeSheet(page);
  const s3 = (await saved(page)).spend.s3;
  assert.deepEqual([s3.icon, s3.type, s3.amount, s3.period], ["basket", "Flexible", 300, "Fortnight"]);
  assert.equal(await page.textContent(".sp-page"), before, "no figure or wording changed");
  assert.deepEqual(errors, []); await ctx.close();
});

test("viewers see icons but can't change them", { skip }, async () => {
  const b = JSON.parse(JSON.stringify(RICH)); b.goals.joint.g2.icon = "car";
  const init = { households: [{ id: "hh-1", name: "Mum’s budget", role: "viewer", budget: b }] };
  const { page, errors, ctx } = await open(null, { init });
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "View only");
  await goTab(page, "goals");
  assert.equal(await page.locator('[data-edit-goal="gj"][data-i="g2"] .gl-ic svg').count(), 1);
  await editGoal(page, "gj", "g2");
  await page.click("#sheet .ico-box summary");
  assert.equal(await page.isDisabled('#sheet [data-icon="home"]'), true);
  assert.deepEqual(errors, []); await ctx.close();
});

test("a cheer for real progress you just made: halfway, then reached; never on reload", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH);
  await settle(page); await goTab(page, "goals");
  await editGoal(page, "gj", "g2");                                   // New couch: $200 of $2,000
  await setField(page, '#sheet [data-f="saved"]', "1000");
  await page.waitForFunction(() => /New couch is halfway there/.test(document.querySelector("#toast").textContent));
  await setField(page, '#sheet [data-f="saved"]', "1200");
  await page.waitForTimeout(300);
  assert.match(await page.textContent("#toast"), /halfway/, "no new message for a small step");
  await setField(page, '#sheet [data-f="saved"]', "2000");
  await page.waitForFunction(() => /New couch reached its target/.test(document.querySelector("#toast").textContent));
  await closeSheet(page);
  await page.waitForFunction(() => window.__fake.budget.goals.joint.g2.saved === 2000);
  await page.waitForFunction(() => !document.querySelector("#toast.on"));
  await goTab(page, "budget"); await goTab(page, "goals");                // drawing the tab again doesn't cheer again
  await page.waitForTimeout(400);
  assert.equal(await page.isVisible("#toast.on"), false);
  assert.match(await page.textContent('[data-edit-goal="gj"][data-i="g2"]'), /Reached/);
  // opening the app with goals already reached celebrates nothing
  const b = JSON.parse(JSON.stringify(RICH)); b.goals.joint.g2.saved = 2000;
  const o = await open(b); await settle(o.page); await goTab(o.page, "goals"); await o.page.waitForTimeout(500);
  assert.equal(await o.page.isVisible("#toast.on"), false, "old achievements aren't celebrated");
  await o.ctx.close();
  assert.deepEqual(errors, []); await ctx.close();
});

for (const width of [320, 390, 768]) {
  test(`${width}px: the appearance sheet and icon picker fit`, { skip }, async () => {
    const { page, errors, ctx } = await open(RICH, { width });
    await settle(page);
    await appearance(page);
    assert.equal(await page.evaluate(() => { const s = document.querySelector("#sheet"); return s.scrollWidth > s.clientWidth + 1; }), false);
    await closeSheet(page);
    await goTab(page, "goals"); await editGoal(page, "gj", "g2"); await page.click("#sheet .ico-box summary");
    assert.equal(await page.evaluate(() => { const s = document.querySelector("#sheet"); return s.scrollWidth > s.clientWidth + 1; }), false);
    const small = await page.$$eval("#sheet .ico-pick button, .acc-sw", els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width < 40 || r.height < 40; }).length);
    assert.equal(small, 0, "every choice is big enough to tap");
    assert.deepEqual(errors, []); await ctx.close();
  });
}
