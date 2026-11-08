/* Phase 8: solo and shared budgets, the household mode, and the optional goal-pot tidy-up.
   Uses the fake Supabase (no real accounts or data). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { blankBudget, toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, fake, goTab, settle } from "./helpers.js";

setup();
const ALL_DONE = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(t => [t, "done"])) }) };
const phone = (w = 390, h = 760) => ({ device: { viewport: { width: w, height: h }, hasTouch: true, isMobile: true } });
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `p8-${name}.png`) });
const budgetOf = page => fake(page, () => window.__fake.budget);
const vals = o => Object.values(o || {});

/** Go through setup, choosing "Just me" or "With someone" on step 1. */
async function setUp(page, mode, pay = "2000") {
  await page.click('[data-obact="back"]'); // step 2 → step 1
  await page.check(`input[name="obmode"][value="${mode}"]`, { force: true });
  await page.click('[data-obact="next"]');
  await page.fill('[data-ob="people.0.pay"]', pay);
  await page.click('[data-obact="next"]');
  await page.waitForSelector(".ob-buckets");
}
async function openHousehold(page) {
  await page.click("#menuBtn"); await page.waitForSelector("#drawer:not([hidden])");
  await page.click('#drawer [data-act="household"]');
  await page.waitForSelector("#hhModeSec");
}

test("Just me: a solo plan with one Goals allocation, nothing labelled Joint, and no Undo for the setup", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob", ...phone(), storage: ALL_DONE });
  await setUp(page, "solo");
  const names = await page.$$eval(".ob-b-name b", e => e.map(x => x.textContent));
  assert.deepEqual(names, ["Bills & essentials", "Spending money", "Emergency Fund", "Goals", "Investments"]);
  assert.deepEqual(await page.$$eval(".ob-pct input", e => e.map(x => x.value)), ["50", "15", "10", "15", "10"]);
  assert.match(await page.textContent('[data-obk="tot"]'), /^100%$/);
  assert.doesNotMatch(await page.textContent(".ob-card"), /Joint|Personal Goals|each person/i);
  await shot(page, "solo-plan");
  await page.click('[data-obact="next"]'); await page.waitForSelector(".ob-done"); await page.click('[data-obact="finish"]');
  await page.waitForSelector("#app .b-income"); await settle(page);
  const b = await budgetOf(page), acc = vals(b.accounts), me = vals(b.people)[0].id;
  assert.equal(b.mode, "solo");
  assert.equal(acc.filter(a => a.type === "Joint").length, 0, "nothing shared");
  assert.equal(acc.filter(a => a.role === "personalGoals").length, 0, "no second goal pot");
  acc.filter(a => a.type !== "Investment").forEach(a => assert.equal(a.owner, me, a.name));
  // every allocation still feeds the right place
  assert.deepEqual(acc.map(a => a.role), ["spending", null, "emergency", "goals", "invest"]);
  const meta = await page.$$eval(".alloc .a-meta", e => e.map(x => x.textContent));
  meta.forEach(m => assert.doesNotMatch(m, /Joint|Personal/));
  assert.match(meta[0], /^Bills & spending · 50% of pay$/);
  assert.doesNotMatch(await page.textContent("#app"), /Joint/);
  assert.equal(await page.isVisible("#undoBtn"), false, "the plan isn't something to undo");
  // the edit sheet says "Kind: Everyday money / Investing", and changing a % still works
  await page.click('[data-edit-acc="js"]'); await page.waitForSelector("#sheet .bsheet");
  assert.deepEqual(await page.$$eval("#sheet fieldset .seg span", e => e.map(x => x.textContent)), ["Everyday money", "Investing"]);
  assert.match(await page.textContent("#sheet .bs-note"), /Feeds the Spending tab/);
  await page.fill(`#sheet [data-f="split.${me}"]`, "45"); await page.click('#sheet [data-sheet="close"]'); await settle(page);
  assert.equal((await budgetOf(page)).accounts.js.split[me], 0.45);
  await goTab(page, "spending");
  assert.equal(await page.textContent('[data-tab="spending"][aria-selected="true"] .t-l, [data-tab="spending"][aria-selected="true"]').then(t => /Joint/.test(t)), false);
  assert.deepEqual(errors, []); await ctx.close();
});

