/* Phase 9C: rebalancing on screen. Preview then cancel (nothing saved), apply (one save, one Undo),
   a failed save, someone else's change in the meantime, the wrong household, view-only access, and
   that balances and history are never touched. Uses the fake Supabase (no real accounts or data). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { toStored, blankBudget, addPerson } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, fake, budgetManage } from "./helpers.js";

setup();
const ALL_DONE = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(t => [t, "done"])) }) };
const phone = (w = 390, h = 844) => ({ device: { viewport: { width: w, height: h }, hasTouch: true, isMobile: true } });
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `p9c-${name}.png`) });
const budgetOf = page => fake(page, () => window.__fake.budget);
const changesOf = page => fake(page, () => window.__fake.hh("hh-1").changes.length);
const tab = (page, t) => page.evaluate(t => document.querySelector(`#tabs [data-tab="${t}"]`).click(), t);
/** Solo, fully allocated: $2,000 a fortnight; Spending 50%, EF 10%, Goals 15%, Investments 10%, Fun money 15%.
    Rent $1,215.31 a fortnight, so expenses are $215.31 over their $1,000 budget. */
function solo(rent = 1215.31) {
  const S = blankBudget({ name: "Jarden", mode: "solo" }), p = S.people[0]; p.pay = 2000; p.payday = "2026-11-05";
  const sh = { spending: 0.5, emergency: 0.1, goals: 0.15, invest: 0.1 };
  S.accounts.forEach(a => { if (sh[a.role] != null) a.split[p.id] = sh[a.role]; });
  S.accounts.push({ id: "fun", name: "Fun money", type: "Personal", owner: p.id, role: null, split: { [p.id]: 0.15 }, pos: 9, icon: "star", colour: "rose" });
  S.spend = [{ id: "e0", name: "Rent", type: "Fixed", amount: rent, period: "Fortnight", notes: "", due: null, aside: null, pos: 1, need: "essential" }];
  S.nw.accounts = [{ id: "n1", name: "Savings", type: "Savings", balance: 5000, pos: 1 }];
  return toStored(S);
}
const pid = S => Object.keys(S.people)[0];
const sheetText = page => page.textContent("#sheet .rb");
const amt = async (page, v) => { await page.fill("#sheet [data-rb-amount]", v); };

