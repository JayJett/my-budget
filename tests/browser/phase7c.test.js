/* Phase 7C: setup fits the phone screen, the menu is a proper bottom sheet, and every tab has its own
   optional guided tour. Uses the fake Supabase: no real accounts, households or data. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, fake, goTab } from "./helpers.js";

setup();
const RICH = toStored(migrate(RICH_V3));
const PHONE = { device: { viewport: { width: 390, height: 664 } } };       // iPhone Safari, toolbars showing
const SMALL = { device: { viewport: { width: 320, height: 568 } } };
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `p7c-${name}.png`) });
const fits = page => page.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight, w: document.documentElement.scrollWidth, vw: innerWidth }));
/** Everyone in the older tests has "seen" every tour; these tests start with none seen. */
const fresh = { "mb-tours-u-me": JSON.stringify({ tabs: {} }) };
const writes = page => fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops").length);
const local = page => page.evaluate(() => JSON.parse(localStorage.getItem("mb-tours-u-me") || "{}"));
const remote = page => fake(page, () => window.__fake.authCalls.filter(c => c.name === "updateUser" && c.data && c.data.tours).map(c => c.data.tours));
const invite = page => page.waitForSelector(".tinv", { timeout: 4000 });

/* ---------------- setup fits the screen ---------------- */
test("setup: short steps fit the screen exactly; long ones scroll and every button can be reached", { skip }, async () => {
  // step 1 (in the sign-in area)
  let o = await open(null, { init: { households: [] }, waitFor: "#fHousehold", ...PHONE });
  let f = await fits(o.page);
  assert.ok(f.h <= f.vh, `step 1 fits (${f.h} ≤ ${f.vh})`);
  assert.ok(f.w <= f.vw, "nothing sideways");
  await shot(o.page, "1-household");
  assert.deepEqual(o.errors, []); await o.ctx.close();

  o = await open({}, { waitFor: ".ob", ...PHONE });
  const { page, errors, ctx } = o;
  f = await fits(page); assert.ok(f.h <= f.vh, `step 2 fits (${f.h} ≤ ${f.vh})`);
  assert.equal(await page.isVisible(".ob-art svg"), true, "a picture, when there's room for one");
  await shot(page, "2-income");
  // the progress bar is kept between steps (so it can glide), not redrawn
  await page.evaluate(() => { window.__bar = document.querySelector(".ob-prog span"); });
  await page.fill('[data-ob="people.0.pay"]', "2000");
  await page.click('[data-obact="next"]');
  assert.equal(await page.evaluate(() => window.__bar === document.querySelector(".ob-prog span")), true, "same progress bar");
  assert.match(await page.textContent(".ob-stage"), /Step 3 of 3/);
  f = await fits(page); assert.ok(f.h > f.vh, "the plan is longer than the screen, so it scrolls");
  // the plan's status and button stay on screen while scrolling the list
  for (const y of [0, 300, 99999]) {
    await page.evaluate(v => scrollTo(0, v), y);
    const r = await page.$eval('[data-obact="next"]', el => el.getBoundingClientRect().bottom);
    assert.ok(r <= 664, `"Use this plan" on screen at scroll ${y}`);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, "3-plan");
  await page.fill('[data-ob="split.0"]', "45");
  assert.match(await page.textContent('[data-obk="status"]'), /5% left to plan/, "percent logic unchanged");
  await page.fill('[data-ob="split.0"]', "50");
  await page.click('[data-obact="next"]');
  await page.waitForSelector(".ob-done");
  f = await fits(page); assert.ok(f.h <= f.vh, `the ready screen fits (${f.h} ≤ ${f.vh})`);
  assert.equal(await page.getAttribute(".ob-prog", "aria-valuenow"), "3");
  await shot(page, "4-ready");
  assert.deepEqual(errors, []); await ctx.close();
});

test("setup on a small phone: opening 'More pay details' makes it scroll, and the payday box can be reached", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob", ...SMALL });
  await page.click(".ob-more summary");
  const f = await fits(page);
  assert.ok(f.h > f.vh, "taller than the screen now");
  await page.locator('[data-ob="people.0.payday"]').scrollIntoViewIfNeeded();
  assert.equal(await page.isVisible('[data-ob="people.0.payday"]'), true);
  await page.locator('[data-obact="next"]').scrollIntoViewIfNeeded();
  await page.click('[data-obact="next"]');
  assert.match(await page.textContent(".ob-stage"), /Step 3 of 3/);
  assert.ok((await fits(page)).w <= 320, "nothing sideways at 320px");
  assert.deepEqual(errors, []); await ctx.close();
});

