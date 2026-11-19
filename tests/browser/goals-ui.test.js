/* UI phase 3, stage B: the redesigned Goals tab. The first test is the safety net: every figure the
   tab works out must be exactly what the old screen produced (tests/browser/nwgoals-baseline.json,
   recorded before the redesign) in four situations and all three periods. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, settle, fake, goTab, setField, closeSheet, editGoal, editAccount, editNetWorth } from "./helpers.js";
import { tabFigures, nwGoalsCases } from "./nwgoals-figures.mjs";

setup();
const CASES = nwGoalsCases(RICH_V3, toStored, migrate);
const BASE = JSON.parse(readFileSync(new URL("./nwgoals-baseline.json", import.meta.url), "utf8"));
const saved = page => fake(page, () => window.__fake.budget);
const goalsTab = async (budget, o = {}) => { const r = await open(budget, o); await settle(r.page); await goTab(r.page, "goals"); return r; };
const text = (page, k) => page.textContent(`[data-k="${k}"]`);
const copy = b => JSON.parse(JSON.stringify(b));

test("every Goals figure is exactly what the old screen worked out (four situations × week, fortnight, month)", { skip }, async () => {
  for (const [name, budget] of Object.entries(CASES)) {
    const now = await tabFigures("goals", budget);
    for (const period of ["week", "fortnight", "month"])
      for (const [k, v] of Object.entries(BASE.goals[name][period])) assert.equal(now[period][k], v, `${name} ${period} ${k}`);
  }
});

test("a couple: summary, emergency fund, joint and each person's goals as cards, with no form fields on the page", { skip }, async () => {
  const { page, errors, ctx } = await goalsTab(CASES.rich, { width: 390 });
  assert.equal(await text(page, "gl.saved"), "$13,200");
  assert.equal(await text(page, "gl.saved.sub"), "of $103,600 total target");
  assert.deepEqual(await page.$$eval(".gl-group h3", els => els.map(e => e.textContent)), ["Joint goals", "Jarden’s goals", "Madi’s goals"]);
  assert.equal(await page.locator(".gl-main input, .gl-main select").count(), 0);
  assert.equal(await page.locator(".viewas").isVisible(), false, "period switch belongs to Funding overview");
  assert.equal(await text(page, "g.g2.amt"), "$200 of $2,000");
  assert.match(await page.textContent('[data-edit-goal="gj"][data-i="g1"]'), /Reached[\s\S]*\$3,000 of \$3,000/);
  await editGoal(page, "gj", "g2"); await page.click("#sheet .ind-sheet-details > summary");
  assert.equal(await page.textContent('#sheet [data-k="g.g2.line"]'), "$392/fn · incl. $215 from Holiday");
  assert.equal(await page.textContent('#sheet [data-k="g.g2.st"]'), "Deadline passed");
  await closeSheet(page);
  await editGoal(page, "ef", "ef");
  assert.match(await page.textContent("#sheet .banner"), /covering 2\.5 months/);
  await closeSheet(page);
  assert.equal(await text(page, "gj.c.j"), "100%");
  assert.equal(await text(page, "gj.c.m"), "100%");
  assert.equal(await page.locator("#app .attn:not([hidden])").count(), 0);
  assert.doesNotMatch(await page.textContent("#app"), /NaN|Infinity|undefined/);
  await page.screenshot({ path: join(SHOTS, "goals-390.png"), fullPage: true });
  assert.deepEqual(errors, []); await ctx.close();
});

test("one person: no couple wording, no empty partner sections", { skip }, async () => {
  const { page, errors, ctx } = await goalsTab(CASES.mixed);
  assert.deepEqual(await page.$$eval(".gl-group h3", els => els.map(e => e.textContent)), ["Goals", "Personal goals"]);
  assert.doesNotMatch(await page.textContent("#app"), /Joint|Madi|both of you|partner/i);
  assert.equal(await text(page, "g.g1.accflag"), "Not in a savings account", "a goal kept in an everyday account is flagged");
  await editGoal(page, "ef", "ef");
  assert.match(await page.textContent("#sheet .banner"), /covering 1\.7 months/);
  assert.deepEqual(errors, []); await ctx.close();
});

test("edge cases: overfunded, no target, no plan, no spending data, no saved amount, nothing going to a pool", { skip }, async () => {
  const b = copy(CASES.mixed);
  b.goals.personal.j.g3.saved = 2000;                                  // more than the $1,500 target
  b.goals.joint.g1.target = null;                                      // no target yet
  b.goals.joint.g1.split = {}; b.goals.joint.g2.split = {};            // and nothing going to it (or passed down)
  b.spend = {};                                                        // no spending, so no months of cover
  let o = await goalsTab(b);
  assert.equal(await text(o.page, "g.g3.amt"), "$2,000 of $1,500", "the real saved amount, not clamped");
  assert.equal(await o.page.$eval('[data-k="g.g3.bar"]', e => e.style.width), "100%");
  assert.equal(await text(o.page, "g.g1.amt"), "$1,000 saved");
  await editGoal(o.page, "gj", "g1"); await o.page.click("#sheet .ind-sheet-details > summary");
  assert.equal(await o.page.textContent('#sheet [data-k="g.g1.st"]'), "Needs a target");
  assert.equal(await o.page.textContent('#sheet [data-k="g.g1.line"]'), "Nothing going to it yet");
  await closeSheet(o.page); await editGoal(o.page, "ef", "ef");
  assert.match(await o.page.textContent("#sheet .banner"), /Add spending categories/);
  await closeSheet(o.page);
  assert.equal(await text(o.page, "gj.c.j"), "100% left");
  assert.doesNotMatch(await o.page.textContent("#app"), /NaN|Infinity|undefined/);
  assert.deepEqual(o.errors, []); await o.ctx.close();
  o = await goalsTab(CASES.empty, { width: 390 });
  assert.equal(await o.page.locator(".gl-sum").count(), 0, "no zero-value dashboard in the empty state");
  assert.equal(await o.page.locator(".gl-first [data-goal-new]").count(), 1, "one clear way to add the first goal");
  assert.doesNotMatch(await o.page.textContent("#app"), /NaN|Infinity|undefined/);
  assert.deepEqual(o.errors, []); await o.ctx.close();
});

test("goal sheet: every field saves, the plan updates while editing, and over-allocating shows the existing warning", { skip }, async () => {
  const { page, errors, ctx } = await goalsTab(CASES.rich, { width: 390 });
  await editGoal(page, "gj", "g2");
  await setField(page, '#sheet [data-f="split.j"]', "70");
  await page.waitForFunction(() => document.querySelector('#sheet [data-k="gj.c.j"]').textContent === "Over 100%");
  assert.equal(await page.getAttribute('#sheet [data-f="saved"]', "inputmode"), "decimal");
  await page.fill('#sheet [data-f="name"]', "Sofa");
  await setField(page, '#sheet [data-f="saved"]', "250.5");
  await setField(page, '#sheet [data-f="target"]', "2500");
  if (!await page.locator("#sheet .ind-sheet-details").evaluate(e => e.open)) await page.click("#sheet .ind-sheet-details summary");
  await page.fill('#sheet [data-f="deadline"]', "2027-06-01");
  await closeSheet(page); await settle(page);
  const g = (await saved(page)).goals.joint.g2;
  assert.deepEqual([g.name, g.saved, g.target, g.split.j, g.deadline, g.account], ["Sofa", 250.5, 2500, 0.7, "2027-06-01", "Joint Savings"]);
  assert.equal(await text(page, "gj.c.j"), "Over 100%");
  assert.match(await page.locator(".gl-fund-alert").filter({hasText:"Goal shares exceed 100%"}).innerText(), /exceed 100%/);
  assert.equal(await text(page, "g.g2.amt"), "$250.50 of $2,500");
  // the account picker only links; no balance changes
  await editGoal(page, "gp:j", "g4");
  assert.match(await page.textContent("#sheet"), /Picking one doesn’t move any money/);
  assert.match(await page.textContent("#sheet"), /Joint Savings has \$12,000/);
  await setField(page, '#sheet [data-f="pct"]', "50");
  await closeSheet(page); await settle(page);
  assert.equal(await text(page, "gp.j.c"), "50% in reserve");
  assert.equal((await saved(page)).nw.accounts.n2.balance, 12000, "no account balance changed");
  assert.deepEqual(errors, []); await ctx.close();
});

test("emergency fund sheet: no name box or delete; suggested targets still work; cover explained", { skip }, async () => {
  const { page, errors, ctx } = await goalsTab(CASES.rich);
  await editGoal(page, "ef", "ef");
  assert.equal(await page.locator('#sheet [data-f="name"], #sheet [data-del], #sheet [data-f="pct"]').count(), 0);
  assert.match(await page.textContent("#sheet .banner"), /covering 2\.5 months of committed costs/);
  await page.click('#sheet [data-ef="3"]'); await settle(page);
  assert.equal((await saved(page)).goals.ef.target, 10645);
  await closeSheet(page);
  assert.equal(await text(page, "g.ef.amt"), "$9,000 of $10,645");
  assert.deepEqual(errors, []); await ctx.close();
});

test("add: closing a blank goal leaves nothing; the + Add goal menu picks the list; delete asks and keeps accounts", { skip }, async () => {
  const { page, errors, ctx } = await goalsTab(CASES.rich);
  await page.click('.ex-gh [data-goal-new="gj"]');
  await page.waitForSelector('#sheet [data-f="name"]:focus');
  await closeSheet(page); await settle(page);
  assert.equal(Object.keys((await saved(page)).goals.joint).length, 3, "no empty goal left behind");
  await page.click('.ind-page-head [data-goal-new="pick"]');
  assert.deepEqual(await page.$$eval("#pop [data-pick-goal] span", els => els.map(e => e.textContent)), ["Joint goals", "Jarden’s goals", "Madi’s goals"]);
  await page.click('#pop [data-pick-goal="gp:m"]');
  await page.waitForSelector('#sheet [data-f="name"]:focus');
  await page.keyboard.type("Laptop");
  await setField(page, '#sheet [data-f="target"]', "1800");
  await closeSheet(page); await settle(page);
  const lap = Object.values((await saved(page)).goals.personal.m).find(g => g.name === "Laptop");
  assert.equal(lap.target, 1800);
  await editGoal(page, "gp:m", lap.id);
  await page.click("#sheet [data-del]"); await page.click("#dlgYes");
  await page.waitForSelector("#sheet", { state: "hidden" }); await settle(page);
  const b = await saved(page);
  assert.equal(b.goals.personal.m[lap.id], undefined);
  assert.equal(Object.keys(b.nw.accounts).length, 5, "deleting a goal never touches accounts");
  assert.deepEqual(errors, []); await ctx.close();
});

test("reorder: touch-friendly up/down; the existing engine passes a finished goal's share to the new next goal", { skip }, async () => {
  const { page, errors, ctx } = await goalsTab(CASES.rich);
  await page.click("[data-reorder]");
  assert.equal(await page.locator("[data-edit-goal]").count(), 0, "cards don't open while reordering");
  assert.match(await page.textContent(".gl-main"), /Goals at the top are funded first/);
  await page.click('[data-move="up"][data-l="gj"][data-i="g3"]'); await settle(page);
  const order = Object.values((await saved(page)).goals.joint).sort((a, b) => a.pos - b.pos).map(g => g.id);
  assert.deepEqual(order, ["g1", "g3", "g2"]);
  await page.click("[data-reorder]");
  await editGoal(page, "gj", "g1");
  assert.equal(await page.textContent('#sheet [data-k="g.g1.line"]'), "Share moved to House deposit");
  assert.deepEqual(errors, []); await ctx.close();
});

test("cross-tab: Budget feeds the plan, Net worth sees goal edits, period switch only changes the display", { skip }, async () => {
  const { page, errors, ctx } = await goalsTab(CASES.rich);
  const before = await text(page, "gp.jg");
  if (!await page.isVisible(".gl-pools .viewas")) await page.click(".gl-pools > summary");
  await page.click('[data-viewas="month"]');
  assert.equal(await text(page, "gl.per"), "/mo");
  if (!await page.isVisible(".gl-pools .viewas")) await page.click(".gl-pools > summary");
  await page.click('[data-viewas="fortnight"]');
  assert.equal(await text(page, "gp.jg"), before, "switching period back and forth changes nothing");
  await goTab(page, "budget");
  await editAccount(page, "jg");
  await setField(page, '#sheet [data-f="split.j"]', "20");
  await closeSheet(page); await settle(page);
  await goTab(page, "goals");
  assert.notEqual(await text(page, "gp.jg"), before, "a bigger goals allocation on Budget raises the fund");
  await editGoal(page, "gj", "g3");
  await setField(page, '#sheet [data-f="saved"]', "1000");
  await closeSheet(page); await settle(page);
  await goTab(page, "networth");
  assert.equal(await text(page, "nw.gm.em"), "$14,200", "earmarked goes up by the new saved amount");
  assert.equal(await text(page, "nw.net"), "$45,500", "net worth is unchanged: saved money was already in the account");
  await editNetWorth(page, "n2");
  await setField(page, '#sheet [data-f="balance"]', "15000");
  await closeSheet(page); await settle(page);
  await goTab(page, "goals");
  await editGoal(page, "gj", "g3");
  assert.match(await page.textContent("#sheet"), /Joint Savings has \$15,000/);
  await closeSheet(page);
  await goTab(page, "invest");
  assert.deepEqual(errors, []); await ctx.close();
});

for (const width of [320, 375, 390, 430, 768, 1280]) {
  test(`${width}px wide: nothing sideways, amounts not clipped, the goal sheet fits`, { skip }, async () => {
    const b = copy(CASES.rich);
    b.goals.joint.g3.name = "A house deposit for the place by the beach with the big garden"; b.goals.joint.g3.target = 1234567.89;
    const { page, errors, ctx } = await goalsTab(b, { width });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const clipped = await page.$$eval(".gl-amt, .sp-head .amt, .ex-gt, .gl-pools b", els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    assert.deepEqual(clipped, [], "money is never cut off");
    await editGoal(page, "gj", "g3");
    assert.equal(await page.evaluate(() => { const s = document.querySelector("#sheet"); return s.scrollWidth > s.clientWidth + 1; }), false);
    if (width === 390) await page.screenshot({ path: join(SHOTS, "goals-sheet-390.png") });
    await closeSheet(page);
    assert.deepEqual(errors, []); await ctx.close();
  });
}

test("viewers can open a goal to look, but not change, add or reorder", { skip }, async () => {
  const init = { households: [{ id: "hh-1", name: "Mum’s budget", role: "viewer", budget: CASES.rich }] };
  const { page, errors, ctx } = await open(null, { init });
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "View only");
  await goTab(page, "goals");
  assert.equal(await page.locator("[data-goal-new], [data-reorder]").count(), 0);
  await editGoal(page, "gj", "g2");
  assert.equal(await page.isDisabled('#sheet [data-f="saved"]'), true);
  assert.equal(await page.locator("#sheet [data-del]").count(), 0);
  await closeSheet(page);
  await editGoal(page, "ef", "ef");
  assert.equal(await page.locator('#sheet [data-ef]:not([disabled])').count(), 0);
  assert.deepEqual(errors, []); await ctx.close();
});
