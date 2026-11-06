/* Phase 6 audit: regression tests for what the audit found and fixed. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { clone } from "../../js/model/util.js";
import { setup, skip, open, settle, goTab, editPerson, setField, editExpense, editGoal } from "./helpers.js";

setup();
let devices = {}; try { ({ devices } = createRequire(import.meta.url)("playwright")); } catch (_) {}
const V4 = toStored(migrate(RICH_V3));

test("offline: no 'leave this page?' prompt when the app knows it's offline, even if the browser says it's online", { skip }, async () => {
  const { page, errors, ctx } = await open(V4, { device: devices["iPhone 13"] });
  await settle(page);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 });
  await ctx.setOffline(true);
  await page.reload(); await page.waitForSelector("#app .viewas");
  await editPerson(page, "j");
  await setField(page, '#sheet [data-l="pp"][data-i="j"][data-f="pay"]', "2500");
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "Offline");
  await page.evaluate(() => Object.defineProperty(Navigator.prototype, "onLine", { get: () => true, configurable: true })); // a phone on Wi-Fi with no internet
  let dialog = null; page.on("dialog", d => { dialog = d.type(); d.dismiss().catch(() => {}); });
  await page.reload({ timeout: 8000 }); await page.waitForSelector("#app .viewas");
  assert.equal(dialog, null, "the edit is kept on the phone, so there's nothing to warn about");
  await editPerson(page, "j");
  assert.equal(await page.inputValue('#sheet [data-l="pp"][data-i="j"][data-f="pay"]'), "2,500", "and it's still there");
  assert.deepEqual(errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e)), []); await ctx.close();
});

test("a brand-new budget: one welcome card (on Budget), no review nag or $0 charts, nothing called 'Joint'", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob", width: 390 });
  await page.click(".ob-later");
  await page.waitForSelector("#app .viewas");
  assert.equal(await page.locator(".welcome").count(), 1);
  assert.doesNotMatch(await page.textContent(".welcome"), /tinted/);
  assert.deepEqual((await page.$$eval(".b-allocs .a-name, [data-edit-acc] .a-name", els => els.map(e => e.textContent))).filter(t => /Joint/.test(t)), [], "no account named 'Joint …'");
  await goTab(page, "networth");
  assert.equal(await page.locator(".welcome, .nw-review").count(), 0);
  assert.equal((await page.textContent('[data-mark="networth"]')).trim(), "", "no warning badge before there's anything to warn about");
  await goTab(page, "invest");
  assert.equal(await page.isVisible("text=Nothing invested yet"), true);
  assert.equal(await page.locator("#ivChart, .iv-miles, #ivYears").count(), 0, "no chart of zeros");
  assert.deepEqual(errors, []); await ctx.close();
});

test("keyboard: closing a sheet puts focus back on the card that opened it", { skip }, async () => {
  const { page, errors, ctx } = await open(V4);
  await settle(page); await goTab(page, "spending");
  await page.focus('[data-edit-sp="s3"]'); await page.keyboard.press("Enter");
  await page.waitForSelector('#sheet [data-f="name"]');
  await page.keyboard.press("Escape");
  await page.waitForSelector("#sheet", { state: "hidden" });
  await page.waitForFunction(() => document.activeElement && document.activeElement.matches('[data-edit-sp="s3"]'));
  await goTab(page, "goals");
  await page.focus('[data-edit-goal="gj"][data-i="g2"]'); await page.keyboard.press("Enter");
  await page.waitForSelector('#sheet [data-f="target"]');
  await page.click('#sheet [data-sheet="close"]');
  await page.waitForFunction(() => document.activeElement && document.activeElement.matches('[data-edit-goal="gj"][data-i="g2"]'));
  assert.deepEqual(errors, []); await ctx.close();
});

test("switching household: Progress shows the new household's history, never the last one's", { skip }, async () => {
  const snap = (id, nw) => { const d = clone(V4); d.nw.accounts.n2.balance = nw; return { id, month: "2026-10-01", kind: "monthly", taken_at: "2026-10-01T00:10:00+13:00", taken_by: null, data: { version: 4, people: d.people, nw: d.nw, goals: d.goals } }; };
  const mine = { user_id: "u-me", display_name: "Jarden", email: "j@example.com", role: "owner", joined_at: "2026-01-01" };
  const init = { noAutoSnapshot: true, households: [
    { id: "hh-1", name: "Ours", role: "owner", budget: V4, snapshots: [snap(1, 1000), snap(2, 2000)], members: [mine] },
    { id: "hh-2", name: "Mum’s", role: "owner", budget: V4, snapshots: [snap(3, 77777)], members: [mine] } ] };
  const { page, errors, ctx } = await open(null, { init });
  await settle(page); await goTab(page, "progress");
  await page.waitForSelector(".pg-hl .pg-list li");
  assert.equal(await page.locator(".pg-hl .pg-list li").count(), 2);
  await page.selectOption("#pgCmpSel", "2");
  await page.click("#menuBtn"); await page.click('[data-switch="hh-2"]');
  await page.waitForFunction(() => /Mum/.test(document.querySelector("#brandNames").textContent));
  await page.waitForSelector(".pg-hero");
  assert.equal(await page.locator(".pg-hl .pg-list li").count(), 1, "just this household's one snapshot");
  assert.match(await page.textContent(".pg-two"), /\$111,277/);
  assert.equal(await page.locator(".pg-cmp-l").count(), 0, "the comparison picked in the other household is gone");
  assert.deepEqual(errors, []); await ctx.close();
});

test("phone: help dots, fold-outs and sheet buttons are at least 44px to tap", { skip: skip || !devices["iPhone 13"] }, async () => {
  const { page, errors, ctx } = await open(V4, { device: devices["iPhone 13"] });
  await settle(page); await goTab(page, "networth");
  const hit = sel => page.$eval(sel, el => { const a = getComputedStyle(el, "::after"), r = el.getBoundingClientRect(); return a.content === "none" ? [r.width, r.height] : [r.width - 2 * parseFloat(a.left), r.height - 2 * parseFloat(a.top)]; });
  const [w, h] = await hit(".qi"); assert.ok(w >= 44 && h >= 44, `help dot touch area ${w}×${h}`);
  assert.ok((await page.locator("details.help summary").boundingBox()).height >= 44);
  await page.click("[data-edit-nw]"); await page.waitForSelector("#sheet[open]");
  assert.ok((await page.locator('#sheet [data-sheet="close"]').boundingBox()).height >= 44);
  assert.deepEqual(errors, []); await ctx.close();
});
