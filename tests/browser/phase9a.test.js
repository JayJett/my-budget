/* Phase 9A: five-tab navigation with Wealth, the Home dashboard, the household menu, the profile ✕,
   and optional setup step 4 (your accounts). Uses the fake Supabase (no real accounts or data). */
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
const phone = (w = 390, h = 844) => ({ device: { viewport: { width: w, height: h }, hasTouch: true, isMobile: true } });
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `p9a-${name}.png`) });
const hash = page => page.evaluate(() => location.hash);
const budgetOf = page => fake(page, () => window.__fake.budget);
const vals = o => Object.values(o || {});
const sideways = page => page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1);
const TWO = (extra = {}) => ({ households: [
  { id: "hh-1", name: "Ana & Ben", role: "owner", budget: RICH, ...extra },
  { id: "hh-2", name: "Mum’s budget", role: "editor", budget: toStored({ ...blankBudget({ name: "Mum" }), note: "Mum’s numbers" }) },
] });

/* ---------------- navigation ---------------- */
test("lands on Home; five tabs; Wealth has Accounts | Investments | History; Back and Forward follow", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...phone(), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
  assert.deepEqual(await page.$$eval("#tabs .tab .tl", e => e.map(x => x.textContent)), ["Home", "Budget", "Expenses", "Goals", "Wealth"]);
  assert.equal(await page.getAttribute('#tabs [data-tab="home"]', "aria-selected"), "true");
  await page.click('#tabs [data-tab="wealth"]'); await page.waitForSelector(".wl-nav");
  assert.equal(await hash(page), "#wealth/accounts");
  assert.deepEqual(await page.$$eval(".wl-nav .wl-t > span:first-child", e => e.map(x => x.textContent)), ["Accounts", "Investments", "History"]);
  assert.ok(await page.isVisible("#app .nw-hero"), "Accounts is the old Net worth");
  await page.click('.wl-nav [data-tab="invest"]'); await page.waitForSelector("#app .iv-hero");
  assert.equal(await hash(page), "#wealth/investments");
  assert.equal(await page.getAttribute('#tabs [data-tab="wealth"]', "aria-selected"), "true", "Wealth stays lit");
  await page.click('.wl-nav [data-tab="progress"]'); await page.waitForSelector("#app .pg-page, #app .pg-start, #app .pg-hero");
  assert.equal(await hash(page), "#wealth/history");
  await shot(page, "wealth-history");
  await page.click('#tabs [data-tab="goals"]'); await page.waitForSelector("#app .gl-page");
  await page.click('#tabs [data-tab="wealth"]'); await page.waitForSelector(".wl-nav");
  assert.equal(await hash(page), "#wealth/history", "Wealth reopens where you were");
  await page.goBack(); await page.waitForSelector("#app .gl-page");
  await page.goBack(); await page.waitForSelector("#app .pg-page, #app .pg-start, #app .pg-hero");
  await page.goForward(); await page.waitForSelector("#app .gl-page");
  assert.equal(await sideways(page), false);
  assert.deepEqual(errors, []); await ctx.close();
});

test("old links open the right place, and the address is tidied", { skip }, async () => {
  for (const [old, want, sel] of [["net-worth", "#wealth/accounts", "#app .nw-hero"], ["investments", "#wealth/investments", "#app .iv-hero"], ["progress", "#wealth/history", ".wl-nav"], ["joint-spending", "#expenses", "#app .sp-page"], ["goals", "#goals", "#app .gl-page"], ["budget", "#budget", "#app .b-income"]]) {
    const { page, errors, ctx } = await open(RICH, { ...phone(), storage: ALL_DONE, hash: old, waitFor: sel });
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
    await page.waitForFunction(w => location.hash === w, want);
    assert.deepEqual(errors, [], old); await ctx.close();
  }
});

