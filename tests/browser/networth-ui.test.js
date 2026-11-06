/* UI phase 3, stage A: the redesigned Net worth tab. The first test is the safety net: every figure the
   tab works out must be exactly what the old screen produced (tests/browser/nwgoals-baseline.json,
   recorded before the redesign) in four situations and all three periods. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, settle, fake, goTab, setField, closeSheet, editNetWorth } from "./helpers.js";
import { tabFigures, nwGoalsCases } from "./nwgoals-figures.mjs";

setup();
const CASES = nwGoalsCases(RICH_V3, toStored, migrate);
const BASE = JSON.parse(readFileSync(new URL("./nwgoals-baseline.json", import.meta.url), "utf8"));
const saved = page => fake(page, () => window.__fake.budget);
const nwTab = async (budget, o = {}) => { const r = await open(budget, o); await settle(r.page); await goTab(r.page, "networth"); return r; };
const text = (page, k) => page.textContent(`[data-k="${k}"]`);

test("every Net worth figure is exactly what the old screen worked out (four situations × week, fortnight, month)", { skip }, async () => {
  for (const [name, budget] of Object.entries(CASES)) {
    const now = await tabFigures("networth", budget);
    for (const period of ["week", "fortnight", "month"])
      for (const [k, v] of Object.entries(BASE.networth[name][period])) assert.equal(now[period][k], v, `${name} ${period} ${k}`);
  }
});

test("the hero leads with net worth; accounts are grouped, tappable rows with no form fields on the page", { skip }, async () => {
  const { page, errors, ctx } = await nwTab(CASES.mixed, { width: 390 });
  assert.equal(await text(page, "nw.net"), "$29,650.25");
  assert.equal(await text(page, "nw.assets"), "$35,850.50"); assert.equal(await text(page, "nw.debt"), "$6,200.25");
  assert.match(await page.getAttribute("#nwBar", "aria-label"), /^What you own: Everyday \$2,450\.50, Savings \$10,600, Investments \$300, Super \$22,500$/);
  assert.deepEqual(await page.$$eval(".ex-gh h3", els => els.map(e => e.textContent)), ["Cash", "Investments and super", "Debt"]);
  assert.equal(await text(page, "nw.grp.cash"), "$13,050.50"); assert.equal(await text(page, "nw.grp.long"), "$22,800");
  assert.equal(await page.locator("#app .nw-main input, #app .nw-main select").count(), 0, "no form fields in the account list");
  assert.equal(await page.locator(".viewas").count(), 0, "no period switch: balances aren't per fortnight");
  // rows: type, goal money, warnings that matter, and debt shown as owed
  assert.equal(await text(page, "nw.a2.sub"), "Savings · $7,500 for goals");
  assert.equal(await text(page, "nw.a2.flag"), "$500 not yet earmarked");
  assert.equal(await page.locator('[data-edit-nw="a2"] .ex-prog.nw-em').count(), 1);
  assert.equal(await text(page, "nw.a3.flag"), "Duplicate name");
  assert.equal(await text(page, "nw.a8.v"), "$6,200.25"); assert.equal(await text(page, "nw.a8.ow"), "owed");
  assert.equal(await page.locator('[data-edit-nw="a8"] .chip.bad').count(), 0, "a debt isn't flagged as a problem just for being a debt");
  assert.equal(await page.locator('[data-edit-nw="a7"] .ex-prog').count(), 0, "no goal bar where goals don't apply");
  // goal money is a slice of savings, never added on top
  assert.deepEqual([await text(page, "nw.gm.sav"), await text(page, "nw.gm.em"), await text(page, "nw.gm.free")], ["$10,600", "$7,750", "$3,100"]);
  assert.equal(await page.isVisible(".nw-over"), false);
  assert.equal(await page.locator("#app .attn:not([hidden])").count(), 0, "warnings show where they apply, not in a separate box");
  assert.doesNotMatch(await page.textContent("#app"), /NaN|Infinity|undefined|sync|live balance/i);
  await page.screenshot({ path: join(SHOTS, "networth-390.png"), fullPage: true });
  assert.deepEqual(errors, []); await ctx.close();
});

test("over-earmarked savings say so plainly; exactly matched savings show as reconciled", { skip }, async () => {
  let o = await nwTab(CASES.rich);
  assert.equal(await o.page.isVisible(".nw-over"), true);
  assert.equal(await text(o.page, "nw.gm.over"), "Joint Savings has $1,200 more promised to goals than is in it.");
  assert.equal(await text(o.page, "nw.n2.flag"), "Over-earmarked by $1,200");
  assert.equal(await o.page.locator('[data-edit-nw="n2"] .ex-prog.over').count(), 1);
  assert.deepEqual(o.errors, []); await o.ctx.close();
  o = await nwTab(CASES.exact);
  assert.equal(await text(o.page, "nw.n2.flag"), "Reconciled");
  assert.equal(await text(o.page, "nw.gm.free"), "$0");
  assert.equal(await o.page.isVisible(".nw-over"), false);
  assert.deepEqual(o.errors, []); await o.ctx.close();
});

test("account sheet: balance, name and type save; renaming keeps goals linked; linked goals are listed", { skip }, async () => {
  const { page, errors, ctx } = await nwTab(CASES.mixed, { width: 390 });
  await editNetWorth(page, "a2");
  assert.equal(await page.getAttribute('#sheet [data-f="balance"]', "inputmode"), "decimal");
  assert.match(await page.textContent("#sheet"), /2 goals use this account/);
  await page.click("#sheet details.more summary");
  assert.deepEqual(await page.$$eval("#sheet .nw-goals li span", els => els.map(e => e.textContent)), ["Emergency Fund", "Phone"]);
  await setField(page, '#sheet [data-f="balance"]', "9000.5");
  await page.waitForFunction(() => document.querySelector('#sheet [data-k="nw.a2.buf"]').textContent === "$1,500.50");
  assert.equal(await text(page, "nw.net"), "$30,650.75", "the hero updates while the sheet is open");
  await page.fill('#sheet [data-f="name"]', "Rainy day");
  await closeSheet(page);
  await settle(page);
  const b = await saved(page);
  assert.deepEqual([b.nw.accounts.a2.name, b.nw.accounts.a2.balance], ["Rainy day", 9000.5]);
  assert.equal(b.goals.ef.account, "Rainy day", "goals follow the rename, as before");
  assert.equal(Object.keys(b.nw.accounts).length, 8, "editing never makes a second account");
  assert.equal(await text(page, "nw.a2.sub"), "Savings · $7,500 for goals");
  // type change: a savings account becomes a debt; the sheet redraws with the debt wording
  await editNetWorth(page, "a4");
  await page.click('#sheet label:has(input[value="Debt"])');
  await page.waitForFunction(() => /Amount owed/.test(document.querySelector("#sheet").textContent));
  await closeSheet(page); await settle(page);
  assert.equal((await saved(page)).nw.accounts.a4.type, "Debt");
  assert.equal(await text(page, "nw.debt"), "$6,300.25");
  assert.deepEqual(errors, []); await ctx.close();
});

test("add: from a group it starts with that type; closing a blank one leaves nothing; delete warns about linked goals", { skip }, async () => {
  const { page, errors, ctx } = await nwTab(CASES.mixed);
  const count = async () => Object.keys((await saved(page)).nw.accounts).length;
  await page.click('.ex-gh [data-nw-new="Debt"]');
  await page.waitForSelector('#sheet [data-f="name"]:focus');
  assert.equal(await page.isChecked('#sheet input[value="Debt"]'), true);
  await closeSheet(page); await settle(page);
  assert.equal(await count(), 8, "no empty account left behind");
  await page.click('.add-row[data-nw-new]');
  await page.waitForSelector('#sheet [data-f="name"]:focus');
  await page.keyboard.type("Term deposit");
  await setField(page, '#sheet [data-f="balance"]', "5000");
  await closeSheet(page); await settle(page);
  const td = Object.values((await saved(page)).nw.accounts).find(a => a.name === "Term deposit");
  assert.deepEqual([td.type, td.balance], ["Savings", 5000]);
  // deleting an account goals use: says which goals, cancelling keeps it, goals are never deleted
  await editNetWorth(page, "a2");
  await page.click("#sheet [data-del]");
  assert.match(await page.textContent("#dlgP"), /2 goals \(Emergency Fund, Phone\) use this account\. They keep their saved amounts/);
  await page.click("#dlgNo");
  assert.ok((await saved(page)).nw.accounts.a2);
  await page.click("#sheet [data-del]"); await page.click("#dlgYes");
  await page.waitForSelector("#sheet", { state: "hidden" }); await settle(page);
  const b = await saved(page);
  assert.equal(b.nw.accounts.a2, undefined);
  assert.equal(b.goals.ef.account, "Emergency", "the goal keeps its saved amount and account name, as before");
  assert.equal(b.goals.ef.saved, 6000);
  assert.deepEqual(errors, []); await ctx.close();
});

test("review: shows when balances were last checked, and 'Reviewed today' still works", { skip }, async () => {
  const { page, errors, ctx } = await nwTab(CASES.mixed);
  assert.match(await text(page, "nw.rev.when"), /^Last reviewed 20 Feb( 2026)? · \d+ days ago$/);
  await page.click("#revToday"); await settle(page);
  assert.equal(await text(page, "nw.rev.when"), "Last reviewed " + await page.evaluate(() => { const d = new Date(); return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}`; }) + " · today");
  assert.equal(await text(page, "nw.rev"), "Recently reviewed");
  await page.click(".nw-rv-date summary");
  await page.fill("#rev", "2026-01-05"); await settle(page);
  assert.equal((await saved(page)).nw.reviewed, "2026-01-05");
  assert.deepEqual(errors, []); await ctx.close();
});

test("no accounts: a friendly empty state with one way to add, and no empty breakdowns", { skip }, async () => {
  const { page, errors, ctx } = await nwTab(CASES.empty, { width: 390 });
  assert.equal(await page.isVisible("text=No accounts yet"), true);
  assert.equal(await page.locator(".sp-empty [data-nw-new]").count(), 1);
  assert.equal(await page.locator(".nw-gm, .ex-group").count(), 0);
  assert.equal(await page.isVisible("#nwBar"), false);
  assert.equal(await text(page, "nw.rev.when"), "Not reviewed yet");
  assert.doesNotMatch(await page.textContent("#app"), /NaN|Infinity|undefined/);
  await goTab(page, "goals"); await goTab(page, "invest");
  assert.deepEqual(errors, []); await ctx.close();
});

test("reorder mode is one list in saved order; account type colours never follow the accent", { skip }, async () => {
  const { page, errors, ctx } = await nwTab(CASES.rich);
  await page.click("[data-reorder]");
  assert.equal(await page.locator(".ex-gh").count(), 0);
  await page.click('[data-move="down"][data-i="n1"]'); await settle(page);
  const order = Object.values((await saved(page)).nw.accounts).sort((a, b) => a.pos - b.pos).map(a => a.id);
  assert.deepEqual(order.slice(0, 2), ["n2", "n1"]);
  await page.click("[data-reorder]");
  const cols = () => page.evaluate(() => ["--nw-op", "--nw-sav", "--nw-inv", "--nw-sup", "--nw-debt"].map(k => getComputedStyle(document.documentElement).getPropertyValue(k).trim()));
  const before = await cols();
  await page.evaluate(() => { document.documentElement.dataset.accent = "coral"; });
  assert.deepEqual(await cols(), before);
  assert.deepEqual(errors, []); await ctx.close();
});

for (const width of [320, 375, 390, 430, 768, 1280]) {
  test(`${width}px wide: nothing sideways, amounts not clipped, the account sheet fits`, { skip }, async () => {
    const b = JSON.parse(JSON.stringify(CASES.mixed));
    b.nw.accounts.a1.name = "Everyday transaction account with a very long name indeed"; b.nw.accounts.a7.balance = 1234567.89;
    const { page, errors, ctx } = await nwTab(b, { width });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const clipped = await page.$$eval(".ex-amt, .sp-figs b, .nw-head .amt, .ex-gt", els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    assert.deepEqual(clipped, [], "money is never cut off");
    await editNetWorth(page, "a2");
    assert.equal(await page.evaluate(() => { const s = document.querySelector("#sheet"); return s.scrollWidth > s.clientWidth + 1; }), false);
    if (width === 390) await page.screenshot({ path: join(SHOTS, "networth-sheet-390.png") });
    await closeSheet(page);
    assert.deepEqual(errors, []); await ctx.close();
  });
}

test("viewers can open an account to look, but not change, add, reorder or mark reviewed", { skip }, async () => {
  const init = { households: [{ id: "hh-1", name: "Mum’s budget", role: "viewer", budget: CASES.mixed }] };
  const { page, errors, ctx } = await open(null, { init });
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "View only");
  await goTab(page, "networth");
  assert.equal(await page.locator("[data-nw-new], [data-reorder], #revToday, #rev").count(), 0);
  await editNetWorth(page, "a2");
  assert.equal(await page.isDisabled('#sheet [data-f="balance"]'), true);
  assert.equal(await page.locator("#sheet [data-del]").count(), 0);
  assert.deepEqual(errors, []); await ctx.close();
});
