/* Part 4C in a real browser: the bell, the inbox, and Reminder settings. Uses the fake Supabase. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createRequire } from "node:module";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, settle, fake } from "./helpers.js";

setup();
const require = createRequire(import.meta.url);
let devices = {}; try { ({ devices } = require("playwright")); } catch (_) {}
const V4 = toStored(migrate(RICH_V3));
const ago = d => new Date(Date.now() - d * 864e5).toISOString();
const INBOX = [
  { id: 1, kind: "sink_behind", title: "Car rego is behind by $50", body: "Put aside $10 a fortnight to be ready by Jul 2027.", tab: "spending", created_at: ago(0), read_at: null },
  { id: 2, kind: "goal_done", title: "🎉 Holiday is fully funded!", body: "Holiday has reached its target of $3,000. Nice work.", tab: "goals", created_at: ago(1), read_at: null },
  { id: 3, kind: "review", title: "Time to review your balances", body: "Update your account balances on the Net worth tab.", tab: "networth", created_at: ago(9), read_at: ago(8) },
];
const init = (reminders = INBOX, role = "owner", remPrefs = null) => ({ households: [{ id: "hh-1", name: "Test household", role, budget: V4, reminders, remPrefs }] });

test("the bell shows how many reminders are new, and the inbox lists them", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init() });
  await settle(page);
  await page.waitForSelector("#bellCount:not([hidden])");
  assert.equal(await page.getAttribute("#bellCount", "aria-hidden"), "true", "a dot (the number is in the bell's label)");
  assert.equal(await page.getAttribute("#bellBtn", "aria-label"), "Notifications, 2 unread");
  await page.click("#bellBtn");
  await page.waitForSelector("#drawer .rem-list");
  assert.deepEqual(await page.$$eval("#drawer .rem-item b", els => els.map(e => e.textContent)), ["Car rego is behind by $50", "🎉 Holiday is fully funded!", "Time to review your balances"]);
  assert.match(await page.textContent("#drawer .rem-item:first-child"), /Today/);
  assert.match(await page.textContent("#drawer .rem-bar"), /2 new/);
  await page.screenshot({ path: join(SHOTS, "reminders-inbox.png") });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("'Take me there' opens the right tab and marks it read; 'Mark all as read' clears the badge", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init() });
  await settle(page);
  await page.click("#bellBtn");
  await page.click('#drawer [data-rem="go"][data-id="1"]');
  await page.waitForSelector('[data-tab="spending"][aria-selected="true"]');
  assert.equal(await page.isVisible("#sheet"), false);
  assert.equal(await page.getAttribute("#bellBtn", "aria-label"), "Notifications, 1 unread");
  await page.waitForFunction(() => window.__fake.remUpdates.some(u => u.ids.includes(1) && u.read_at));
  await page.click("#bellBtn");
  await page.click('#drawer [data-rem="readall"]');
  await page.waitForSelector("#bellCount", { state: "hidden" });
  assert.match(await page.textContent("#drawer .rem-bar"), /All caught up/);
  await page.waitForFunction(() => window.__fake.hh("hh-1").reminders.every(r => r.read_at));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("settings: everything starts off; switching one on saves it and shows what you'd get today", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init([]) });
  await settle(page);
  await page.click("#bellBtn");
  await page.waitForSelector("#drawer >> text=You’re all caught up");
  await page.click('#drawer [data-rem="settings"]');
  await page.waitForSelector("#sheet .rem-switches");
  assert.equal(await page.locator('#sheet [data-pref]').count(), 6);
  assert.equal(await page.locator('#sheet [data-pref]:checked').count(), 0, "all off to start with");
  assert.match(await page.textContent("#sheet .rem-preview"), /Nothing: every reminder is off/);
  await page.click('#sheet label:has([data-pref="goal_done"])');
  await page.waitForFunction(() => window.__fake.prefSaves.length === 1);
  const saved = await fake(page, () => window.__fake.prefSaves[0]);
  assert.equal(saved.goal_done, true); assert.equal(saved.review, false); assert.equal(saved.user_id, "u-me"); assert.equal(saved.household_id, "hh-1");
  assert.match(await page.textContent("#sheet .rem-preview"), /Holiday is fully funded/);
  // The yearly-bill switch brings its "how many weeks ahead" choice
  await page.click('#sheet label:has([data-pref="sink_due"])');
  await page.selectOption('#sheet [data-pref-n="due_weeks"]', "4");
  await page.waitForFunction(() => window.__fake.prefSaves.at(-1).due_weeks === 4 && window.__fake.prefSaves.at(-1).sink_due === true);
  await page.screenshot({ path: join(SHOTS, "reminder-settings.png") });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("settings remember what you chose last time", { skip }, async () => {
  const prefs = { user_id: "u-me", household_id: "hh-1", review: true, review_day: 15, sink_due: false, due_weeks: 6, sink_behind: true, goal_done: false, goal_risk: false, allocation: false };
  const { page, errors, ctx } = await open(null, { init: init([], "owner", prefs) });
  await settle(page);
  await page.click("#bellBtn"); await page.click('#drawer [data-rem="settings"]'); // Phase 9A.1: from the bell (no longer in your menu)
  await page.waitForSelector("#sheet .rem-switches");
  assert.deepEqual(await page.$$eval("#sheet [data-pref]:checked", els => els.map(e => e.dataset.pref)), ["review", "sink_behind"]);
  assert.equal(await page.inputValue('#sheet [data-pref-n="review_day"]'), "15");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("viewers can have reminders too", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init(INBOX, "viewer") });
  await page.waitForSelector("#saveText >> text=View only");
  await page.waitForSelector("#bellCount:not([hidden])");
  await page.click("#bellBtn");
  await page.click('#drawer [data-rem="settings"]');
  await page.click('#sheet label:has([data-pref="review"])');
  await page.waitForFunction(() => window.__fake.prefSaves.length === 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("phone: the bell fits the header, the inbox slides up, and switches are easy to tap", { skip: skip || !devices["iPhone 13"] }, async () => {
  const { page, errors, ctx } = await open(null, { init: init(), device: devices["iPhone 13"] });
  await settle(page);
  const bb = await page.locator("#bellBtn").boundingBox();
  assert.ok(bb.width >= 40 && bb.height >= 40);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  await page.click("#bellBtn");
  await page.waitForSelector("#drawer .rem-list");
  const vp = page.viewportSize(), dr = await page.locator("#drawer").boundingBox();
  assert.ok(dr.x + dr.width >= vp.width - 1 && dr.width < vp.width, "notifications slide in from the right, with the page still showing");
  await page.screenshot({ path: join(SHOTS, "phone-reminders.png") });
  await page.click('#drawer [data-rem="settings"]');
  await page.waitForSelector("#sheet .rem-switches");
  const small = await page.$$eval("#sheet .switch-row, #sheet .btn, #sheet select", els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height < 40; }).map(e => e.textContent.trim().slice(0, 30)));
  assert.deepEqual(small, []);
  assert.equal(await page.evaluate(() => { const s = document.querySelector("#sheet"); return s.scrollWidth > s.clientWidth + 1; }), false);
  await page.screenshot({ path: join(SHOTS, "phone-reminder-settings.png") });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("offline: the inbox shows the copy on this device; settings need a connection; signing out clears it", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init() });
  await settle(page);
  await page.waitForSelector("#bellCount:not([hidden])");
  await ctx.setOffline(true);
  await page.click("#bellBtn");
  await page.waitForSelector("#drawer >> text=saved on this device");
  assert.equal(await page.locator("#drawer .rem-item").count(), 3);
  await page.click('#drawer [data-rem="settings"]');
  await page.waitForSelector("#sheet >> text=needs a connection");
  await page.click('#sheet [data-sheet="close"]');
  await ctx.setOffline(false);
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith("mb-rem-v1-"))));
  await page.click("#menuBtn"); await page.click('[data-act="signout"]');
  await page.waitForSelector("#fSignin");
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(k => /^mb-(rem|snaps|cache)-v1-/.test(k))), [], "no household data left on the device");
  assert.equal(await page.isVisible("#bellBtn"), false);
  assert.deepEqual(errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e)), []);
  await ctx.close();
});
