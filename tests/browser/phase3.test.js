/* Phase 3 in a real browser: phone layout (emulated iPhone and Android), offline use, and updates.
   Uses the fake Supabase, which also behaves as if it's unreachable when the device is offline. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createRequire } from "node:module";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, settle, fake, goTab, setField, publishNewVersion } from "./helpers.js";

setup();
const require = createRequire(import.meta.url);
let devices = {};
try { ({ devices } = require("playwright")); } catch (_) {}
const IPHONE = devices["iPhone 13"], PIXEL = devices["Pixel 7"];
const V4 = toStored(migrate(RICH_V3)); // the budget as it's saved today (version 4)

/** Things on screen that are too small to tap comfortably (under 40px tall or wide). */
const tinyTargets = page => page.evaluate(() => {
  const els = [...document.querySelectorAll("#app button, #app input:not([type=hidden]), #app select, #tabs button, .top button")];
  return els.filter(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && (r.height < 40 || r.width < 40) && !el.closest(".unit"); })
    .map(el => `${el.tagName.toLowerCase()}.${el.className || ""}[${el.getAttribute("aria-label") || el.textContent.trim().slice(0, 20)}] ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
});
const sideways = page => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

for (const [name, device] of [["iPhone", IPHONE], ["Android", PIXEL]]) {
  test(`${name}: bottom tab bar, cards, big tap targets, no sideways scrolling`, { skip: skip || (!device && "no device profile") }, async () => {
    const { page, errors, ctx } = await open(V4, { device });
    await settle(page);
    const vh = page.viewportSize().height;
    const bar = await page.locator("#tabs").boundingBox();
    assert.ok(Math.abs(bar.y + bar.height - vh) < 2, "tab bar sits at the bottom of the screen");
    assert.equal(await page.isVisible("#tabs .ts >> text=Spending"), true, "short tab names");
    for (const tab of ["budget", "networth", "spending", "goals", "invest", "progress"]) {
      await goTab(page, tab);
      assert.equal(await sideways(page), false, `${tab}: no sideways scrolling`);
      assert.deepEqual(await tinyTargets(page), [], `${tab}: everything is big enough to tap`);
      if (name === "iPhone") await page.screenshot({ path: join(SHOTS, `phone-${tab}.png`), fullPage: true });
    }
    await goTab(page, "budget");
    // Tables are cards: no column headings, each row is its own box
    assert.equal(await page.isVisible(".w-acc thead"), false);
    assert.equal(await page.locator(".w-acc tbody tr").first().evaluate(el => getComputedStyle(el).display), "block");
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("phone: money and % boxes bring up the number keypad, and text is big enough not to zoom", { skip: skip || !IPHONE }, async () => {
  const { page, errors, ctx } = await open(V4, { device: IPHONE });
  await settle(page);
  const bad = await page.evaluate(() => [...document.querySelectorAll('#app input[data-t="num"], #app input[data-t="pct"]')]
    .filter(i => i.inputMode !== "decimal").map(i => i.getAttribute("aria-label")));
  assert.deepEqual(bad, [], "every money and % box uses the decimal keypad");
  const small = await page.evaluate(() => [...document.querySelectorAll("#app input, #app select")]
    .filter(i => i.offsetParent && parseFloat(getComputedStyle(i).fontSize) < 16).map(i => i.getAttribute("aria-label") || i.name));
  assert.deepEqual(small, [], "iPhones zoom in on boxes with text under 16px");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("phone: move rows with the up/down buttons instead of dragging", { skip: skip || !IPHONE }, async () => {
  const { page, errors, ctx } = await open(V4, { device: IPHONE });
  await settle(page);
  await goTab(page, "spending");
  assert.equal(await page.isVisible(".grip"), false);
  await page.click('[data-move="up"][data-i="s3"]');
  await settle(page);
  const order = Object.values(await fake(page, () => window.__fake.budget.spend)).sort((a, b) => a.pos - b.pos).map(s => s.id);
  assert.deepEqual(order.slice(0, 3), ["s1", "s3", "s2"]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("phone: the menu and settings slide up from the bottom", { skip: skip || !IPHONE }, async () => {
  const { page, errors, ctx } = await open(V4, { device: IPHONE });
  await settle(page);
  await page.click("#menuBtn");
  const pop = await page.locator("#pop").boundingBox(), vp = page.viewportSize();
  assert.ok(Math.abs(pop.y + pop.height - vp.height) < 2 && pop.width >= vp.width - 1, "menu is a full-width sheet at the bottom");
  await page.screenshot({ path: join(SHOTS, "phone-menu.png") });
  await page.click('[data-act="household"]');
  await page.waitForSelector("#sheet[open]");
  const sheet = await page.locator("#sheet").boundingBox();
  assert.ok(Math.abs(sheet.y + sheet.height - vp.height) < 2, "settings sit at the bottom");
  await page.screenshot({ path: join(SHOTS, "phone-settings.png") });
  assert.deepEqual(errors, []);
  await ctx.close();
});

/** Open the app and wait until the service worker has stored it and is in charge. */
async function openInstalled(opts) {
  const o = await open(V4, opts);
  await settle(o.page);
  await o.page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 });
  return o;
}

test("offline: the app opens with no connection, edits are kept, and they sync when back online", { skip }, async () => {
  const { page, errors, ctx } = await openInstalled({ device: IPHONE });
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector("#app .viewas");
  assert.match(await page.textContent("#conn"), /You’re offline/);
  assert.equal(await page.textContent("#saveText"), "Offline");
  assert.equal(await page.inputValue('[data-f="note"]'), "Test budget", "the budget comes from this phone");
  await setField(page, '[data-l="pp"][data-i="j"][data-f="pay"]', "2500");
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "Offline");
  await page.screenshot({ path: join(SHOTS, "phone-offline.png") });
  // Close and reopen while still offline: the edit is still there
  await page.reload();
  await page.waitForSelector("#app .viewas");
  assert.equal(await page.inputValue('[data-l="pp"][data-i="j"][data-f="pay"]'), "2,500");
  // Back online: the app reconnects and sends the edit
  await ctx.setOffline(false);
  await page.waitForFunction(() => window.__fake && window.__fake.rpcCalls.some(c => c.name === "apply_budget_ops"), null, { timeout: 15000 });
  await settle(page);
  assert.equal(await fake(page, () => window.__fake.budget.people.j.pay), 2500);
  const ops = await fake(page, () => window.__fake.rpcCalls.find(c => c.name === "apply_budget_ops").args.p_ops);
  assert.deepEqual(ops, [{ op: "set", path: ["people", "j", "pay"], value: 2500 }], "just the change, merged onto the latest copy");
  assert.equal(await page.isVisible("#conn"), false);
  assert.deepEqual(errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e)), []);
  await ctx.close();
});

test("offline while the app is open: changes wait, then save when the connection returns", { skip }, async () => {
  const { page, errors, ctx } = await openInstalled({});
  await ctx.setOffline(true);
  await page.waitForFunction(() => !document.querySelector("#conn").hidden);
  await page.fill('[data-f="note"]', "Written on the bus");
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "Offline");
  await ctx.setOffline(false);
  await page.waitForFunction(() => window.__fake.budget.note === "Written on the bus", null, { timeout: 15000 });
  await settle(page);
  assert.deepEqual(errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e)), []);
  await ctx.close();
});

test("signing out leaves no copy of the budget on the device", { skip }, async () => {
  const { page, errors, ctx } = await openInstalled({});
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith("mb-cache-v1-"))));
  await page.click("#menuBtn"); await page.click('[data-act="signout"]');
  await page.waitForSelector("#fSignin");
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("mb-cache-v1-") || k === "mb-offline")), []);
  assert.ok(await page.evaluate(() => localStorage.getItem("mb-welcome")), "the 'Welcome back' name is kept");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a new version shows 'Tap to refresh', and refreshing loads it", { skip }, async () => {
  const { page, errors, ctx } = await openInstalled({});
  publishNewVersion();
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForSelector("#update", { timeout: 15000 });
  assert.match(await page.textContent("#update"), /A new version is ready/);
  await page.screenshot({ path: join(SHOTS, "update-banner.png") });
  const nav = page.waitForEvent("framenavigated");
  await page.click("#update button");
  await nav;
  await page.waitForSelector("#app .viewas");
  assert.equal(await page.isVisible("#update"), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("phone: tooltips appear when you tap a ?, and never get left over the screen", { skip: skip || !IPHONE }, async () => {
  const { page, errors, ctx } = await open(V4, { device: IPHONE });
  await settle(page);
  await page.tap('[data-tab="goals"]');
  await page.waitForSelector('[data-tab="goals"][aria-selected="true"]');
  assert.equal(await page.evaluate(() => document.querySelector("#tt").classList.contains("on")), false, "tapping a tab shows no tooltip");
  await page.tap(".sec-head .qi");
  assert.equal(await page.evaluate(() => document.querySelector("#tt").classList.contains("on")), true, "tapping ? shows its tip");
  await page.tap("h2");
  assert.equal(await page.evaluate(() => document.querySelector("#tt").classList.contains("on")), false, "tapping elsewhere hides it");
  assert.deepEqual(errors, []);
  await ctx.close();
});