test("With someone, before they've joined: a shared plan that stays shared", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob", ...phone(), storage: ALL_DONE });
  await setUp(page, "with");
  const names = await page.$$eval(".ob-b-name b", e => e.map(x => x.textContent));
  assert.deepEqual(names, ["Bills & essentials", "Spending money", "Emergency Fund", "Joint Goals", "Joint Investments", "Personal Goals"]);
  assert.match(await page.textContent(".ob-shared-hint"), /ready for whoever joins you/);
  await page.click('[data-obact="next"]'); await page.waitForSelector(".ob-done"); await page.click('[data-obact="finish"]');
  await page.waitForSelector("#app .b-income"); await settle(page);
  const b = await budgetOf(page), acc = vals(b.accounts);
  assert.equal(b.mode, "shared");
  assert.equal(acc.find(a => a.role === "spending").type, "Joint");
  assert.equal(acc.filter(a => a.role === "personalGoals").length, 1);
  assert.match((await page.$$eval(".alloc .a-meta", e => e.map(x => x.textContent)))[0], /^Joint/);
  await openHousehold(page);
  assert.equal(await page.getAttribute('[data-hh-mode="shared"]', "aria-pressed"), "true", "one member so far, but still shared");
  assert.deepEqual(errors, []); await ctx.close();
});

test("Household settings: switching between Just me and With others changes words only, never money", { skip }, async () => {
  const s = blankBudget({ name: "Sam" }); s.people[0].pay = 2000; const pid = s.people[0].id;
  s.accounts.forEach(a => { a.split[pid] = { spending: 0.5, emergency: 0.1, goals: 0.25, invest: 0.15, personalGoals: 0 }[a.role]; });
  const { page, errors, ctx } = await open(toStored(s), { ...phone(), storage: ALL_DONE });
  const before = JSON.stringify((await budgetOf(page)).accounts);
  await openHousehold(page);
  assert.equal(await page.getAttribute('[data-hh-mode="solo"]', "aria-pressed"), "true", "an old one-person budget counts as just you");
  await page.click('[data-hh-mode="shared"]'); await settle(page);
  assert.equal((await budgetOf(page)).mode, "shared");
  assert.equal(JSON.stringify((await budgetOf(page)).accounts), before, "no allocation changed");
  await page.click('#sheet [data-sheet="close"]');
  assert.match(await page.textContent('[data-tab="spending"]'), /Spending/);
  assert.match((await page.$$eval(".alloc .a-meta", e => e.map(x => x.textContent)))[0], /^Joint/);
  await openHousehold(page);
  await page.click('[data-hh-mode="solo"]'); await settle(page);
  assert.equal((await budgetOf(page)).mode, "solo");
  assert.equal(JSON.stringify((await budgetOf(page)).accounts), before);
  assert.deepEqual(errors, []); await ctx.close();
});

