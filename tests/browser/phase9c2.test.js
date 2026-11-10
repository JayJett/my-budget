/* Phase 9C.2: mobile polish. The tour's last stop stays on screen; setup ends on "Show me around" and
   needs each earner's last payday; the Expenses empty state; doughnuts that aren't clipped; a quieter
   expense check; live updates paused without moving the page; no tab note; the Goals hero. Uses the
   fake Supabase (no real accounts or data). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored, blankBudget } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, fake } from "./helpers.js";

setup();
const ALL_DONE = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(t => [t, "done"])) }) };
const phone = (w = 390, h = 844) => ({ device: { viewport: { width: w, height: h }, hasTouch: true, isMobile: true } });
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `p9c2-${name}.png`) });
const tab = (page, t) => page.evaluate(t => document.querySelector(`#tabs [data-tab="${t}"]`).click(), t);
const rich = () => toStored(migrate(RICH_V3));
function solo(spend = []) {
  const S = blankBudget({ name: "Jarden", mode: "solo" }), p = S.people[0]; p.pay = 2000; p.payday = "2026-11-05";
  const sh = { spending: 0.5, emergency: 0.1, goals: 0.2, invest: 0.2 };
  S.accounts.forEach(a => { if (sh[a.role] != null) a.split[p.id] = sh[a.role]; });
  S.spend = spend; return toStored(S);
}

test("tour: the last Budget stop (your initial) is lit and its card fully on screen, even scrolled down", { skip }, async () => {
  for (const [w, h] of [[320, 568], [390, 844]]) {
    const { page, errors, ctx } = await open(rich(), { ...phone(w, h), hash: "budget", waitFor: "#app .b-income" });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(async () => { const { app } = await import("./js/ui/ctx.js"); app.startTour("budget"); });
    await page.waitForSelector(".tour:not([hidden]) .tour-card");
    for (let k = 0; k < 5; k++) { await page.click('.tour [data-tour="next"]'); await page.waitForTimeout(120); }
    await page.waitForFunction(() => /Your settings/.test(document.querySelector(".tour-card").textContent));
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const box = e => e.getBoundingClientRect(), me = box(document.querySelector("#menuBtn")), spot = box(document.querySelector(".tour-spot")), card = box(document.querySelector(".tour-card"));
      return { meOn: me.top >= 0 && me.bottom <= innerHeight, lit: spot.left <= me.left + 1 && spot.right >= me.right - 1 && spot.top <= me.top + 1 && spot.bottom >= me.bottom - 1,
        cardIn: card.top >= 0 && card.bottom <= innerHeight && card.left >= 0 && card.right <= innerWidth, overlap: !(card.bottom <= me.top || card.top >= me.bottom || card.right <= me.left || card.left >= me.right),
        sticky: !document.documentElement.classList.contains("scroll-locked") };
    });
    assert.deepEqual(r, { meOn: true, lit: true, cardIn: true, overlap: false, sticky: true }, `${w}×${h}`);
    if (w === 390) await shot(page, "tour-last");
    assert.match(await page.textContent(".tour-card"), /Tap your initial for your profile, appearance, reminders and tours/);
    await page.click('.tour [data-tour="next"]'); await page.waitForSelector(".tour", { state: "hidden" });
    assert.deepEqual(errors, [], `${w}`); await ctx.close();
  }
});

test("setup: pay needs its own last payday; pay left blank needs none; the end offers the tour first", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { ...phone(), storage: ALL_DONE, hash: "", waitFor: ".ob" });
  assert.match(await page.textContent(".ob-payday"), /When were you last paid\?/);
  await page.fill('[data-ob="people.0.pay"]', "2000");
  await page.click('[data-obact="next"]');
  await page.waitForSelector(".ob-err");
  assert.match(await page.textContent(".ob-err"), /Add the date you were last paid/);
  assert.match(await page.textContent(".ob-stage"), /Step 2 of 4/, "not past step 2 without it");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.ob), "people.0.payday", "the date box gets focus");
  await shot(page, "payday-needed");
  await page.fill('[data-ob="people.0.payday"]', "2026-11-05");
  assert.equal(await page.locator(".ob-err").count(), 0, "the message goes once a date is in");
  assert.equal(await page.evaluate(() => { const i = document.querySelector('[data-ob="people.0.payday"]'), r = i.getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; }), true, "the date box fits");
  await page.click('[data-obact="next"]'); await page.waitForSelector('[data-obact="next"]');
  assert.match(await page.textContent(".ob-stage"), /Step 3 of 4/);
  await page.click('[data-obact="next"]'); await page.click('[data-obact="acc-skip"]'); await page.waitForSelector(".ob-done");
  assert.equal(await page.textContent(".ob-done-acts .btn.primary"), "Show me around");
  assert.equal(await page.locator('.ob-done-acts .linkish[data-obact="finish"]').count(), 1, "Open Moni Money is the quieter link");
  await shot(page, "done");
  await page.click('[data-obact="finish"]'); await page.waitForSelector("#app .home");
  assert.equal(await page.isVisible(".tour:not([hidden])"), false, "opening the app doesn't start a tour");
  assert.equal(Object.values((await fake(page, () => window.__fake.budget)).people)[0].payday, "2026-11-05");
  assert.deepEqual(errors, []); await ctx.close();
});

test("setup: two earners each need their own date; no pay, no date", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { ...phone(), storage: ALL_DONE, hash: "", waitFor: ".ob" });
  await page.click('[data-obact="back"]'); await page.check('input[name="obmode"][value="with"]'); await page.click('[data-obact="next"]');
  await page.waitForSelector('[data-obact="addperson"]');
  {
    await page.fill('[data-ob="people.0.pay"]', "2000"); await page.fill('[data-ob="people.0.payday"]', "2026-11-05");
    await page.click('[data-obact="addperson"]');
    await page.fill('[data-ob="people.1.name"]', "Madi"); await page.fill('[data-ob="people.1.pay"]', "1200");
    await page.click('[data-obact="next"]'); await page.waitForSelector(".ob-err");
    assert.equal(await page.locator(".ob-err").count(), 1, "only Madi's date is missing");
    assert.equal(await page.inputValue('[data-ob="people.1.payday"]'), "", "Jarden's date isn't copied over");
    await page.fill('[data-ob="people.1.payday"]', "2026-11-06");
    await page.click('[data-obact="next"]'); await page.waitForSelector('[data-obk="tot"]');
  }
  assert.deepEqual(errors, []); await ctx.close();
  // nobody's pay entered yet: no date asked for
  const o = await open({}, { ...phone(), storage: ALL_DONE, hash: "", waitFor: ".ob" });
  await o.page.click('[data-obact="next"]'); await o.page.waitForSelector('[data-obk="tot"]');
  assert.equal(await o.page.locator(".ob-err").count(), 0);
  await o.ctx.close();
});

test("Expenses empty state: the main button full width, 'Add your own' under it", { skip }, async () => {
  for (const w of [320, 390]) {
    const { page, errors, ctx } = await open(solo(), { ...phone(w, 760), storage: ALL_DONE, hash: "expenses", waitFor: "#app .sp-empty" });
    const r = await page.evaluate(() => { const b = document.querySelector(".sp-empty [data-xp-open]").getBoundingClientRect(), l = document.querySelector(".sp-empty .sp-own").getBoundingClientRect(), c = document.querySelector(".sp-empty").getBoundingClientRect();
      return { below: l.top >= b.bottom - 1, inside: b.left >= c.left && b.right <= c.right && l.left >= c.left && l.right <= c.right, tall: b.height >= 44 && l.height >= 44 }; });
    assert.deepEqual(r, { below: true, inside: true, tall: true }, `${w}`);
    if (w === 320) await shot(page, "empty-320");
    assert.deepEqual(errors, []); await ctx.close();
  }
});

test("doughnuts: the whole ring fits inside its box", { skip }, async () => {
  // (Phase 10A: Budget's income doughnut became a bar; the doughnuts left are on Wealth and Expenses)
  const { page, errors, ctx } = await open(rich(), { ...phone(), storage: ALL_DONE, hash: "wealth/accounts", waitFor: "#nwBar svg" });
  const r = await page.evaluate(() => [...document.querySelectorAll(".mini-donut circle")].map(c => Number(c.getAttribute("r")) + Number(c.getAttribute("stroke-width")) / 2));
  assert.ok(r.length && r.every(x => x <= 18), "ring outer edge within the 36-unit box");
  assert.deepEqual(errors, []); await ctx.close();
});

test("expense check: nothing to break down without expenses; opened, two numbers then 'More detail'", { skip }, async () => {
  const a = await open(solo([{ id: "e1", name: "Internet", type: "Fixed", amount: null, period: "Month", notes: "", due: null, aside: null, pos: 1 }]), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
  assert.match(await a.page.textContent("#planCheck .pc-main"), /Add amounts to check your expenses\s*1 expense needs an amount/);
  assert.equal(await a.page.locator("#planCheck [data-pc-toggle]").count(), 0, "no breakdown to open");
  await a.page.click("#planCheck .pc-act"); await a.page.waitForSelector('#sheet [data-l="sp"][data-i="e1"]');
  await a.ctx.close();
  const { page, errors, ctx } = await open(solo([{ id: "e1", name: "Rent", type: "Fixed", amount: 900, period: "Fortnight", notes: "", due: null, aside: null, pos: 1 }]), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
  await page.click("#planCheck [data-pc-toggle]");
  assert.match(await page.textContent("#planCheck .pc-sum"), /Entered expenses\s*\$900\/fn\s*Budget for them\s*\$1,000\/fn/);
  assert.equal(await page.isVisible("#planCheck .pc-deep .ib"), false, "where pay goes waits behind 'More detail'");
  await page.click("#planCheck .pc-deep summary");
  assert.equal(await page.isVisible("#planCheck .pc-deep .ib"), true);
  await page.$eval("#planCheck", e => e.scrollIntoView()); await shot(page, "check-open");
  assert.deepEqual(errors, []); await ctx.close();
});

test("live updates paused: no banner, nothing moves; the dot explains and reconnects; a failed save still speaks up", { skip }, async () => {
  const { page, errors, ctx } = await open(solo(), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "Saved");
  const y0 = await page.$eval("#app .b-income", e => e.getBoundingClientRect().top);
  await fake(page, () => { window.__fake.liveDown = true; window.__fake.live("CHANNEL_ERROR"); });
  await page.waitForSelector("#saveState.paused");
  assert.equal(await page.isVisible("#conn"), false, "no banner");
  assert.equal(await page.$eval("#app .b-income", e => e.getBoundingClientRect().top), y0, "the page didn't move");
  assert.equal(await page.textContent("#saveText"), "Live updates paused");
  await page.click("#saveState"); await page.waitForSelector(".live-pop");
  assert.match(await page.textContent(".live-pop"), /Live updates paused[\s\S]*Your changes still save/);
  await shot(page, "live-paused");
  const n0 = await fake(page, () => window.__fake.subscribes);
  await fake(page, () => { window.__fake.liveDown = false; });
  await page.click('.live-pop [data-live="retry"]');
  await page.waitForFunction(() => !document.querySelector("#saveState.paused"));
  assert.ok((await fake(page, () => window.__fake.subscribes)) > n0, "it subscribed again");
  // a save that fails is said out loud, not just a dot
  await fake(page, () => { window.__fake.failNext = 5; });
  await page.click('[data-edit-acc="js"]'); await page.waitForSelector('#sheet [data-f="name"]');
  await page.fill('#sheet [data-f="name"]', "Bills");
  await page.waitForSelector("#toast.on", { timeout: 10000 });
  assert.match(await page.textContent("#toast"), /didn’t save yet/);
  assert.deepEqual(errors.filter(e => !/Failed to fetch/.test(e)), []); await ctx.close();
});

test("no note box at the end of Budget; an existing note is kept, tucked away; Goals hero shows the count beside the saved amount", { skip }, async () => {
  const a = await open(solo(), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#app .b-income" });
  assert.equal(await a.page.locator("#app .note-input").count(), 0);
  await a.ctx.close();
  const S = rich(); S.note = "Remember the rates rise";
  const { page, errors, ctx } = await open(S, { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#app .b-income" });
  assert.equal(await page.isVisible("#app .note-input"), false, "tucked away");
  await page.click("#app .b-note-old summary");
  assert.equal(await page.inputValue("#app .note-input"), "Remember the rates rise");
  assert.equal((await fake(page, () => window.__fake.budget)).note, "Remember the rates rise", "kept as it is");
  await tab(page, "goals"); await page.waitForSelector("#app .gl-hero-top");
  const g = await page.evaluate(() => { const l = document.querySelector(".gl-top-l .amt").getBoundingClientRect(), r = document.querySelector(".gl-count").getBoundingClientRect(), c = document.querySelector(".gl-sum").getBoundingClientRect();
    return { same: Math.abs(l.bottom - r.bottom) < 14, right: c.right - r.right < 40, text: document.querySelector(".gl-sum").textContent.replace(/\s+/g, " ") }; });
  assert.equal(g.same, true); assert.equal(g.right, true);
  assert.match(g.text, /Saved so far\s*\$13,200\s*Your goals\s*7\s*2 reached\s*of \$103,600 total target/);
  assert.equal((g.text.match(/7 goals/g) || []).length, 0, "the count isn't said twice");
  await shot(page, "goals");
  // pages end without a divider line before "How it works" and without a big empty run
  for (const t of ["goals", "budget", "spending", "home"]) {
    await tab(page, t); await page.waitForTimeout(150);
    const gap = await page.evaluate(() => { const els = [...document.querySelectorAll("#app > * *")].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0); const last = Math.max(...els.map(e => e.getBoundingClientRect().bottom + scrollY)); return document.scrollingElement.scrollHeight - last; });
    assert.ok(gap < 200, `${t}: ${Math.round(gap)}px after the last thing`);
  }
  assert.equal(await page.evaluate(() => { const h = document.querySelector("details.help"); return h ? getComputedStyle(h).borderTopWidth : "0px"; }), "0px");
  assert.deepEqual(errors, []); await ctx.close();
});
