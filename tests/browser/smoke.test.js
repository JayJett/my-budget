/* Browser tests: load the real app in Chromium, with a fake Supabase (fake-supabase.js),
   and click through it. Run with: npm run test:browser
   Screenshots go to tests/browser/screenshots/ (not committed) so a person can eyeball them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { LIVE_V3, RICH_V3 } from "../fixtures.js";
import { setup, skip, SHOTS, open, settle, fake, goTab, setField, editPerson, editAccount, closeSheet } from "./helpers.js";

setup();

test("your live budget upgrades itself, with a backup, and shows both people", { skip }, async () => {
  const { page, errors, ctx } = await open(LIVE_V3);
  await settle(page);
  const calls = await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops"));
  assert.equal(calls.length, 1, "one save: the upgrade");
  assert.equal(calls[0].args.p_ops[0].op, "replace");
  const backups = await fake(page, () => window.__fake.backups);
  assert.deepEqual(backups[0], LIVE_V3, "the old budget was backed up before replacing");
  const saved = await fake(page, () => window.__fake.budget);
  assert.equal(saved.version, 4);
  assert.equal(saved.people.j.pay, 1000);
  assert.equal(saved.accounts.ji.split.j, 0.5);
  assert.equal(await page.textContent("#brandNames .brand-t"), "Test household", "the household's name, not fixed people");
  assert.equal(await page.textContent("#brandNames small"), "Jarden and Madi");
  assert.equal(await page.locator("[data-edit-person]").count(), 2);
  // Joint Investments gets 50% of Jarden's $1,000 = $500 a fortnight
  assert.equal((await page.textContent('[data-k="acc.ji.part.j"]')).trim(), "Jarden $500");
  await page.screenshot({ path: join(SHOTS, "budget-live.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("an edit saves as one small change, not the whole budget", { skip }, async () => {
  const { page, errors, ctx } = await open(LIVE_V3);
  await settle(page);
  await fake(page, () => { window.__fake.rpcCalls = []; });
  await editPerson(page, "m");
  await setField(page, '#sheet [data-l="pp"][data-i="m"][data-f="pay"]', "650");
  await settle(page);
  const calls = await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops"));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.p_ops, [{ op: "set", path: ["people", "m", "pay"], value: 650 }]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("someone else's change arrives while you're typing: both are kept", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  await editPerson(page, "j");
  await setField(page, '#sheet [data-l="pp"][data-i="j"][data-f="pay"]', "2500");  // my edit, not yet saved
  await fake(page, () => window.__fake.remote([{ op: "set", path: ["note"], value: "From Madi" }])); // their save
  await settle(page);
  const saved = await fake(page, () => window.__fake.budget);
  assert.equal(saved.note, "From Madi");
  assert.equal(saved.people.j.pay, 2500);
  assert.equal(await page.inputValue('#app [data-f="note"]'), "From Madi");
  assert.equal(await page.inputValue('#sheet [data-l="pp"][data-i="j"][data-f="pay"]'), "2500", "the open sheet keeps my edit");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a remote update shows up on screen", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  const before = await fake(page, () => window.__fake.seq);
  await fake(page, () => window.__fake.remote([{ op: "set", path: ["people", "m", "name"], value: "Madison" }]));
  await page.waitForFunction(() => document.querySelector("#brandNames").textContent.includes("Madison"));
  assert.equal(await fake(page, () => window.__fake.seq), before + 1, "the app didn't save anything back");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("'show amounts per' switches every figure between week, fortnight and month", { skip }, async () => {
  const { page, errors, ctx } = await open(LIVE_V3);
  await settle(page);
  const inv = () => page.textContent('[data-k="acc.ji.part.j"]');
  assert.equal((await inv()).trim(), "Jarden $500");
  await page.click('[data-viewas="week"]');
  assert.equal((await inv()).trim(), "Jarden $250");
  await page.click('[data-viewas="month"]');
  assert.equal((await inv()).trim(), "Jarden $1,083.33");               // $13,000 a year ÷ 12
  assert.equal(await page.getAttribute('[data-viewas="month"]', "aria-pressed"), "true");
  assert.match(await page.textContent(".b-income .per"), /per month/);
  await settle(page);
  assert.equal((await fake(page, () => window.__fake.budget)).viewAs, "month", "the choice is saved for the household");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("people: add, set pay frequency, recolour, remove", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  await page.click("[data-person-new]");
  await page.waitForSelector('#sheet .bsheet [data-l="pp"][data-f="name"]');
  await page.keyboard.type("Sam");                                   // the name box has the cursor
  const sam = await page.getAttribute('#sheet [data-l="pp"][data-f="name"]', "data-i");
  await setField(page, `#sheet [data-l="pp"][data-i="${sam}"][data-f="pay"]`, "1000");
  await page.selectOption(`#sheet [data-l="pp"][data-i="${sam}"][data-f="freq"]`, "weekly");
  await page.click(`#sheet [data-colour="slate"][data-i="${sam}"]`);
  assert.equal(await page.getAttribute(`#sheet [data-colour="slate"]`, "aria-pressed"), "true", "the sheet shows the new colour");
  await settle(page);
  let saved = await fake(page, () => window.__fake.budget);
  assert.equal(saved.people[sam].name, "Sam");
  assert.equal(saved.people[sam].freq, "weekly");
  assert.equal(saved.people[sam].colour, "slate");
  assert.ok(Object.values(saved.accounts).some(a => a.owner === sam && a.role === "personalGoals"), "Sam got a personal goals account");
  assert.match(await page.textContent(`#sheet [data-k="inc.${sam}.sub"]`), /\$2,000 a fortnight/);
  await closeSheet(page);
  // a share-of-pay box for Sam in every allocation, and Sam in the allocation status
  await editAccount(page, "js");
  assert.equal(await page.locator(`#sheet [data-f="split.${sam}"]`).count(), 1);
  await closeSheet(page);
  assert.equal(await page.locator("#allocStatus .st-list li").count(), 3);
  await page.screenshot({ path: join(SHOTS, "budget-three-people.png"), fullPage: true });
  await editPerson(page, sam);
  await page.click(`#sheet [data-rmperson="${sam}"]`);
  await page.click("#dlgYes");
  await page.waitForSelector("#sheet", { state: "hidden" });         // their sheet closes with them
  await settle(page);
  saved = await fake(page, () => window.__fake.budget);
  assert.equal(saved.people[sam], undefined);
  assert.ok(!Object.values(saved.accounts).some(a => a.owner === sam));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the fair-split check only shows with two or more earners", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  assert.equal(await page.isVisible("#fairSec"), true);
  await editPerson(page, "m");
  await setField(page, '#sheet [data-l="pp"][data-i="m"][data-f="pay"]', "");
  await closeSheet(page);
  assert.equal(await page.isVisible("#fairSec"), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a brand-new household opens the setup guide; skipping it gives one person and no fair-split check", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob" });
  assert.ok(await page.isVisible("text=What’s this budget for?"));
  assert.equal(await page.isVisible("#tabs"), false, "tabs are hidden during setup");
  await page.click("text=Skip setup and start with a blank budget");
  await page.waitForSelector("#app .viewas");
  assert.equal(await page.locator("[data-edit-person]").count(), 1);
  assert.equal(await page.textContent(".m-name"), "Jarden", "named after the signed-in person");
  assert.equal(await page.isVisible("#fairSec"), false);
  assert.ok(await page.isVisible(".welcome"));
  assert.equal(await page.locator(".tab", { hasText: "Spending" }).count(), 1);
  const calls = await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops"));
  assert.equal(calls.length, 0, "nothing is saved until you change something");
  await page.click("[data-edit-person]");
  await setField(page, '#sheet [data-l="pp"][data-f="pay"]', "3000");
  await settle(page);
  assert.equal(Object.values((await fake(page, () => window.__fake.budget)).people)[0].pay, 3000);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("every tab draws without errors, and goals/spending follow the view period", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  for (const tab of ["networth", "spending", "goals", "invest", "budget"]) {
    await goTab(page, tab);
    await page.screenshot({ path: join(SHOTS, `tab-${tab}.png`), fullPage: true });
  }
  await goTab(page, "spending");
  assert.match(await page.textContent("thead"), /Per fortnight/);
  await page.click('[data-viewas="month"]');
  assert.match(await page.textContent("thead"), /Per month/);
  await goTab(page, "goals");
  assert.ok(await page.locator("text=Jarden’s personal goals").count());
  assert.ok(await page.locator("text=Madi’s personal goals").count());
  await page.screenshot({ path: join(SHOTS, "tab-goals-month.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("adding, reordering and deleting rows all save", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  await page.click('[data-tab="spending"]');
  await page.click('[data-add="sp"]');
  await page.keyboard.type("Netflix");
  await settle(page);
  let saved = await fake(page, () => window.__fake.budget);
  const nf = Object.values(saved.spend).find(s => s.name === "Netflix");
  assert.ok(nf, "new row saved");
  // move it to the top with the keyboard
  for (let k = 0; k < 6; k++) { await page.focus(`.grip[data-i="${nf.id}"]`); await page.keyboard.press("ArrowUp"); }
  await settle(page);
  saved = await fake(page, () => window.__fake.budget);
  const order = Object.values(saved.spend).sort((a, b) => a.pos - b.pos).map(s => s.name);
  assert.equal(order[0], "Netflix");
  await page.click(`[data-del="sp"][data-i="s3"]`);
  await page.click("#dlgYes");
  await settle(page);
  saved = await fake(page, () => window.__fake.budget);
  assert.equal(saved.spend.s3, undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("if saving fails, it says so and tries again", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  await fake(page, () => { window.__fake.failNext = 2; });
  await page.fill('[data-f="note"]', "Offline edit");
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "Couldn’t save", null, { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "Saved", null, { timeout: 20000 });
  assert.equal((await fake(page, () => window.__fake.budget)).note, "Offline edit");
  assert.deepEqual(errors.filter(e => !/Failed to fetch/.test(e)), []);
  await ctx.close();
});

test("phone width still loads (full mobile layout comes in Phase 3)", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3, { width: 390 });
  await settle(page);
  await page.screenshot({ path: join(SHOTS, "phone-budget.png"), fullPage: false });
  assert.deepEqual(errors, []);
  await ctx.close();
});
