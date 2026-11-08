/* Phase 7D.1: Undo never takes back setup; the header's avatar opens the account menu; and a set of
   visual-integrity checks (things that must never overlap or be hidden), at several phone sizes.
   Uses the fake Supabase: no real accounts or data. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, fake, goTab, settle } from "./helpers.js";

setup();
const RICH = toStored(migrate(RICH_V3));
const ALL_DONE = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(t => [t, "done"])) }) };
const dev = (w, h = 760) => ({ device: { viewport: { width: w, height: h } } });
const undoShown = page => page.isVisible("#undoBtn");
const saved = page => fake(page, () => window.__fake.budget);
const tap = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel); // a finger tap: no auto-scroll

/** Go through setup: income 2000 fortnightly (and a partner's pay when "with"), the suggested plan. */
async function finishSetup(page, { partner = false } = {}) {
  if (partner) { await page.click('[data-obact="back"]'); await page.check('input[name="obmode"][value="with"]'); await page.click('[data-obact="next"]'); }
  await page.fill('[data-ob="people.0.pay"]', "2000");
  await page.click('.ob-freq label:has(input[value="fortnightly"])');
  if (partner) { await page.click('[data-obact="addperson"]'); await page.fill('[data-ob="people.1.name"]', "Sam"); await page.fill('[data-ob="people.1.pay"]', "1500"); }
  await page.click('[data-obact="next"]'); await page.click('[data-obact="next"]');
  await page.waitForSelector(".ob-done");
  await page.click('[data-obact="finish"]');
  await page.waitForSelector("#app .b-income");
}

/* ---------------- Undo ---------------- */
for (const partner of [false, true]) test(`Undo after setup (${partner ? "shared" : "solo"}): nothing to undo; the first real edit can be undone, and only it`, { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob", ...dev(390), storage: ALL_DONE });
  await finishSetup(page, { partner });
  await page.waitForTimeout(300);
  assert.equal(await undoShown(page), false, "no Undo straight after setup");
  const setupChange = await fake(page, () => window.__fake.households[0].changes.at(-1));
  assert.equal(setupChange.kind, "replace"); assert.equal(setupChange.reason, "Budget set up");
  const pid = Object.keys((await saved(page)).people)[0];
  assert.equal((await saved(page)).people[pid].freq, "fortnightly");
  // the first real edit (within 2 minutes of setup): its own history entry, and Undo appears
  await tap(page, `[data-edit-person="${pid}"]`);
  await page.waitForSelector("#sheet[open]");
  const pay = `#sheet [data-l="pp"][data-i="${pid}"][data-f="pay"]`;
  await page.fill(pay, "2500"); await page.press(pay, "Tab");
  await tap(page, '#sheet [data-sheet="close"]');
  await settle(page);
  assert.equal(await undoShown(page), true, "Undo after a real edit");
  assert.equal(await fake(page, () => window.__fake.households[0].changes.length), 2, "the edit isn't folded into setup");
  // Undo takes back the edit, not the setup
  await page.click("#undoBtn");
  await page.waitForFunction(id => window.__fake.budget.people[id].pay === 2000, pid);
  const b = await saved(page);
  assert.equal(b.people[pid].freq, "fortnightly", "setup's fortnightly pay is still there");
  assert.ok(Object.keys(b.accounts).length >= 4, "setup's plan is still there");
  assert.equal(Object.keys(b.people).length, partner ? 2 : 1);
  await page.waitForFunction(() => document.querySelector("#undoBtn").hidden);
  // History: the setup entry is labelled and can't be undone from there either
  await page.click("#menuBtn"); await page.click('#drawer [data-act="history"]');
  await page.waitForSelector("#sheet .hist-item");
  const items = await page.$$eval("#sheet .hist-item", L => L.map(li => ({ t: li.textContent, undo: !!li.querySelector('[data-hist="undo"]') })));
  const set = items.find(x => /Budget set up/.test(x.t));
  assert.ok(set, "setup is in History as 'Budget set up'"); assert.equal(set.undo, false, "with no Undo");
  const kept = await saved(page);
  assert.deepEqual(errors, []); await ctx.close();
  // refresh (opening the app again on the same budget): nothing to undo
  const again = await open(kept, { ...dev(390), storage: ALL_DONE });
  assert.equal(await undoShown(again.page), false);
  await again.ctx.close();
});

test("'Set up later': the empty budget saved with your first edit is the starting point too", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob", ...dev(390), storage: ALL_DONE });
  await page.click(".ob-later");
  await page.waitForSelector("#app .b-income");
  const pid = await page.evaluate(() => document.querySelector("[data-edit-person]").dataset.editPerson);
  await tap(page, `[data-edit-person="${pid}"]`); await page.waitForSelector("#sheet[open]");
  const pay = `#sheet [data-l="pp"][data-i="${pid}"][data-f="pay"]`;
  await page.fill(pay, "1800"); await page.press(pay, "Tab");
  await settle(page);
  assert.equal(await undoShown(page), false, "undoing this would empty the budget, so it isn't offered");
  await page.fill(pay, "1900"); await page.press(pay, "Tab");
  await tap(page, '#sheet [data-sheet="close"]');
  await settle(page);
  assert.equal(await undoShown(page), true, "the next edit can be undone");
  await page.click("#undoBtn");
  await page.waitForFunction(id => window.__fake.budget.people[id].pay === 1800, pid);
  assert.ok(Object.keys((await saved(page)).accounts).length >= 4, "the budget is still there");
  assert.deepEqual(errors, []); await ctx.close();
});