test("the bottom bar fits 320–430px with no sideways scroll; every screen draws", { skip }, async () => {
  for (const w of [320, 375, 390, 430]) {
    const { page, errors, ctx } = await open(RICH, { ...phone(w, 700), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
    const tabs = await page.$$eval("#tabs .tab", e => e.map(x => { const r = x.getBoundingClientRect(); return [r.left, r.right, r.width]; }));
    assert.equal(tabs.length, 5);
    tabs.forEach(([l, r, wd]) => { assert.ok(l >= -0.5 && r <= w + 0.5, `w=${w} tab inside`); assert.ok(wd >= 44, `w=${w} tab ${wd}px wide`); });
    for (const t of ["home", "budget", "spending", "goals", "networth", "invest", "progress"]) {
      await goTab(page, t);
      assert.equal(await sideways(page), false, `${w}px ${t}`);
    }
    if (w === 320) await shot(page, "tabs-320");
    assert.deepEqual(errors, [], `${w}`); await ctx.close();
  }
});

/* ---------------- Home ---------------- */
test("Home (shared): each person's own payday and pay, never added together; figures match the other screens", { skip }, async () => {
  const b = JSON.parse(JSON.stringify(RICH));
  const ids = Object.keys(b.people); b.people[ids[0]].payday = "2026-11-06"; b.people[ids[1]].payday = "";
  const { page, errors, ctx } = await open(b, { ...phone(), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
  assert.match(await page.textContent(".ho-greet h2"), /, Jarden$/);
  const pay = await page.textContent(".ho-pay");
  assert.match(pay, /Next payday/); assert.match(pay, /In \d+ days|Today|Tomorrow/);
  assert.match(pay, /No payday yet/, "the other person has no date, and none is made up");
  assert.doesNotMatch(pay, /\$4,300/, "two people's pay isn't added up as one payday");
  const homeNW = (await page.textContent('.ho-fig[data-home-go="networth"] b')).trim();
  const homeSave = (await page.textContent('.ho-fig[data-home-go="goals"] b')).replace(/\/fn/, "").trim();
  await shot(page, "home-shared");
  await page.click('.ho-fig[data-home-go="networth"]'); await page.waitForSelector("#app .nw-hero");
  assert.equal(await hash(page), "#wealth/accounts");
  assert.ok((await page.textContent("#app .nw-hero")).includes(homeNW), `net worth ${homeNW} matches Accounts`);
  await goTab(page, "goals");
  const pools = await page.$$eval(".gl-pools b", e => e.map(x => Number(x.textContent.replace(/[^\d.]/g, ""))));
  assert.equal(pools.reduce((s, x) => s + x, 0), Number(homeSave.replace(/[^\d.]/g, "")), "saving = emergency fund + goal pools");
  assert.deepEqual(errors, []); await ctx.close();
});

test("Home for a brand-new solo budget: no made-up balances or dates; next steps open the right place", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { ...phone(), storage: ALL_DONE, hash: "", waitFor: ".ob" });
  await page.fill('[data-ob="people.0.pay"]', "2000"); await page.click('[data-obact="next"]'); await page.click('[data-obact="next"]');
  await page.waitForSelector('[data-obact="acc-skip"]'); await page.click('[data-obact="acc-skip"]');
  await page.waitForSelector(".ob-done");
  assert.match(await page.textContent(".ob-done"), /Add your accounts any time in Wealth/);
  await page.click('[data-obact="finish"]'); await page.waitForSelector("#app .home");
  assert.equal(await hash(page), "#home");
  assert.match(await page.textContent(".ho-pay"), /\$2,000/); assert.match(await page.textContent(".ho-pay"), /Set a payday/);
  assert.doesNotMatch(await page.textContent(".ho-pay"), /In \d+ days|Today|Tomorrow/, "no countdown without a payday");
  assert.equal((await page.textContent('.ho-fig[data-home-go="networth"] b')).trim(), "—", "no net worth without accounts");
  assert.match(await page.textContent(".ho-plan"), /100% of your pay has a plan/);
  assert.deepEqual(await page.$$eval("[data-home-act]", e => e.map(x => x.dataset.homeAct)), ["payday", "accounts", "goal"]);
  await shot(page, "home-new-solo");
  await page.click('[data-home-act="accounts"]');
  await page.waitForSelector('#sheet [data-l="nw"][data-f="name"]');
  assert.equal(await hash(page), "#wealth/accounts", "straight to adding an account");
  await page.click('#sheet .sheet-head [data-sheet="close"]');
  await goTab(page, "home");
  await page.click('[data-home-act="payday"]');
  await page.waitForSelector('#sheet [data-l="pp"][data-f="payday"]');
  assert.equal(await hash(page), "#budget");
  assert.deepEqual(errors, []); await ctx.close();
});

test("Home with huge numbers at 320px: nothing overflows", { skip }, async () => {
  const b = JSON.parse(JSON.stringify(RICH));
  Object.values(b.people).forEach(p => { p.pay = 987654; });
  Object.values(b.nw.accounts).forEach(a => { a.balance = (a.balance || 0) * 1000; });
  const { page, errors, ctx } = await open(b, { ...phone(320, 640), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
  assert.equal(await sideways(page), false);
  const over = await page.$$eval(".ho-fig b, .ho-big", e => e.filter(x => x.scrollWidth > x.clientWidth + 1).length);
  assert.equal(over, 0);
  assert.deepEqual(errors, []); await ctx.close();
});

/* ---------------- the household menu ---------------- */
test("household menu: your avatar still opens your menu; the household opens a small anchored dropdown", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { ...phone(320, 640), storage: ALL_DONE, init: TWO() });
  await page.click("#menuBtn"); await page.waitForSelector("#drawer:not([hidden])");
  assert.equal(await page.locator('#drawer [data-act="household"], #drawer [data-switch]').count(), 0, "household things moved out of your menu");
  for (const a of ["profile", "history", "appearance", "tours", "data", "signout"]) assert.equal(await page.locator(`#drawer [data-act="${a}"]`).count(), 1, a);
  await page.keyboard.press("Escape"); await page.waitForSelector("#drawer", { state: "hidden" });
  await page.click("#hhBtn"); await page.waitForSelector("#hhPop");
  assert.equal(await page.getAttribute("#hhBtn", "aria-expanded"), "true");
  const pop = await page.locator("#hhPop").boundingBox(), btn = await page.locator("#hhBtn").boundingBox(), vp = page.viewportSize();
  assert.ok(pop.y >= btn.y + btn.height && pop.y - (btn.y + btn.height) < 16, "right under the household name");
  assert.ok(pop.x >= 0 && pop.x + pop.width <= vp.width, "inside the screen");
  assert.ok(pop.height < vp.height * 0.7, "a small dropdown, not a full-screen sheet");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("scroll-locked")), false, "the page isn't locked");
  assert.equal(await page.getAttribute('#hhPop [data-switch="hh-1"]', "aria-checked"), "true", "the open household is marked");
  assert.equal(await page.locator('#hhPop [data-switch="hh-2"]').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.switch), "hh-1", "focus in the menu");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.switch), "hh-2");
  await shot(page, "household-menu");
  await page.keyboard.press("Escape"); await page.waitForSelector("#hhPop", { state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement.id), "hhBtn", "focus back on the household name");
  await page.click("#hhBtn"); await page.waitForSelector("#hhPop");
  await page.mouse.click(160, 500); await page.waitForSelector("#hhPop", { state: "detached" });
  assert.deepEqual(errors, []); await ctx.close();
});