test("sign-in: the tagline wraps instead of being cut off", { skip }, async () => {
  const { page, ctx } = await open(null, { init: { signedOut: true }, waitFor: "#fSignin", ...SMALL });
  const t = await page.$eval(".auth-brand small", el => ({ vis: getComputedStyle(el).display !== "none", cut: el.scrollWidth > el.clientWidth + 1 }));
  assert.deepEqual(t, { vis: true, cut: false });
  await shot(page, "signin-320");
  await ctx.close();
});

/* ---------------- the menu as a bottom sheet ---------------- */
test("menu on a phone: a sheet; the page behind stays exactly where it was; backdrop, Escape and drag close it", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...PHONE, storage: { "mb-tours-u-me": JSON.stringify({ tabs: { budget: "done", networth: "done", spending: "done", goals: "done", invest: "done", progress: "done" } }) } });
  // a classic (space-taking) scrollbar, like a desktop browser's: hiding it must not reflow or move the page
  await page.addStyleTag({ content: "::-webkit-scrollbar{ width:15px; } ::-webkit-scrollbar-thumb{ background:#999; }" });
  // let the tab finish loading first (anything that arrives late above the fold would move the page by itself)
  await page.waitForLoadState("networkidle"); await page.waitForTimeout(800);
  await page.evaluate(() => scrollTo(0, 500)); await page.waitForTimeout(300);
  const y0 = await page.evaluate(() => scrollY);
  // record anything that changes size while the menu is open, so a failure says what moved
  await page.evaluate(() => { window.__moved = []; let first = true; const ro = new ResizeObserver(es => { if (first) { first = false; return; } es.forEach(e => window.__moved.push(`${e.target.tagName}.${e.target.className} ${Math.round(e.contentRect.height)}`)); }); document.querySelectorAll("#app, #app > *, #app > * > *, #app section").forEach(el => ro.observe(el)); window.addEventListener("scroll", () => window.__moved.push("scroll " + scrollY)); });
  assert.ok(y0 > 300, "scrolled down the Budget tab");
  await page.click("#menuBtn");
  await page.waitForSelector("#pop.as-sheet:not([hidden])");
  assert.equal(await page.getAttribute("#pop", "role"), "dialog");
  assert.equal(await page.getAttribute("#pop", "aria-modal"), "true");
  assert.equal(await page.getAttribute("#menuBtn", "aria-expanded"), "true");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("scroll-locked")), true);
  assert.equal(await page.evaluate(() => document.querySelector("#app").inert), true, "the page behind can't be tapped or focused");
  await shot(page, "menu-sheet");
  // trying to scroll the page behind does nothing
  await page.mouse.move(195, 120); await page.mouse.wheel(0, 600);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => scrollY), y0, `background didn't move (${await page.evaluate(() => window.__moved.join(", "))})`);
  // the sheet's own list still scrolls (when it's taller than the sheet)
  await page.$eval("#pop .pop-body", el => el.scrollTop = 40);
  // backdrop closes it, and the page is where it was
  await page.mouse.click(195, 20);
  await page.waitForSelector("#pop", { state: "hidden" });
  assert.equal(await page.evaluate(() => scrollY), y0, "same place afterwards");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("scroll-locked")), false);
  assert.equal(await page.evaluate(() => document.querySelector("#app").inert), false);
  // Escape
  await page.click("#menuBtn"); await page.waitForSelector("#pop:not([hidden])");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pop", { state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "menuBtn", "focus goes back to the ⋯ button");
  // a small drag on the handle springs back; a long one closes it
  const drag = async dy => {
    const b = await page.$eval("#pop .pop-grab", el => { const r = el.getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2 }; });
    await page.mouse.move(b.x, b.y); await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(b.x, b.y + (dy * k) / 6);
    await page.mouse.up();
  };
  await page.click("#menuBtn"); await page.waitForSelector("#pop:not([hidden])");
  await drag(30);
  await page.waitForTimeout(100);
  assert.equal(await page.isVisible("#pop"), true, "a little drag: still open");
  await drag(320);
  await page.waitForSelector("#pop", { state: "hidden" });
  // open and close several times: never left locked
  for (let k = 0; k < 4; k++) { await page.click("#menuBtn"); await page.waitForSelector("#pop:not([hidden])"); await page.click("#pop [data-pop-close]"); await page.waitForSelector("#pop", { state: "hidden" }); }
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("scroll-locked")), false);
  assert.equal(await page.evaluate(() => scrollY), y0);
  // menu actions still work
  await page.click("#menuBtn"); await page.click('#pop [data-act="appearance"]');
  await page.waitForSelector("#sheet[open]");
  assert.deepEqual(errors, []); await ctx.close();
});