test("the expense shortfall: Adjust budget opens a preset proposal; preview, then apply as one change; Undo puts it back", { skip }, async () => {
  const { page, errors, ctx } = await open(solo(), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
  const before = await budgetOf(page), p = pid(before), changes0 = await changesOf(page);
  assert.match(await page.textContent("#planCheck .pc-acts"), /Review expenses\s*Adjust budget/, "both choices: fix the expenses, or the plan");
  await page.click('#planCheck [data-rb-open="fix"]'); await page.waitForSelector("#sheet .rb");
  assert.equal(await page.inputValue("#sheet [data-rb-target]"), "js");
  assert.equal(await page.inputValue("#sheet [data-rb-amount]"), "1215.31");
  assert.match(await sheetText(page), /\$215\.31\/fn\s*still to find/, "fully allocated: the money has to come from somewhere");
  assert.equal(await page.isDisabled('#sheet [data-rb="apply"]'), true);
  assert.match(await sheetText(page), /Investments[\s\S]*Unchanged/, "nothing is picked for you");
  await page.check('#sheet [data-rb-from="fun"]');
  assert.match(await sheetText(page), /✓ Balanced/);
  assert.match(await sheetText(page), /Spending\s*\$1,000 → \$1,215\.31\s*\+\$215\.31\/fn/);
  assert.match(await sheetText(page), /Fun money\s*\$300 → \$84\.69\s*−\$215\.31\/fn/);
  assert.match(await sheetText(page), /Plan\s*100% allocated/);
  assert.match(await sheetText(page), /Expenses\s*\$215\.31\/fn short → Entered expenses covered/);
  assert.deepEqual(await budgetOf(page), before, "the preview saves nothing");
  await shot(page, "preview");
  await page.click('#sheet [data-rb="apply"]');
  await page.waitForSelector("#sheet .rb", { state: "hidden" });
  const after = await budgetOf(page);
  assert.ok(Math.abs(after.accounts.js.split[p] - 1215.31 / 2000) < 1e-9);
  assert.ok(Math.abs(after.accounts.fun.split[p] - 84.69 / 2000) < 1e-9);
  assert.equal(await changesOf(page), changes0 + 1, "one entry in history");
  assert.deepEqual(after.nw, before.nw, "balances untouched"); assert.deepEqual(after.spend, before.spend, "expenses untouched");
  assert.equal(after.accounts.fun.icon, "star"); assert.equal(after.accounts.fun.colour, "rose");
  assert.match(await page.textContent("#planCheck .pc-main"), /Your expenses are covered/);
  await page.waitForSelector("#undoBtn:not([hidden])");
  await page.click("#undoBtn");
  await page.waitForFunction(() => window.__fake.budget.accounts.fun.split[Object.keys(window.__fake.budget.people)[0]] === 0.15);
  assert.equal((await budgetOf(page)).accounts.js.split[p], 0.5, "Undo restores both together");
  assert.deepEqual(errors, []); await ctx.close();
});

test("preview and cancel: nothing saved; closing with changes asks first", { skip }, async () => {
  const { page, errors, ctx } = await open(solo(1000), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
  const before = await budgetOf(page), saves = () => fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops").length), saves0 = await saves();
  await budgetManage(page, "rebalance"); await page.waitForSelector("#sheet .rb");
  await page.selectOption("#sheet [data-rb-target]", "ji");
  await amt(page, "250");
  await page.check('#sheet [data-rb-from="fun"]'); await page.check('#sheet [data-rb-from="jg"]');
  assert.match(await sheetText(page), /✓ Balanced/);
  // proportional: Fun $300 and Goals $300 give $25 each
  assert.match(await sheetText(page), /Fun money\s*\$300 → \$275/); assert.match(await sheetText(page), /Goals\s*\$300 → \$275/);
  assert.match(await sheetText(page), /Goals\s*\$25\/fn less going here/, "less saving is said plainly");
  // an exact amount from one of them
  await page.fill('#sheet [data-rb-manual="fun"]', "40");
  assert.match(await sheetText(page), /Fun money\s*\$300 → \$260/); assert.match(await sheetText(page), /Goals\s*\$300 → \$290/);
  await shot(page, "sources");
  await page.click('#sheet .sheet-head [data-rb="close"]');
  await page.waitForSelector("#dlg[open]");
  assert.match(await page.textContent("#dlg"), /Discard this rebalance/);
  await page.click("#dlgNo"); assert.equal(await page.isVisible("#sheet .rb"), true, "Keep it: still there");
  await page.click('#sheet .sheet-head [data-rb="close"]'); await page.click("#dlgYes");
  await page.waitForSelector("#sheet .rb", { state: "hidden" });
  assert.deepEqual(await budgetOf(page), before);
  assert.equal(await saves(), saves0, "no save was sent");
  // closing without any change: no question
  await budgetManage(page, "rebalance"); await page.waitForSelector("#sheet .rb");
  await page.click('#sheet .sheet-head [data-rb="close"]'); await page.waitForSelector("#sheet .rb", { state: "hidden" });
  assert.equal(await page.isVisible("#dlg"), false);
  assert.deepEqual(errors, []); await ctx.close();
});

test("a failed save: nothing changes, the proposal stays to try again", { skip }, async () => {
  const { page, errors, ctx } = await open(solo(), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
  const before = await budgetOf(page);
  await page.click('#planCheck [data-rb-open="fix"]'); await page.waitForSelector("#sheet .rb");
  await page.check('#sheet [data-rb-from="fun"]');
  await fake(page, () => { window.__fake.failNext = 1; });
  await page.click('#sheet [data-rb="apply"]');
  await page.waitForSelector("#sheet .rb-msg.bad");
  assert.match(await sheetText(page), /Couldn’t apply the changes, so nothing was changed/);
  assert.deepEqual(await budgetOf(page), before);
  assert.doesNotMatch(await page.textContent("body"), /Budget rebalanced/);
  await page.click('#sheet [data-rb="apply"]'); await page.waitForSelector("#sheet .rb", { state: "hidden" });
  assert.notDeepEqual(await budgetOf(page), before);
  assert.deepEqual(errors, []); await ctx.close();
});

test("someone else changed the budget meanwhile: nothing is overwritten; the preview updates and asks again", { skip }, async () => {
  const { page, errors, ctx } = await open(solo(), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
  const p = pid(await budgetOf(page));
  await page.click('#planCheck [data-rb-open="fix"]'); await page.waitForSelector("#sheet .rb");
  await page.check('#sheet [data-rb-from="fun"]');
  const changes0 = await changesOf(page);
  // Madi (in another browser) moves 5% from Fun money to Goals; no live update reaches us
  await page.evaluate(p => { const h = window.__fake.hh("hh-1"); h.budget.accounts.fun.split[p] = 0.1; h.budget.accounts.jg.split[p] = 0.2; h.seq++; }, p);
  await page.click('#sheet [data-rb="apply"]');
  await page.waitForSelector("#sheet .rb-msg.warn");
  assert.match(await sheetText(page), /changed by someone else/);
  assert.equal(await changesOf(page), changes0, "nothing saved");
  assert.equal((await budgetOf(page)).accounts.jg.split[p], 0.2, "their change stands");
  assert.match(await sheetText(page), /Fun money\s*\$200 → \$0/, "the preview is worked out again from the new budget");
  assert.match(await sheetText(page), /\$15\.31\/fn\s*still to find/);
  await page.check('#sheet [data-rb-from="jg"]');
  await page.click('#sheet [data-rb="apply"]'); await page.waitForSelector("#sheet .rb", { state: "hidden" });
  const b = await budgetOf(page);
  // $215.31 in proportion to what each gives now ($200 and $400): $71.77 and $143.54
  assert.ok(Math.abs(b.accounts.fun.split[p] - 128.23 / 2000) < 1e-9); assert.ok(Math.abs(b.accounts.jg.split[p] - 256.46 / 2000) < 1e-9);
  assert.deepEqual(errors, []); await ctx.close();
});

test("a proposal can't be applied to another household; view-only people don't see it", { skip }, async () => {
  const init = { households: [
    { id: "hh-1", name: "Ours", role: "owner", budget: solo() },
    { id: "hh-2", name: "Mum’s", role: "viewer", budget: solo() },
  ] };
  const { page, errors, ctx } = await open(null, { ...phone(), storage: ALL_DONE, init, hash: "budget", waitFor: "#planCheck" });
  await page.click('#planCheck [data-rb-open="fix"]'); await page.waitForSelector("#sheet .rb");
  await page.check('#sheet [data-rb-from="fun"]');
  await page.evaluate(async () => { const { app } = await import("./js/ui/ctx.js"); app.household.id = "hh-2"; });
  await page.click('#sheet [data-rb="apply"]');
  await page.waitForSelector("#sheet .rb-msg.bad");
  assert.match(await sheetText(page), /different household/);
  assert.deepEqual(await fake(page, () => window.__fake.hh("hh-1").changes.length + window.__fake.hh("hh-2").changes.length), 0);
  await page.evaluate(async () => { const { app } = await import("./js/ui/ctx.js"); app.household.id = "hh-1"; });
  await page.click('#sheet [data-rb="close"]'); await page.click("#dlgYes").catch(() => {});
  await page.waitForSelector("#sheet .rb", { state: "hidden" });
  // the view-only household
  await page.click("#hhBtn"); await page.click('#hhPop [data-switch="hh-2"]');
  await page.waitForFunction(() => /Mum/.test(document.querySelector("#brandNames").textContent));
  await tab(page, "budget"); await page.waitForSelector("#planCheck");
  assert.equal(await page.locator("[data-rb-open]").count(), 0);
  assert.deepEqual(errors, []); await ctx.close();
});

test("shared household: a joint increase is split as they pay in now; each person's part comes from their own plan", { skip }, async () => {
  const S = blankBudget({ name: "Jarden", mode: "shared" }); addPerson(S, { name: "Madi" });
  const [j, m] = S.people; j.pay = 2900; j.payday = "2026-11-05"; m.pay = 1200; m.freq = "weekly"; m.payday = "2026-11-06";
  const set = (role, a, b) => { const acc = S.accounts.find(x => x.role === role); acc.split[j.id] = a; acc.split[m.id] = b; };
  set("spending", 0.4, 0.4); set("emergency", 0.1, 0.1); set("goals", 0.1, 0.2); set("invest", 0.2, 0.1);
  S.accounts.filter(a => a.role === "personalGoals").forEach(a => { a.split = {}; });
  S.accounts.push({ id: "pj", name: "Jarden spending", type: "Personal", owner: j.id, role: null, split: { [j.id]: 0.2 }, pos: 20 });
  S.accounts.push({ id: "pm", name: "Madi spending", type: "Personal", owner: m.id, role: null, split: { [m.id]: 0.2 }, pos: 21 });
  const { page, errors, ctx } = await open(toStored(S), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
  await budgetManage(page, "rebalance"); await page.waitForSelector("#sheet .rb");
  // Spending is $1,160 + $960 = $2,120 a fortnight; +$212 shared as now (Jarden 1160:960 Madi)
  await amt(page, "2332");
  assert.equal(await page.locator("#sheet [data-rb-who]").count(), 5, "As now, By pay, Equally, Jarden only, Madi only");
  await page.check('#sheet [data-rb-from="pj"]'); await page.check('#sheet [data-rb-from="pm"]');
  const t = await sheetText(page);
  assert.match(t, /✓ Balanced/);
  assert.match(t, /Spending[\s\S]*Jarden \+\$116 · Madi \+\$96/);
  assert.match(t, /Jarden spending[\s\S]{0,40}\$580 → \$464/);
  assert.match(t, /Madi spending[\s\S]{0,40}\$480 → \$384/);
  await shot(page, "shared");
  await page.check('#sheet [data-rb-who][value="' + j.id + '"]');
  assert.match(await sheetText(page), /Jarden spending[\s\S]{0,40}\$580 → \$368/);
  assert.doesNotMatch(await sheetText(page), /Madi spending[\s\S]{0,40}\$480 →/, "Madi's plan isn't touched");
  await page.click('#sheet [data-rb="apply"]'); await page.waitForSelector("#sheet .rb", { state: "hidden" });
  const b = await budgetOf(page);
  assert.ok(Math.abs(b.accounts.pj.split[j.id] - 368 * 26 / (2900 * 26)) < 1e-9);
  assert.equal(b.accounts.pm.split[m.id], 0.2);
  assert.deepEqual(errors, []); await ctx.close();
});

test("320–430px: the sheet fits, the Apply button stays on screen, nothing scrolls sideways", { skip }, async () => {
  for (const w of [320, 375, 390, 430]) {
    const { page, errors, ctx } = await open(solo(), { ...phone(w, 700), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
    await page.click('#planCheck [data-rb-open="fix"]'); await page.waitForSelector("#sheet .rb");
    await page.check('#sheet [data-rb-from="fun"]'); await page.check('#sheet [data-rb-from="jg"]');
    const r = await page.evaluate(() => {
      const d = document.querySelector("#sheet"), b = d.querySelector('[data-rb="apply"]').getBoundingClientRect();
      return { side: d.scrollWidth > d.clientWidth + 1, page: document.scrollingElement.scrollWidth > innerWidth + 1, applyIn: b.bottom <= innerHeight + 1 && b.top >= 0 };
    });
    assert.deepEqual(r, { side: false, page: false, applyIn: true }, `${w}`);
    if (w === 320) await shot(page, "320");
    assert.deepEqual(errors, [], `${w}`); await ctx.close();
  }
});

test("Home: the shortfall step opens the same fix on Budget", { skip }, async () => {
  const { page, errors, ctx } = await open(solo(), { ...phone(), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
  assert.match(await page.textContent(".ho-next"), /Planned expenses are over their budget[\s\S]*Adjust your plan or trim expenses/);
  await page.click('.ho-next [data-home-act="short"]');
  await page.waitForSelector("#sheet .rb");
  assert.equal(await page.inputValue("#sheet [data-rb-amount]"), "1215.31");
  assert.deepEqual(errors, []); await ctx.close();
});