test("household menu: switch (no mix-up of data), settings, and create a household (the existing flow)", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { ...phone(), storage: ALL_DONE, init: TWO(), hash: "", waitFor: "#app .home" });
  const before = await page.textContent(".ho-pay");
  await page.click("#hhBtn"); await page.click('#hhPop [data-switch="hh-2"]');
  await page.waitForFunction(() => /Mum/.test(document.querySelector("#brandNames").textContent) && document.querySelector("#app .home"));
  assert.notEqual(await page.textContent("#app .home"), null);
  assert.doesNotMatch(await page.textContent("#app"), /Jarden and Madi|Madi/, "nothing from the other household");
  assert.notEqual(await page.textContent(".ho-pay"), before);
  await page.click("#hhBtn"); await page.click('#hhPop [data-hp="settings"]'); await page.waitForSelector("#sheet #hhLookSec");
  await page.click('#sheet [data-sheet="close"]');
  await page.click("#hhBtn"); await page.click('#hhPop [data-hp="create"]'); await page.waitForSelector("#sheet #setNewHH");
  await page.fill("#setNewHH input", "Holiday house"); await page.click("#setNewHH button[type=submit]");
  await page.waitForSelector(".ob", { timeout: 10000 }); // a new household is empty: the setup guide opens, as always
  assert.equal(await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "create_household").length), 1, "made once, the usual way");
  await page.click(".ob-later"); await page.waitForSelector("#hhBtn");
  assert.match(await page.textContent("#brandNames"), /Holiday house/);
  await page.click("#hhBtn");
  assert.equal(await page.locator("#hhPop [data-switch]").count(), 3, "all three households listed");
  assert.deepEqual(errors, []); await ctx.close();
});