test("menu on a wide screen: still a small menu beside the button, nothing locked", { skip }, async () => {
  const { page, ctx } = await open(RICH, { width: 1280, storage: fresh });
  await page.click("#menuBtn");
  await page.waitForSelector("#pop:not([hidden])");
  assert.equal(await page.evaluate(() => document.querySelector("#pop").classList.contains("as-sheet")), false);
  assert.equal(await page.getAttribute("#pop", "role"), null);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("scroll-locked")), false);
  await page.keyboard.press("Escape");
  await ctx.close();
});

/* ---------------- tours ---------------- */
test("first visits: each tab offers its own tour once; 'Not now' sticks; your progress is saved to your login", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...PHONE }); // nothing stored yet, and a reload keeps what this device saved
  await invite(page);
  assert.match(await page.textContent(".tinv"), /New to Budget\?/);
  await shot(page, "invite-budget");
  await page.click('[data-tinv="no"]');
  await page.waitForSelector(".tinv", { state: "detached" });
  assert.equal((await local(page)).tabs.budget, "dismissed");
  // Net worth asks for itself
  await goTab(page, "networth");
  await invite(page);
  assert.match(await page.textContent(".tinv"), /New to Net worth\?.*what you own and owe/);
  await page.click('[data-tinv="no"]');
  // back to Budget and Net worth: not asked again
  await goTab(page, "budget"); await page.waitForTimeout(1600);
  await goTab(page, "networth"); await page.waitForTimeout(1600);
  assert.equal(await page.locator(".tinv").count(), 0, "no repeat invitations");
  // Goals asks, separately
  await goTab(page, "goals");
  await invite(page);
  assert.match(await page.textContent(".tinv"), /New to Goals\?/);
  // saved to the login (user_metadata), for this person only
  await page.waitForTimeout(1000);
  const sent = await remote(page);
  assert.ok(sent.length >= 1, "sent to your login");
  assert.equal(sent[sent.length - 1].budget, "dismissed");
  assert.equal(sent[sent.length - 1].networth, "dismissed");
  // a refresh remembers
  await page.reload(); await page.waitForSelector("#app .viewas, #app .gl-page");
  await page.waitForTimeout(1600);
  assert.equal(await page.locator(".tinv").count(), 0, "Goals was offered already, so it isn't asked again either");
  assert.deepEqual(errors, []); await ctx.close();
});

test("a tour: spotlight steps for the tab, then done; nothing in the budget changes", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...PHONE, storage: fresh });
  await goTab(page, "networth");
  await invite(page);
  const before = await writes(page);
  await page.click('[data-tinv="go"]');
  await page.waitForSelector(".tour:not([hidden])");
  assert.match(await page.textContent(".tour-n"), /Net worth · 1 of 3/);
  assert.equal(await page.textContent("#tourT"), "Your net worth");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tour), "next", "focus on Next");
  await shot(page, "tour-networth-1");
  // the spotlight sits on the target and the card doesn't cover it
  const geo = await page.evaluate(() => { const s = document.querySelector(".tour-spot").getBoundingClientRect(), c = document.querySelector(".tour-card").getBoundingClientRect(); return { overlap: !(c.bottom <= s.top || c.top >= s.bottom) && s.height < innerHeight * 0.5, sh: s.height }; });
  assert.ok(geo.sh > 20 && !geo.overlap, "a real spotlight, not covered by the card");
  await page.click('[data-tour="next"]'); assert.equal(await page.textContent("#tourT"), "Your accounts");
  await page.click('[data-tour="next"]'); assert.equal(await page.textContent("#tourT"), "Keeping it current");
  await shot(page, "tour-networth-3");
  await page.click('[data-tour="next"]');
  await page.waitForSelector(".tour", { state: "hidden" });
  assert.equal((await local(page)).tabs.networth, "done");
  assert.equal(await writes(page), before, "the tour saved nothing to the budget");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("scroll-locked")), false);
  assert.deepEqual(errors, []); await ctx.close();
});

