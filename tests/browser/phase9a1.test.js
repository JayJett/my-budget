/* Phase 9A.1: a calmer payday card, no Reminders in your menu (the bell has them), no pill behind the
   chosen tab, step 4's buttons the right way round, and date boxes that fit on small phones. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored, blankBudget } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, fake, goTab, settle } from "./helpers.js";

setup();
const RICH = toStored(migrate(RICH_V3));
const ALL_DONE = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(t => [t, "done"])) }) };
const phone = (w = 390, h = 844, dark = false) => ({ device: { viewport: { width: w, height: h }, hasTouch: true, isMobile: true, ...(dark ? { colorScheme: "dark" } : {}) } });
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `p9a1-${name}.png`) });
const withPaydays = (a, b) => { const x = JSON.parse(JSON.stringify(RICH)), ids = Object.keys(x.people); x.people[ids[0]].payday = a; x.people[ids[1]].payday = b; return x; };

test("payday card: one date and countdown, then each person and their pay; no 'Planned, not yet…' line; nothing added up", { skip }, async () => {
  const { page, errors, ctx } = await open(withPaydays("2026-11-04", "2026-11-04"), { ...phone(390, 844, true), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
  const card = await page.textContent(".ho-pay");
  assert.doesNotMatch(card, /Planned, not yet in your account/);
  assert.equal((card.match(/Nov/g) || []).length, 1, "the date appears once");
  assert.deepEqual(await page.$$eval(".ho-pays li", e => e.map(x => [x.querySelector(".ho-who").textContent.trim(), x.querySelector(".ho-amt").textContent])), [["Jarden", "$2,400"], ["Madi", "$1,900"]]);
  assert.doesNotMatch(card, /\$4,300/, "no total of two people's pay");
  await shot(page, "pay-same-day");
  await ctx.close(); assert.deepEqual(errors, []);
});

test("payday card: different days stay apart, each with its own date; no payday yet says so", { skip }, async () => {
  let { page, errors, ctx } = await open(withPaydays("2026-11-04", "2026-11-06"), { ...phone(), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
  const rows = await page.$$eval(".ho-pays li", e => e.map(x => x.textContent.replace(/\s+/g, " ").trim()));
  assert.equal(rows.length, 2);
  assert.match(rows[1], /Fri 20 Nov|Fri 6 Nov|Fri/, "the second person's own date");
  assert.deepEqual(errors, []); await ctx.close();
  ({ page, errors, ctx } = await open(withPaydays("", ""), { ...phone(320, 640), storage: ALL_DONE, hash: "", waitFor: "#app .home" }));
  assert.match(await page.textContent(".ho-pay"), /Your pay/);
  assert.doesNotMatch(await page.textContent(".ho-pay"), /In \d+ days|Today|Tomorrow|Next payday/, "no countdown without a payday");
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []); await ctx.close();
});

test("your menu has no Reminders; the bell still opens them, with Reminder settings", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...phone(), storage: ALL_DONE });
  await page.click("#menuBtn"); await page.waitForSelector("#drawer:not([hidden])");
  assert.equal(await page.locator('#drawer [data-act="reminders"]').count(), 0);
  for (const a of ["profile", "history", "appearance", "tours", "data", "signout"]) assert.equal(await page.locator(`#drawer [data-act="${a}"]`).count(), 1, a);
  await page.keyboard.press("Escape"); await page.waitForSelector("#drawer", { state: "hidden" });
  await page.click("#bellBtn"); await page.waitForSelector('#drawer [data-rem="settings"]');
  await page.click('#drawer [data-rem="settings"]'); await page.waitForSelector("#sheet .rem-switches");
  assert.deepEqual(errors, []); await ctx.close();
});

test("bottom bar: the chosen tab is its colour and a bolder label, with no pill behind it (light and dark)", { skip }, async () => {
  for (const dark of [false, true]) {
    const { page, errors, ctx } = await open(RICH, { ...phone(390, 844, dark), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
    for (const t of ["home", "budget", "spending", "goals", "wealth"]) {
      await page.click(`#tabs [data-tab="${t}"]`); await page.waitForSelector(`#tabs [data-tab="${t}"][aria-selected="true"]`);
      const s = await page.$eval(`#tabs [data-tab="${t}"]`, e => { const ti = getComputedStyle(e.querySelector(".ti")), tb = getComputedStyle(e); return [ti.backgroundColor, tb.backgroundColor, tb.color, getComputedStyle(e.querySelector(".ts")).fontWeight]; });
      assert.equal(s[0], "rgba(0, 0, 0, 0)", `${t}: no pill`); assert.equal(s[1], "rgba(0, 0, 0, 0)");
      const off = await page.$eval(`#tabs .tab:not([aria-selected="true"])`, e => getComputedStyle(e).color);
      assert.notEqual(s[2], off, `${t}: coloured`); assert.ok(Number(s[3]) >= 700, `${t}: bolder label`);
    }
    if (dark) await shot(page, "tabs-dark");
    assert.deepEqual(errors, []); await ctx.close();
  }
});

test("step 4: '+ Add an account' is the main button and 'Skip for now' a quiet link; with accounts, 'Save and continue'", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { ...phone(375, 667), storage: ALL_DONE, hash: "", waitFor: ".ob" });
  await page.fill('[data-ob="people.0.pay"]', "2000"); await page.fill('[data-ob="people.0.payday"]', "2026-11-05"); await page.click('[data-obact="next"]'); await page.click('[data-obact="next"]');
  await page.waitForSelector('.ob-nav [data-obact="acc-add"]');
  assert.equal(await page.getAttribute('.ob-nav [data-obact="acc-add"]', "class"), "btn primary block");
  assert.equal(await page.getAttribute('[data-obact="acc-skip"]', "class"), "linkish ob-skip-link");
  assert.equal(await page.locator(".btn.primary").count(), 1, "one main button");
  await shot(page, "step4-empty");
  await page.click('.ob-nav [data-obact="acc-add"]'); await page.fill('[data-acc="name"]', "Everyday"); await page.fill('[data-acc="balance"]', "500"); await page.click('[data-obact="acc-keep"]');
  assert.equal(await page.textContent('.ob-nav .btn.primary'), "Save and continue");
  assert.equal(await page.locator('[data-obact="acc-add"]').textContent(), "+ Add another account");
  assert.equal(await page.locator(".btn.primary").count(), 1);
  await shot(page, "step4-one");
  await page.click('[data-obact="next"]'); await page.waitForSelector(".ob-done");
  assert.equal(Object.keys((await fake(page, () => window.__fake.budget)).nw.accounts).length, 1);
  assert.deepEqual(errors, []); await ctx.close();
});

test("'A recent payday' fits inside the sheet at 320–430px, and a changed date is saved", { skip }, async () => {
  for (const w of [320, 375, 390, 430]) {
    const { page, errors, ctx } = await open(RICH, { ...phone(w, 760), storage: ALL_DONE });
    await page.click("[data-edit-person]"); await page.waitForSelector('#sheet [data-f="payday"]');
    const r = await page.$eval('#sheet [data-f="payday"]', e => { const a = e.getBoundingClientRect(), b = e.closest(".bs-field").getBoundingClientRect(), s = e.closest("#sheet"); return [a.left >= b.left - 0.5, a.right <= b.right + 0.5, s.scrollWidth <= s.clientWidth + 1]; });
    assert.deepEqual(r, [true, true, true], `w=${w}`);
    const pay = await page.$eval('#sheet .bs-pay', e => { const a = e.getBoundingClientRect(), b = e.closest(".bs-field").getBoundingClientRect(); return a.right <= b.right + 0.5; });
    assert.ok(pay, `w=${w}: pay row fits`);
    if (w === 320) {
      await page.fill('#sheet [data-f="payday"]', "2026-11-05"); await page.click('#sheet .sheet-head [data-sheet="close"]'); await settle(page);
      assert.equal(Object.values((await fake(page, () => window.__fake.budget)).people)[0].payday, "2026-11-05");
      await shot(page, "after-date");
    }
    assert.deepEqual(errors, []); await ctx.close();
  }
});

test("Compact spacing doesn't add big gaps above Home's greeting or Wealth's cards", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...phone(), storage: { ...ALL_DONE, "jm-budget-prefs": JSON.stringify({ density: "compact" }) }, hash: "", waitFor: "#app .home" });
  const gap = (a, b) => page.evaluate(([a, b]) => Math.round(document.querySelector(b).getBoundingClientRect().top - document.querySelector(a).getBoundingClientRect().bottom), [a, b]);
  assert.ok(await gap(".ho-greet", ".ho-pay") <= 16, "greeting to card");
  await goTab(page, "networth");
  assert.ok(await gap(".wl-nav", "#app .nw-hero") <= 20, "Wealth switch to card");
  assert.deepEqual(errors, []); await ctx.close();
});
