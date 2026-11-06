/* UI phase 4, Progress: the redesigned history. The maths is unchanged (js/model/snapshots.js, covered
   by tests/snapshots.test.js and progress.test.js); these check what's shown is only recorded history,
   that looking never writes anything, and the sparse, falling and failing cases. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { clone } from "../../js/model/util.js";
import { setup, skip, SHOTS, open, settle, fake, goTab, setField, closeSheet, editNetWorth } from "./helpers.js";

setup();
const V4 = toStored(migrate(RICH_V3));
/** A monthly snapshot k months ago with Joint Savings and the car loan at given balances. */
function past(k, savings, carLoan, couchSaved) {
  const d = clone(V4);
  d.nw.accounts.n2.balance = savings; d.nw.accounts.n5.balance = carLoan;
  if (couchSaved !== undefined) d.goals.joint.g2.saved = couchSaved;
  const now = new Date(), m = new Date(now.getFullYear(), now.getMonth() - k, 1);
  const month = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-01`;
  return { id: 100 + k, month, kind: "monthly", taken_at: `${month}T00:10:00+13:00`, taken_by: null,
    data: { version: 4, people: Object.fromEntries(Object.entries(d.people).map(([i, p]) => [i, { id: p.id, name: p.name, colour: p.colour, pos: p.pos }])), nw: d.nw, goals: d.goals } };
}
// Today: savings 12,000 and car loan 6,000 → net worth $45,500. A month ago: $45,060.
const LONG = [past(9, 8000, 8000, 0), past(3, 10000, 7000, 0), past(2, 11000, 6500, 0), past(1, 11760, 6200, 100)];
const init = (snaps, budget = V4, role = "owner") => ({ noAutoSnapshot: true, households: [{ id: "hh-1", name: "Test household", role, budget, snapshots: snaps,
  members: [{ user_id: "u-me", display_name: "Jarden", email: "j@example.com", role, joined_at: "2026-01-01" }] }] });
const pgTab = async (snaps, o = {}) => { const r = await open(null, { init: init(snaps, o.budget), width: o.width || 1280 }); await settle(r.page); await goTab(r.page, "progress"); await r.page.waitForSelector(".pg-hero"); return r; };
const stored = page => fake(page, () => JSON.stringify(window.__fake.hh("hh-1").snapshots));

test("history chart: one dot per recorded month plus today; ranges only filter; picking and filtering never write", { skip }, async () => {
  const { page, errors, ctx } = await pgTab(LONG, { width: 390 });
  const before = await stored(page);
  assert.equal(await page.locator("#pgNet circle").count(), 5, "4 recorded months + today");
  assert.deepEqual(await page.$$eval("[data-pg-range]", els => els.map(e => e.textContent)), ["6M", "All"]);
  assert.match(await page.textContent("#pgRead"), /^Today · current balances.*Net worth \$45,500/);
  await page.focus("#pgNet"); await page.keyboard.press("ArrowLeft");
  assert.match(await page.textContent("#pgRead"), /Net worth \$45,060/, "the last recorded snapshot");
  await page.click('[data-pg-range="6m"]');
  assert.equal(await page.locator("#pgNet circle").count(), 4, "the 9-month-old snapshot is filtered out, nothing added");
  await page.screenshot({ path: join(SHOTS, "progress-390.png"), fullPage: true });
  assert.equal(await stored(page), before, "no snapshot was created or changed");
  assert.equal(await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "save_snapshot_now").length), 0);
  assert.deepEqual(errors, []); await ctx.close();
});

test("the top: net worth today, the change since last month with words, and debt changes worded the right way round", { skip }, async () => {
  let o = await pgTab(LONG);
  assert.match(await o.page.textContent(".pg-hero .sp-head"), /\$45,500\s*net worth today/);
  assert.match(await o.page.textContent(".pg-delta"), /\+\$440\s*since/);
  assert.equal(await o.page.locator(".pg-delta .chip.ok").count(), 1);
  const debt = o.page.locator(".pg-rows li", { hasText: "Debt" });
  assert.equal((await debt.locator(".chip").textContent()).trim(), "$200 less owed");
  assert.equal(await debt.locator(".chip.ok").count(), 1, "less debt is good news");
  await o.ctx.close();
  // today worse than last month: more debt, less savings
  const worse = clone(V4); worse.nw.accounts.n2.balance = 11000; worse.nw.accounts.n5.balance = 6700;
  o = await pgTab(LONG, { budget: worse });
  assert.match(await o.page.textContent(".pg-delta"), /−\$1,260\s*since/);
  assert.equal(await o.page.locator(".pg-delta .chip.bad").count(), 1, "a fall isn't hidden");
  assert.equal((await o.page.locator(".pg-rows li", { hasText: "Debt" }).locator(".chip.bad").textContent()).trim(), "$500 more owed");
  assert.deepEqual(o.errors, []); await o.ctx.close();
});

test("sparse history: no snapshots, then one: no trend line is drawn from a single point", { skip }, async () => {
  let o = await pgTab([], { width: 390 });
  assert.match(await o.page.textContent(".pg-start"), /Your journey starts here/);
  assert.match(await o.page.textContent(".pg-start .sp-head"), /\$45,500/);
  assert.equal(await o.page.locator("#pgNet, .pg-delta .chip").count(), 0, "no chart and no made-up change");
  await o.page.screenshot({ path: join(SHOTS, "progress-empty-390.png") });
  await o.ctx.close();
  o = await pgTab([past(1, 11760, 6200, 100)], { width: 390 });
  assert.equal(await o.page.locator("#pgNet").count(), 0);
  assert.match(await o.page.textContent(".pg-two"), /\$45,060[\s\S]*Today[\s\S]*\$45,500/);
  assert.match(await o.page.textContent(".pg-sparse"), /Nothing is filled in between/);
  assert.equal(await o.page.locator("#pgMixBox").count(), 0, "no mix chart from one snapshot");
  assert.deepEqual(o.errors, []); await o.ctx.close();
});

test("compare: pick a snapshot; both sides are labelled; a goal deleted since still shows its recorded amount", { skip }, async () => {
  const b = clone(V4); delete b.goals.joint.g3;
  const { page, errors, ctx } = await pgTab(LONG, { budget: b });
  await page.selectOption("#pgCmpSel", "102");
  await page.waitForSelector(".pg-cmp-l");
  assert.match(await page.textContent(".pg-cmp-h"), /Then[\s\S]*Now\s*Today/);
  const row = label => page.locator(".pg-cmp-l li", { has: page.locator(".pg-cmp-n b", { hasText: label }) }).first();
  assert.equal((await row("Net worth").locator(".chip").textContent()).trim(), "+$1,500");
  assert.match(await row("House deposit").textContent(), /\$0 → —/, "recorded then, gone now: shown, not invented");
  await page.click('.pg-hl [data-compare="101"]');
  assert.equal(await page.inputValue("#pgCmpSel"), "101", "the History list and the picker agree");
  assert.deepEqual(errors, []); await ctx.close();
});

test("saving: one snapshot per tap even if tapped twice; a failure says so and saves nothing", { skip }, async () => {
  const { page, errors, ctx } = await pgTab(LONG);
  const count = () => fake(page, () => window.__fake.hh("hh-1").snapshots.length);
  await page.locator('.pg-hero [data-snap="save"]').dblclick();
  await page.waitForSelector("text=Snapshot saved");
  assert.equal(await count(), 5, "just one new snapshot");
  await fake(page, () => { window.__fake.failNext = 1; });
  await page.click('.pg-hero [data-snap="save"]');
  await page.waitForFunction(() => /Failed to fetch|connection|Couldn’t/i.test(document.querySelector("#toast")?.textContent || ""));
  assert.equal(await count(), 5, "nothing saved");
  assert.equal(await page.locator('.pg-hero [data-snap="save"]').isDisabled(), false, "ready to try again");
  assert.deepEqual(errors, []); await ctx.close();
});

test("history stays as recorded: changing today's balances only changes Today", { skip }, async () => {
  const { page, errors, ctx } = await pgTab(LONG);
  const before = await stored(page), listBefore = await page.textContent(".pg-hl .pg-list");
  await goTab(page, "networth");
  await editNetWorth(page, "n2"); await setField(page, '#sheet [data-f="balance"]', "20000"); await closeSheet(page); await settle(page);
  await goTab(page, "progress");
  assert.match(await page.textContent(".pg-hero .sp-head"), /\$53,500/);
  assert.equal(await stored(page), before, "snapshots untouched");
  assert.equal(await page.textContent(".pg-hl .pg-list"), listBefore);
  assert.deepEqual(errors, []); await ctx.close();
});

for (const width of [320, 375, 390, 430, 768, 1280]) {
  test(`${width}px wide: nothing sideways, figures not clipped (big and negative values)`, { skip }, async () => {
    const b = clone(V4); b.nw.accounts.n5.balance = 1250000;                         // net worth well below zero
    const { page, errors, ctx } = await pgTab(LONG, { budget: b, width });
    await page.selectOption("#pgCmpSel", "101");
    await page.click("#pgMixBox summary");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const clipped = await page.$$eval(".sp-head .amt, .pg-rows b, .pg-g-v, .pg-nw", els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    assert.deepEqual(clipped, [], "money is never cut off");
    assert.doesNotMatch(await page.textContent("#app"), /NaN|Infinity|undefined/);
    assert.deepEqual(errors, []); await ctx.close();
  });
}