test("tours on empty tabs make sense, skip what isn't there, and replay from the menu", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { ...PHONE, storage: { ...fresh, "mb-ob-mode-u-me": "solo" }, waitFor: ".ob" });
  await page.click(".ob-later");
  await page.waitForSelector("#app .viewas, #app .b-income");
  // replay Net worth from the menu while on Budget
  await page.click("#menuBtn"); await page.click('#pop [data-act="tours"]');
  assert.equal(await page.locator("#pop [data-tour-replay]").count(), 6, "all six tabs");
  await shot(page, "menu-tours");
  await page.click('#pop [data-tour-replay="networth"]');
  await page.waitForSelector(".tour:not([hidden])");
  assert.equal(await page.getAttribute('[data-tab="networth"]', "aria-selected"), "true", "went to Net worth first");
  assert.match(await page.textContent(".tour-n"), /1 of 2/, "no review card without accounts, so that stop is skipped");
  await page.click('[data-tour="next"]');
  assert.equal(await page.textContent("#tourT"), "Start with an account");
  await page.click('[data-tour="end"]');
  // Goals with no goals: the first-goal card, and the tour points at it
  await goTab(page, "goals");
  assert.match(await page.textContent(".gl-first"), /Create your first goal/);
  await page.click("#menuBtn"); await page.click('#pop [data-act="tours"]'); await page.click('#pop [data-tour-replay="goals"]');
  await page.waitForSelector(".tour:not([hidden])");
  let titles = [await page.textContent("#tourT")];
  while (await page.textContent('[data-tour="next"]') === "Next") { await page.click('[data-tour="next"]'); titles.push(await page.textContent("#tourT")); }
  assert.ok(titles.includes("Your goals") && !titles.includes("Personal goals"), titles.join(", "));
  assert.match(await page.textContent("#tourP"), /./);
  await page.click('[data-tour="next"]');
  // Progress before any snapshot
  await goTab(page, "progress");
  await page.waitForSelector(".pg-start");
  await page.click("#menuBtn"); await page.click('#pop [data-act="tours"]'); await page.click('#pop [data-tour-replay="progress"]');
  await page.waitForSelector(".tour:not([hidden])");
  assert.equal(await page.textContent("#tourT"), "Your journey starts here");
  assert.doesNotMatch(await page.textContent(".tour-card"), /\$/, "no made-up figures");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".tour", { state: "hidden" });
  assert.deepEqual(errors, []); await ctx.close();
});

test("changing tab mid-tour leaves nothing behind; the old Budget tour counts; another person's progress doesn't", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...PHONE, storage: { "mb-tour-done-u-me": "1", "mb-tours-u-other": JSON.stringify({ tabs: { networth: "done", spending: "done" } }) } });
  await page.waitForTimeout(1800);
  assert.equal(await page.locator(".tinv").count(), 0, "finished the old Budget tour: not asked again");
  await goTab(page, "networth");
  await invite(page); // someone else's "done" on this device doesn't count for you
  await page.click('[data-tinv="go"]');
  await page.waitForSelector(".tour:not([hidden])");
  await page.evaluate(() => { location.hash = "goals"; }); // e.g. the back button
  await page.waitForSelector('[data-tab="goals"][aria-selected="true"]');
  await page.waitForSelector(".tour", { state: "hidden" });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("scroll-locked")), false, "not left locked");
  assert.deepEqual(errors, []); await ctx.close();
});

test("progress saved on your login counts on this device too, and invitations wait while you're busy", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...PHONE, storage: fresh, init: { budget: RICH, meta: { tours: { budget: "done", spending: "dismissed" } } } });
  await page.waitForTimeout(1800);
  assert.equal(await page.locator(".tinv").count(), 0, "Budget done on another device");
  await goTab(page, "spending"); await page.waitForTimeout(1800);
  assert.equal(await page.locator(".tinv").count(), 0, "Spending said 'Not now' on another device");
  // open the menu before Invest's invitation would appear: it waits until the menu closes
  await goTab(page, "invest");
  await page.click("#menuBtn"); await page.waitForSelector("#pop:not([hidden])");
  await page.waitForTimeout(1800);
  assert.equal(await page.locator(".tinv").count(), 0, "not while the menu is open");
  await page.keyboard.press("Escape");
  await invite(page);
  assert.match(await page.textContent(".tinv"), /New to Investments\?/);
  assert.deepEqual(errors, []); await ctx.close();
});

test("after setup: 'Open my budget' doesn't ask about the Budget tour again; 'Show me around' starts it", { skip }, async () => {
  for (const choice of ["finish", "tour"]) {
    const { page, errors, ctx } = await open({}, { waitFor: ".ob", ...PHONE, storage: fresh });
    await page.fill('[data-ob="people.0.pay"]', "2000");
    await page.click('[data-obact="next"]'); await page.click('[data-obact="next"]');
    await page.waitForSelector(".ob-done");
    await page.click(`[data-obact="${choice}"]`);
    if (choice === "tour") {
      await page.waitForSelector(".tour:not([hidden])");
      assert.match(await page.textContent(".tour-n"), /Budget · 1 of/);
    } else {
      await page.waitForTimeout(1800);
      assert.equal(await page.locator(".tinv").count(), 0);
    }
    assert.deepEqual(errors, []); await ctx.close();
  }
});
