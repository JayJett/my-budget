/* Phase 7B: the three-step setup (make it yours → your income → your starting plan), and Moni Money.
   Uses the fake Supabase: no real accounts or households are made. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { setup, skip, SHOTS, open, settle, fake } from "./helpers.js";
import { emergencyTarget } from "../../js/model/onboarding.js";

setup();
const saved = page => fake(page, () => window.__fake.budget);
const writes = page => fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops").length);
const stepText = page => page.textContent("#app .ob-stage");
const doneCount = page => page.getAttribute("#app .ob-prog", "aria-valuenow");
const next = page => page.click('[data-obact="next"]');
const empty = (o = {}) => open({}, { waitFor: ".ob", width: 390, ...o });
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `setup7b-${name}.png`), fullPage: true });

test("one person: income, then the plan, then 'ready' only once it's saved; the budget is right", { skip }, async () => {
  const { page, errors, ctx } = await empty();
  assert.match(await stepText(page), /Step 2 of 3\s*Your income/);
  assert.equal(await doneCount(page), "1", "step 1 (the household) is done");
  assert.equal(await page.isVisible(".top"), false, "setup has its own small header");
  assert.equal(await page.locator('[data-ob="people.0.name"]').count(), 0, "your name isn't asked for again");
  await shot(page, "2-income-empty");
  await page.fill('[data-ob="people.0.pay"]', "2000");
  await page.click('.ob-freq label:has(input[value="fortnightly"])');
  await page.click(".ob-more summary");
  await shot(page, "2-income-details");
  await next(page);
  assert.match(await stepText(page), /Step 3 of 3\s*Your starting plan/);
  assert.equal(await doneCount(page), "2");
  assert.equal(await page.textContent('[data-obk="tot"]'), "100%");
  assert.match(await page.textContent(".ob-sum"), /\$2,000\/fn/);
  assert.match(await page.textContent('[data-obk="amt.0"]'), /^\$1,000\/fn$/, "50% of $2,000");
  assert.doesNotMatch(await page.textContent(".ob-card"), /already covers|three months/, "no claims the setup can't back up");
  await shot(page, "3-plan-complete");
  await page.fill('[data-ob="split.0"]', "45");
  assert.match(await page.textContent('[data-obk="status"]'), /5% left to plan/);
  assert.equal(await page.isDisabled('[data-obact="next"]'), true);
  await shot(page, "3-plan-partial");
  await page.fill('[data-ob="split.0"]', "55");
  assert.match(await page.textContent('[data-obk="status"]'), /5% over/);
  await shot(page, "3-plan-over");
  await page.fill('[data-ob="split.0"]', "50");
  assert.match(await page.textContent('[data-obk="status"]'), /All planned/);
  assert.equal(await writes(page), 0, "nothing saved while planning");
  await next(page);
  await page.waitForSelector("text=Your budget is ready, Jarden!");
  assert.equal(await doneCount(page), "3");
  assert.ok(await writes(page) >= 1, "saved before saying so");
  await shot(page, "4-ready");
  const b = await saved(page);
  const people = Object.values(b.people);
  assert.deepEqual(people.map(p => [p.name, p.pay, p.freq]), [["Jarden", 2000, "fortnightly"]]);
  const total = Object.values(b.accounts).reduce((s, a) => s + (a.split[people[0].id] || 0), 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "the plan adds to 100% of pay");
  assert.deepEqual(Object.values(b.nw.accounts).map(a => a.balance), [null], "no balances made up (only the empty Emergency Fund account, as before)");
  assert.deepEqual(Object.keys(b.goals.joint || {}), [], "no goals made up");
  assert.equal(b.goals.ef.target, emergencyTarget([{ pay: 2000, freq: "fortnightly" }], "solo"));
  await page.click('[data-obact="finish"]');
  await page.waitForSelector("#app .viewas");
  assert.equal(await page.isVisible(".tour:not([hidden])"), false, "the tour is optional");
  assert.equal(await page.isVisible(".top"), true);
  assert.match(await page.textContent("#app"), /\$2,000/);
  assert.deepEqual(errors, []); await ctx.close();
});

test("with someone: their pay is optional; added, it's shared in proportion to income, one personal pot each", { skip }, async () => {
  const { page, errors, ctx } = await empty();
  await page.click('[data-obact="back"]');
  assert.match(await stepText(page), /Step 1 of 3/);
  await shot(page, "1-in-setup");
  await page.check('input[name="obmode"][value="with"]');
  await next(page);
  await page.fill('[data-ob="people.0.pay"]', "2000");
  await page.click('[data-obact="addperson"]');
  await page.fill('[data-ob="people.1.name"]', "Madi");
  await page.fill('[data-ob="people.1.pay"]', "4000");
  await page.click('.ob-pay:nth-of-type(2) .ob-freq label:has(input[value="monthly"])');
  await shot(page, "2-income-two");
  await next(page);
  assert.match(await page.textContent(".ob-sum"), /\$3,846\/fn/, "$100,000 a year together, per fortnight");
  assert.match(await page.textContent(".ob-buckets"), /one each/);
  await next(page);
  await page.waitForSelector(".ob-done"); await settle(page);
  const b = await saved(page), people = Object.values(b.people);
  assert.deepEqual(people.map(p => [p.name, p.pay, p.freq]), [["Jarden", 2000, "fortnightly"], ["Madi", 4000, "monthly"]]);
  for (const p of people) {
    assert.ok(Math.abs(Object.values(b.accounts).reduce((s, a) => s + (a.split[p.id] || 0), 0) - 1) < 1e-9, `${p.name} 100%`);
    assert.equal(Object.values(b.accounts).filter(a => a.role === "personalGoals" && a.owner === p.id).length, 1, `${p.name} has their own goals pot`);
  }
  assert.equal(await fake(page, () => window.__fake.hh("hh-1").members.length), 1, "no sign-in made up for Madi: she's just in the budget");
  assert.deepEqual(errors, []); await ctx.close();
});

test("back keeps your answers and your plan changes; changing pay updates the plan's dollars", { skip }, async () => {
  const { page, ctx } = await empty();
  await page.fill('[data-ob="people.0.pay"]', "2000"); await next(page);
  await page.fill('[data-ob="split.0"]', "40");
  await page.click('[data-obact="back"]');
  assert.equal(await page.inputValue('[data-ob="people.0.pay"]'), "2,000");
  assert.equal(await page.isChecked('.ob-freq input[value="fortnightly"]'), true);
  await page.fill('[data-ob="people.0.pay"]', "3000"); await next(page);
  assert.equal(await page.inputValue('[data-ob="split.0"]'), "40", "your own change to the plan is kept");
  assert.match(await page.textContent('[data-obk="amt.0"]'), /^\$1,200\/fn$/, "and its dollars follow the new pay (40% of $3,000)");
  await ctx.close();
});

test("no income yet: the plan shows percentages only (no $0 or NaN), and can still be saved", { skip }, async () => {
  const { page, errors, ctx } = await empty();
  await next(page);
  assert.match(await page.textContent(".ob-sum"), /Not added yet/);
  assert.match(await page.textContent(".ob-note"), /Add your income/);
  assert.equal(await page.textContent('[data-obk="amt.0"]'), "");
  assert.doesNotMatch(await page.textContent(".ob-card"), /NaN|Infinity|undefined|\$0/);
  await shot(page, "3-plan-no-income");
  await next(page);
  await page.waitForSelector(".ob-done"); await settle(page);
  assert.equal(Object.values((await saved(page)).people)[0].pay, null, "no income made up");
  await page.click('[data-obact="finish"]'); await page.waitForSelector("#app .viewas");
  assert.doesNotMatch(await page.textContent("#app"), /NaN|Infinity|undefined/);
  assert.deepEqual(errors, []); await ctx.close();
});

test("'Set up later' goes straight in with an empty budget and saves nothing", { skip }, async () => {
  const { page, errors, ctx } = await empty();
  await page.click(".ob-later");
  await page.waitForSelector("#app .viewas");
  assert.equal(await writes(page), 0);
  assert.equal(await page.isVisible(".welcome"), true);
  assert.deepEqual(errors, []); await ctx.close();
});

test("if saving fails it says so (never 'ready'), and Try again works", { skip }, async () => {
  const { page, ctx } = await empty();
  await page.fill('[data-ob="people.0.pay"]', "2000"); await next(page);
  await fake(page, () => { window.__fake.failNext = 2; });
  await next(page);
  await page.waitForSelector(".ob-card .msg.err");
  assert.match(await page.textContent(".ob-card .msg.err"), /couldn’t save your budget/);
  assert.equal(await page.locator(".ob-done").count(), 0);
  assert.equal(await page.textContent('[data-obact="next"]'), "Try again");
  await next(page);
  await page.waitForSelector(".ob-done");
  await ctx.close();
});

test("a missing name is asked for once, with the pay", { skip }, async () => {
  const { page, ctx } = await open(null, { init: { meta: { name: "" }, households: [{ id: "hh-1", name: "Ours", role: "owner", budget: {}, members: [{ user_id: "u-me", display_name: "", email: "jarden@example.com", role: "owner", joined_at: "2026-01-01" }] }] }, waitFor: ".ob" });
  await page.fill('[data-ob="people.0.name"]', "Sam");
  await page.fill('[data-ob="people.0.pay"]', "1000"); await next(page); await next(page);
  await page.waitForSelector("text=Your budget is ready, Sam!"); await settle(page);
  assert.equal(Object.values((await saved(page)).people)[0].name, "Sam");
  await ctx.close();
});

test("step 1 for a brand-new account: nothing pre-chosen; 'joining' explains invitations; 'with someone' carries into step 2", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: { households: [] }, waitFor: "#fHousehold", width: 390 });
  assert.match(await page.textContent(".ob-stage"), /Step 1 of 3/);
  assert.equal(await page.getAttribute(".ob-prog", "aria-valuenow"), "0");
  assert.equal(await page.locator('input[name="obmode"]:checked').count(), 0, "no choice made for you");
  assert.equal(await page.isDisabled('#fHousehold button[type="submit"]'), true);
  await shot(page, "1-start");
  await page.check('input[name="obmode"][value="join"]');
  assert.match(await page.textContent(".ob-join"), /jarden@example\.com/);
  assert.equal(await page.isVisible('#fHousehold [name="name"]'), false);
  await page.check('input[name="obmode"][value="with"]');
  assert.equal(await page.inputValue('#fHousehold [name="name"]'), "Our budget");
  await shot(page, "1-selected");
  await page.click('#fHousehold button[type="submit"]');
  await page.waitForSelector(".ob .ob-stage");
  assert.match(await stepText(page), /Step 2 of 3/);
  assert.equal(await page.locator('[data-obact="addperson"]').count(), 1, "'with someone' offers to add their pay");
  assert.equal(await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "create_household").length), 1);
  assert.deepEqual(errors, []); await ctx.close();
});

test("someone joining a household that's already set up goes straight to its budget (no setup)", { skip }, async () => {
  const budget = JSON.parse(readFileSync(new URL("./budget-baseline.json", import.meta.url), "utf8")) && null;
  const { page, ctx } = await open(null, { init: { households: [], invite: { id: "hh-inv", name: "Mum’s budget", role: "editor", budget: { version: 4, note: "", viewAs: "fortnight", people: { p1: { id: "p1", name: "Mum", pay: 1000, freq: "fortnightly", payday: "", colour: "blue", pos: 1 } }, accounts: {}, nw: { reviewed: "", accounts: {} }, spend: {}, goals: { ef: { id: "ef", name: "Emergency Fund" }, joint: {}, personal: { p1: {} } }, invest: { rate: 0.07, growth: 0, fee: 0 } } } }, waitFor: "#app .viewas" });
  assert.equal(await page.locator(".ob").count(), 0);
  assert.equal(await writes(page), 0, "nothing of theirs is replaced");
  void budget; await ctx.close();
});

test("your colour carries into setup", { skip }, async () => {
  const { page, ctx } = await open({}, { waitFor: ".ob", width: 390, init: { budget: {}, meta: { accent: "lavender" } } });
  const [bar, accent] = await page.evaluate(() => [getComputedStyle(document.querySelector(".ob-prog span")).backgroundColor, getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()]);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), "lavender");
  assert.ok(bar && accent);
  await shot(page, "lavender");
  await ctx.close();
});

for (const width of [320, 375, 390, 430, 1280]) {
  test(`${width}px: every setup step fits, inputs don't zoom, everything is easy to tap`, { skip }, async () => {
    const { page, errors, ctx } = await open({}, { waitFor: ".ob", width });
    const check = async label => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label}: no sideways scroll`);
      assert.deepEqual(await page.$$eval(".ob input:not([type=radio])", els => els.filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.dataset.ob)), [], `${label}: no zoom`);
      assert.deepEqual(await page.$$eval(".ob button, .ob summary, .ob-opt", els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height < 40; }).map(e => e.textContent.trim().slice(0, 20))), [], `${label}: tappable`);
    };
    await check("income");
    await page.fill('[data-ob="people.0.pay"]', "123456.78"); await next(page);
    await check("plan");
    const clipped = await page.$$eval(".ob-b-amt, .ob-sum b", els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    assert.deepEqual(clipped, [], "amounts aren't cut off");
    await page.click('[data-obact="back"]'); await page.click('[data-obact="back"]');
    await check("step 1");
    if (width === 320) await shot(page, "320-step1");
    assert.deepEqual(errors, []); await ctx.close();
  });
}

test("Moni Money: the name in the tab, the Home Screen and sign-in (household names untouched)", { skip }, async () => {
  const { page, ctx } = await open(null, { init: { signedOut: true }, waitFor: "#fSignin" });
  assert.equal(await page.title(), "Moni Money");
  assert.equal(await page.getAttribute('meta[name="apple-mobile-web-app-title"]', "content"), "Moni Money");
  assert.match(await page.textContent(".auth-brand"), /Moni Money/);
  const manifest = JSON.parse(readFileSync(new URL("../../manifest.webmanifest", import.meta.url), "utf8"));
  assert.deepEqual([manifest.name, manifest.short_name], ["Moni Money", "Moni Money"]);
  await ctx.close();
  const o = await open(null, { init: { households: [{ id: "hh-1", name: "Smith Family Budget", role: "owner", budget: {} }] }, waitFor: ".ob" });
  await o.page.click('[data-obact="back"]');
  assert.match(await o.page.textContent(".ob-hint"), /Smith Family Budget/);
  await o.ctx.close();
});
