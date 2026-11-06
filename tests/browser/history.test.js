/* Part 4B in a real browser: the Undo button, the History panel, preview and restore. Uses the fake Supabase. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createRequire } from "node:module";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, settle, fake, goTab, setField } from "./helpers.js";

setup();
const require = createRequire(import.meta.url);
let devices = {}; try { ({ devices } = require("playwright")); } catch (_) {}
const V4 = toStored(migrate(RICH_V3));
const GROCERIES = '[data-l="sp"][data-i="s3"][data-f="amount"]';
const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
// Yesterday Madi changed Power from $150 to $180 and added a goal; today the budget is V4.
const PAST = [
  { id: 1, changed_by: "u-madi", changed_at: ago(30), kind: "edit", reason: "", ref_id: null, ref_at: null, undone_at: null, changes: [{ p: ["spend", "s2", "amount"], o: 150, n: 180 }] },
  { id: 2, changed_by: "u-madi", changed_at: ago(29), kind: "edit", reason: "", ref_id: null, ref_at: null, undone_at: null, changes: [{ p: ["goals", "joint", "g3"], n: V4.goals.joint.g3 }] },
];
const members = role => [{ user_id: "u-me", display_name: "Jarden", email: "jarden@example.com", role, joined_at: "2026-01-01" },
  { user_id: "u-madi", display_name: "Madi", email: "madi@example.com", role: "owner", joined_at: "2026-01-01" }];
const init = (role = "owner") => ({ households: [{ id: "hh-1", name: "Test household", role, budget: V4, changes: PAST, members: members(role) }] });
const budget = page => fake(page, () => window.__fake.budget);
async function openHistory(page) {
  await page.click("#menuBtn"); await page.click('[data-act="history"]');
  await page.waitForSelector("#sheet .hist-list");
}

test("Undo: appears after your change, and puts it back", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init() });
  await settle(page);
  assert.equal(await page.isVisible("#undoBtn"), false, "nothing to undo yet");
  await goTab(page, "spending");
  await setField(page, GROCERIES, "450");
  await page.waitForFunction(() => window.__fake.budget.spend.s3.amount === 450);
  await page.waitForSelector("#undoBtn:not([hidden])");
  await page.screenshot({ path: join(SHOTS, "undo-button.png") });
  await page.click("#undoBtn");
  await page.waitForSelector("#toast.on >> text=Undone");
  assert.match(await page.textContent("#toast"), /Groceries: \$450 → \$300/);
  assert.equal((await budget(page)).spend.s3.amount, 300);
  assert.equal(await page.inputValue(GROCERIES), "300", "the screen shows it too");
  await page.waitForSelector("#undoBtn", { state: "hidden" });
  const h = await fake(page, () => window.__fake.hh("hh-1").changes);
  assert.deepEqual(h.slice(-2).map(x => x.kind), ["edit", "undo"]);
  assert.ok(h.at(-2).undone_at);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Undo steps back through your changes one at a time; Ctrl+Z works too", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init() });
  await settle(page);
  await goTab(page, "spending");
  await setField(page, GROCERIES, "450");
  await page.waitForFunction(() => window.__fake.budget.spend.s3.amount === 450);
  await fake(page, () => { const h = window.__fake.hh("hh-1").changes; h[h.length - 1].changed_at = new Date(Date.now() - 600e3).toISOString(); }); // a while ago
  await setField(page, '[data-l="sp"][data-i="s1"][data-f="amount"]', "1250");
  await page.waitForFunction(() => window.__fake.budget.spend.s1.amount === 1250);
  await settle(page);
  await page.click("h2"); // out of the box, so Ctrl+Z means "undo my change" rather than "undo my typing"
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.__fake.budget.spend.s1.amount === 1200);
  assert.equal((await budget(page)).spend.s3.amount, 450, "only the last change");
  await page.click("#undoBtn");
  await page.waitForFunction(() => window.__fake.budget.spend.s3.amount === 300);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Undo leaves alone what someone else has changed since, and says so", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init() });
  await settle(page);
  await goTab(page, "spending");
  await setField(page, GROCERIES, "450");
  await page.waitForFunction(() => window.__fake.budget.spend.s3.amount === 450);
  await settle(page);
  await fake(page, () => window.__fake.remote([{ op: "set", path: ["spend", "s3", "amount"], value: 500 }], "u-madi"));
  await page.waitForFunction(sel => document.querySelector(sel).value === "500", GROCERIES);
  await page.click("#undoBtn");
  await page.waitForSelector("#toast.on >> text=Nothing to undo");
  assert.match(await page.textContent("#toast"), /Madi has changed Groceries since, so it was left as it is/);
  assert.equal((await budget(page)).spend.s3.amount, 500);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("History: changes in plain language, grouped by day, newest first", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init() });
  await settle(page);
  await goTab(page, "spending");
  await setField(page, GROCERIES, "450");
  await page.waitForFunction(() => window.__fake.budget.spend.s3.amount === 450);
  await settle(page);
  await openHistory(page);
  const days = await page.$$eval("#sheet .hist-day", els => els.map(e => e.textContent));
  assert.equal(days[0], "Today");
  const items = await page.$$eval("#sheet .hist-item .hist-text", els => els.map(e => e.textContent.trim()));
  assert.deepEqual(items.slice(0, 3), ["You changed Groceries from $300 to $450", "Madi added the joint goal “House deposit”", "Madi changed Power from $150 to $180"]);
  assert.match(await page.textContent("#sheet .hist-time"), /^\d{1,2}:\d{2}(am|pm)$/);
  await page.screenshot({ path: join(SHOTS, "history.png") });
  // Undo one of Madi's from the panel
  await page.locator("#sheet .hist-item", { hasText: "Power" }).locator("summary").click();
  await page.locator("#sheet .hist-item", { hasText: "Power" }).locator('[data-hist="undo"]').click();
  await page.waitForFunction(() => window.__fake.budget.spend.s2.amount === 150);
  await page.waitForSelector("#sheet .hist-text >> text=You undid a change: changed Power from $180 to $150");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Preview an earlier version, then restore it (and the restore can be undone)", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init() });
  await settle(page);
  await goTab(page, "spending");
  await setField(page, GROCERIES, "450");
  await page.waitForFunction(() => window.__fake.budget.spend.s3.amount === 450);
  await settle(page);
  await openHistory(page);
  // Go back to right after Madi changed Power: that undoes the goal she added and my Groceries change
  const power = page.locator("#sheet .hist-item", { hasText: "Power" });
  await power.locator("summary").click();
  await power.locator('[data-hist="preview"]').click();
  await page.waitForSelector("#sheet >> text=Going back to this version would change 2 things");
  const lines = await page.$$eval("#sheet .hist-lines li", els => els.map(e => e.textContent));
  assert.deepEqual(lines.sort(), ["Groceries: $450 → $300", "The joint goal “House deposit”: removed"].sort());
  await page.screenshot({ path: join(SHOTS, "history-preview.png") });
  assert.equal((await budget(page)).spend.s3.amount, 450, "previewing changes nothing");
  await page.click('[data-hist="restore"]');
  await page.waitForSelector("#dlg[open]");
  assert.match(await page.textContent("#dlgP"), /saved as a new change, so you can undo it/);
  await page.click("#dlgYes");
  await page.waitForFunction(() => window.__fake.budget.spend.s3.amount === 300 && !window.__fake.budget.goals.joint.g3);
  await page.waitForSelector("#sheet .hist-text >> text=You restored the version from");
  assert.equal(await page.isVisible("#sheet .chip.info >> text=Restore"), true);
  await page.click('[data-sheet="close"]');
  assert.equal(await page.inputValue(GROCERIES), "300");
  // Changed your mind: Undo brings it all back
  await page.click("#undoBtn");
  await page.waitForFunction(() => window.__fake.budget.spend.s3.amount === 450 && !!window.__fake.budget.goals.joint.g3);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("viewers can read the history and preview, but can't undo or restore", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init("viewer") });
  await page.waitForSelector("#saveText >> text=View only");
  assert.equal(await page.isVisible("#undoBtn"), false);
  await openHistory(page);
  assert.match(await page.textContent("#sheet .hist-intro"), /only owners and editors can undo/);
  assert.equal(await page.locator('#sheet [data-hist="undo"]').count(), 0);
  const power = page.locator("#sheet .hist-item", { hasText: "Power" });
  await power.locator("summary").click();
  await power.locator('[data-hist="preview"]').click();
  await page.waitForSelector("#sheet >> text=Only owners and editors can restore");
  assert.equal(await page.locator('#sheet [data-hist="restore"]').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("phone: History slides up from the bottom, fits the screen, and is easy to tap", { skip: skip || !devices["iPhone 13"] }, async () => {
  const { page, errors, ctx } = await open(null, { init: init(), device: devices["iPhone 13"] });
  await settle(page);
  await goTab(page, "spending");
  await setField(page, GROCERIES, "450");
  await page.waitForFunction(() => window.__fake.budget.spend.s3.amount === 450);
  await page.waitForSelector("#undoBtn:not([hidden])");
  const ub = await page.locator("#undoBtn").boundingBox();
  assert.ok(ub.height >= 40 && ub.width >= 40, "Undo is big enough to tap");
  await settle(page);
  await openHistory(page);
  const vp = page.viewportSize(), sh = await page.locator("#sheet").boundingBox();
  assert.ok(Math.abs(sh.y + sh.height - vp.height) < 2, "sheet sits at the bottom");
  await page.locator("#sheet .hist-item").first().locator("summary").click();
  const small = await page.$$eval("#sheet summary, #sheet .btn", els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height < 40; }).map(e => e.textContent.trim()));
  assert.deepEqual(small, []);
  assert.equal(await page.evaluate(() => { const s = document.querySelector("#sheet"); return s.scrollWidth > s.clientWidth + 1; }), false, "no sideways scrolling");
  await page.screenshot({ path: join(SHOTS, "phone-history.png") });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("offline: History explains it needs a connection, and Undo waits", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init() });
  await settle(page);
  await goTab(page, "spending");
  await setField(page, GROCERIES, "450");
  await page.waitForFunction(() => window.__fake.budget.spend.s3.amount === 450);
  await settle(page);
  await ctx.setOffline(true);
  await page.waitForFunction(() => document.querySelector("#undoBtn").disabled);
  await page.click("#menuBtn"); await page.click('[data-act="history"]');
  await page.waitForSelector("#sheet >> text=History needs a connection");
  await ctx.setOffline(false);
  await page.waitForFunction(() => !document.querySelector("#undoBtn").disabled);
  assert.deepEqual(errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e)), []);
  await ctx.close();
});
