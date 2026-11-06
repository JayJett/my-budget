/* UI phase 4, Invest: the redesigned forecast. The first test is the safety net: every figure the tab
   works out must be exactly what the old screen produced (tests/browser/invest-baseline.json, recorded
   before the redesign) in eight situations and all three periods. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, settle, fake, goTab, setField, closeSheet, editAccount, editNetWorth } from "./helpers.js";
import { tabFigures } from "./nwgoals-figures.mjs";
import { investCases } from "./invest-figures.mjs";

setup();
const CASES = investCases(RICH_V3, toStored, migrate);
const BASE = JSON.parse(readFileSync(new URL("./invest-baseline.json", import.meta.url), "utf8"));
const ivTab = async (budget, o = {}) => { const r = await open(budget, o); await settle(r.page); await goTab(r.page, "invest"); await r.page.waitForSelector("#ivChart svg"); return r; };
const text = (page, k) => page.textContent(`[data-k="${k}"]`);
const writes = page => fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops").length);

test("every Invest figure is exactly what the old screen worked out (eight situations × week, fortnight, month)", { skip }, async () => {
  for (const [name, budget] of Object.entries(CASES)) {
    const now = await tabFigures("invest", budget);
    for (const period of ["week", "fortnight", "month"])
      for (const [k, v] of Object.entries(BASE[name][period])) assert.equal(now[period][k], v, `${name} ${period} ${k}`);
  }
});

test("the forecast leads; years ahead and milestones show the same figure as the yearly table", { skip }, async () => {
  const { page, errors, ctx } = await ivTab(CASES.rich, { width: 390 });
  assert.equal(await text(page, "iv.h.bal"), await text(page, "iv.m30"));
  assert.equal(await text(page, "iv.h.lab"), "Projected in 30 years");
  assert.match(await page.textContent(".iv-hero"), /not a guarantee/);
  assert.equal(await page.locator(".iv-page input, .iv-page select").count(), 0, "no form fields on the page");
  assert.equal(await page.locator(".viewas").count(), 0);
  await page.click('.iv-h [data-iv-h="10"]');
  assert.equal(await text(page, "iv.h.lab"), "Projected in 10 years");
  assert.equal(await text(page, "iv.h.bal"), await text(page, "iv.m10"));
  assert.equal(await text(page, "iv.h.bal"), await text(page, "iv.y10.b"));
  assert.match(await page.textContent("#ivRead"), /^Year 10/);
  await page.click('.iv-m[data-iv-h="20"]');
  assert.equal(await text(page, "iv.h.bal"), await text(page, "iv.m20"));
  assert.equal(await page.getAttribute('.iv-h [data-iv-h="20"]', "aria-pressed"), "true");
  await page.screenshot({ path: join(SHOTS, "invest-390.png"), fullPage: true });
  assert.deepEqual(errors, []); await ctx.close();
});

test("the chart: tap, drag or arrow keys pick a year; the figures beside it come from the projection; nothing is saved", { skip }, async () => {
  const { page, errors, ctx } = await ivTab(CASES.rich, { width: 390 });
  const before = await writes(page);
  const box = await page.locator("#ivChart svg").boundingBox();
  await page.mouse.click(box.x + 50 + (box.width - 64) * 0.5, box.y + box.height / 2);
  assert.match(await page.textContent("#ivRead"), /^Year 15/);
  assert.match(await page.textContent("#ivRead"), new RegExp(`Balance ${(await text(page, "iv.y15.b")).replace("$", "\\$")}`));
  await page.focus("#ivChart"); await page.keyboard.press("ArrowLeft");
  assert.match(await page.textContent("#ivRead"), /^Year 14/);
  await page.keyboard.press("Home");
  assert.match(await page.textContent("#ivRead"), /^Now.*Balance \$8,000/, "year 0 is the starting balance");
  await page.keyboard.press("End");
  assert.match(await page.textContent("#ivRead"), /^Year 30/);
  // a touch drag across the chart doesn't scroll the page sideways
  assert.equal(await page.$eval("#ivChart svg", e => getComputedStyle(e).touchAction), "pan-y");
  assert.equal(await writes(page), before, "looking at the chart never saves anything");
  assert.deepEqual(errors, []); await ctx.close();
});

test("assumptions: shown compactly, adjusted in a sheet, saved as before", { skip }, async () => {
  const { page, errors, ctx } = await ivTab(CASES.rich);
  assert.deepEqual([await text(page, "iv.as.rate"), await text(page, "iv.as.growth"), await text(page, "iv.as.fee")], ["7%", "2%", "0.5%"]);
  const was = await text(page, "iv.h.bal");
  await page.click("[data-iv-edit]");
  await page.waitForSelector('#sheet [data-f="invest.rate"]');
  await setField(page, '#sheet [data-f="invest.rate"]', "5");
  await page.waitForFunction(w => document.querySelector('[data-k="iv.h.bal"]').textContent !== w, was);
  assert.match(await page.textContent("#sheet"), /Fees of 0\.50% a year cost you about/);
  await closeSheet(page); await settle(page);
  assert.equal((await fake(page, () => window.__fake.budget.invest.rate)), 0.05);
  assert.equal(await text(page, "iv.as.rate"), "5%");
  assert.deepEqual(errors, []); await ctx.close();
});

test("starting balance comes from Net worth and the amount going in from Budget", { skip }, async () => {
  const { page, errors, ctx } = await ivTab(CASES.rich);
  assert.equal(await text(page, "iv.start"), "$8,000");
  const per = await text(page, "iv.per");
  await page.click('.iv-src-i[data-tab="networth"]');
  await page.waitForSelector('[data-tab="networth"][aria-selected="true"]');
  await editNetWorth(page, "n3"); await setField(page, '#sheet [data-f="balance"]', "10000"); await closeSheet(page);
  await goTab(page, "budget");
  await editAccount(page, "ji"); await setField(page, '#sheet [data-f="split.j"]', "20"); await closeSheet(page); await settle(page);
  await goTab(page, "invest");
  assert.equal(await text(page, "iv.start"), "$10,000");
  assert.notEqual(await text(page, "iv.per"), per);
  assert.match(await page.textContent("#ivRead"), /^Year 30/);
  assert.deepEqual(errors, []); await ctx.close();
});

test("yearly breakdown: hidden until asked for, then every year with every column", { skip }, async () => {
  const { page, errors, ctx } = await ivTab(CASES.rich, { width: 390 });
  assert.equal(await page.isVisible("#ivYears tbody"), false);
  await page.click("#ivYears summary");
  assert.equal(await page.locator("#ivYears tbody tr").count(), 30);
  assert.deepEqual(await page.$$eval("#ivYears thead th", els => els.map(e => e.textContent.replace("?", "").trim())), ["Year", "Put in", "Balance", "Growth", "Multiplier"]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "the table scrolls inside its box, not the page");
  assert.deepEqual(errors, []); await ctx.close();
});

test("edge cases: nothing invested, a falling market, very large balances: never NaN or Infinity", { skip }, async () => {
  for (const name of ["nothing", "negative", "big", "noContrib", "noStart", "flat"]) {
    const { page, errors, ctx } = await ivTab(CASES[name], { width: 320 });
    await page.click("#ivYears summary");
    assert.doesNotMatch(await page.textContent("#app"), /NaN|Infinity|undefined/, name);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name);
    if (name === "negative") assert.match(await text(page, "iv.h.g"), /^−\$/, "growth can be negative and says so");
    if (name === "nothing") assert.equal(await text(page, "iv.h.bal"), "$0");
    assert.deepEqual(errors, [], name); await ctx.close();
  }
});

test("series colours never follow the accent; viewers can look at the assumptions but not change them", { skip }, async () => {
  let o = await ivTab(CASES.rich);
  const col = () => o.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--invest").trim());
  const before = await col();
  await o.page.evaluate(() => { document.documentElement.dataset.accent = "lavender"; });
  assert.equal(await col(), before);
  await o.ctx.close();
  const init = { households: [{ id: "hh-1", name: "Mum’s budget", role: "viewer", budget: CASES.rich }] };
  o = await open(null, { init });
  await o.page.waitForFunction(() => document.querySelector("#saveText").textContent === "View only");
  await goTab(o.page, "invest");
  assert.equal(await o.page.textContent("[data-iv-edit]"), "View");
  await o.page.click("[data-iv-edit]");
  assert.equal(await o.page.isDisabled('#sheet [data-f="invest.rate"]'), true);
  assert.deepEqual(o.errors, []); await o.ctx.close();
});

for (const width of [320, 375, 390, 430, 768, 1280]) {
  test(`${width}px wide: nothing sideways, figures not clipped, the chart and sheet fit`, { skip }, async () => {
    const { page, errors, ctx } = await ivTab(CASES.big, { width });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const clipped = await page.$$eval(".sp-head .amt, .sp-figs b, .iv-src-i b, .iv-m b, .iv-as-l b", els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    assert.deepEqual(clipped, [], "money is never cut off");
    const c = await page.locator("#ivChart svg").boundingBox();
    assert.ok(c.x >= 0 && c.x + c.width <= width + 1, "the chart fits");
    await page.click("[data-iv-edit]"); await page.waitForSelector('#sheet [data-f="invest.fee"]');
    assert.equal(await page.evaluate(() => { const s = document.querySelector("#sheet"); return s.scrollWidth > s.clientWidth + 1; }), false);
    if (width === 390) await page.screenshot({ path: join(SHOTS, "invest-sheet-390.png") });
    await closeSheet(page);
    assert.deepEqual(errors, []); await ctx.close();
  });
}
