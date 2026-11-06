/* Part 4A in a real browser: the Progress tab, snapshots, comparing with today. Uses the fake Supabase. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createRequire } from "node:module";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { clone } from "../../js/model/util.js";
import { setup, skip, SHOTS, open, settle, fake, goTab } from "./helpers.js";

setup();
const require = createRequire(import.meta.url);
let devices = {}; try { ({ devices } = require("playwright")); } catch (_) {}
const V4 = toStored(migrate(RICH_V3));

/** A snapshot k months ago (NZ month), with Joint Savings and the car loan set to given balances. */
function past(k, savings, carLoan, couchSaved) {
  const d = clone(V4);
  d.nw.accounts.n2.balance = savings; d.nw.accounts.n5.balance = carLoan;
  if (couchSaved !== undefined) d.goals.joint.g2.saved = couchSaved;
  const now = new Date(), m = new Date(now.getFullYear(), now.getMonth() - k, 1);
  const month = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-01`;
  return { id: 100 + k, month, kind: "monthly", taken_at: `${month}T00:10:00+13:00`, taken_by: null,
    data: { version: 4, people: Object.fromEntries(Object.entries(d.people).map(([i, p]) => [i, { id: p.id, name: p.name, colour: p.colour, pos: p.pos }])), nw: d.nw, goals: d.goals } };
}
// Today: savings 12,000, car loan 6,000. Last month: 11,760 and 6,200 → net worth up $440.
const HISTORY = [past(3, 10000, 7000, 0), past(2, 11000, 6500, 0), past(1, 11760, 6200, 100)];
const withHistory = (role = "owner", extra = {}) => ({ households: [{ id: "hh-1", name: "Test household", role, budget: V4, snapshots: HISTORY,
  members: [{ user_id: "u-me", display_name: "Jarden", email: "jarden@example.com", role, joined_at: "2026-01-01" }, { user_id: "u-madi", display_name: "Madi", email: "madi@example.com", role: "owner", joined_at: "2026-01-01" }] }], ...extra });

test("empty state explains snapshots, and 'Save a snapshot now' starts the charts", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: { budget: V4, noAutoSnapshot: true } });
  await settle(page);
  await goTab(page, "progress");
  await page.waitForSelector("text=Your progress will show here");
  assert.match(await page.textContent(".pg-empty"), /1st of every month/);
  assert.equal(await page.isVisible("#app .viewas"), false, "no 'show amounts per' on Progress");
  await page.screenshot({ path: join(SHOTS, "progress-empty.png"), fullPage: true });
  await page.click('[data-snap="save"]');
  await page.waitForSelector("text=Snapshot saved");
  await page.waitForSelector("#pgNet svg");
  assert.equal(await page.locator(".pg-list li").count(), 1);
  assert.match(await page.textContent(".pg-list"), /Saved by you/);
  assert.match(await page.textContent("#pgNotes"), /starting point/);
  assert.equal(await fake(page, () => window.__fake.hh("hh-1").snapshots.length), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("trends: net worth chart, the mix, goals, and plain-language notes", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: withHistory() });
  await settle(page);
  // Opening the household took this month's snapshot automatically
  await page.waitForFunction(() => window.__fake.hh("hh-1").snapshots.length === 4);
  await goTab(page, "progress");
  await page.waitForSelector("#pgNet svg circle");
  const notes = await page.textContent("#pgNotes");
  assert.match(notes, /Net worth is up \$440 since/);
  assert.match(notes, /You’ve paid \$200 off your debts since/);
  assert.equal(await page.locator("#pgNet circle").count(), 5, "4 months + today");
  assert.ok(await page.locator("#pgMix rect").count() >= 10, "stacked bars for each month");
  assert.match(await page.textContent("#pgGoals"), /New couch/);
  assert.match(await page.textContent("#pgGoals"), /10% there, up \$100 this month/);
  await page.screenshot({ path: join(SHOTS, "progress.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("compare any snapshot with today", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: withHistory() });
  await settle(page);
  await goTab(page, "progress");
  await page.waitForSelector(".pg-list li");
  await page.click(`[data-compare="101"]`);
  await page.waitForSelector("#pgCompare");
  const row = label => page.locator("#pgCompare tr", { has: page.locator("td.c-name b", { hasText: label }) }).first();
  assert.equal((await row("Net worth").locator("td").last().textContent()).trim(), "+$440");
  assert.equal((await row("Debt").locator("td").last().textContent()).trim(), "−$200");
  assert.match(await row("Debt").locator(".chip").getAttribute("class"), /ok/, "less debt shows as good news");
  assert.equal((await row("Joint Savings").locator("td").last().textContent()).trim(), "+$240");
  await page.screenshot({ path: join(SHOTS, "progress-compare.png"), fullPage: true });
  await page.click('[data-compare="close"]');
  assert.equal(await page.isVisible("#pgCompare"), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("viewers can see progress but not save snapshots", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: withHistory("viewer") });
  await goTab(page, "progress");
  await page.waitForSelector("#pgNet svg");
  assert.equal(await page.isDisabled('[data-snap="save"]'), true);
  assert.match(await page.textContent(".pg-save"), /Only owners and editors/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("offline: Progress shows the copy saved on this device", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: withHistory(), device: devices["iPhone 13"] });
  await settle(page);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 });
  await page.waitForFunction(() => Object.keys(localStorage).some(k => k.startsWith("mb-snaps-v1-")));
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector("#app .viewas");
  await goTab(page, "progress");
  await page.waitForSelector("#pgNet svg circle");
  assert.equal(await page.isDisabled('[data-snap="save"]'), true);
  assert.match(await page.textContent(".pg-save"), /needs a connection/);
  await page.screenshot({ path: join(SHOTS, "phone-progress-offline.png"), fullPage: true });
  assert.deepEqual(errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e)), []);
  await ctx.close();
});