/* ---------------- the profile ✕ ---------------- */
test("My profile: no ring round the ✕ when it opens; it still closes, and still shows focus for keyboards", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...phone(), storage: ALL_DONE });
  await page.click("#menuBtn"); await page.click('#drawer [data-act="profile"]'); await page.waitForSelector("#sheet .prof");
  assert.equal(await page.evaluate(() => document.activeElement.tagName), "H3", "focus on the title, not the ✕");
  const x = '#sheet .sheet-head [data-sheet="close"]';
  const look = () => page.$eval(x, e => { const c = getComputedStyle(e); return [c.outlineStyle, c.borderTopWidth, c.backgroundColor, c.boxShadow].join("|"); });
  assert.equal(await look(), "none|0px|rgba(0, 0, 0, 0)|none", "a plain ✕");
  const box = await page.locator(x).boundingBox(); assert.ok(box.width >= 44 && box.height >= 44, "still easy to tap");
  await shot(page, "profile-x");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.sheet), "close");
  assert.notEqual(await page.$eval(x, e => getComputedStyle(e).outlineStyle), "none", "keyboard focus still shows");
  await page.keyboard.press("Enter"); await page.waitForSelector("#sheet", { state: "hidden" });
  assert.deepEqual(errors, []); await ctx.close();
});

/* ---------------- setup step 4: your accounts ---------------- */
async function toStep4(page, pay = "2000") {
  await page.fill('[data-ob="people.0.pay"]', pay); await page.click('[data-obact="next"]'); await page.click('[data-obact="next"]');
  await page.waitForSelector('[data-obact="acc-add"]');
}
async function addAcc(page, name, type, bal) {
  await page.click('[data-obact="acc-add"]'); await page.fill('[data-acc="name"]', name);
  if (type !== "Operating") await page.check(`input[name="obacctype"][value="${type}"]`, { force: true });
  if (bal !== null) await page.fill('[data-acc="balance"]', String(bal));
  await page.click('[data-obact="acc-keep"]');
}

test("step 4: four steps, clearly optional; savings, investments, KiwiSaver and debts saved right; nothing counted twice; no Undo", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { ...phone(375, 667), storage: ALL_DONE, hash: "", waitFor: ".ob" });
  await toStep4(page);
  assert.match(await page.textContent(".ob-stage"), /Step 4 of 4\s*Your accounts \(optional\)/);
  assert.equal(await page.getAttribute(".ob-prog", "aria-valuemax"), "4");
  await addAcc(page, "Everyday", "Operating", 1250);
  await addAcc(page, "Main Savings", "Savings", 10000);
  await addAcc(page, "Shares", "Investment", 5000);
  await addAcc(page, "KiwiSaver", "Super", 12000);
  await addAcc(page, "Credit card", "Debt", 600);
  assert.match(await page.textContent(".ob-acc-sum"), /You have\s*\$28,250.*You owe\s*\$600.*Net worth\s*\$27,650/s);
  // fix a typo: edit, and remove one
  await page.click('[data-obact="acc-edit"][data-i="0"]'); await page.fill('[data-acc="balance"]', "1300"); await page.click('[data-obact="acc-keep"]');
  await page.click('[data-obact="acc-rm"][data-i="2"]');
  assert.equal(await page.locator(".ob-acc").count(), 4);
  // a name that's taken is caught (goals find accounts by name)
  await page.click('[data-obact="acc-add"]'); await page.fill('[data-acc="name"]', "main savings"); await page.click('[data-obact="acc-keep"]');
  assert.match(await page.textContent(".ob-acc-form .msg.err"), /already have an account with that name/);
  await page.click('[data-obact="acc-cancel"]');
  await shot(page, "step4-list");
  await page.dblclick('[data-obact="next"]'); // two quick taps
  await page.waitForSelector(".ob-done");
  const b = await budgetOf(page), nw = vals(b.nw.accounts);
  assert.deepEqual(nw.map(a => [a.name, a.type, a.balance]).sort(), [["Credit card", "Debt", 600], ["Everyday", "Operating", 1300], ["KiwiSaver", "Super", 12000], ["Main Savings", "Savings", 10000]], "each saved once, as typed");
  assert.equal(b.goals.ef.saved, null, "no separate emergency-fund balance invented");
  assert.equal(nw.some(a => /emergency/i.test(a.name)), false);
  await page.click('[data-obact="finish"]'); await page.waitForSelector("#app .home");
  assert.equal((await page.textContent('.ho-fig[data-home-go="networth"] b')).trim(), "$22,700", "net worth: 1,300 + 10,000 + 12,000 − 600");
  assert.equal(await page.isVisible("#undoBtn"), false, "setup isn't something to undo");
  assert.equal(await page.locator('[data-home-act="accounts"]').count(), 0);
  assert.deepEqual(errors, []); await ctx.close();
});