test("a save that fails adds nothing to Undo; switching household or signing out clears it", { skip }, async () => {
  const two = [{ id: "hh-1", name: "Ours", role: "owner", budget: RICH }, { id: "hh-2", name: "Holiday house", role: "owner", budget: RICH }];
  const { page, errors, ctx } = await open(null, { init: { households: two }, ...dev(390), storage: ALL_DONE });
  await fake(page, () => { window.__fake.failNext = 5; });
  await tap(page, '[data-edit-person="j"]'); await page.waitForSelector("#sheet[open]");
  await page.fill('#sheet [data-l="pp"][data-i="j"][data-f="pay"]', "2222"); await page.press('#sheet [data-l="pp"][data-i="j"][data-f="pay"]', "Tab");
  await page.waitForTimeout(2600);
  assert.equal(await undoShown(page), false, "nothing saved, nothing to undo");
  await fake(page, () => { window.__fake.failNext = 0; });
  await tap(page, '#sheet [data-sheet="close"]');
  await page.waitForFunction(() => document.querySelector("#saveText")?.textContent === "Saved", null, { timeout: 20000 });
  assert.equal(await undoShown(page), true, "once it really saves, it can be undone");
  // another household: its Undo starts empty (never reaches back into the first)
  await page.click("#menuBtn"); await page.click('#drawer [data-switch="hh-2"]');
  await page.waitForFunction(() => document.querySelector(".brand-t")?.textContent === "Holiday house");
  assert.equal(await undoShown(page), false);
  assert.deepEqual(errors.filter(e => !/Failed to fetch/.test(e)), []); await ctx.close();
});

/* ---------------- header ---------------- */
test("header: your avatar opens the account menu (the ⋯ button is gone); long names never collide", { skip }, async () => {
  const init = { households: [{ id: "hh-1", name: "The Featherstonehaugh–Okonkwo Family Household Budget", role: "owner", budget: RICH }, { id: "hh-2", name: "Beach", role: "owner", budget: RICH }] };
  for (const w of [320, 390, 1280]) {
    const { page, errors, ctx } = await open(null, { init, ...dev(w), storage: ALL_DONE });
    assert.equal(await page.locator(".top button[aria-label='More options']").count(), 0, "no ⋯ button");
    const btn = page.locator("#menuBtn");
    assert.equal(await btn.evaluate(el => el.tagName), "BUTTON");
    assert.match(await btn.getAttribute("aria-label"), /^Open account menu \(Jarden\)$/);
    assert.equal(await page.textContent("#meSlot .av"), "J");
    const box = await btn.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44, "44px to tap");
    // nothing in the header overlaps: avatar | name | status and buttons
    const r = await page.evaluate(() => { const g = s => document.querySelector(s).getBoundingClientRect(); return { av: g("#menuBtn"), name: g("#brandNames"), right: g(".save-area") }; });
    assert.ok(r.av.right <= r.name.left + 1 && r.name.right <= r.right.left + 1, `w=${w}: header pieces overlap`);
    await btn.click();
    await page.waitForSelector("#drawer:not([hidden])");
    for (const a of ["profile", "reminders", "history", "household", "appearance", "tours", "data", "signout"])
      assert.equal(await page.locator(`#drawer [data-act="${a}"]`).count(), 1, `menu still has ${a}`);
    assert.equal(await page.locator('#drawer [data-switch="hh-2"]').count(), 1, "switching household is still there");
    if (w === 390) await page.screenshot({ path: join(SHOTS, "p7d1-header-menu.png") });
    await page.keyboard.press("Escape");
    await page.waitForSelector("#drawer", { state: "hidden" });
    assert.equal(await page.evaluate(() => document.activeElement.id), "menuBtn", "focus back on the avatar");
    assert.deepEqual(errors, []); await ctx.close();
  }
});

/* ---------------- visual integrity ---------------- */
/** Boxes that must not overlap, buttons that must be tappable (nothing on top of them). */
const rect = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; });
const apart = (a, b) => a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5 || a.right <= b.left + 0.5 || b.right <= a.left + 0.5;
const tappable = page => page.$$eval(".ob-card button:not([disabled]), .ob-nav button, #auth .ob-auth button:not([hidden])", L => L.filter(b => b.offsetParent).map(b => {
  b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(), el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return el && (el === b || b.contains(el)) ? null : (b.textContent.trim() || b.getAttribute("aria-label"));
}).filter(Boolean));
async function artClear(page, where) {
  const a = await rect(page, ".ob-prog"), art = page.locator(".ob-art .hart, .ob-done-art .hart").first();
  if (!(await art.count()) || !(await art.isVisible())) return;
  const s = await art.boundingBox();
  assert.ok(s.y >= a.bottom + 4, `${where}: the picture starts ${Math.round(s.y - a.bottom)}px below the progress bar`);
  const h = await rect(page, "#obTitle");
  assert.ok(s.y + s.height <= h.top + 0.5, `${where}: the picture runs into the headline`);
}