test("an older solo budget with two goal pots: offered (never forced), reviewed, combined with every goal's money kept, and undoable", { skip }, async () => {
  const s = blankBudget({ name: "Sam" }); s.people[0].pay = 2000; const pid = s.people[0].id;
  s.accounts.forEach(a => { a.split[pid] = { spending: 0.7, emergency: 0.05, goals: 0.1, invest: 0.1, personalGoals: 0.05 }[a.role]; });
  s.goals.joint.push({ id: "g1", name: "House", target: 50000, saved: 1000, account: "", split: { [pid]: 1 }, deadline: "", pos: 1 });
  s.goals.personal[pid] = [{ id: "p1", name: "Guitar", target: 1500, saved: 200, account: "", pct: 1, deadline: "", pos: 1 }];
  const { page, errors, ctx } = await open(toStored(s), { ...phone(), storage: ALL_DONE });
  const before = await budgetOf(page);
  await goTab(page, "goals");
  await page.waitForSelector(".hm-combine");
  assert.equal(JSON.stringify(await budgetOf(page)), JSON.stringify(before), "showing the offer changes nothing");
  const amt = async id => page.textContent(`[data-k="g.${id}.line"]`);
  const was = { g1: await amt("g1"), p1: await amt("p1") };
  await page.click('[data-combine="review"]'); await page.waitForSelector(".hm-review");
  assert.match(await page.textContent(".hm-review"), /After combining, one Goals allocation gets 15%/);
  assert.equal(await page.locator(".hm-rows li").count(), 2, await page.innerHTML(".hm-review"));
  assert.match(await page.textContent(".hm-review .msg"), /Every goal keeps the same money/);
  await shot(page, "combine-review");
  await page.click('[data-combine="go"]'); await settle(page);
  const b = await budgetOf(page), acc = vals(b.accounts);
  assert.equal(acc.filter(a => a.role === "personalGoals").length, 0);
  assert.equal(acc.find(a => a.role === "goals").split[pid], 0.15);
  assert.deepEqual(vals(b.goals.joint).map(g => g.name).sort(), ["Guitar", "House"]);
  assert.equal(vals(b.goals.joint).find(g => g.id === "p1").saved, 200);
  assert.equal(await amt("g1"), was.g1, "House gets the same each fortnight"); assert.equal(await amt("p1"), was.p1, "so does Guitar");
  assert.equal(await page.locator(".hm-combine").count(), 0);
  // Undo puts it all back
  await page.click("#undoBtn");
  await page.waitForFunction(() => Object.values(window.__fake.budget.accounts).some(a => a.role === "personalGoals"), null, { timeout: 5000 });
  const u = await budgetOf(page);
  assert.equal(vals(u.accounts).filter(a => a.role === "personalGoals").length, 1);
  assert.deepEqual(vals(u.goals.joint).map(g => g.name), ["House"]);
  assert.deepEqual(errors, []); await ctx.close();
});

test("'Not now' hides the offer on this device; it's still in Household settings", { skip }, async () => {
  const s = blankBudget({ name: "Sam" }); s.people[0].pay = 2000;
  const { page, errors, ctx } = await open(toStored(s), { ...phone(), storage: ALL_DONE });
  await goTab(page, "goals"); await page.waitForSelector(".hm-combine");
  await page.click('[data-combine="later"]');
  assert.equal(await page.locator(".hm-combine").count(), 0);
  await goTab(page, "budget"); await goTab(page, "goals");
  assert.equal(await page.locator(".hm-combine").count(), 0, "stays hidden");
  await openHousehold(page);
  assert.equal(await page.locator('#sheet [data-combine="review"]').count(), 1);
  assert.deepEqual(errors, []); await ctx.close();
});

test("solo → shared: adding a person keeps every allocation as it was, and explains how to share", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob", ...phone(), storage: ALL_DONE });
  await setUp(page, "solo");
  await page.click('[data-obact="next"]'); await page.waitForSelector(".ob-done"); await page.click('[data-obact="finish"]');
  await page.waitForSelector("#app .b-income"); await settle(page);
  const before = vals((await budgetOf(page)).accounts);
  await page.click("[data-person-new]"); await page.waitForSelector('#sheet .bsheet [data-l="pp"][data-f="name"]');
  await page.keyboard.type("Madi"); await settle(page);
  await page.click('#sheet .sheet-head [data-sheet="close"]');
  await page.waitForSelector("#sheet", { state: "hidden" }); await settle(page);
  const after = vals((await budgetOf(page)).accounts);
  before.forEach(a => assert.deepEqual(after.find(x => x.id === a.id), a, a.name));
  assert.match(await page.textContent(".hm-note"), /started as just you/);
  await page.click('[data-hh-note="ok"]');
  assert.equal(await page.locator(".hm-note").count(), 0);
  assert.deepEqual(errors, []); await ctx.close();
});