test("step 4: a refresh keeps what you typed and comes back to step 4; saving then adds each account once", { skip }, async () => {
  // (the fake server forgets everything on a real reload, so the refresh is a fresh page with what the
  //  real database and this tab would still have: the saved plan, and the accounts typed on step 4)
  let { page, errors, ctx } = await open({}, { ...phone(), storage: ALL_DONE, hash: "", waitFor: ".ob" });
  await toStep4(page);
  await addAcc(page, "Everyday", "Operating", 900);
  const saved = await budgetOf(page), kept = await page.evaluate(() => sessionStorage.getItem("mb-ob-accounts-hh-1"));
  assert.ok(kept && JSON.parse(kept).length === 1, "kept on this device until saved");
  await ctx.close();
  ({ page, errors, ctx } = await open(saved, { ...phone(), storage: ALL_DONE, hash: "", waitFor: '[data-obact="acc-add"]', initScript: [k => sessionStorage.setItem("mb-ob-accounts-hh-1", k), kept] }));
  assert.match(await page.textContent(".ob-stage"), /Step 4 of 4/, "back on step 4");
  assert.equal(await page.locator(".ob-acc").count(), 1, "with what was typed");
  await page.click('[data-obact="next"]'); await page.click('[data-obact="next"]').catch(() => {});
  await page.waitForSelector(".ob-done");
  assert.equal(vals((await budgetOf(page)).nw.accounts).length, 1, "not added twice");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("mb-ob-accounts-hh-1")), null, "nothing left to resume");
  await page.click('[data-obact="finish"]'); await page.waitForSelector("#app .home");
  assert.equal(await page.isVisible("#undoBtn"), false);
  assert.deepEqual(errors, []); await ctx.close();
});

test("step 4: a failed save keeps your accounts and says so; Try again works", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { ...phone(), storage: ALL_DONE, hash: "", waitFor: ".ob" });
  await toStep4(page);
  await addAcc(page, "Savings", "Savings", 3000);
  await fake(page, () => { window.__fake.failNext = 3; });
  await page.click('[data-obact="next"]');
  await page.waitForSelector(".ob-card .msg.err");
  assert.match(await page.textContent(".ob-card .msg.err"), /couldn’t save your accounts/);
  assert.equal(await page.locator(".ob-acc").count(), 1);
  assert.equal(await page.locator(".ob-done").count(), 0, "never 'ready' before it's saved");
  await page.click('[data-obact="next"]'); await page.waitForSelector(".ob-done", { timeout: 15000 });
  assert.equal(vals((await budgetOf(page)).nw.accounts).length, 1);
  await ctx.close();
});

test("step 4 in a shared household: 'Whose account' defaults to you, Shared is a choice", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { ...phone(), storage: ALL_DONE, hash: "", waitFor: ".ob" });
  await page.click('[data-obact="back"]'); await page.check('input[name="obmode"][value="with"]', { force: true }); await page.click('[data-obact="next"]');
  await toStep4(page);
  await addAcc(page, "My everyday", "Operating", 100);
  await page.click('[data-obact="acc-add"]'); await page.fill('[data-acc="name"]', "Joint savings"); await page.selectOption('[data-acc="owner"]', ""); await page.click('[data-obact="acc-keep"]');
  await page.click('[data-obact="next"]'); await page.waitForSelector(".ob-done");
  const b = await budgetOf(page), me = vals(b.people)[0].id;
  const by = Object.fromEntries(vals(b.nw.accounts).map(a => [a.name, a]));
  assert.equal(by["My everyday"].owner, me); assert.equal(by["Joint savings"].owner, null);
  assert.equal(by["Joint savings"].balance, null, "no balance typed: none saved (not $0)");
  assert.deepEqual(errors, []); await ctx.close();
});