for (const [w, h] of [[320, 568], [375, 667], [390, 664], [430, 932]]) test(`setup at ${w}×${h}: pictures stay clear of the progress bar and headline; every button can be tapped; the plan footer never hides the last row`, { skip }, async () => {
  let o = await open(null, { init: { households: [] }, waitFor: "#fHousehold", ...dev(w, h) });
  await artClear(o.page, "step 1");
  await o.page.check('input[name="obmode"][value="with"]');
  assert.deepEqual(await tappable(o.page), []);
  await o.ctx.close();
  o = await open({}, { waitFor: ".ob", ...dev(w, h) });
  const { page, errors, ctx } = o;
  await artClear(page, "step 2");
  assert.deepEqual(await tappable(page), [], "step 2 buttons");
  if (w === 390) await page.screenshot({ path: join(SHOTS, "p7d1-step2.png") });
  await page.click(".ob-more summary");
  assert.deepEqual(await tappable(page), [], "step 2 with details open");
  await page.fill('[data-ob="people.0.pay"]', "2000"); await page.click('[data-obact="next"]');
  // step 3: scroll to the end; the last plan row sits fully above the footer
  await page.evaluate(() => { const s = document.querySelector(".ob.im"); s.scrollTop = s.scrollHeight; });
  const last = await rect(page, ".ob-buckets li:last-child"), foot = await rect(page, ".ob-foot");
  assert.ok(last.bottom <= foot.top + 0.5, `the last row (${Math.round(last.bottom)}) is under the footer (${Math.round(foot.top)})`);
  assert.deepEqual(await tappable(page), [], "step 3 buttons and % boxes' rows");
  if (w === 390) await page.screenshot({ path: join(SHOTS, "p7d1-step3-end.png") });
  await page.click('[data-obact="next"]'); await page.waitForSelector(".ob-done");
  await artClear(page, "done");
  assert.deepEqual(await tappable(page), [], "done buttons");
  assert.deepEqual(errors, []); await ctx.close();
});

for (const w of [320, 390, 430]) test(`welcome at ${w}px: the picture stays inside its slide; the dots and buttons are clear`, { skip }, async () => {
  const { page, ctx } = await open(null, { init: { signedOut: true }, waitFor: ".wl", welcome: true, ...dev(w, w === 320 ? 568 : 700) });
  const art = await page.locator(".wl-slide:first-child .hart").boundingBox(), dots = await rect(page, ".wl-dots"), title = await rect(page, ".wl-slide:first-child h2");
  assert.ok(art.y >= title.bottom - 0.5 && art.y + art.height <= dots.top + 0.5, "the picture sits between the words and the dots");
  for (const b of ['.wl-acts [data-auth="signup"]', '.wl-acts [data-auth="signin"]']) {
    const r = await rect(page, b); assert.ok(r.bottom <= (await page.evaluate(() => innerHeight)) + 0.5, `${b} on screen`);
  }
  await ctx.close();
});

test("Goals with no goals: one first-goal card, stacked; a button with a one-line label; other sections stay compact", { skip }, async () => {
  for (const w of [320, 390]) {
    const { page, errors, ctx } = await open({}, { waitFor: ".ob", ...dev(w), storage: ALL_DONE });
    await page.click(".ob-later"); await page.waitForSelector("#app .b-income");
    await goTab(page, "goals");
    assert.equal(await page.locator(".gl-first").count(), 1, "one first-goal card");
    assert.equal(await page.locator(".gl-first .empty-art").count(), 1);
    const card = await rect(page, ".gl-first"), btn = await rect(page, ".gl-first-btn"), h3 = await rect(page, ".gl-first h3");
    assert.ok(btn.h < 56, `the button is one line tall (${btn.h}px)`);
    assert.ok(btn.top > h3.bottom, "button below the words, not beside them");
    for (const s of [".gl-first h3", ".gl-first p", ".gl-first-btn", ".gl-first .empty-art"]) {
      const r = await rect(page, s); assert.ok(r.left >= card.left - 0.5 && r.right <= card.right + 0.5, `${s} inside the card`);
    }
    assert.ok(card.h < 420, `card isn't oversized (${card.h}px)`);
    if (w === 390) { await page.locator(".gl-first").scrollIntoViewIfNeeded(); await page.screenshot({ path: join(SHOTS, "p7d1-goals-empty.png") }); }
    // the action still adds a goal
    await page.click(".gl-first-btn");
    await page.waitForSelector("#sheet[open]");
    assert.deepEqual(errors, []); await ctx.close();
  }
});
